const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const A=require('../js/accounting'),AD=require('../js/accounting-domain'),C=require('../js/cloud-core');
const digest=async x=>crypto.createHash('sha256').update(C.canonical(C.normalizeDates(Object.fromEntries(Object.entries(x).map(([n,rs])=>[n,rs.slice().sort((a,b)=>a.id.localeCompare(b.id))]))))).digest('hex');
const b={bankTxnId:'duplicate',bankAccount:'メイン口座',bankTransactionDate:'2026-10-31',description:'ダイナスト',incoming:1594900,outgoing:0,amount:1594900,balance:2000000,status:'未照合',deletedAt:null};
function setup(){
 const rows={bankTransactions:[{id:'duplicate',revision:1,payload:{...b}},{id:'keeper',revision:1,payload:{...b,bankTxnId:'keeper',bankAccount:'GMO あおぞら'}}],settings:[{id:'alias',revision:1,payload:{type:'bankAccountAlias',key:'メイン口座',canonical:'gmo あおぞら',enabled:true,reviewedBy:'admin'}}],payments:[],sales:[],expenses:[],documents:[],cashLedger:[]};
 const writes=[];
 const context={who:{uid:'admin',role:'admin'},bankSeed:rows,backupDigest:digest,read:async(n,id)=>rows[n]?.find(r=>r.id===id)||null,write:async(n,id,p,action,v)=>{const row=rows[n].find(r=>r.id===id);assert.equal(row.revision,v);writes.push({n,id,action,before:row.payload});row.payload=p;row.revision++;}};
 const command=async(extra={})=>({type:'bankCancelDuplicate',bankTxnId:'duplicate',keeperId:'keeper',expectedRevision:1,keeperRevision:1,reason:'原本確認済み重複',sourceVerified:true,sourceEvidence:'bank.csv / 残高2000000 / 同一口座',backupDigest:await digest(rows),...extra});
 return {rows,writes,context,command};
}
test('cancel retains complete original, keeper and financial records; restore returns byte-equivalent payload',async()=>{
 const h=setup(),before=JSON.stringify(h.rows),original=JSON.stringify(h.rows.bankTransactions[0].payload);
 await AD.handle(await h.command(),h.context);assert.equal(h.rows.bankTransactions[0].payload.status,'cancelled');assert(!A.live(h.rows.bankTransactions[0].payload));
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].n,'bankTransactions');assert.equal(JSON.stringify(h.rows.bankTransactions[1]),JSON.parse(before).bankTransactions.map(JSON.stringify)[1]);
 await assert.rejects(AD.handle({type:'bankMatch',bankTxnId:'duplicate'},h.context),/取消済み/);
 await assert.rejects(AD.handle({type:'bankExclude',bankTxnId:'duplicate'},h.context));
 await AD.handle(await h.command({type:'bankRestoreDuplicate',expectedRevision:2}),h.context);
 assert.equal(JSON.stringify(h.rows.bankTransactions[0].payload),original);assert.equal(h.writes.length,2);
});
test('weak evidence, distinct occurrence, changed descriptions, wrong keeper and linked records are blocked',async()=>{
 for(const mutate of [h=>{delete h.rows.bankTransactions[0].payload.balance;},h=>{h.rows.bankTransactions[0].payload.occurrence=2;},h=>{h.rows.bankTransactions[0].payload.description='別取引';},h=>{h.rows.bankTransactions[1].payload.bankAccount='別口座';},h=>{h.rows.bankTransactions[0].payload.status='照合済';},h=>{h.rows.payments.push({id:'p',revision:1,payload:{bankTxnId:'duplicate',confirmation:'bank-confirmed'}});},h=>{h.rows.documents.push({id:'doc',revision:1,payload:{snapshot:{bankId:'duplicate'}}});}]){
  const h=setup();mutate(h);await assert.rejects(AD.handle(await h.command(),h.context));assert.equal(h.writes.length,0);
 }
});
test('admin, versions, source confirmation and matching backup are mandatory',async()=>{
 for(const patch of [{expectedRevision:0},{keeperRevision:2},{sourceVerified:false},{sourceEvidence:''},{backupDigest:'stale'}]){const h=setup();await assert.rejects(AD.handle(await h.command(patch),h.context));assert.equal(h.writes.length,0);}
 const h=setup();h.context.who.role='staff';await assert.rejects(AD.handle(await h.command(),h.context));
});
test('date and amount alone never authorize; bank KPI ignores cancelled records',()=>{
 const h=setup(),data=Object.fromEntries(Object.entries(h.rows).map(([n,rs])=>[n,rs.map(r=>({...r.payload,id:r.id}))]));delete data.bankTransactions[0].balance;delete data.bankTransactions[1].balance;assert(A.bankCancellationReview(...data.bankTransactions,data).reasons.length);
 assert.equal(A.bankMatch({...b,status:'cancelled'},data).candidates.length,0);
});

