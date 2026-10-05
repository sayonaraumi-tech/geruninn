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
test('standalone cash receipt atomically creates one sale, payment and cash mirror without guessing existing customer links',async()=>{
 const h=await harness('staff');h.rows.set('companies/tsukinowa/sales/existing',{payload:{id:'existing',customer:receipt.customerName,amount:1000,paymentIds:[]},revision:1});
 const r=await h.service.execute(save(receipt));assert.match(r.invoiceNo,/^\d{8}-\d{4}-\d{2,}$/);assert.equal(r.snapshot.saleId,'sale_standalone');
 assert.equal(h.list('documents')[0].payload.paymentId,'pay_standalone');assert.equal(h.list('sales').length,2);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 assert.deepEqual(h.list('sales').find(s=>s.id==='sale_standalone').payload.paymentIds,['pay_standalone']);
 for(let i=0;i<3;i++)assert.equal((await h.service.execute(save(r.snapshot,{expectedRevision:r.revision}))).unchanged,true);
 assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);assert.equal(h.list('sales').length,2);
});
test('cash receipt revision preserves accounting IDs and updates ownership without duplicate counting',async()=>{
 const h=await harness();const r=await h.service.execute(save(receipt));
 await assert.rejects(h.service.execute(save({...r.snapshot,documentId:'bad',receiptTotal:'900'},{revisedFromDocumentId:'standalone',expectedParentRevision:r.revision,reason:'金額訂正'})),/確認済み/);
 await h.service.execute(save({...r.snapshot,documentId:'revision',customerName:'宛名訂正'},{revisedFromDocumentId:'standalone',expectedParentRevision:r.revision,reason:'宛名訂正'}));
 assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].payload.documentId,'revision');assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
});
test('unlinked bank receipt does not invent confirmed bank income',async()=>{
 const h=await harness();await h.service.execute(save({...receipt,paymentMethod:'銀行振込'}));for(const n of ['sales','payments','cashLedger'])assert.equal(h.list(n).length,0);
});
test('explicit invoice link defaults payment date and repeated output creates only one payment',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/sales/existing',{payload:{id:'existing',customer:receipt.customerName,amount:1000,paymentIds:[]},revision:1});const r=await h.service.execute(save({...receipt,saleId:'existing'}));
 assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].payload.paymentDate,receipt.invoiceDate);
 for(let i=0;i<3;i++)await h.service.execute(save(r.snapshot,{expectedRevision:r.revision}));assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);assert.equal(h.list('sales').length,1);
});
test('standalone receipt still requires customer, positive amount, date and method',async()=>{
 for(const bad of [{customerName:''},{receiptTotal:0},{receiptTotal:-1},{invoiceDate:''},{paymentMethod:''}]){const h=await harness();await assert.rejects(h.service.execute(save({...receipt,...bad})));assert.equal(h.rows.size,0);}
});

test('cash receipt followed by invoice on the same event reuses the sale and preserves one payment',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/calendarLinks/event',{revision:1,payload:{id:'event',googleEventId:'google',googleCalendarId:'shared'}});
 const r=await h.service.execute(save({...receipt,calendarEventId:'event'}));assert.equal(h.list('sales').length,1);
 await h.service.execute(save({documentId:'later-invoice',docType:'invoice',customerName:receipt.customerName,invoiceDate:receipt.invoiceDate,calendarEventId:'event',items:[{content:'工事',qty:1,price:1000/1.1}]}));assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].id,r.saleId);assert.equal(h.list('sales')[0].payload.documentId,'later-invoice');assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 await h.service.execute(save({...r.snapshot,documentId:'receipt-revision',customerName:'領収宛名訂正'},{revisedFromDocumentId:receipt.documentId,expectedParentRevision:r.revision,reason:'宛名訂正'}));assert.equal(h.list('sales')[0].payload.documentId,'later-invoice');assert.equal(h.list('payments').length,1);
});

test('legacy cash receipt reconciliation preserves original snapshot, explicit invoice association and replay',async()=>{
 const h=await harness();const original={documentId:'legacy',docType:'receipt',confirmed:true,status:'active',customerName:receipt.customerName,snapshot:{...receipt,documentId:'legacy',invoiceNo:'OLD'}};h.rows.set('companies/tsukinowa/documents/legacy',{revision:1,payload:original});
 const cmd={type:'reconcileReceipt',documentId:'legacy',expectedRevision:1,reason:'旧領収書を記帳',operationId:'reconcile'};const r=await h.service.execute(cmd);assert.equal(r.saleId,'sale_legacy');assert.deepEqual(h.list('documents')[0].payload,original);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 await h.service.execute({...cmd,operationId:'retry'});assert.equal(h.list('payments').length,1);
 const linked=await harness();linked.rows.set('companies/tsukinowa/documents/legacy',{revision:1,payload:original});linked.rows.set('companies/tsukinowa/sales/invoice',{revision:1,payload:{id:'invoice',documentStatus:'active',amount:2000,paymentIds:[]}});await linked.service.execute({...cmd,saleId:'invoice'});assert.equal(linked.list('sales').length,1);assert.equal(linked.list('payments')[0].payload.saleId,'invoice');
});
