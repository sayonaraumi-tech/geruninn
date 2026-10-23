const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(role='admin'){
 const rows=new Map();let cb;
 const digest=async s=>crypto.createHash('sha256').update(s).digest('hex'),driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest,timestamp:()=>123,
 list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{const writes=[];const result=await f({get:async p=>rows.get(p)||null,set:(p,v)=>writes.push([p,v])});for(const [p,v]of writes)rows.set(p,v);return result;}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:role,claims:{role,companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 return {rows,service,list};
}

const receipt={documentId:'standalone',docType:'receipt',customerName:'同じ顧客',receiptTotal:'1000',invoiceDate:'2026-10-05',paymentMethod:'現金',tadashi:'工事代',remarks:'備考'};
const save=(snapshot,extra={})=>({type:'saveDocument',operationId:crypto.randomUUID(),expectedRevision:0,snapshot,...extra});
for(const method of ['現金','銀行振込','プラットフォーム経由','その他'])test('formal independent receipt: '+method,async()=>{
 const h=await harness('staff'),r=await h.service.execute(save({...receipt,paymentMethod:method,platformName:'テスト平台'}));
 assert.match(r.invoiceNo,/^\d{8}-\d{4}-\d{2,}$/);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,method==='現金'?1:0);
 const pay=h.list('payments')[0].payload,e=h.list('calendarLinks')[0].payload;
 assert.equal(pay.confirmation,method==='現金'?'cash-received':'bank-confirmed');assert.equal(pay.method,method);assert.equal(pay.platformName,'テスト平台');
 assert.equal(require('../js/accounting').ledger(h.list('sales').map(r=>r.payload),[pay]).sales[0].outstanding,0);
 assert.equal(e.status,'領収済');assert.equal(e.date,receipt.invoiceDate);assert.equal(e.end,'2026-10-06');assert.equal(e.receiptSaleId,r.saleId);assert(e.googleCreatePending);assert(e.googlePatchPending);assert.match(e.title,/同じ顧客｜工事代｜¥1,000｜領収済/);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++)assert((await h.service.execute(save(r.snapshot,{expectedRevision:1}))).unchanged);assert.equal(JSON.stringify([...h.rows]),frozen);
 assert((await h.service.execute(save({...receipt,paymentMethod:method,platformName:'テスト平台'},{expectedRevision:1}))).unchanged);
 await assert.rejects(h.service.execute(save({...r.snapshot,documentId:'second'})),/既に領収書/);
 await h.service.execute({type:'calendarPrepareCreate',id:e.id,calendarId:'shared',operationId:'prepare'});
 await h.service.execute({type:'calendarCreated',id:e.id,calendarId:'shared',googleEventId:e.googleEventId,operationId:'created'});
 assert.equal(h.list('calendarLinks')[0].payload.googleCreatePending,false);
});
test('safe unique schedule is reused; amount conflict and ambiguity fail atomically',async()=>{
 for(const mode of ['unique','amount','multiple']){
  const h=await harness();for(const id of mode==='multiple'?['one','two']:['one'])h.rows.set('companies/tsukinowa/calendarLinks/'+id,{revision:1,payload:{id,date:receipt.invoiceDate,title:'同じ顧客｜工事代｜1000',customerName:receipt.customerName,content:receipt.tadashi,amount:mode==='amount'?2000:1000,googleEventId:id,googleCalendarId:'shared',calendarId:'shared'}});
  if(mode!=='unique'){const before=JSON.stringify([...h.rows]);await assert.rejects(h.service.execute(save(receipt)),/要確認/);assert.equal(JSON.stringify([...h.rows]),before);continue;}
  const r=await h.service.execute(save(receipt));assert.equal(r.snapshot.calendarEventId,'one');assert.equal(h.list('calendarLinks').length,1);const e=h.list('calendarLinks')[0].payload;assert(!e.googleCreatePending);assert(e.googlePatchPending);assert.equal(e.googleEventId,'one');
 }
});
test('manual noncash sale and confirmed payment are safely taken over; invoice later reuses sale',async()=>{
 const h=await harness(),exec=cmd=>h.service.execute({...cmd,operationId:crypto.randomUUID()});
 const link=await exec({type:'calendar',event:{id:'manual',date:receipt.invoiceDate,title:'同じ顧客｜工事代｜1000'}});
 const r=await exec({type:'registerCalendarSale',id:link.id,sale:{amount:1000,salesDate:receipt.invoiceDate,customer:receipt.customerName,content:receipt.tadashi,paymentMethod:'銀行振込'}});
 await exec({type:'payment',manualConfirmed:true,paymentId:'bank',saleId:r.saleId,amount:1000,paymentDate:receipt.invoiceDate,method:'銀行振込'});
 await exec(save({...receipt,paymentMethod:'銀行振込',calendarEventId:link.id}));assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].id,'bank');
 await exec(save({documentId:'invoice',docType:'invoice',customerName:receipt.customerName,invoiceDate:receipt.invoiceDate,calendarEventId:link.id,items:[{content:receipt.tadashi,qty:1,price:1000/1.1}]}));assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].id,r.saleId);
});
test('different confirmed bank payment cannot be silently merged',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/sales/existing',{revision:1,payload:{id:'existing',documentId:'invoice',customer:receipt.customerName,amount:1000,paymentIds:['bank']}});h.rows.set('companies/tsukinowa/payments/bank',{revision:1,payload:{id:'bank',paymentId:'bank',saleId:'existing',amount:1000,paymentDate:'2026-10-01',method:'銀行振込',confirmation:'bank-confirmed'}});
 const before=JSON.stringify([...h.rows]);await assert.rejects(h.service.execute(save({...receipt,saleId:'existing',paymentMethod:'銀行振込'})),/要確認/);assert.equal(JSON.stringify([...h.rows]),before);
});
test('receipt revision preserves sale/payment/calendar identities and updates formal customer',async()=>{
 const h=await harness(),r=await h.service.execute(save({...receipt,paymentMethod:'銀行振込'}));
 const revision=await h.service.execute(save({...r.snapshot,documentId:'revision',customerName:'正式顧客訂正'},{revisedFromDocumentId:'standalone',expectedParentRevision:1,reason:'宛名訂正'}));
 assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('calendarLinks').length,1);assert.equal(revision.saleId,r.saleId);assert.equal(revision.paymentId,r.paymentId);assert.equal(h.list('sales')[0].payload.customer,'正式顧客訂正');assert.equal(h.list('sales')[0].payload.documentId,'revision');
});
test('explicit invoice link defaults payment date and repeated output creates only one payment',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/sales/existing',{payload:{id:'existing',customer:receipt.customerName,amount:1000,paymentIds:[]},revision:1});const r=await h.service.execute(save({...receipt,saleId:'existing'}));
 assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].payload.paymentDate,receipt.invoiceDate);
 for(let i=0;i<3;i++)await h.service.execute(save(r.snapshot,{expectedRevision:r.revision}));assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);assert.equal(h.list('sales').length,1);
});
test('standalone receipt still requires customer, positive amount, date and method',async()=>{
 for(const bad of [{customerName:''},{receiptTotal:0},{receiptTotal:-1},{invoiceDate:''},{paymentMethod:''}]){const h=await harness();await assert.rejects(h.service.execute(save({...receipt,...bad})));assert.equal(h.rows.size,0);}
});

test('standalone cash receipt creates its own sale/payment/cash mirror without guessing invoice links',async()=>{
 const h=await harness('staff'),r=await h.service.execute(save({...receipt,receiptTotal:110000}));
 assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 const sale=h.list('sales')[0].payload,pay=h.list('payments')[0].payload;assert.equal(sale.sourceType,'receipt-cash');assert.equal(sale.invoiceDate,'');assert.equal(sale.amount,110000);assert.equal(pay.amount,110000);assert.equal(pay.paymentDate,receipt.invoiceDate);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++)assert((await h.service.execute(save(r.snapshot,{expectedRevision:1}))).unchanged);assert.equal(JSON.stringify([...h.rows]),frozen);
 await assert.rejects(h.service.execute(save({...r.snapshot,documentId:'revision',receiptTotal:900},{revisedFromDocumentId:'standalone',expectedParentRevision:1,reason:'訂正'})),/管理者/);
});