const B=require('../js/business-domain');
async function harness(){
 const rows=new Map();let cb,retries=0;
 const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const r=rows.get(p)||null;reads.set(p,r);return r;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(rows.get(p)||null)!==v)){retries++;continue;}for(const [p,v]of writes)rows.set(p,v);return result;}}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo-tsukinowa',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 const execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});return {client,rows,service,list,execute,retries:()=>retries};
}



test('service dispatch validates current full backup and only writes bank plus audit/operation',async()=>{
 const h=await harness();
 await h.client.put('bankTransactions','duplicate',b,{operationId:'seed_b'});
 await h.client.put('bankTransactions','keeper',{...b,bankTxnId:'keeper',bankAccount:'GMO あおぞら'},{operationId:'seed_k'});
 await h.execute({type:'saveBankRule',ruleType:'bankAccountAlias',key:'メイン口座',canonical:'GMO あおぞら'});
 const snapshot=Object.fromEntries(await Promise.all(B.COLLECTIONS.filter(n=>n!=='auditLogs').map(async n=>[n,await h.client.listRecords(n)])));
 const cmd={type:'bankCancelDuplicate',bankTxnId:'duplicate',keeperId:'keeper',expectedRevision:1,keeperRevision:1,reason:'原本確認',sourceEvidence:'bank.csv / balance2000000',sourceVerified:true,backupDigest:await digest(snapshot)};
 const before=JSON.stringify(h.list('bankTransactions').find(r=>r.id==='keeper'));
 await h.execute(cmd);assert.equal(h.list('bankTransactions').find(r=>r.id==='duplicate').payload.status,'cancelled');assert.equal(JSON.stringify(h.list('bankTransactions').find(r=>r.id==='keeper')),before);
 assert.equal(h.list('payments').length,0);assert.equal(h.list('sales').length,0);assert.equal(h.list('cashLedger').length,0);assert(h.list('auditLogs').some(r=>r.action==='bank duplicate cancel'));
 await h.execute({...cmd,type:'bankRestoreDuplicate',expectedRevision:2});assert.deepEqual(h.list('bankTransactions').find(r=>r.id==='duplicate').payload,b);
});
test('production service gate rejects cancellation before accessing records',async()=>{
 const service=B.createService({getState:()=>({role:'admin',projectId:'tsukinowa-business'})});
 await assert.rejects(service.execute({type:'bankCancelDuplicate',operationId:'cancel'}),/参照ロック/);
 await assert.rejects(service.execute({type:'bankRestoreDuplicate',operationId:'restore'}),/参照ロック/);
});

test('review UI renders IDs and evidence, blocks weak rows, hides rows from staff, and gates production clicks',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');class Element{constructor(){this.children=[];this.style={};this.textContent='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}}
 const panel=new Element(),status=new Element(),alerts=[],sent=[];let role='admin';const h=setup();
 const client={getState:()=>({role,projectId:'tsukinowa-business',companyId:'tsukinowa'})};
 const root={TsukinowaAccounting:A,TsukinowaBusinessUI:{isEnabled:()=>true,getClient:()=>client,getSync:()=>({getQueue:()=>[]}),enqueue:c=>sent.push(c)}};
 const context={window:root,document:{getElementById:id=>({bankDuplicateReview:panel,bankDuplicateStatus:status,accountingMessage:status}[id]),createElement:()=>new Element(),addEventListener:()=>{}},crypto,bizState:{},bizEsc:String,bizMoney:String,alert:m=>alerts.push(m),confirm:()=>true,prompt:()=>{throw Error('production should not prompt');}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/accounting-ui.js'),'utf8'),context);
 root.TsukinowaAccountingUI.hydrate(h.rows);assert.equal(panel.children.length,1);assert.match(panel.children[0].children[0].textContent,/duplicate.*keeper/);assert.equal(panel.children[0].children[1].disabled,false);
 await root.accountingDuplicateAction('duplicate','keeper',false);assert.equal(sent.length,0);assert.match(alerts[0],/参照ロック/);
 delete h.rows.bankTransactions[0].payload.balance;root.TsukinowaAccountingUI.hydrate(h.rows);assert.equal(panel.children[0].children[1].disabled,true);
 role='staff';root.TsukinowaAccountingUI.hydrate(h.rows);assert.equal(panel.children.length,0);
});
