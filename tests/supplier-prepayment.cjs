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


const supplier={supplierName:'東鵬',openingBalance:0,openingDate:'2026-10-01'};
const bank={bankTxnId:'dongpeng',bankTransactionDate:'2026-10-13',incoming:0,outgoing:1000000,amount:1000000,description:'東鵬 壁紙前渡',bankAccount:'GMO あおぞら'};
async function setup(){const h=await harness();await h.execute({type:'saveSupplier',supplierId:'dongpeng',supplier,expectedRevision:0});await h.execute({type:'importBank',bank});return h;}
test('million yen prepayment is one supplier asset and bank link, no expense or duplicate outflow',async()=>{
 const h=await setup(),cmd={type:'supplierFromBank',bankTxnId:bank.bankTxnId,supplierId:'dongpeng',description:'壁紙前渡金',expectedRevision:1};await h.execute(cmd);await h.execute(cmd);
 assert.equal(h.list('expenses').length,0);assert.equal(h.list('payments').length,0);assert.equal(h.list('supplierTransactions').length,1);assert.equal(h.list('suppliers')[0].payload.currentBalance,1000000);assert.equal(h.list('bankTransactions').length,1);assert.equal(h.list('bankTransactions')[0].payload.matchType,'supplier');
});
test('reviewed monthly invoice separates purchase and actual deduction; repeat number month and PDF rejected atomically',async()=>{
 const h=await setup();await h.execute({type:'supplierFromBank',bankTxnId:'dongpeng',supplierId:'dongpeng',description:'壁紙前渡金',expectedRevision:1});
 const transaction={supplierId:'dongpeng',invoiceNo:'DP-10',invoiceMonth:'2026-10',date:'2026-10-31',amount:120000,deductionAmount:100000,description:'壁紙購入',reviewed:true,sourceHash:'a'.repeat(64)};
 await h.execute({type:'settleSupplierInvoice',transaction});assert.equal(h.list('suppliers')[0].payload.currentBalance,900000);assert.equal(h.list('expenses')[0].payload.amount,120000);assert.equal(A.supplierBalance({...supplier,supplierId:'dongpeng'},h.list('supplierTransactions').map(r=>r.payload)),900000);assert.equal(h.list('bankTransactions').length,1);
 for(const patch of [{},{invoiceMonth:'2026-11'},{invoiceMonth:'2026-11',invoiceNo:'new'}])await assert.rejects(h.execute({type:'settleSupplierInvoice',transaction:{...transaction,...patch}}),/重複/);
 assert.equal(h.list('expenses').length,1);assert.equal(h.list('suppliers')[0].payload.currentBalance,900000);
});
test('unreviewed and excessive deductions perform zero writes',async()=>{
 const h=await setup(),transaction={supplierId:'dongpeng',invoiceNo:'DP',invoiceMonth:'2026-10',date:'2026-10-31',amount:100,deductionAmount:101,description:'材料',reviewed:true};
 await assert.rejects(h.execute({type:'settleSupplierInvoice',transaction}),/控除額/);await assert.rejects(h.execute({type:'settleSupplierInvoice',transaction:{...transaction,reviewed:false}}),/確認/);assert.equal(h.list('expenses').length,0);assert.equal(h.list('supplierTransactions').length,0);
});
test('interest requires reviewed policy, cashback note cannot post income, advance cannot become expense',async()=>{
 const h=await setup();await assert.rejects(h.execute({type:'bankMatch',bankTxnId:'dongpeng',targetType:'expense',targetId:'any',expectedRevision:1}),/前渡金/);await assert.rejects(h.execute({type:'expenseFromBank',bankTxnId:'dongpeng',expense:{expenseDate:'2026-10-13',category:'材料費',paymentMethod:'銀行振込',amount:1000000,vendor:'東鵬',description:'壁紙'},expectedRevision:1}),/前渡金/);
 await h.execute({type:'importBank',bank:{bankTxnId:'interest',bankTransactionDate:'2026-10-01',incoming:2679,outgoing:0,amount:2679,description:'普通預金利息',bankAccount:'GMO あおぞら'}});
 const c={type:'reviewBankIncome',bankTxnId:'interest',note:'承認済み口径を原本照合',interest:true,expectedRevision:1};await assert.rejects(h.execute(c),/会計口径/);await h.execute({type:'saveBankRule',ruleType:'bankSpecialPolicy',key:'受取利息'});await h.execute(c);
 assert.equal(h.list('bankTransactions').find(r=>r.id==='interest').payload.matchType,'bankIncome');
 await h.execute({type:'importBank',bank:{bankTxnId:'cashback',bankTransactionDate:'2026-10-21',incoming:3071,outgoing:0,amount:3071,description:'Visaデビットキャッシュバック',bankAccount:'GMO あおぞら'}});
 await h.execute({type:'reviewBankIncome',bankTxnId:'cashback',note:'値引・返金・特典の原本確認待ち',interest:false,expectedRevision:1});const cash=h.list('bankTransactions').find(r=>r.id==='cashback').payload;assert.equal(cash.status,'未照合');assert.equal(cash.matchType,undefined);assert.equal(h.list('expenses').length,0);
});
