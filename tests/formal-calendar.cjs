const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(role='admin'){
 const rows=new Map();let cb;
 const digest=async s=>crypto.createHash('sha256').update(s).digest('hex'),driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest,timestamp:()=>123,
 list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{const writes=[];const result=await f({get:async p=>rows.get(p)||null,set:(p,v)=>writes.push([p,v])});for(const [p,v]of writes)rows.set(p,v);return result;}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:role,claims:{role,companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 return {rows,service,list,client};
}

const invoice={documentId:'wooc',docType:'invoice',customerName:'株式会社WOOC',invoiceDate:'2026-10-31',workDate:'2026-10-30',salesDate:'2026-10-29',items:[{content:'クロス張替',qty:1,price:66000}]};
const exec=(h,cmd)=>h.service.execute({operationId:crypto.randomUUID(),...cmd});
const save=(h,s=invoice)=>exec(h,{type:'saveDocument',snapshot:s,expectedRevision:0});
const rows=h=>Object.fromEntries(B.COLLECTIONS.map(n=>[n,h.list(n)]));
for(const docType of ['invoice','onoda','receipt'])test(docType+' short calendar title preserves full records and repairs the same event once',async()=>{
 const h=await harness(),s={...invoice,docType,receiptTotal:72600,paymentMethod:'銀行振込',tadashi:'カーペット張替 / カーペット処理代',items:[{content:'カーペット張替',qty:1,price:60000},{content:'カーペット処理代',qty:1,price:6000}]};
 const expected='株式会社WOOC｜カーペット張替｜¥72,600｜'+(docType==='receipt'?'領収済':'請求済');
 assert.equal(B.formalCalendarTitle(s,72600),expected);
 assert.equal(B.formalCalendarTitle({...s,items:[s.items[0]]},72600),expected);
 assert.match(B.formalCalendarTitle({...s,items:[{content:'CF/クッションフロア'}]},72600),/｜CF\/クッションフロア｜/);
 for(const field of ['summary','tadashi','content'])assert.equal(B.formalCalendarTitle({...s,items:[{content:'  '}],summary:'',tadashi:'',content:'',[field]:'カーペット張替 / 追加作業'},72600),expected);
 assert.match(B.formalCalendarTitle({docType,customerName:'顧客',items:[]},1),/｜.+｜¥1｜/);
 await save(h,s);const e=h.list('calendarLinks')[0],key='companies/tsukinowa/calendarLinks/'+e.id;
 assert.equal(e.payload.title,expected);assert(e.payload.googleCreatePending);assert(e.payload.googlePatchPending);
 assert.deepEqual(h.list('documents')[0].payload.snapshot.items,s.items);
 assert.equal(h.list('sales')[0].payload.content,docType==='receipt'?s.tadashi:B.summary(s));
 const content=e.payload.content,protectedRows=JSON.stringify(Object.fromEntries(B.COLLECTIONS.filter(n=>!['calendarLinks','auditLogs'].includes(n)).map(n=>[n,h.list(n)])));
 h.rows.set(key,{...h.rows.get(key),payload:{...e.payload,title:'old long title',googleCreatePending:false,googlePatchPending:false}});
 const old=h.rows.get(key).payload;
 assert(B.formalDocumentNeedsRepair(h.list('documents')[0],rows(h)));
 await exec(h,{type:'repairFormalDocument',documentId:'wooc'});
 assert.deepEqual(h.rows.get(key).payload,{...old,title:expected,googlePatchPending:true});assert.equal(h.rows.get(key).payload.content,content);
 assert.equal(JSON.stringify(Object.fromEntries(B.COLLECTIONS.filter(n=>!['calendarLinks','auditLogs'].includes(n)).map(n=>[n,h.list(n)]))),protectedRows);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++){assert(!B.formalDocumentNeedsRepair(h.list('documents')[0],rows(h)));assert((await exec(h,{type:'repairFormalDocument',documentId:'wooc'})).skipped);}
 assert.equal(JSON.stringify([...h.rows]),frozen);assert.equal(h.list('calendarLinks').length,1);
});
for(const docType of ['invoice','onoda'])test(docType+' standalone WOOC creates one pending schedule, replay and Google completion are idempotent',async()=>{
 const h=await harness('staff'),s={...invoice,docType},r=await save(h,s),e=h.list('calendarLinks')[0].payload;
 assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,0);assert.equal(e.status,'請求済');assert.equal(e.date,'2026-10-30');assert.equal(e.end,'2026-10-31');assert.equal(e.officialAmount,72600);assert.equal(e.linkedInvoiceId,'wooc');assert.equal(h.list('documents')[0].payload.saleId,r.saleId);assert(e.googleCreatePending);assert(e.googlePatchPending);assert.equal(e.title,B.formalCalendarTitle(s,72600));assert.equal(r.snapshot.calendarEventId,e.id);
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<3;i++)assert((await exec(h,{type:'saveDocument',snapshot:r.snapshot,expectedRevision:r.revision})).unchanged);assert.equal(JSON.stringify([...h.rows]),frozen);
 await exec(h,{type:'calendarPrepareCreate',id:e.id,calendarId:'mock'});await exec(h,{type:'calendarCreated',id:e.id,calendarId:'mock',googleEventId:e.googleEventId});assert.equal(h.list('calendarLinks')[0].payload.googleCreatePending,false);
});
for(const mode of ['unique','explicit','google','sale','multiple','amount','manual-amount','other-invoice'])test('formal candidate '+mode,async()=>{
 const h=await harness(),s={...invoice};
 for(const id of mode==='multiple'?['one','two']:['one'])h.rows.set('companies/tsukinowa/calendarLinks/'+id,{revision:1,payload:{id,date:'2026-10-30',customerName:s.customerName,content:'クロス張替',officialAmount:['amount','manual-amount'].includes(mode)?70000:72600,googleEventId:id,...(mode==='manual-amount'?{manualSaleConfirmed:true}:{}),...(mode==='other-invoice'?{linkedInvoiceId:'different'}:{}),...(mode==='sale'?{saleId:'sale_wooc',customerName:'old'}:{}),...(mode==='google'?{customerName:'old'}:{})}});
 if(mode==='explicit')s.calendarEventId='one';if(mode==='google')s.googleEventId='one';
 if(['multiple','amount','manual-amount','other-invoice'].includes(mode)){const before=JSON.stringify([...h.rows]);await assert.rejects(save(h,s),/要確認/);assert.equal(JSON.stringify([...h.rows]),before);return;}
 const r=await save(h,s);assert.equal(r.snapshot.calendarEventId,'one');assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('calendarLinks')[0].payload.googleCreatePending,false);assert(h.list('calendarLinks')[0].payload.googlePatchPending);
});
for(const docType of ['invoice','onoda'])test('historical '+docType+' repair only changes calendar graph; repeated hydrate and repair do not duplicate sales',async()=>{
 const h=await harness(),s={...invoice,docType,invoiceNo:'legacy-123'};
 h.rows.set('companies/tsukinowa/documents/wooc',{revision:1,payload:{documentId:'wooc',docType,status:'active',confirmed:true,amount:72600,customerName:s.customerName,snapshot:s,saleId:'sale_wooc'}});
 h.rows.set('companies/tsukinowa/sales/sale_wooc',{revision:1,payload:{id:'sale_wooc',documentId:'wooc',documentStatus:'active',customer:s.customerName,amount:72600}});
 const saleBefore=JSON.stringify(h.list('sales')),snapshotBefore=C.canonical(s);
 assert(B.formalDocumentNeedsRepair(h.list('documents')[0],rows(h)));
 await exec(h,{type:'repairFormalDocument',documentId:'wooc'});
 const frozen=JSON.stringify([...h.rows]);for(let i=0;i<4;i++){assert(!B.formalDocumentNeedsRepair(h.list('documents')[0],rows(h)));assert((await exec(h,{type:'repairFormalDocument',documentId:'wooc'})).skipped);}
 assert.equal(JSON.stringify([...h.rows]),frozen);assert.equal(JSON.stringify(h.list('sales')),saleBefore);assert.equal(C.canonical(h.list('documents')[0].payload.snapshot),snapshotBefore);assert.equal(h.list('calendarLinks').length,1);assert(h.list('calendarLinks')[0].payload.googleCreatePending);assert.equal(h.list('calendarLinks')[0].payload.date,'2026-10-30');
});
test('invoice date fallback and second formal invoice require review',async()=>{const h=await harness();const s={...invoice,workDate:'',salesDate:''};await save(h,s);assert.equal(h.list('calendarLinks')[0].payload.date,s.invoiceDate);await assert.rejects(save(h,{...s,documentId:'duplicate'}),/要確認/);assert.equal(h.list('sales').length,1);});

