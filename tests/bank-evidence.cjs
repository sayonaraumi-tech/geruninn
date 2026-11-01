const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(){
 const rows=new Map();let cb,retries=0;
 const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const r=rows.get(p)||null;reads.set(p,r);return r;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(rows.get(p)||null)!==v)){retries++;continue;}for(const [p,v]of writes)rows.set(p,v);return result;}}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 const execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});return {client,rows,service,list,execute,retries:()=>retries};
}


const A=require('../js/accounting'),Y=require('../js/year-end');
const sale=(id='sale',over={})=>({id,salesDate:'2026-10-24',invoiceDate:'2026-10-24',amount:79500,customer:'株式会社テスト',...over});
const bank=(id='bank',over={})=>({bankTxnId:id,bankTransactionDate:'2026-10-25',description:'振込 株式会社テスト',incoming:79500,outgoing:0,amount:79500,bankAccount:'試験口座',...over});
const digest=async s=>crypto.createHash('sha256').update(s).digest('hex');
const expense={expenseDate:'2026-10-25',category:'消耗品費',paymentMethod:'銀行振込',amount:6060,vendor:'試験店',description:'備品確認'};
const data=h=>Object.fromEntries(['sales','payments','expenses','bankTransactions'].map(n=>[n,h.list(n).map(r=>({...r.payload,id:r.id}))]));
async function seed(h,s){await h.execute({type:'migrateRecord',collection:'sales',id:s.id,payload:s});}
const csv='取引日,摘要,入金,出金,残高\n2026-10-31,振込 ダイナスト（ド,1594900,,2000000\n2026-10-30,ネットプロテクションズ,,207949,405100\n2026-10-30,振込手数料,,100,405000\n2026-10-28,Visaデビット AMAZON TID:46301325931956,,1172,612949';
async function rule(h,ruleType,key,extra={}){return h.execute({type:'saveBankRule',ruleType,key,...extra});}
test('reviewed aliases reuse strong existing evidence, retain occurrences and real equal-value transfers',async()=>{
 const h=await harness();await rule(h,'bankAccountAlias','メイン口座',{canonical:'GMOあおぞら'});
 for(const account of ['GMOあおぞら','メイン口座'])for(const b of await A.parseBank(csv,account,digest))await h.execute({type:'importBank',bank:b});
 assert.equal(h.list('bankTransactions').length,4);
 const historical=JSON.stringify(h.list('bankTransactions'));
 for(const b of await A.parseBank(csv,'メイン口座',digest))await h.execute({type:'importBank',bank:b});
 assert.equal(JSON.stringify(h.list('bankTransactions')),historical);
 const repeated=await A.parseBank('日付,摘要,入金,出金,残高\n2026-10-01,同額,100,,1000\n2026-10-01,同額,100,,1000\n2026-10-01,同額,100,,1100','GMOあおぞら',digest);
 for(const b of repeated)await h.execute({type:'importBank',bank:b});assert.equal(h.list('bankTransactions').length,7);
 assert.notEqual(A.bankIdentity(repeated[0]),A.bankIdentity(repeated[1]));
 assert.equal(A.bankIdentity({...repeated[0],balance:''}),'');
});
test('trusted unique full receipt automatically confirms and preserves original sale period',async()=>{
 const h=await harness();await seed(h,sale('sale',{salesDate:'2026-09-30'}));await rule(h,'bankPartyAlias','振込 株式会社テスト',{customer:'株式会社テスト'});
 await h.execute({type:'importBank',bank:bank('auto',{balance:100000})});
 const d=data(h);assert.equal(d.payments.length,1);assert.equal(d.bankTransactions[0].status,'照合済');assert(A.bankEvidence(d.payments[0],d));
 const m=A.monthly(d,'2026-10');assert.equal(m.sales,0);assert.equal(m.income,79500);assert.equal(A.ledgerRows(d,A.periodFilter({month:'2026-10'})).filter(r=>r.type==='過月売上の入金').length,1);
 await h.execute({type:'importBank',bank:bank('different-id',{balance:100000})});assert.equal(h.list('payments').length,1);
});
test('confirmed payment reused, hand date is not bank evidence and bank date is retained separately',async()=>{
 const h=await harness();await seed(h,sale());await h.execute({type:'payment',paymentId:'receipt',saleId:'sale',amount:79500,paymentDate:'2026-09-30',method:'銀行振込',manualConfirmed:true});
 let d=data(h);assert(!A.bankEvidence(d.payments[0],d));assert(A.ledgerRows(d,A.periodFilter({month:'2026-10'}))[0].status.includes('銀行未照合'));
 await rule(h,'bankPartyAlias','振込 株式会社テスト',{customer:'株式会社テスト'});await h.execute({type:'importBank',bank:bank('reuse',{balance:100000})});
 d=data(h);assert.equal(d.payments.length,1);assert.equal(d.payments[0].paymentDate,'2026-09-30');assert.equal(d.payments[0].bankTransactionDate,'2026-10-25');assert(A.bankEvidence(d.payments[0],d));assert.equal(A.monthly(d,'2026-10').income,0);
});
test('untrusted names, partial, multiple anchors, orphan and missing strong identity require review',async()=>{
 for(const mode of ['untrusted','partial','multiple','orphan','weak']){const h=await harness();await seed(h,sale());if(mode!=='untrusted')await rule(h,'bankPartyAlias','振込 株式会社テスト',{customer:'株式会社テスト'});if(mode==='multiple')await seed(h,sale('two'));if(mode==='partial')await h.execute({type:'payment',paymentId:'partial',saleId:'sale',amount:100,paymentDate:'2026-10-24',method:'銀行振込',manualConfirmed:true});
  await h.execute({type:'importBank',bank:bank(mode,{balance:mode==='weak'?'':100000,incoming:mode==='partial'?79400:79500,amount:mode==='partial'?79400:79500,description:mode==='orphan'?'ダイナスト':'振込 株式会社テスト'})});assert.equal(h.list('bankTransactions')[0].payload.status,'未照合',mode);
 }
});
test('special accounting is policy gated, interest never sales, fees once, debit is not monthly card',async()=>{
 const h=await harness();for(const category of ['受取利息','支払手数料'])await rule(h,'bankSpecialPolicy',category);
 const interest=bank('interest',{description:'受取利息',incoming:50,amount:50,balance:100050});await h.execute({type:'importBank',bank:interest});await h.execute({type:'importBank',bank:interest});
 const fee=bank('fee',{description:'振込手数料',incoming:0,outgoing:100,amount:100,balance:99950});await h.execute({type:'importBank',bank:fee});await h.execute({type:'importBank',bank:fee});
 const d=data(h),m=A.monthly(d,'2026-10');assert.equal(d.sales.length,0);assert.equal(d.payments.length,0);assert.equal(d.expenses.length,1);assert.equal(m.sales,0);assert.equal(m.otherIncome,50);assert.equal(m.expenseTotal,100);assert.equal(m.cashFlowDifference,-50);assert.equal(Y.annual(d,2026).otherIncome,50);
 assert(!A.cardSettlement({outgoing:1172,description:'Visaデビット利用 AMAZON TID:46301325931956'}));assert(A.cardSettlement({outgoing:200000,description:'VISA カード利用代金'}));
});
test('concurrent evidence cannot double receive the same sale',async()=>{
 const h=await harness();await seed(h,sale());await rule(h,'bankPartyAlias','振込 株式会社テスト',{customer:'株式会社テスト'});
 await Promise.allSettled([100000,200000].map(balance=>h.execute({type:'importBank',bank:bank('b'+balance,{balance})})));
 assert.equal(h.list('payments').filter(p=>A.confirmed(p.payload)).reduce((n,p)=>n+p.payload.amount,0),79500);
});
test('legacy Firestore IDs remain byte-for-byte unchanged on alias CSV import; conflicting bank number fails',async()=>{
 const h=await harness(),legacy=bank('legacy-hash',{bankAccount:'GMOあおぞら',balance:100000,externalId:'GMO-123',occurrence:1,hash:'old-account-dependent-hash',status:'未照合'});
 await h.execute({type:'migrateAccounting',collection:'bankTransactions',id:legacy.bankTxnId,payload:legacy});
 await rule(h,'bankAccountAlias','メイン口座',{canonical:'GMOあおぞら'});const before=JSON.stringify(h.list('bankTransactions'));
 await h.execute({type:'importBank',bank:{...legacy,bankAccount:'メイン口座',bankTxnId:'new-hash'}});assert.equal(JSON.stringify(h.list('bankTransactions')),before);
 await assert.rejects(h.execute({type:'importBank',bank:{...legacy,bankAccount:'メイン口座',bankTxnId:'conflict',incoming:1,amount:1}}),/要確認/);assert.equal(JSON.stringify(h.list('bankTransactions')),before);
});

test('all existing expense categories remain available; payroll/outsource rules still require review',()=>{
 for(const category of A.CATEGORIES){const r={type:'expenseCategoryRule',key:'confirmed vendor',category,enabled:true};const c=A.classifyExpense('confirmed vendor','',[r]);assert.equal(c.category,category);assert.equal(c.review,['給与','外注費'].includes(category));assert.equal(A.classifyExpense('confirmed vendor',category,[{...r,category:'その他'}]).category,category);}
});
