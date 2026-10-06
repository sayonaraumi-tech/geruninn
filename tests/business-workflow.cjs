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
const event={googleEventId:'cash-event',googleCalendarId:'shared',date:'2026-10-05',start:'2026-10-05',end:'2026-10-06',title:'下村 健朗、クロス張替、足立区、11万、現金、km',location:'現場'};
test('cash Google parsing, repeat/concurrent synchronization, amount/date/customer update, cancellation audit and formal lock',async()=>{
 const parsed=B.parseCalendar(event.title);assert.deepEqual(parsed,{amount:110000,payment:'現金',area:'足立区',customer:'下村健朗',work:'クロス張替',projectCategory:'クロス張替'});
 const h=await harness();await Promise.all([h.execute({type:'calendar',event}),h.execute({type:'calendar',event})]);
 assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 let sale=h.list('sales')[0].payload;assert.equal(sale.amount,110000);assert.equal(sale.invoiceDate,'');assert.equal(A.receivables([sale],h.list('payments').map(r=>r.payload),'2026-10-06')[0].status,'入金済');assert.equal(A.receivables([sale],h.list('payments').map(r=>r.payload),'2026-10-06')[0].paid,110000);
 await h.execute({type:'calendar',event:{...event,date:'2026-10-07',title:'別 顧客、穴補修、足立区、12万、現金'}});
 sale=h.list('sales')[0].payload;assert.equal(sale.customer,'別顧客');assert.equal(sale.amount,120000);assert.equal(sale.salesDate,'2026-10-07');assert.equal(h.list('payments')[0].payload.amount,120000);assert.equal(h.list('cashLedger')[0].payload.amount,120000);
 const link=h.list('calendarLinks')[0];await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'formal',docType:'invoice',customerName:'正式顧客',invoiceDate:'2026-10-08',salesDate:'2026-10-07',calendarEventId:link.id,items:[{content:'穴補修',qty:1,price:100000}]}});
 assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].payload.amount,110000);
 await h.execute({type:'calendar',event:{...event,title:'変更 顧客、クロス張替、足立区、99万、現金'}});assert.equal(h.list('sales')[0].payload.amount,110000);assert.equal(h.list('sales')[0].payload.customer,'正式顧客');assert.equal(h.list('payments')[0].payload.amount,120000);
 await h.execute({type:'calendar',event:{...event,googleStatus:'cancelled'}});assert.equal(h.list('sales').length,1);assert(h.list('sales')[0].payload.accountingReviewRequired);
});
test('ordinary events without explicit cash/amount create no accounting; standalone forms and filenames use shared classifier',async()=>{
 const h=await harness();for(const title of ['下村 健朗、クロス張替、足立区、11万','下村 健朗、クロス張替、足立区、現金'])await h.execute({type:'calendar',event:{...event,title}});
 assert.equal(h.list('sales').length,0);assert.equal(h.list('payments').length,0);
 for(const docType of ['invoice','estimate','receipt','onoda']){
 const snapshot={documentId:docType,docType,invoiceDate:'2026-10-06',workDate:docType==='estimate'?'2026-10-20':'',customerName:'顧客',items:docType==='receipt'?[]:[{content:'穴補修',qty:1,price:1000}],tadashi:'穴補修代',receiptTotal:1100,paymentMethod:'現金'};
 await h.execute({type:'saveDocument',snapshot,expectedRevision:0});const row=h.list('documents').find(r=>r.id===docType),before=JSON.stringify([...h.rows]);
 const result=await h.execute({type:'saveDocument',snapshot:row.payload.snapshot,expectedRevision:row.revision});assert(result.unchanged);assert.equal(h.list('documents').find(r=>r.id===docType).revision,row.revision);assert.equal(h.list('sales').length,['invoice','onoda','receipt'].filter(t=>h.list('documents').some(d=>d.id===t)).length);
 assert.equal(B.projectCategory({items:[],linkedInvoice:{items:[{content:'クロス張替'},{content:'穴補修'},{content:'ドア補修'}]},tadashi:'工事代'}),'クロス張替・穴補修・ドア補修');assert(B.documentFilename(snapshot).startsWith('2026-10-06_顧客_穴補修_'));
 }
 assert.equal(h.list('payments').length,1);await h.execute({type:'acceptEstimate',estimateId:'est_estimate'});assert.equal(h.list('estimates')[0].payload.workDate,'2026-10-20');assert.equal(h.list('documents').find(r=>r.id==='estimate').payload.salesDate,'');
});
test('void excludes unpaid sale, is idempotent, preserves snapshot and audit; valid payment blocks and markers/deleted payments do not',async()=>{
 const h=await harness();const snapshot={documentId:'i',docType:'invoice',customerName:'顧客',invoiceDate:'2026-10-06',items:[{content:'穴補修',qty:1,price:1000}]};await h.execute({type:'saveDocument',snapshot,expectedRevision:0});
 await h.execute({type:'payment',paymentId:'p',saleId:'sale_i',amount:100,paymentDate:'2026-10-06',method:'現金'});
 await assert.rejects(h.execute({type:'documentStatus',documentId:'i',status:'void',reason:'誤登録',expectedRevision:1}),/入金/);
 await h.execute({type:'voidPayment',paymentId:'p',reason:'取消',expectedRevision:h.list('payments')[0].revision});
 const original=JSON.stringify(h.list('documents')[0].payload.snapshot);
 await h.execute({type:'documentStatus',documentId:'i',status:'void',reason:'誤登録',expectedRevision:1});assert(!A.live(h.list('sales')[0].payload));assert.equal(JSON.stringify(h.list('documents')[0].payload.snapshot),original);
 const result=await h.execute({type:'documentStatus',documentId:'i',status:'void',reason:'再試行',expectedRevision:1});assert(result.unchanged);assert.equal(h.list('documents')[0].revision,2);
});

