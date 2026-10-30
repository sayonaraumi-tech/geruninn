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
test('manual calendar cash confirmation, concurrent replay, sync preservation and receipt/invoice takeover',async()=>{
 const h=await harness(),event={googleEventId:'manual-cash',googleCalendarId:'shared',date:'2026-10-19',title:'太陽様 クロス張り替え、14000、文京区、km、現金'};
 const p=B.parseCalendar(event.title);assert.equal(p.customer,'太陽様');assert.equal(p.work,'クロス張り替え');assert.equal(p.amount,14000);
 // Model a pre-existing calendarLink which has never triggered automatic accounting.
 const id=await h.service.eventId(event);h.rows.set('companies/tsukinowa/calendarLinks/'+id,{revision:1,payload:{...event,id}});
 const cmd={type:'registerCalendarSale',id,sale:{salesDate:event.date,customer:p.customer,content:p.work,amount:p.amount,paymentMethod:p.payment,memo:'確認'}};
 await Promise.all([h.execute(cmd),h.execute(cmd)]);await h.execute(cmd);
 assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);assert.equal(h.list('documents').length,0);
 let sale=h.list('sales')[0].payload;assert.equal(sale.customer,'太陽様');assert.equal(sale.content,'クロス張り替え');assert.equal(h.list('payments')[0].payload.confirmation,'cash-received');assert.equal(h.list('cashLedger')[0].payload.amount,14000);assert.equal(A.ledger([sale],h.list('payments').map(r=>r.payload)).sales[0].outstanding,0);
 const accounting=JSON.stringify(['sales','payments','cashLedger'].map(n=>h.list(n)));await h.execute({type:'calendar',event:{...event,title:'別人様 穴補修、20000、現金'}});assert.equal(JSON.stringify(['sales','payments','cashLedger'].map(n=>h.list(n))),accounting);
 await assert.rejects(h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'mismatched-receipt',docType:'receipt',saleId:sale.id,customerName:'太陽様',invoiceDate:'2026-10-20',paymentMethod:'現金',receiptTotal:14000,tadashi:p.work,calendarEventId:id}}),/一致/);
 await assert.rejects(h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'small-invoice',docType:'invoice',customerName:'太陽様',invoiceDate:event.date,calendarEventId:id,items:[{content:p.work,qty:1,price:1000}]}}),/要確認/);
 await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'manual-receipt',docType:'receipt',customerName:'太陽様',invoiceDate:event.date,paymentMethod:'現金',receiptTotal:14000,tadashi:p.work,calendarEventId:id}});
 await h.execute(cmd);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'manual-invoice',docType:'invoice',customerName:'太陽様',invoiceDate:event.date,salesDate:event.date,calendarEventId:id,items:[{content:p.work,qty:1,price:14000/1.1}]}});
 assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].payload.documentId,'manual-invoice');
});
test('manual noncash methods retain unpaid sale, unnamed customer fallback and formal invoice reuse',async()=>{
 for(const method of ['銀行振込','プラットフォーム経由','その他']){
 const h=await harness(),link=await h.execute({type:'calendar',event:{googleEventId:method,date:'2026-10-19',title:'クロス張り替え、14000、km'}}),cmd={type:'registerCalendarSale',id:link.id,sale:{salesDate:'2026-10-19',customer:'',content:'クロス張り替え',amount:14000,paymentMethod:method}};
 await h.execute(cmd);const s=h.list('sales')[0].payload;assert.equal(s.customer,'現金客');assert.equal(s.paymentMethod,method);assert.equal(h.list('payments').length,0);assert.equal(h.list('cashLedger').length,0);assert.equal(A.ledger([s],[]).sales[0].outstanding,14000);
 await h.execute({type:'calendar',event:{googleEventId:method,date:'2026-10-19',title:'クロス張り替え、14000、現金'}});assert.equal(h.list('payments').length,0);
 await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'formal',docType:'invoice',customerName:'正式顧客',invoiceDate:'2026-10-19',calendarEventId:link.id,items:[{content:'クロス張り替え',qty:1,price:14000/1.1}]}});await h.execute(cmd);assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].id,s.id);
 }
});
test('automatic cash and existing formal sales block manual registration; invalid input writes nothing',async()=>{
 for(const formal of [false,true]){const h=await harness(),event={googleEventId:'existing',date:'2026-10-19',title:formal?'工事':'クロス張り替え、14000、現金'},link=await h.execute({type:'calendar',event});if(formal)await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'existing',docType:'invoice',calendarEventId:link.id,customerName:'顧客',invoiceDate:event.date,items:[{content:'工事',qty:1,price:1000}]}});const before=JSON.stringify(['sales','payments','cashLedger'].map(n=>h.list(n)));await h.execute({type:'registerCalendarSale',id:link.id,sale:{}});assert.equal(JSON.stringify(['sales','payments','cashLedger'].map(n=>h.list(n))),before);}
 const h=await harness(),link=await h.execute({type:'calendar',event:{id:'invalid',date:'2026-10-19',title:'予定'}});await assert.rejects(h.execute({type:'registerCalendarSale',id:link.id,sale:{amount:0}}));assert.equal(h.list('sales').length,0);
});
test('legacy duplicate links share one manual sale across Google resync; unnamed cash uses 現金客',async()=>{
 const h=await harness(),event={googleEventId:'alias-google',date:'2026-10-19',title:'クロス張り替え、14000、現金'};
 for(const id of ['first','second'])h.rows.set('companies/tsukinowa/calendarLinks/'+id,{revision:1,payload:{...event,id}});
 await h.execute({type:'registerCalendarSale',id:'second',sale:{salesDate:event.date,content:'クロス張り替え',amount:14000,paymentMethod:'現金'}});
 await h.execute({type:'calendar',event});await h.execute({type:'registerCalendarSale',id:'first',sale:{}});
 assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].payload.customer,'現金客');assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);assert(h.list('calendarLinks').every(r=>r.payload.saleId===h.list('sales')[0].id));
});
test('platform payment survives repeat registration, bank match/unmatch and historical supplier accounting',async()=>{
 const h=await harness();await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'platform',docType:'invoice',customerName:'顧客',invoiceDate:'2026-10-08',items:[{content:'施工',qty:1,price:10000}]}});
 await h.execute({type:'saveSupplier',supplierId:'supplier',supplier:{supplierName:'材料会社',openingDate:'2026-10-01',openingBalance:1000000},expectedRevision:0});
 await h.execute({type:'supplierTransaction',transactionId:'material',transaction:{supplierId:'supplier',date:'2026-10-08',type:'monthlyInvoice',amount:1000,invoiceMonth:'2026-10',paymentMethod:'銀行振込',description:'請求書'},expectedRevision:0});
 const preserved=JSON.stringify(['suppliers','supplierTransactions','expenses'].map(n=>h.list(n)));
 const cmd={type:'payment',paymentId:'platform-pay',saleId:'sale_platform',amount:1000,paymentDate:'2026-10-08',method:'プラットフォーム経由',platformName:'くらしのマーケット',memo:'精算'};
 await h.execute(cmd);await h.execute(cmd);assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].payload.confirmation,'pending-bank');
 const bank={bankTxnId:'platform-bank',bankTransactionDate:'2026-10-09',bankAccount:'GMO',incoming:1000,outgoing:0,amount:1000,description:'STRIPE JAPAN'};
 await h.execute({type:'importBank',bank});await h.execute({type:'bankMatch',bankTxnId:bank.bankTxnId,targetType:'sale',targetId:cmd.saleId,paymentId:cmd.paymentId,expectedRevision:1});
 let p=h.list('payments')[0].payload;assert.equal(p.method,cmd.method);assert.equal(p.platformName,cmd.platformName);assert.equal(p.confirmation,'bank-confirmed');assert.equal(p.memo,bank.description);assert.equal(h.list('cashLedger').length,0);
 const d=()=>Object.fromEntries(['sales','payments','suppliers','supplierTransactions','expenses','documents'].map(n=>[n,h.list(n).map(r=>r.payload)]));
 assert.equal(A.monthly(d(),'2026-10').income,1000);assert.equal(A.monthly(d(),'2026-10').receivables,10000);assert.equal(A.monthly(d(),'2026-10').expenseTotal,1000);
 const csv=require('../js/year-end').exports(d(),2026,{role:'admin',companyId:'tsukinowa'});for(const n of ['入金一覧.csv','月次集計.csv','年間集計.csv'])assert(csv[n].includes('くらしのマーケット'),n);
 await h.execute({type:'bankUnmatch',bankTxnId:bank.bankTxnId,expectedRevision:2,reason:'再確認'});p=h.list('payments')[0].payload;assert.equal(p.method,cmd.method);assert.equal(p.platformName,cmd.platformName);assert.equal(p.confirmation,'pending-bank');assert.equal(A.monthly(d(),'2026-10').income,0);
 assert.equal(JSON.stringify(['suppliers','supplierTransactions','expenses'].map(n=>h.list(n))),preserved);
});
test('legacy channel projection is read-only; missing methods and platform aliases do not change totals',()=>{
 const rows=[{method:'現金'},{method:'銀行振込'},{method:'GMO銀行'},{method:'暮らしのマーケット'},{method:'くらしのマーケット'},{method:'オンライン決済',memo:'くらしのマーケット経由入金'},{}, {method:'その他'}],before=JSON.stringify(rows);
 assert.deepEqual(rows.map(p=>A.paymentChannel(p).channel),['現金','銀行振込','銀行振込','プラットフォーム経由','プラットフォーム経由','プラットフォーム経由','未設定','その他']);
 for(const p of rows.slice(3,6))assert.equal(A.paymentChannel(p).platformName,'くらしのマーケット');assert.equal(JSON.stringify(rows),before);
});
const event={googleEventId:'cash-event',googleCalendarId:'shared',date:'2026-10-05',start:'2026-10-05',end:'2026-10-06',title:'下村 健朗、クロス張替、足立区、11万、現金、km',location:'現場'};
test('cash Google parsing, repeat/concurrent synchronization, date/customer update, cancellation audit and formal lock',async()=>{
 const parsed=B.parseCalendar(event.title);assert.deepEqual(parsed,{amount:110000,payment:'現金',area:'足立区',customer:'下村健朗',work:'クロス張替',projectCategory:'クロス張替'});
 const h=await harness();await Promise.all([h.execute({type:'calendar',event}),h.execute({type:'calendar',event})]);
 assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,1);
 let sale=h.list('sales')[0].payload;assert.equal(sale.amount,110000);assert.equal(sale.invoiceDate,'');assert.equal(A.receivables([sale],h.list('payments').map(r=>r.payload),'2026-10-06')[0].status,'入金済');assert.equal(A.receivables([sale],h.list('payments').map(r=>r.payload),'2026-10-06')[0].paid,110000);
 await h.execute({type:'calendar',event:{...event,date:'2026-10-07',title:'別 顧客、穴補修、足立区、11万、現金'}});
 sale=h.list('sales')[0].payload;assert.equal(sale.customer,'別顧客');assert.equal(sale.amount,110000);assert.equal(sale.salesDate,'2026-10-07');assert.equal(h.list('payments')[0].payload.amount,110000);assert.equal(h.list('cashLedger')[0].payload.amount,110000);
 const link=h.list('calendarLinks')[0];await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'formal',docType:'invoice',customerName:'正式顧客',invoiceDate:'2026-10-08',salesDate:'2026-10-07',calendarEventId:link.id,items:[{content:'穴補修',qty:1,price:100000}]}});
 assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].payload.amount,110000);
 await h.execute({type:'calendar',event:{...event,title:'変更 顧客、クロス張替、足立区、99万、現金'}});assert.equal(h.list('sales')[0].payload.amount,110000);assert.equal(h.list('sales')[0].payload.customer,'正式顧客');assert.equal(h.list('payments')[0].payload.amount,110000);
 await h.execute({type:'calendar',event:{...event,googleStatus:'cancelled'}});assert.equal(h.list('sales').length,1);assert(h.list('sales')[0].payload.accountingReviewRequired);
});
test('unnamed cash keeps stable anchors through customer edits; changed amount or cash requires review',async()=>{
 const title='クロス張り替え、14000、文京区、km、現金',h=await harness(),e={...event,title};
 assert.deepEqual(B.parseCalendar(title),{amount:14000,payment:'現金',area:'文京区',customer:'',work:'クロス張り替え',projectCategory:'クロス張替'});
 await Promise.all([h.execute({type:'calendar',event:e}),h.execute({type:'calendar',event:e})]);
 const ids=()=>['calendarLinks','sales','payments','cashLedger'].map(n=>h.list(n).map(r=>r.id)),anchors=ids();
 for(const [next,customer]of [[title,'現金客'],['山田様、'+title,'山田様'],[title,'現金客']]){
  await h.execute({type:'calendar',event:{...e,title:next}});assert.deepEqual(ids(),anchors);assert(anchors.every(a=>a.length===1));
  const sale=h.list('sales')[0].payload,pay=h.list('payments')[0].payload;
  assert.equal(sale.customer,customer);assert.equal(sale.sourceType,'calendar-cash');assert.equal(sale.amount,14000);assert.equal(sale.documentId,'');assert.equal(sale.invoiceDate,'');assert.equal(sale.invoiceNo,undefined);
  assert.equal(h.list('calendarLinks')[0].payload.customerName,customer);assert.equal(pay.confirmation,'cash-received');assert.equal(pay.method,'現金');assert.equal(pay.amount,14000);assert.equal(h.list('cashLedger')[0].payload.amount,14000);
  assert.equal(A.receivables([sale],[pay],'2026-10-06')[0].outstanding,0);
 }
 const payment=JSON.stringify(h.list('payments')),cash=JSON.stringify(h.list('cashLedger'));
 for(const next of [title.replace('14000','15000'),title.replace('、現金','')]){
  await h.execute({type:'calendar',event:{...e,title:next}});assert.deepEqual(ids(),anchors);
  const sale=h.list('sales')[0].payload;assert.equal(sale.amount,14000);assert.equal(sale.customer,'現金客');assert(sale.accountingReviewRequired);assert.match(sale.reviewReason,/現金・金額/);assert(h.list('calendarLinks')[0].payload.accountingReviewRequired);
  assert.equal(A.receivables([sale],h.list('payments').map(r=>r.payload),'2026-10-06')[0].status,'要確認');assert.equal(JSON.stringify(h.list('payments')),payment);assert.equal(JSON.stringify(h.list('cashLedger')),cash);
 }
 assert.equal(h.list('documents').length,0);assert.equal(h.list('operations').filter(r=>r.id.startsWith('documentNumber_')).length,0);
});

