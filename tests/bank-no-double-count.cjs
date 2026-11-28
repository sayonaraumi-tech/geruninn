// 手動入金 → 月末の銀行CSV取込・照合 and 領収書 (銀行振込) → 銀行CSV: the bank line attaches evidence to the
// existing payment; it never adds a second 入金. Synthetic data only.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain'),A=require('../js/accounting');
async function harness(){
 const rows=new Map();let cb;
 const digest=async s=>crypto.createHash('sha256').update(s).digest('hex'),driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest,timestamp:()=>123,
 list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{const writes=[];const result=await f({get:async p=>rows.get(p)||null,set:(p,v)=>writes.push([p,v])});for(const [p,v]of writes)rows.set(p,v);return result;}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r.payload}));
 return {list,exec:cmd=>service.execute({operationId:crypto.randomUUID(),...cmd})};
}
const live=rs=>rs.filter(r=>!r.deletedAt);
const paid=(h,month)=>A.salesRegister({sales:h.list('sales'),payments:h.list('payments')},A.periodFilter({month}),'2026-12-31').reduce((n,s)=>n+s.paid,0);
const bank=(id,date,incoming,description='フリコミ シケンキヤク')=>({type:'importBank',bank:{bankTxnId:id,bankTransactionDate:date,incoming,outgoing:0,amount:incoming,description,bankAccount:'GMO あおぞら'}});
const invoice={documentId:'inv_dd',docType:'invoice',customerName:'試験顧客',invoiceDate:'2026-11-05',salesDate:'2026-11-05',items:[{content:'クロス張替',qty:1,price:50000}]};
for(const confirmed of [true,false])test('請求書 + 手動入金 ('+(confirmed?'確認済':'銀行照合待ち')+') + 月末銀行CSV: one 入金',async()=>{
 const h=await harness(),r=await h.exec({type:'saveDocument',snapshot:invoice,expectedRevision:0}),sale=h.list('sales')[0];assert.equal(sale.amount,55000);
 await h.exec({type:'payment',paymentId:'manual1',saleId:r.saleId,amount:55000,paymentDate:'2026-11-20',method:'銀行振込',...(confirmed?{manualConfirmed:true}:{})});
 assert.equal(paid(h,'2026-11'),confirmed?55000:0);
 for(let i=0;i<2;i++)await h.exec(bank('b1','2026-11-20',55000));// month-end import, twice
 assert.equal(h.list('bankTransactions').length,1);
 await h.exec({type:'bankMatch',bankTxnId:'b1',targetType:'sale',targetId:r.saleId,expectedRevision:1});
 const ps=live(h.list('payments'));assert.equal(ps.length,1,'no second payment');assert.equal(ps[0].id,'manual1');assert.equal(ps[0].bankTxnId,'b1');assert.equal(ps[0].confirmation,'bank-confirmed');assert.equal(ps[0].paymentDate,'2026-11-20');
 assert.equal(paid(h,'2026-11'),55000);
 assert((await h.exec({type:'bankMatch',bankTxnId:'b1',targetType:'sale',targetId:r.saleId,expectedRevision:2})).unchanged,'re-matching is a no-op');assert.equal(live(h.list('payments')).length,1);
});
test('請求書 fully paid by 手動入金 of another amount: a bank line cannot add a second 入金',async()=>{
 const h=await harness(),r=await h.exec({type:'saveDocument',snapshot:invoice,expectedRevision:0});
 await h.exec({type:'payment',paymentId:'m1',saleId:r.saleId,amount:30000,paymentDate:'2026-11-20',method:'銀行振込',manualConfirmed:true});
 await h.exec({type:'payment',paymentId:'m2',saleId:r.saleId,amount:25000,paymentDate:'2026-11-21',method:'銀行振込',manualConfirmed:true});
 await h.exec(bank('b2','2026-11-21',55000));
 await assert.rejects(h.exec({type:'bankMatch',bankTxnId:'b2',targetType:'sale',targetId:r.saleId,expectedRevision:1}),/入金|未収/);
 assert.equal(live(h.list('payments')).length,2);assert.equal(paid(h,'2026-11'),55000);
});
test('領収書 (銀行振込) = 売上 + 入金 at save; the later bank line attaches to that 入金',async()=>{
 const h=await harness(),r=await h.exec({type:'saveDocument',snapshot:{documentId:'rec_dd',docType:'receipt',customerName:'試験顧客R',receiptTotal:'22000',invoiceDate:'2026-11-10',paymentMethod:'銀行振込',tadashi:'穴補修'},expectedRevision:0});
 const [sale]=h.list('sales'),[pay]=h.list('payments');assert.equal(sale.amount,22000);assert.equal(pay.confirmation,'bank-confirmed');assert.equal(pay.method,'銀行振込');assert.equal(paid(h,'2026-11'),22000);
 await h.exec(bank('b3','2026-11-12',22000));await h.exec({type:'bankMatch',bankTxnId:'b3',targetType:'sale',targetId:r.saleId,expectedRevision:1});
 const ps=live(h.list('payments'));assert.equal(ps.length,1);assert.equal(ps[0].bankTxnId,'b3');assert.equal(ps[0].paymentDate,'2026-11-10','receipt date kept');assert.equal(paid(h,'2026-11'),22000);
});
test('領収書 (現金) = 売上 + 入金 + 現金出納; bank matching refuses it',async()=>{
 const h=await harness(),r=await h.exec({type:'saveDocument',snapshot:{documentId:'rec_cash',docType:'receipt',customerName:'試験顧客S',receiptTotal:'11000',invoiceDate:'2026-11-11',paymentMethod:'現金',tadashi:'補修'},expectedRevision:0});
 assert.equal(h.list('payments')[0].confirmation,'cash-received');assert.equal(h.list('cashLedger').length,1);assert.equal(paid(h,'2026-11'),11000);
 await h.exec(bank('b4','2026-11-12',11000));await assert.rejects(h.exec({type:'bankMatch',bankTxnId:'b4',targetType:'sale',targetId:r.saleId,expectedRevision:1}),/現金/);
 assert.equal(live(h.list('payments')).length,1);
});
