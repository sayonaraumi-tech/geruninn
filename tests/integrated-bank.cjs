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



const bank=(id,extra={})=>({bankTxnId:id,bankTransactionDate:'2026-10-01',bankAccount:'GMO',description:'STRIPE JAPAN',incoming:62068,outgoing:0,amount:62068,...extra});
const data=h=>Object.fromEntries(['sales','payments','expenses','bankTransactions','cashLedger','supplierTransactions'].map(n=>[n,h.list(n).map(r=>({...r.payload,id:r.id}))]));
async function platform(h,fee=0,manualConfirmed=false){
 for(const [id,amount] of [['one',30000],['two',32068+fee]]){
  await h.execute({type:'migrateRecord',collection:'sales',id,payload:{id,customer:id,salesDate:'2026-09-28',amount}});
  await h.execute({type:'payment',paymentId:'pay_'+id,saleId:id,amount,paymentDate:'2026-09-30',method:'プラットフォーム経由',platformName:'くらしのマーケット',manualConfirmed});
 }
 await h.execute({type:'importBank',bank:bank('stripe')});
 if(fee)await h.execute({type:'saveExpense',expenseId:'fee',expense:{expenseDate:'2026-09-30',category:'支払手数料',amount:fee,vendor:'くらしのマーケット',description:'精算書控除',paymentMethod:'その他'}});
 return {type:'bankMatch',bankTxnId:'stripe',targetType:'platformSettlement',targetId:'stripe',paymentIds:['pay_one','pay_two'],feeExpenseId:fee?'fee':'',statement:'SETTLEMENT-10-01',expectedRevision:1};
}
test('empty supplier list: atomic create, concurrent retry and no expense/cash/extra outflow',async()=>{
 const h=await harness();await h.execute({type:'importBank',bank:bank('advance',{incoming:0,outgoing:1000000,amount:1000000,description:'東鵬 壁紙前渡',bankTransactionDate:'2026-10-13'})});
 const c={type:'supplierFromBank',bankTxnId:'advance',supplierName:'東鵬',description:'原本確認',expectedRevision:1};await Promise.all([h.execute(c),h.execute(c)]);
 assert.equal(h.list('suppliers').length,1);assert.equal(h.list('suppliers')[0].payload.currentBalance,1000000);assert.equal(h.list('supplierTransactions').length,1);assert.equal(h.list('expenses').length,0);assert.equal(h.list('cashLedger').length,0);assert.equal(h.list('bankTransactions').length,1);
});
test('platform multiple orders: net fee, retry, unmatch/rematch reuse existing records and immutable documents',async()=>{
 const h=await harness(),c=await platform(h,1000),sales=h.list('sales').length;
 await Promise.all([h.execute(c),h.execute(c)]);let d=data(h);assert.equal(d.payments.length,2);assert.equal(d.sales.length,sales);assert.equal(d.expenses.length,1);assert.equal(d.cashLedger.length,0);assert(d.payments.every(p=>A.bankEvidence(p,d)));assert.equal(A.monthly(d,'2026-09').income,0);assert.equal(A.monthly(d,'2026-10').income,63068);
 await h.execute({type:'bankUnmatch',bankTxnId:'stripe',reason:'再確認',expectedRevision:2});assert(data(h).payments.every(p=>p.confirmation==='pending-bank'&&!p.bankTxnId));assert(!data(h).expenses[0].platformSettlementBankId);
 await h.execute({...c,expectedRevision:3});assert.equal(h.list('payments').length,2);
});
test('platform wrong total, cash/order mismatch, competing bank and duplicate fee fail atomically',async()=>{
 const h=await harness(),c=await platform(h,1000);let before=JSON.stringify([...h.rows]);await assert.rejects(h.execute({...c,feeExpenseId:''}),/一致/);assert.equal(JSON.stringify([...h.rows]),before);
 await assert.rejects(h.execute({...c,paymentIds:['pay_one','pay_one']}),/1〜5/);assert.equal(JSON.stringify([...h.rows]),before);
 await h.execute(c);await h.execute({type:'importBank',bank:bank('another')});before=JSON.stringify([...h.rows]);await assert.rejects(h.execute({...c,bankTxnId:'another',targetId:'another'}),/照合状態/);assert.equal(JSON.stringify([...h.rows]),before);
});
test('interest and VISA cashback retries have one non-sales income; platform cannot be miscellaneous',async()=>{
 const h=await harness();for(const [id,description,amount,flags]of [['interest','普通預金 利息',2679,{interest:true}],['cashback','VISAキャッシュバック',123,{cashback:true}]]){await h.execute({type:'importBank',bank:bank(id,{description,incoming:amount,amount})});const c={type:'reviewBankIncome',bankTxnId:id,note:'原本確認',...flags,expectedRevision:1};await h.execute(c);const before=JSON.stringify([...h.rows]);await h.execute(c);assert.equal(JSON.stringify([...h.rows]),before);}
 const d=data(h);assert.equal(A.monthly(d,'2026-10').otherIncome,2802);assert.equal(A.monthly({...d,bankTransactions:d.bankTransactions.filter(b=>b.category==='受取利息')},'2026-10').attention,0);assert.equal(d.sales.length,0);assert.equal(d.payments.length,0);await h.execute({type:'importBank',bank:bank('stripe')});await assert.rejects(h.execute({type:'reviewBankIncome',bankTxnId:'stripe',category:'雑収入',note:'test',expectedRevision:1}),/精算/);
});
test('WOOC September invoice resolves October receipt without a duplicate sale/payment; orphan is blocked',async()=>{
 const h=await harness();await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'wooc',docType:'invoice',customerName:'株式会社WOOC',invoiceDate:'2026-09-28',items:[{content:'施工',qty:1,price:41000}]}});
 await h.execute({type:'importBank',bank:bank('wooc-bank',{incoming:45100,amount:45100,description:'振込 カ）WOOC',bankTransactionDate:'2026-10-15'})});let d=data(h);const candidates=A.suggestions(d.bankTransactions[0],{...d,documents:h.list('documents').map(r=>({...r.payload,id:r.id}))});assert.equal(candidates.length,1);assert(candidates[0].reasons.includes('名称一致'));
 const c={type:'bankMatch',bankTxnId:'wooc-bank',targetType:'sale',targetId:candidates[0].id,expectedRevision:1};await h.execute(c);await h.execute(c);d=data(h);assert.equal(d.sales.length,1);assert.equal(d.payments.length,1);assert.equal(A.monthly(d,'2026-09').sales,45100);assert.equal(A.monthly(d,'2026-10').income,45100);
 const orphan=A.suggestions(bank('orphan',{incoming:45100,description:'WOOC',bankTransactionDate:'2026-10-15'}),{documents:[{id:'old',docType:'invoice',confirmed:true,amount:45100,invoiceDate:'2026-09-28',customerName:'WOOC'}]});assert.equal(orphan[0].blocked,true);
});

test('already confirmed platform receipts keep their business period and require exact retry allocation',async()=>{
 const h=await harness(),c=await platform(h,0,true);await h.execute(c);const d=data(h);assert.equal(A.monthly(d,'2026-09').income,62068);assert.equal(A.monthly(d,'2026-10').income,0);const before=JSON.stringify([...h.rows]);await assert.rejects(h.execute({...c,paymentIds:['pay_one']}),/照合済/);assert.equal(JSON.stringify([...h.rows]),before);
});
