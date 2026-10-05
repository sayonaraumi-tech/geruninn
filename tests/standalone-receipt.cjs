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
test('standalone receipt reserves formal number but leaves all accounting and Calendar untouched',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/sales/existing',{payload:{id:'existing',customer:receipt.customerName,amount:1000,paymentIds:[]},revision:1});h.rows.set('companies/tsukinowa/calendarLinks/event',{payload:{id:'event',status:'請求済'},revision:1});
 const before=[...h.rows],r=await h.service.execute(save({...receipt,calendarEventId:'event'}));
 assert.match(r.invoiceNo,/^\d{8}-\d{4}-\d{2,}$/);assert.equal(r.snapshot.paymentDate,receipt.invoiceDate);assert.equal(h.list('documents')[0].payload.paymentId,'');assert.equal(h.list('documents')[0].payload.saleId,'');
 for(const [key,value]of before)assert.deepEqual(h.rows.get(key),value);
 for(const name of ['payments','cashLedger','receivables','bankTransactions'])assert.equal(h.list(name).length,0);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++)assert.equal((await h.service.execute(save(r.snapshot,{expectedRevision:r.revision}))).unchanged,true);assert.equal(JSON.stringify([...h.rows].filter(([k])=>!k.includes('/operations/'))),JSON.stringify(JSON.parse(frozen).filter(([k])=>!k.includes('/operations/'))));
 const revised=await h.service.execute(save({...r.snapshot,documentId:'revision',receiptTotal:'900',invoiceDate:'2026-10-06',paymentDate:'2026-10-06'},{revisedFromDocumentId:'standalone',expectedParentRevision:r.revision,reason:'金額訂正'}));assert.equal(h.list('payments').length,0);
 await h.service.execute({type:'documentStatus',operationId:'void',documentId:'revision',status:'void',reason:'取消',expectedRevision:revised.revision});assert.equal(h.list('payments').length,0);assert.equal(h.list('sales').length,1);
});
test('explicit invoice link defaults payment date and repeated output creates only one payment',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/sales/existing',{payload:{id:'existing',customer:receipt.customerName,amount:1000,paymentIds:[]},revision:1});const r=await h.service.execute(save({...receipt,saleId:'existing'}));
 assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].payload.paymentDate,receipt.invoiceDate);
 for(let i=0;i<3;i++)await h.service.execute(save(r.snapshot,{expectedRevision:r.revision}));assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);assert.equal(h.list('sales').length,1);
});
test('standalone receipt still requires customer, positive amount, date and method',async()=>{
 for(const bad of [{customerName:''},{receiptTotal:0},{receiptTotal:-1},{invoiceDate:''},{paymentMethod:''}]){const h=await harness();await assert.rejects(h.service.execute(save({...receipt,...bad})));assert.equal(h.rows.size,0);}
});
