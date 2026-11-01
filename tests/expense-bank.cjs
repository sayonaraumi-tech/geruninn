const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(){
 const rows=new Map();let cb,retries=0;
 const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const r=rows.get(p)||null;reads.set(p,r);return r;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(rows.get(p)||null)!==v)){retries++;continue;}for(const [p,v]of writes)rows.set(p,v);return result;}}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 const execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});return {client,rows,service,list,execute,retries:()=>retries};
}

const A=require('../js/accounting');

const expense=(over={})=>({expenseDate:'2026-10-02',category:'旅費交通費',paymentMethod:'銀行振込',amount:6060,vendor:'ビックカメラ',description:'備品',...over});
const bank=(over={})=>({bankTxnId:'bank-one',bankTransactionDate:'2026-10-04',incoming:0,outgoing:6060,amount:6060,description:'ビックカメラ',bankAccount:'メイン口座',...over});
test('CSV format, BOM, quoted commas/newlines, validation and all six duplicate fields',()=>{
 const csv='\ufeff日付,科目,支払方法,金額,取引先,内容・備考\r\n2026/10/02,旅費交通費,銀行振込,"6,060",ビックカメラ,"備品\n購入"\r\n';
 const p=A.expensePreview(csv);assert.equal(p.count,1);assert.equal(p.total,6060);assert.deepEqual(p.errors,[]);assert.equal(p.records[0].expense.description,'備品\n購入');
 assert.equal(A.expensePreview(csv,[p.records[0].expense]).duplicates,1);
 for(const change of [{expenseDate:'2026-10-03'},{category:'その他'},{amount:6061},{vendor:'別店'},{paymentMethod:'口座振替'},{description:'別内容'}])assert.notEqual(A.expenseKey(expense()),A.expenseKey(expense(change)));
 const bad=A.expensePreview('日付,科目,支払方法,金額,取引先,内容・備考\n2026-02-30,その他,現金,1,A,B\n2026-10-01,その他,不明,-1,A,B');assert.equal(bad.errors.length,2);assert.throws(()=>A.expensePreview('日付,金額\n2026-10-01,1'));
});
test('manual and CSV share saveExpense, repeated/concurrent imports skip and only cash mirrors',async()=>{
 const h=await harness();
 for(const [i,method] of A.METHODS.entries()){
 const e=expense({paymentMethod:method,description:method});await h.execute({type:'saveExpense',expenseId:'manual-'+i,expense:e,expectedRevision:0});
 const cmd={type:'saveExpense',expenseId:'ignored-client-id',expense:e,skipDuplicate:true,expectedRevision:0};await h.execute(cmd);assert.equal(h.list('expenses').length,i+1);
 }
 assert.equal(h.list('cashLedger').filter(r=>A.live(r.payload)).length,1);assert.equal(A.cashRows(h.list('cashLedger').map(r=>r.payload)).at(-1).runningBalance,-6060);
 const cmd={type:'saveExpense',expenseId:'ignored',expense:expense({description:'新規CSV'}),skipDuplicate:true,expectedRevision:0};await Promise.all([h.execute(cmd),h.execute(cmd)]);await h.execute(cmd);assert.equal(h.list('expenses').length,7);
 // Manual correction retains its existing ID and cash tombstone behavior.
 await h.execute({type:'saveExpense',expenseId:'manual-0',expense:expense({paymentMethod:'口座振替'}),expectedRevision:1});assert.equal(A.cashRows(h.list('cashLedger').map(r=>r.payload)).length,0);
});
test('bank import is evidence only; match/replay/unmatch updates existing expense, never creates fee',async()=>{
 const h=await harness(),e=expense();await h.execute({type:'saveExpense',expenseId:'expense-one',expense:e,expectedRevision:0});await h.execute({type:'importBank',bank:bank()});
 const data=()=>({expenses:h.list('expenses').map(r=>r.payload)});assert.equal(A.expenseMatch(bank(),data()).status,'要確認');assert.equal(h.list('expenses').length,1);
 const cmd={type:'bankMatch',bankTxnId:'bank-one',targetType:'expense',targetId:'expense-one',expectedRevision:1};await h.execute(cmd);await h.execute(cmd);assert.equal(h.list('expenses').length,1);assert.equal(h.list('expenses')[0].payload.bankTxnId,'bank-one');assert.equal(h.list('cashLedger').length,0);
 await h.execute({type:'bankUnmatch',bankTxnId:'bank-one',reason:'再確認',expectedRevision:2});assert(!h.list('expenses')[0].payload.bankTxnId);assert.equal(h.list('expenses').length,1);
});
test('ambiguous, weak, nonbank and monthly card evidence never silently matches or creates expense',async()=>{
 const e={...expense(),expenseId:'one'},b=bank(),data={expenses:[e]};
 assert.equal(A.expenseMatch({...b,description:'不明'},data).status,'候補');assert.equal(A.expenseMatch(b,{expenses:[e,{...e,expenseId:'two'}]}).status,'候補');
 assert.equal(A.expenseMatch({...b,bankTransactionDate:'2026-10-10'},data).status,'未一致');assert.equal(A.expenseMatch({...b,outgoing:1},data).status,'未一致');
 for(const paymentMethod of ['現金','代表者立替（交通系IC）','その他'])assert.equal(A.expenseMatch(b,{expenses:[{...e,paymentMethod}]}).status,'未一致');
 const h=await harness();await h.execute({type:'saveExpense',expenseId:'one',expense:expense(),expectedRevision:0});
 for(const description of ['VISA カード利用代金','JCB','ｶｰﾄﾞ利用代金']){
 const row=bank({bankTxnId:description,description});await h.execute({type:'importBank',bank:row});assert(A.expenseMatch(row,data).card);assert.deepEqual(A.suggestions(row,data),[]);
 await assert.rejects(h.execute({type:'bankMatch',bankTxnId:description,targetType:'expense',targetId:'one',expectedRevision:1}),/一致/);
 }
 assert.equal(h.list('expenses').length,1);assert(!h.list('expenses')[0].payload.bankTxnId);
});
test('sales incoming suggestions preserve existing pending payment matching',()=>{
 const data={sales:[{id:'sale',salesDate:'2026-10-01',invoiceDate:'2026-10-01',amount:6060,customer:'ビックカメラ'}],payments:[{id:'pending',saleId:'sale',amount:6060,paymentDate:'2026-10-02',confirmation:'pending-bank'}]};
 assert(A.suggestions(bank({incoming:6060,outgoing:0}),data).some(s=>s.kind==='sale'&&s.paymentId==='pending'));
});

test('single corporate card purchase can match, monthly settlement cannot',()=>{for(const paymentMethod of ['法人カード決済','クレジットカード'])assert.equal(A.expenseMatch(bank(),{expenses:[{...expense({paymentMethod}),expenseId:'card'}]}).status,'要確認');});
