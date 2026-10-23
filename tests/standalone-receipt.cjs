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

function seedLegacy(h,method='現金',extra={}){
 const snapshot={...receipt,documentId:'legacy',invoiceNo:'20261023-1200-01',invoiceDate:'2026-10-23',customerName:'（株）益田工房東京',paymentMethod:method,...extra};
 const payload={documentId:'legacy',docType:'receipt',status:'active',confirmed:true,amount:1000,customerName:snapshot.customerName,invoiceDate:snapshot.invoiceDate,snapshot};
 h.rows.set('companies/tsukinowa/documents/legacy',{revision:1,payload});return payload;
}
const repair=(h,operationId=crypto.randomUUID())=>h.service.execute({type:'backfillReceiptAccounting',documentId:'legacy',operationId});
for(const method of ['現金','銀行振込','プラットフォーム経由','その他'])test('legacy accounting repair: '+method,async()=>{
 const h=await harness(),p=seedLegacy(h,method),original=C.canonical(p.snapshot);
 await repair(h);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('cashLedger').length,method==='現金'?1:0);
 const pay=h.list('payments')[0].payload,e=h.list('calendarLinks')[0].payload;
 assert.equal(pay.confirmation,method==='現金'?'cash-received':'bank-confirmed');assert.equal(require('../js/accounting').ledger(h.list('sales').map(r=>r.payload),[pay]).sales[0].outstanding,0);
 assert(e.googleCreatePending);assert(e.googlePatchPending);assert.equal(e.date,'2026-10-23');assert.equal(e.status,'領収済');assert.match(e.title,/益田工房東京.*1,000.*領収済/);
 assert.equal(C.canonical(h.list('documents')[0].payload.snapshot),original);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++)await repair(h);assert.equal(JSON.stringify([...h.rows]),frozen);
 // A new operation ID, like another login, still makes no writes.
 const h2=await harness();for(const [k,v]of h.rows)h2.rows.set(k,v);await repair(h2);assert.equal(JSON.stringify([...h2.rows]),frozen);
});
test('legacy existing Google event patches; missing payment and cash mirror repaired independently',async()=>{
 const h=await harness(),p=seedLegacy(h);p.calendarEventId='known';h.rows.set('companies/tsukinowa/calendarLinks/known',{revision:1,payload:{id:'known',googleEventId:'existing',date:'2026-10-23',customerName:p.customerName,content:receipt.tadashi,amount:1000}});
 await repair(h);assert.equal(h.list('calendarLinks')[0].payload.googleCreatePending,false);assert(h.list('calendarLinks')[0].payload.googlePatchPending);
 h.rows.delete('companies/tsukinowa/payments/pay_legacy');await repair(h);assert.equal(h.list('payments').length,1);
 h.rows.delete('companies/tsukinowa/cashLedger/cash_pay_legacy');await repair(h);assert.equal(h.list('cashLedger').length,1);
});
for(const method of ['現金','銀行振込'])test('legacy reuses manual calendar accounting '+method,async()=>{
 const h=await harness(),p=seedLegacy(h,method);
 const e=await h.service.execute({type:'calendar',operationId:'event',event:{id:'manual',date:p.invoiceDate,title:p.customerName+'｜工事代｜1000'}});
 const r=await h.service.execute({type:'registerCalendarSale',operationId:'manual',id:e.id,sale:{customer:p.customerName,content:'工事代',amount:1000,paymentMethod:method,salesDate:p.invoiceDate}});
 if(method!=='現金')await h.service.execute({type:'payment',operationId:'pay',paymentId:'manual-bank',saleId:r.saleId,amount:1000,paymentDate:p.invoiceDate,method,manualConfirmed:true});
 await repair(h);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('documents')[0].payload.saleId,r.saleId);
});
for(const mode of ['amount','multiple','payment'])test('legacy conflict is atomic: '+mode,async()=>{
 const h=await harness(),p=seedLegacy(h,'銀行振込');
 for(const id of mode==='multiple'?['a','b']:['a'])h.rows.set('companies/tsukinowa/sales/'+id,{revision:1,payload:{id,sourceType:'calendar-manual',documentId:'',customer:p.customerName,content:'工事代',salesDate:p.invoiceDate,amount:mode==='amount'?2000:1000,paymentIds:mode==='payment'?['bad']:[]}});
 if(mode==='payment')h.rows.set('companies/tsukinowa/payments/bad',{revision:1,payload:{id:'bad',saleId:'a',amount:900,paymentDate:p.invoiceDate,method:'銀行振込',confirmation:'bank-confirmed'}});
 const before=JSON.stringify([...h.rows]);await assert.rejects(repair(h),/要確認/);assert.equal(JSON.stringify([...h.rows]),before);
});
test('legacy repair is admin-only and invalid/void receipts are ignored',async()=>{
 const staff=await harness('staff');seedLegacy(staff);await assert.rejects(repair(staff),/管理者/);
 for(const extra of [{status:'void'},{amount:0},{docType:'estimate'}]){const h=await harness(),p=seedLegacy(h);Object.assign(p,extra);await repair(h);assert.equal(h.list('sales').length,0);}
});

