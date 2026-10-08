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
 assert.equal(B.projectCategory({items:[],linkedInvoice:{items:[{content:'クロス張替'},{content:'穴補修'},{content:'ドア補修'}]},tadashi:'工事代'}),'クロス張替・穴補修・ドア補修');assert.equal(B.documentFilename(snapshot),docType==='onoda'?'26／10／31 dynast合同会社様10月分クロス張替請求書.pdf':`26／10／6 顧客様穴補修${{invoice:'請求書',estimate:'見積書',receipt:'領収書'}[docType]}.pdf`);
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

test('production gate: calendar UTC storage displays Japan time and local ICS times stay local',()=>{
 assert.equal(B.calendarTime('2026-10-01T05:30:00.000Z'),'14:30');assert.equal(B.calendarTime('2026-10-01T14:30:00+09:00'),'14:30');assert.equal(B.calendarTime('2026-10-01T14:30:00'),'14:30');assert.equal(B.calendarTime('2026-10-01'),'終日');assert.equal(B.calendarTime('Invalid Date'),'未定');
});


test('restored business filenames use first main work, skip expenses, honorific once and fixed Onoda branch',()=>{
 for(const [docType,label]of [['estimate','見積書'],['invoice','請求書'],['receipt','領収書']])assert.equal(B.documentFilename({docType,invoiceDate:'2026-04-08',customerName:'中村成男',items:[{content:'出張費'},{content:'クロス張替'},{content:'穴補修'}]}),`26／4／8 中村成男様クロス張替${label}.pdf`);
 assert.equal(B.documentFilename({docType:'invoice',invoiceDate:'2026-09-24',customerName:'蛍火株式会社様',items:[{content:'網戸張替'},{content:'クロス張替'}]}),'26／9／24 蛍火株式会社様網戸張替請求書.pdf');
 assert.equal(B.documentFilename({docType:'onoda',invoiceDate:'2026-08-31',customerName:'変更顧客',items:[{content:'穴補修'}]}),'26／8／31 dynast合同会社様8月分クロス張替請求書.pdf');
 assert.equal(B.filenameProject({items:[{content:'材料費 クロス'},{content:'雑費'},{content:'清掃'},{content:'洗浄'}]}),'清掃');
 assert.equal(B.filenameProject({items:[{content:'材料費'},{content:'雑費'}]}),'工事');
 assert.equal(B.filenameProject({items:[{content:'穴補修'},{content:'クロス張替'}]}),'穴補修');
 assert.equal(B.filenameProject({items:[{content:'クロス張替・網戸張替'}]}),'クロス張替');
 assert.equal(B.filenameProject({linkedInvoice:{items:[{content:'網戸張替'}]},tadashi:'工事代'}),'網戸張替');
 assert.equal(B.projectCategory({items:[{content:'クロス張替'},{content:'穴補修'}]}),'クロス張替・穴補修');
});
test('manual confirmed bank payment is partial/final, concurrent/repeated idempotent and creates no document or number',async()=>{
 const h=await harness();await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'manual',docType:'invoice',customerName:'顧客',invoiceDate:'2026-10-08',items:[{content:'クロス張替',qty:1,price:10000}]}});
 const original=JSON.stringify(h.list('documents')),numbers=JSON.stringify(h.list('operations').filter(r=>r.id.startsWith('documentNumber_')));
 const cmd={type:'payment',manualConfirmed:true,paymentId:'random-a',saleId:'sale_manual',amount:5000,paymentDate:'2026-10-08',method:'銀行振込',memo:'銀行で確認'};
 await Promise.all([h.execute(cmd),h.execute(cmd)]);await h.execute(cmd);
 assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].payload.confirmation,'bank-confirmed');
 assert.equal(A.receivables(h.list('sales').map(r=>r.payload),h.list('payments').map(r=>r.payload),'2026-10-08')[0].outstanding,6000);
 await h.execute({...cmd,paymentId:'real-second'});assert.equal(h.list('payments').length,2);assert.equal(A.receivables(h.list('sales').map(r=>r.payload),h.list('payments').map(r=>r.payload),'2026-10-08')[0].outstanding,1000);await h.execute({...cmd,paymentId:'final',amount:1000,paymentDate:'2026-10-09'});
 assert.equal(A.receivables(h.list('sales').map(r=>r.payload),h.list('payments').map(r=>r.payload),'2026-10-09')[0].outstanding,0);
 assert.equal(h.list('cashLedger').length,0);assert.equal(JSON.stringify(h.list('documents')),original);assert.equal(JSON.stringify(h.list('operations').filter(r=>r.id.startsWith('documentNumber_'))),numbers);
});

test('Onoda filenames always use the target month end including leap February',()=>{for(const [date,expected] of [['2026-08-01','26／8／31'],['2026-09-12','26／9／30'],['2026-10-06','26／10／31'],['2026-02-01','26／2／28'],['2024-02-01','24／2／29']])assert.equal(B.documentFilename({docType:'onoda',invoiceDate:date}),expected+' dynast合同会社様'+Number(date.slice(5,7))+'月分クロス張替請求書.pdf');});

test('lost payment response replays the persisted operation and standard reload once',async()=>{const h=await harness();await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'retry-network',docType:'invoice',invoiceDate:'2026-10-08',customerName:'顧客',items:[{content:'施工',qty:1,price:1000}]}});const store=new Map();let reloads=0;const sync=require('../js/business-sync').createSync({client:h.client,storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},onData:()=>reloads++});const run=sync.service.execute;let lose=true;sync.service.execute=async cmd=>{const result=await run(cmd);if(lose){lose=false;const e=Error('response lost');e.code='unavailable';throw e;}return result;};const command={type:'payment',operationId:'network-retry',paymentId:'pay-network',manualConfirmed:true,saleId:'sale_retry-network',amount:500,paymentDate:'2026-10-08',method:'銀行振込',memo:''};sync.enqueue(command);await sync.flush();assert.equal(h.list('payments').length,1);assert.equal(sync.getQueue().length,1);await sync.flush();assert.equal(h.list('payments').length,1);assert.equal(sync.getQueue().length,0);assert.equal(reloads,1);assert.equal(sync.getRows().payments.length,1);sync.stop();});