test('production gate: backed-up Invalid Date outbox recovers subsequent void; committed observer failure cannot poison next command',async()=>{
 const {createSync}=require('../js/business-sync'),h=await harness(),m=new Map(),storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};
 await h.execute({type:'saveDocument',snapshot:{documentId:'recovery-est',docType:'estimate',invoiceDate:'2026-10-03',customerName:'琢居株式会社',items:[]},expectedRevision:0});
 await h.execute({type:'saveDocument',snapshot:{documentId:'recovery-inv',docType:'invoice',invoiceDate:'2026-10-03',customerName:'琢居株式会社',items:[{qty:1,price:97160}]},expectedRevision:0});
 const first={command:{operationId:'bad-date',type:'acceptEstimate',estimateId:'est_recovery-est',workDate:'2026/10/7'},blocked:true,error:'Invalid Date'},second={command:{operationId:'pending-void',type:'documentStatus',documentId:'recovery-inv',status:'void',reason:'誤登録',expectedRevision:1}};
 const key='tsukinowa_cloud_v2_demo_tsukinowa_admin_outbox';storage.setItem(key,JSON.stringify([first,second]));const failures=[];
 const sync=createSync({client:h.client,storage,onCommitted:cmd=>{if(cmd.type==='acceptEstimate')throw Error('bad display observer');},onFailure:(cmd,e)=>failures.push([cmd.type,e])});await sync.flush();
 assert.equal(sync.getQueue().length,0);assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('calendarLinks')[0].payload.date,'2026-10-07');assert.equal(h.list('documents').find(d=>d.id==='recovery-inv').payload.status,'void');assert.equal(h.list('documents').length,2);assert.equal(failures.length,1);assert([...m.keys()].some(k=>k.includes('invalid_date_bad-date')));assert.equal(JSON.parse(m.get([...m.keys()].find(k=>k.includes('invalid_date_bad-date')))).command.workDate,'2026/10/7');
});
