// 日程の自動登録 (cloud mode, the production configuration): no manual second entry, one event per source, updates in place.
// B) 見積 → 受注 with a 施工日 creates one calendarLinks event; changing the date updates the same event.
// C) A standalone 請求書 / 領収書 creates one event titled 宛名｜first 施工項目｜金額｜状態; replays and 訂正 keep one event.
// Synthetic data only.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(role='admin'){
 const rows=new Map();let cb;
 const digest=async s=>crypto.createHash('sha256').update(s).digest('hex'),driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest,timestamp:()=>123,
 list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{const writes=[];const result=await f({get:async p=>rows.get(p)||null,set:(p,v)=>writes.push([p,v])});for(const [p,v]of writes)rows.set(p,v);return result;}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:role,claims:{role,companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 return {rows,list,exec:cmd=>service.execute({operationId:crypto.randomUUID(),...cmd})};
}
const live=h=>h.list('calendarLinks').filter(r=>!r.payload.deletedAt);
const estimate={documentId:'est_doc',docType:'estimate',customerName:'試験顧客A',invoiceDate:'2026-11-20',items:[{content:'クロス張替 6畳',qty:1,price:50000},{content:'巾木交換',qty:1,price:10000}]};

test('B: 受注 with a date creates one event; changing the date updates the same event; no duplicates',async()=>{
 const h=await harness();await h.exec({type:'saveDocument',snapshot:estimate,expectedRevision:0});
 const est=h.list('estimates')[0];assert(est,'estimate record');
 await h.exec({type:'acceptEstimate',estimateId:est.id,workDate:'2026-12-03'});
 assert.equal(live(h).length,1);const first=live(h)[0];
 assert.equal(first.payload.date,'2026-12-03');assert.equal(first.payload.linkedEstimateId,est.id);assert.equal(first.payload.status,'施工予定');assert.match(first.payload.title,/^試験顧客A｜/);
 assert.equal(h.list('estimates')[0].payload.calendarEventId,first.id);assert.equal(h.list('estimates')[0].payload.status,'受注');
 await h.exec({type:'acceptEstimate',estimateId:est.id,workDate:'2026-12-10'});
 assert.equal(live(h).length,1,'same event, no duplicate');assert.equal(live(h)[0].id,first.id);assert.equal(live(h)[0].payload.date,'2026-12-10');assert.equal(live(h)[0].payload.end,'2026-12-11');
 assert.equal(h.list('projects')[0].payload.workDate,'2026-12-10');
 for(let i=0;i<2;i++)await h.exec({type:'acceptEstimate',estimateId:est.id,workDate:'2026-12-10'});
 assert.equal(live(h).length,1);assert.equal(h.list('sales').length,0,'受注 creates no sale');assert.equal(h.list('payments').length,0);
});
test('B: 受注 without a date creates no event until a date is chosen',async()=>{
 const h=await harness();await h.exec({type:'saveDocument',snapshot:{...estimate,documentId:'est_doc2'},expectedRevision:0});
 const est=h.list('estimates')[0];await h.exec({type:'acceptEstimate',estimateId:est.id,workDate:''});
 assert.equal(live(h).length,0);assert.equal(h.list('estimates')[0].payload.status,'受注・日程未定');
 await h.exec({type:'acceptEstimate',estimateId:est.id,workDate:'2026-12-05'});assert.equal(live(h).length,1);assert.equal(live(h)[0].payload.date,'2026-12-05');
});
for(const docType of ['invoice','receipt'])test('C: standalone '+docType+' creates one event titled 宛名｜first 施工項目; replay and 訂正 keep one event',async()=>{
 const h=await harness();
 const s=docType==='invoice'?{documentId:'inv_c',docType,customerName:'試験顧客B',invoiceDate:'2026-12-02',workDate:'2026-12-01',items:[{content:'クロス張替',qty:1,price:30000},{content:'追加作業',qty:1,price:5000}]}
  :{documentId:'rec_c',docType,customerName:'試験顧客C',receiptTotal:'22000',invoiceDate:'2026-12-04',paymentMethod:'現金',tadashi:'穴補修 / 追加',items:[{content:'穴補修',qty:1,price:20000}]};
 const r=await h.exec({type:'saveDocument',snapshot:s,expectedRevision:0});
 assert.equal(live(h).length,1);const e=live(h)[0].payload,amount=docType==='invoice'?38500:22000;
 assert.equal(e.title,docType==='invoice'?'試験顧客B｜クロス張替｜¥38,500｜請求済':'試験顧客C｜穴補修｜¥22,000｜領収済');
 assert.equal(e.date,docType==='invoice'?'2026-12-01':'2026-12-04');assert.equal(e.officialAmount,amount);assert.equal(e[docType==='invoice'?'linkedInvoiceId':'linkedReceiptId'],s.documentId);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++)assert((await h.exec({type:'saveDocument',snapshot:r.snapshot,expectedRevision:r.revision})).unchanged);assert.equal(JSON.stringify([...h.rows]),frozen,'replay writes nothing');
 // 訂正 (new version of the same document): still exactly one live event for the chain, now pointing at the new version.
 const rev={...r.snapshot,documentId:s.documentId+'_v2',invoiceNo:'',items:docType==='invoice'?[{content:'クロス張替',qty:1,price:30000},{content:'追加作業',qty:1,price:5000}]:s.items,remarks:'訂正'};
 await h.exec({type:'saveDocument',snapshot:rev,expectedRevision:0,revisedFromDocumentId:s.documentId,expectedParentRevision:h.list('documents').find(d=>d.id===s.documentId).revision,reason:'記載訂正'});
 assert.equal(live(h).length,1,'one event after 訂正');assert.equal(live(h)[0].payload.documentId,s.documentId+'_v2');
});