test('stale discovery list still reuses stable historical schedule and leaves accounting untouched',async()=>{
 const h=await harness(),s={...invoice};h.rows.set('companies/tsukinowa/documents/wooc',{revision:1,payload:{documentId:'wooc',docType:'invoice',status:'active',amount:72600,snapshot:s,saleId:'sale_wooc'}});h.rows.set('companies/tsukinowa/sales/sale_wooc',{revision:1,payload:{id:'sale_wooc',documentId:'wooc',amount:72600}});
 const list=h.client.listRecords;h.client.listRecords=n=>n==='calendarLinks'?Promise.resolve([]):list(n);
 await exec(h,{type:'repairFormalDocument',documentId:'wooc'});const frozen=JSON.stringify([...h.rows]);assert((await exec(h,{type:'repairFormalDocument',documentId:'wooc'})).skipped);assert.equal(JSON.stringify([...h.rows]),frozen);
});
test('explicit Google identity conflict and different formal sale cannot overwrite accounting',async()=>{
 for(const mode of ['google','sale']){const h=await harness(),r=await save(h),before=JSON.stringify([...h.rows]);await assert.rejects(save(h,{...invoice,documentId:'second',...(mode==='google'?{calendarEventId:r.snapshot.calendarEventId,googleEventId:'different'}:{saleId:r.saleId,customerName:'別顧客'})}),/要確認/);assert.equal(JSON.stringify([...h.rows]),before);}
});
test('invoice repair never downgrades a receipt calendar',async()=>{
 const h=await harness(),r=await save(h);await exec(h,{type:'saveDocument',expectedRevision:0,snapshot:{documentId:'paid',docType:'receipt',saleId:r.saleId,customerName:invoice.customerName,invoiceDate:'2026-10-30',receiptTotal:72600,paymentMethod:'銀行振込',tadashi:'クロス張替'}});
 const before=JSON.stringify([...h.rows]);assert((await exec(h,{type:'repairFormalDocument',documentId:'wooc'})).skipped);assert.equal(JSON.stringify([...h.rows]),before);assert.equal(h.list('calendarLinks')[0].payload.status,'領収済');
});