test('legacy receipt preserves an existing formal invoice anchor',async()=>{
 const h=await harness(),p=seedLegacy(h,'銀行振込');
 h.rows.set('companies/tsukinowa/documents/invoice',{revision:1,payload:{documentId:'invoice',docType:'invoice',status:'active',saleId:'invoice-sale',amount:1000}});
 h.rows.set('companies/tsukinowa/sales/invoice-sale',{revision:1,payload:{id:'invoice-sale',documentId:'invoice',customer:p.customerName,amount:1000,salesDate:p.invoiceDate,paymentIds:[]}});
 h.rows.set('companies/tsukinowa/calendarLinks/formal',{revision:1,payload:{id:'formal',date:p.invoiceDate,customerName:p.customerName,content:'工事代',officialAmount:1000,linkedInvoiceId:'invoice',documentId:'invoice',googleEventId:'google'}});
 await repair(h);assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].payload.documentId,'invoice');assert.equal(h.list('documents').find(r=>r.id==='legacy').payload.saleId,'invoice-sale');assert.equal(h.list('calendarLinks')[0].payload.linkedInvoiceId,'invoice');
});
for(const mode of ['multiple','amount'])test('legacy calendar candidate conflict '+mode,async()=>{
 const h=await harness(),p=seedLegacy(h);
 for(const id of mode==='multiple'?['a','b']:['a'])h.rows.set('companies/tsukinowa/calendarLinks/'+id,{revision:1,payload:{id,date:p.invoiceDate,customerName:p.customerName,content:'工事代',amount:mode==='amount'?2000:1000}});
 const before=JSON.stringify([...h.rows]);await assert.rejects(repair(h),/要確認/);assert.equal(JSON.stringify([...h.rows]),before);
});
test('legacy cash placeholder is replaced only through its explicit schedule',async()=>{
 const h=await harness(),p=seedLegacy(h);const e=await h.service.execute({type:'calendar',operationId:'unnamed',event:{id:'unnamed',date:p.invoiceDate,title:'クロス張替、1000、現金'}});p.calendarEventId=e.id;
 await repair(h);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('sales')[0].payload.customer,p.customerName);
});

test('matching pending bank payment is confirmed in place by the saved receipt',async()=>{
 const h=await harness(),p=seedLegacy(h,'銀行振込');
 p.saleId='sale_legacy';p.paymentId='pay_legacy';
 h.rows.set('companies/tsukinowa/sales/sale_legacy',{revision:1,payload:{id:'sale_legacy',documentId:'legacy',sourceType:'receipt',amount:1000,customer:p.customerName,paymentIds:['pay_legacy']}});
 h.rows.set('companies/tsukinowa/payments/pay_legacy',{revision:1,payload:{id:'pay_legacy',paymentId:'pay_legacy',saleId:'sale_legacy',documentId:'legacy',amount:1000,paymentDate:p.invoiceDate,method:'銀行振込',confirmation:'pending-bank'}});
 await repair(h);assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].payload.confirmation,'bank-confirmed');assert.equal(h.list('cashLedger').length,0);
});

test('complete invoice installments share the latest schedule and skip repair after invoice revision',async()=>{
 const h=await harness(),exec=cmd=>h.service.execute({...cmd,operationId:crypto.randomUUID()});
 const inv=await exec({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'installment-invoice',docType:'invoice',customerName:receipt.customerName,invoiceDate:receipt.invoiceDate,salesDate:receipt.invoiceDate,items:[{content:'工事',qty:1,price:2000/1.1}]}});
 for(const id of ['first','second'])await exec(save({...receipt,documentId:id,saleId:'sale_installment-invoice'}));
 let rows=Object.fromEntries(B.COLLECTIONS.map(n=>[n,h.list(n)]));
 for(const r of h.list('documents').filter(r=>r.payload.docType==='receipt')){assert.equal(B.receiptAccountingNeedsRepair(r,rows),false);assert((await exec({type:'backfillReceiptAccounting',documentId:r.id})).skipped);}
 await exec(save({...inv.snapshot,documentId:'revised-invoice',customerName:'訂正後の請求先'},{revisedFromDocumentId:'installment-invoice',expectedParentRevision:1,reason:'宛名訂正'}));
 rows=Object.fromEntries(B.COLLECTIONS.map(n=>[n,h.list(n)]));
 for(const r of h.list('documents').filter(r=>r.payload.docType==='receipt'))assert.equal(B.receiptAccountingNeedsRepair(r,rows),false);
 assert.equal(h.list('payments').length,2);
});