test('formal receipt takes over unnamed cash anchors without duplicate accounting',async()=>{
 const h=await harness(),e={...event,title:'クロス張り替え、14000、文京区、km、現金'};
 await h.execute({type:'calendar',event:e});const link=h.list('calendarLinks')[0],saleId=h.list('sales')[0].id,payId=h.list('payments')[0].id;
 await h.execute({type:'saveDocument',expectedRevision:0,snapshot:{documentId:'unnamed-receipt',docType:'receipt',customerName:'山田様',invoiceDate:e.date,receiptTotal:14000,paymentMethod:'現金',tadashi:'クロス張り替え代',calendarEventId:link.id}});
 await h.execute({type:'calendar',event:e});
 assert.equal(h.list('sales').length,1);assert.equal(h.list('sales')[0].id,saleId);assert.equal(h.list('sales')[0].payload.customer,'山田様');assert.equal(h.list('sales')[0].payload.sourceType,'receipt-cash');assert.equal(h.list('payments').length,1);assert.equal(h.list('payments')[0].id,payId);assert.equal(h.list('cashLedger').length,1);assert.equal(h.list('cashLedger')[0].payload.amount,14000);
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
 // Fixture for a pre-existing cancelled payment; the obsolete UI cancellation command is removed.
 await h.client.transact('cancelled-fixture',{},async({read,write})=>{const p=await read('payments','p');await write('payments','p',{...p.payload,deletedAt:'2026-10-07',deleteReason:'取消'},'adjustment',p.revision);return {};});
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
 assert.equal(sync.getQueue().length,0);assert.equal(h.list('calendarLinks').length,2);assert.equal(h.list('calendarLinks').find(r=>r.payload.linkedEstimateId).payload.date,'2026-10-07');assert.equal(h.list('documents').find(d=>d.id==='recovery-inv').payload.status,'void');assert.equal(h.list('documents').length,2);assert.equal(failures.length,1);assert([...m.keys()].some(k=>k.includes('invalid_date_bad-date')));assert.equal(JSON.parse(m.get([...m.keys()].find(k=>k.includes('invalid_date_bad-date')))).command.workDate,'2026/10/7');
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

test('Onoda carryover is snapshot-only: no tax/revenue/receivable duplication, payments allocated manually',async()=>{
 const h=await harness(),snapshot={documentId:'onoda-carryover',docType:'onoda',customerName:'dynast合同会社',invoiceDate:'2026-10-31',salesDate:'2026-10-31',items:[{content:'施工',qty:10,price:1000},{content:'高速代',qty:1,price:2000,taxable:false}],carryoverMonth:'8月分',carryoverAmount:9000};
 const original=structuredClone(snapshot.items),base={...snapshot,carryoverAmount:0};
 assert.equal(B.total(base),13000);assert.equal(B.total(snapshot),13000);
 assert.deepEqual(B.onodaTotals(snapshot),{taxableSubtotal:10000,nonTaxSubtotal:2000,subtotal:12000,tax:1000,currentAmount:13000,carryoverAmount:9000,carryoverLabel:'8月分未入金残高',paymentTotal:22000});
 assert.equal(B.onodaTotals({...base,carryoverAmount:undefined}).carryoverAmount,0);
 for(const docType of ['invoice','estimate','receipt'])assert.equal(B.total({...snapshot,docType}),B.total({...base,docType}));
 await h.execute({type:'saveDocument',expectedRevision:0,snapshot});
 const doc=h.list('documents')[0].payload,sale=h.list('sales')[0].payload;
 assert.equal(doc.amount,13000);assert.equal(sale.amount,13000);assert.equal(h.list('sales').length,1);assert.equal(doc.snapshot.carryoverAmount,9000);assert.equal(doc.snapshot.carryoverMonth,'8月分');assert.deepEqual(doc.snapshot.items,original);
 const count=h.list('payments').length;
 await assert.rejects(h.execute({type:'payment',paymentId:'combined',saleId:sale.id,amount:22000,paymentDate:'2026-11-01',method:'銀行振込',manualConfirmed:true}),/分けて登録/);
 assert.equal(h.list('payments').length,count);
 await h.execute({type:'payment',paymentId:'current-only',saleId:sale.id,amount:13000,paymentDate:'2026-11-01',method:'銀行振込',manualConfirmed:true});
 assert.equal(h.list('payments')[0].payload.amount,13000);assert.equal(h.list('sales')[0].payload.amount,13000);
});
