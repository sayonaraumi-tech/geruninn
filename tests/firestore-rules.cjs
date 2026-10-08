const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,collection,setDoc,deleteDoc,updateDoc,runTransaction,serverTimestamp,onSnapshot}=require('firebase/firestore');
const {createClient,LOCAL_KEYS}=require('../js/cloud-core.js');
const {createService}=require('../js/business-domain.js');
const {createSync,migrateLegacy}=require('../js/business-sync.js');
let env;
const company='tsukinowa',ref=(db,name,id='one')=>doc(db,`companies/${company}/${name}/${id}`);
const db=(role,tenant=company)=>env.authenticatedContext('uid-'+role,{role,companyId:tenant}).firestore();
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});});
after(async()=>{await env?.cleanup();});beforeEach(async()=>env.clearFirestore());
function storage(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
async function clientFor(role){
 const store=db(role);let callback;
 const client=createClient({initialize:async()=>{},observeAuth:f=>{callback=f;return()=>{}},claims:async u=>u.claims,
  listen:(path,many,next,error)=>onSnapshot(many?collection(store,path):doc(store,path),{includeMetadataChanges:true},s=>next(many?s.docs.map(d=>({id:d.id,...d.data()})):s.exists()?{id:s.id,...s.data()}:null,{fromCache:s.metadata.fromCache}),error),
  list:async path=>(await getDocs(collection(store,path))).docs.map(d=>({id:d.id,...d.data()})),
  digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:serverTimestamp,
  transaction:fn=>runTransaction(store,tx=>fn({get:async p=>{const s=await tx.get(doc(store,p));return s.exists()?s.data():null},set:(p,v)=>tx.set(doc(store,p),v),delete:p=>tx.delete(doc(store,p))}))});
 await client.start({enabled:true,companyId:company,firebase:{apiKey:'x',authDomain:'x',projectId:'demo-tsukinowa',appId:'x'}});await callback({uid:'uid-'+role,claims:{role,companyId:company}});return client;
}
async function until(fn){const start=Date.now();while(!fn()){if(Date.now()-start>12000)throw Error('snapshot timeout');await new Promise(r=>setTimeout(r,30));}}
const snapshot=(id,type='invoice')=>({documentId:id,docType:type,customerName:'共有テスト',invoiceDate:'2026-09-20',salesDate:'2026-09-10',items:[{content:'施工',qty:1,price:90909.09}],travelFee:0,paymentMethod:'現金'});
const exec=(service,cmd)=>service.execute({operationId:crypto.randomUUID(),...cmd});
test('platform channel and optional detail persist under unchanged admin/staff payment rules',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);
 await exec(s,{type:'saveDocument',snapshot:snapshot('platform-rules'),expectedRevision:0});
 const cmd={type:'payment',paymentId:'platform-rules-pay',saleId:'sale_platform-rules',amount:1000,paymentDate:'2026-10-08',method:'プラットフォーム経由',platformName:'くらしのマーケット',manualConfirmed:true};
 await exec(a,cmd);await exec(a,cmd);const p=(await admin.listRecords('payments'))[0];assert.equal(p.payload.method,cmd.method);assert.equal(p.payload.platformName,cmd.platformName);assert.equal(p.payload.confirmation,'bank-confirmed');assert.equal((await admin.listRecords('cashLedger')).length,0);
 await assert.rejects(exec(s,{...cmd,paymentId:'staff-denied'}));assert.equal((await admin.listRecords('payments')).length,1);
});
test('unauthenticated, cross-company and out-of-scope staff reads denied',async()=>{
 await assertFails(getDoc(ref(env.unauthenticatedContext().firestore(),'documents')));await assertFails(getDoc(ref(db('admin','other'),'documents')));
 for(const n of ['documents','estimates','projects','sales','payments','calendarLinks'])await assertSucceeds(getDocs(collection(db('staff'),`companies/${company}/${n}`)));
 for(const n of ['expenses','suppliers','cashLedger','settings','migrations','auditLogs','supplierTransactions'])await assertFails(getDocs(collection(db('staff'),`companies/${company}/${n}`)));
});
test('unaudited writes and self-promotion denied',async()=>{await assertFails(setDoc(ref(db('admin'),'sales'),{payload:{amount:1}}));await assertFails(setDoc(doc(db('staff'),'users/uid-staff'),{role:'admin'}));});
test('two devices: estimate/acceptance, invoice/download idempotency, partial payments, Calendar protection, offline recovery',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);let online=true;
 const phone=createSync({client:staff,storage:storage(),online:()=>online}),desktop=createSync({client:admin,storage:storage()});phone.start();desktop.start();
 try{
  phone.enqueue({type:'saveDocument',snapshot:snapshot('estimate-1','estimate'),expectedRevision:0,operationId:'phone-estimate'});await phone.flush();await until(()=>desktop.getRows().estimates.length===1);
  assert.equal(desktop.getRows().sales.length,0);
  await exec(a,{type:'acceptEstimate',estimateId:'est_estimate-1',expectedRevision:1,workDate:'2026-10-01'});await until(()=>phone.getRows().estimates[0]?.payload.status==='受注');assert.equal((await getDocs(collection(db('admin'),`companies/${company}/projects`))).size,1);
  const inv=snapshot('invoice-1');await exec(s,{type:'saveDocument',snapshot:inv,expectedRevision:0});for(let i=0;i<3;i++)await exec(s,{type:'saveDocument',snapshot:inv,expectedRevision:1});
  assert.equal((await getDocs(collection(db('admin'),`companies/${company}/sales`))).size,1);
  for(const [id,amount] of [['p1',50000],['p2',20000]])await exec(s,{type:'payment',paymentId:id,saleId:'sale_invoice-1',amount,paymentDate:'2026-09-22',method:'現金'});
  const sale=(await getDoc(ref(db('admin'),'sales','sale_invoice-1'))).data().payload,pays=await getDocs(collection(db('admin'),`companies/${company}/payments`));assert.equal(sale.amount,100000);assert.equal(sale.amount-pays.docs.reduce((n,d)=>n+d.data().payload.amount,0),30000);assert.equal(sale.salesDate,'2026-09-10');assert.equal(sale.invoiceDate,'2026-09-20');
  await assertFails(deleteDoc(ref(db('staff'),'sales','sale_invoice-1')));
  const event={googleEventId:'google-1',googleCalendarId:'shared',title:'仮の予定',date:'2026-09-10'};const link=await exec(s,{type:'calendar',event});await exec(s,{type:'calendar',event});assert.equal((await getDocs(collection(db('admin'),`companies/${company}/calendarLinks`))).size,2);
  await exec(s,{type:'saveDocument',snapshot:{...snapshot('linked'),calendarEventId:link.id},expectedRevision:0});await exec(s,{type:'calendar',event:{...event,title:'変更 1円'}});assert.equal((await getDoc(ref(db('admin'),'documents','linked'))).data().payload.amount,100000);
  await assert.rejects(exec(a,{type:'saveDocument',snapshot:{...inv,customerName:'stale'},expectedRevision:0}),/別の端末/);
  online=false;phone.enqueue({type:'payment',paymentId:'offline',saleId:'sale_invoice-1',amount:1000,paymentDate:'2026-09-23',method:'現金',operationId:'offline-payment'});await phone.flush();assert.equal(phone.getQueue().length,1);online=true;await phone.flush();await until(()=>desktop.getRows().payments.some(r=>r.id==='offline'));assert.equal(phone.getQueue().length,0);
  const audits=await getDocs(collection(db('admin'),`companies/${company}/auditLogs`));assert(audits.docs.some(d=>d.data().action==='status change'&&d.data().before?.status==='見積済'&&d.data().after.status==='受注'));
  for(const d of audits.docs.slice(0,1)){await assertFails(deleteDoc(d.ref));await assertFails(updateDoc(d.ref,{action:'forged'}));}
 }finally{phone.stop();desktop.stop();admin.dispose();staff.dispose();}
});
test('migration twice preserves local originals and existing cloud records, marker prevents duplicates',async()=>{
 const client=await clientFor('admin'),local=storage(),legacy={audit:[{id:'old-audit',action:'旧操作',user:'local',at:'2026-08-10'}],sales:[{id:'old-sale',sourceId:'old-doc',customer:'旧顧客',amount:100000,saleDate:'2026-08-01',invoiceDate:'2026-08-10'}],payments:[{id:'old-pay',saleId:'old-sale',amount:50000,date:'2026-08-15',method:'現金'}]};
 local.setItem(LOCAL_KEYS.business,JSON.stringify(legacy));local.setItem(LOCAL_KEYS.documents,JSON.stringify([{...snapshot('unused'),documentId:undefined,historyId:'old-doc'}]));const raw=local.getItem(LOCAL_KEYS.business);
 const first=await migrateLegacy({client,storage:local}),second=await migrateLegacy({client,storage:local});assert(second.skipped);const audits=await getDocs(collection(db('admin'),`companies/${company}/auditLogs`));assert(audits.docs.some(d=>d.data().after?.legacy?.id==='old-audit'));assert.equal(local.getItem(LOCAL_KEYS.business),raw);assert(local.getItem(first.backupKey));assert.equal((await getDocs(collection(db('admin'),`companies/${company}/sales`))).size,1);
 const broken=storage();broken.setItem(LOCAL_KEYS.business,'{broken');await assert.rejects(migrateLegacy({client,storage:broken}));assert.equal(broken.getItem(LOCAL_KEYS.business),'{broken');client.dispose();
});
test('receipt only records payment; bank confirmation preserves invoice and cannot be forged by staff',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);await exec(a,{type:'saveDocument',snapshot:snapshot('inv'),expectedRevision:0});
 const receipt={...snapshot('receipt','receipt'),saleId:'sale_inv',receiptTotal:20000,paymentDate:'2026-09-21',paymentMethod:'銀行振込'};
 await exec(s,{type:'saveDocument',snapshot:receipt,expectedRevision:0});for(let i=0;i<3;i++)await exec(s,{type:'saveDocument',snapshot:receipt,expectedRevision:1});
 assert.equal((await getDocs(collection(db('admin'),`companies/${company}/payments`))).size,1);assert.equal((await getDoc(ref(db('admin'),'sales','sale_inv'))).data().payload.amount,100000);
 await assert.rejects(exec(s,{type:'confirmBank',bankId:'bank1',saleId:'sale_inv',amount:20000,paymentDate:'2026-09-22'}));
 await exec(a,{type:'confirmBank',bankId:'bank1',saleId:'sale_inv',amount:20000,paymentDate:'2026-09-22',pendingPaymentId:'pay_receipt'});await exec(a,{type:'confirmBank',bankId:'bank1',saleId:'sale_inv',amount:20000,paymentDate:'2026-09-22',pendingPaymentId:'pay_receipt'});
 const pays=await getDocs(collection(db('admin'),`companies/${company}/payments`));assert.equal(pays.docs.reduce((n,d)=>n+d.data().payload.amount,0),20000);assert.equal((await getDoc(ref(db('admin'),'payments','pay_receipt'))).data().payload.confirmation,'bank-confirmed');
 await assert.rejects(exec(s,{type:'saveDocument',snapshot:{...receipt,receiptTotal:30000},expectedRevision:1}));admin.dispose();staff.dispose();
});
const A=require('../js/accounting.js');
async function records(name){return (await getDocs(collection(db('admin'),`companies/${company}/${name}`))).docs.map(d=>({...d.data().payload,id:d.id,createdAt:d.data().createdAt,createdBy:d.data().createdBy,updatedAt:d.data().updatedAt,updatedBy:d.data().updatedBy}));}
test('cash collection and expense are atomic, idempotent and auditable; soft deletion recomputes cash',async()=>{
 const staff=await clientFor('staff'),admin=await clientFor('admin'),s=createService(staff),a=createService(admin);await exec(a,{type:'saveDocument',snapshot:snapshot('cash-invoice'),expectedRevision:0});
 const c={type:'payment',operationId:'cash-once',paymentId:'cash-payment',saleId:'sale_cash-invoice',amount:20000,paymentDate:'2026-10-02',method:'現金'};await s.execute(c);await s.execute(c);assert.equal((await records('payments')).length,1);assert.equal((await records('cashLedger')).length,1);assert.equal(A.receivables(await records('sales'),await records('payments'),'2026-10-31')[0].outstanding,80000);
 await exec(a,{type:'saveExpense',expenseId:'e1',expense:{expenseDate:'2026-10-03',category:'交通費',amount:3000,paymentMethod:'現金',vendor:'現場',description:'交通'},expectedRevision:0});let cash=A.cashRows(await records('cashLedger'));assert.equal(cash.at(-1).runningBalance,17000);assert(cash.every(c=>c.createdAt&&c.createdBy));
 await exec(a,{type:'saveExpense',expenseId:'e1',expense:{expenseDate:'2026-10-03',category:'交通費',amount:4000,paymentMethod:'現金'},expectedRevision:1});assert.equal(A.cashRows(await records('cashLedger')).at(-1).runningBalance,16000);
 await exec(a,{type:'deleteExpense',expenseId:'e1',expectedRevision:2,reason:'取消テスト'});assert((await records('expenses'))[0].deletedAt);assert.equal(A.cashRows(await records('cashLedger')).at(-1).runningBalance,20000);
 await assertFails(deleteDoc(ref(db('staff'),'cashLedger','cash_cash-payment')));await assertFails(getDocs(collection(db('staff'),`companies/${company}/cashLedger`)));
 await assert.rejects(exec(s,{type:'saveExpense',expenseId:'forbidden',expense:{},expectedRevision:0}),/管理者/);
 const audits=await getDocs(collection(db('admin'),`companies/${company}/auditLogs`));for(const action of ['cash transaction','expense create','expense update','expense delete'])assert(audits.docs.some(d=>d.data().action===action));admin.dispose();staff.dispose();
});
test('bank CSV twice, bank 50,000 + cash 20,000 leaves 30,000; pending payment is confirmed once and can be reversed',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);await exec(a,{type:'saveDocument',snapshot:snapshot('bank-invoice'),expectedRevision:0});
 const csv='日付,摘要,入金,出金,取引ID\r\n2026/10/05,"共有テスト, 振込","50,000",,txn-one\r\n',parsed=await A.parseBank(csv,'GMO',admin.digest);for(let n=0;n<2;n++)for(const bank of parsed)await exec(a,{type:'importBank',bank});assert.equal((await records('bankTransactions')).length,1);
 await exec(a,{type:'payment',paymentId:'pending50',saleId:'sale_bank-invoice',amount:50000,paymentDate:'2026-10-04',method:'銀行振込'});
 const b=parsed[0];assert(A.suggestions(b,{sales:await records('sales'),payments:await records('payments')}).some(x=>x.paymentId==='pending50'));
 const match={type:'bankMatch',bankTxnId:b.bankTxnId,targetType:'sale',targetId:'sale_bank-invoice',paymentId:'pending50',expectedRevision:1};await exec(a,match);await exec(a,match);assert.equal((await records('payments')).length,1);assert.equal((await records('payments'))[0].paymentDate,'2026-10-05');
 await exec(s,{type:'payment',paymentId:'cash20',saleId:'sale_bank-invoice',amount:20000,paymentDate:'2026-10-07',method:'現金'});assert.equal(A.receivables(await records('sales'),await records('payments'),'2026-10-31')[0].outstanding,30000);
 const m=A.monthly({sales:await records('sales'),payments:await records('payments'),cashLedger:await records('cashLedger')},'2026-10');assert.equal(m.bankIncome,50000);assert.equal(m.cashIncome,20000);assert.equal(m.receivables,30000);assert.equal(m.sales,0);assert.equal(A.monthly({sales:await records('sales'),payments:await records('payments')},'2026-09').sales,100000);
 await assert.rejects(exec(s,{...match}),/管理者/);await assertFails(getDocs(collection(db('staff'),`companies/${company}/bankTransactions`)));
 await exec(a,{type:'bankUnmatch',bankTxnId:b.bankTxnId,reason:'確認し直し',expectedRevision:2});assert.equal((await records('payments')).find(p=>p.id==='pending50').confirmation,'pending-bank');assert.equal(A.receivables(await records('sales'),await records('payments'),'2026-10-31')[0].outstanding,80000);
 await exec(a,{...match,expectedRevision:3});assert.equal((await records('payments')).length,2);admin.dispose();staff.dispose();
});
test('supplier prepayments 1m + 1m minus 1,438,620; material expense once, category/month summaries and staff restrictions',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);await exec(a,{type:'saveSupplier',supplierId:'supplier1',supplier:{supplierName:'材料商',openingDate:'2026-10-01',openingBalance:0},expectedRevision:0});
 for(const [id,date,type,amount] of [['pre1','2026-10-05','prepayment',1000000],['pre2','2026-10-20','prepayment',1000000],['bill','2026-10-31','monthlyInvoice',1438620]])await exec(a,{type:'supplierTransaction',transactionId:id,transaction:{supplierId:'supplier1',date,type,amount,description:'月結材料',invoiceMonth:'2026-10',paymentMethod:'銀行振込'},expectedRevision:0});
 let suppliers=await records('suppliers'),ts=await records('supplierTransactions');assert.equal(suppliers[0].currentBalance,561380);assert.equal(A.supplierBalance(suppliers[0],ts),561380);assert.equal((await records('expenses')).length,1);
 await exec(a,{type:'saveExpense',expenseId:'rent',expense:{expenseDate:'2026-10-01',category:'家賃',amount:100000,paymentMethod:'銀行振込'},expectedRevision:0});await exec(a,{type:'saveExpense',expenseId:'nextmonth',expense:{expenseDate:'2026-11-01',category:'通信費',amount:5000,paymentMethod:'銀行振込'},expectedRevision:0});
 const m=A.monthly({suppliers,supplierTransactions:ts,expenses:await records('expenses')},'2026-10');assert.equal(m.supplierPrepayment,2000000);assert.equal(m.supplierInvoice,1438620);assert.equal(m.categories['材料費'],1438620);assert.equal(m.categories['家賃'],100000);assert.equal(m.categories['通信費'],0);assert.equal(m.expenseTotal,1538620);assert.equal(m.cashFlowDifference,-1538620);
 await assert.rejects(exec(s,{type:'saveSupplier',supplierId:'supplier1',supplier:{supplierName:'改ざん',openingDate:'2026-10-01',openingBalance:999},expectedRevision:4}),/管理者/);await assertFails(getDocs(collection(db('staff'),`companies/${company}/suppliers`)));
 await exec(a,{type:'deleteSupplierTransaction',transactionId:ts.find(t=>t.type==='monthlyInvoice').id,expectedRevision:1,reason:'訂正'});suppliers=await records('suppliers');assert.equal(suppliers[0].currentBalance,2000000);assert.equal((await records('expenses')).filter(A.live).length,2);admin.dispose();staff.dispose();
});
test('CSV validation, duplicate equal rows, same account identity and Excel export BOM',async()=>{
 const digest=async s=>crypto.createHash('sha256').update(s).digest('hex'),text='日付,摘要,入金,出金\n2026/10/01,"A\nB",1000,\n2026/10/01,"A\nB",1000,\n';const first=await A.parseBank(text,'銀行',digest),second=await A.parseBank(text,'銀行',digest);assert.equal(first.length,2);assert.notEqual(first[0].bankTxnId,first[1].bankTxnId);assert.deepEqual(first,second);await assert.rejects(A.parseBank('日付,摘要,入金,出金\n2026/02/30,X,1,','銀行',digest));await assert.rejects(A.parseBank('日付,摘要,入金,出金\n2026/10/01,X,no,','銀行',digest));const out=A.csv([['日本語','=1+1','1,000']]);assert.equal(Buffer.from(out).subarray(0,3).toString('hex'),'efbbbf');assert(out.includes("'=1+1"));assert(A.csv([[-10]]).includes('"-10"'));assert(!A.csv([[-10]]).includes("'-10"));
});

test('security rules deny forged audited staff bank/supplier writes and cash rows without matching payment',async()=>{
 const staff=await clientFor('staff');
 for(const name of ['bankTransactions','suppliers','supplierTransactions','expenses'])await assert.rejects(staff.transact('forged-'+name,{name},async({write})=>{await write(name,'forged',{amount:1},'create',0);return {id:'forged'};}));
 await assert.rejects(staff.transact('forged-cash',{name:'cashLedger'},async({write})=>{await write('cashLedger','cash_unknown',{cashTxnId:'cash_unknown',linkedPaymentId:'unknown',linkedExpenseId:'',linkedSupplierTransactionId:'',amount:999,date:'2026-10-01',type:'income',deletedAt:null},'cash transaction',0);return {id:'cash_unknown'};}));
 for(const n of ['bankTransactions','suppliers','cashLedger'])assert.equal((await records(n)).length,0);staff.dispose();
});

test('formal revisions transfer a stable sale, preserve paid amounts and immutable snapshots; two devices see status',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),phone=createSync({client:staff,storage:storage()});phone.start();
 try{
 const inv=snapshot('person');await exec(a,{type:'saveDocument',snapshot:inv,expectedRevision:0});const original=(await records('documents')).find(x=>x.documentId==='person').snapshot;
 await exec(a,{type:'payment',paymentId:'partial',saleId:'sale_person',amount:20000,paymentDate:'2026-09-22',method:'現金'});
 await assert.rejects(exec(a,{type:'documentStatus',documentId:'person',status:'void',reason:'mistake',expectedRevision:1}),/確認済み入金/);
 await exec(a,{type:'saveDocument',snapshot:{...inv,documentId:'company',customerName:'法人担当',customerCompany:'会社',customerAddress:'東京'},expectedRevision:0,revisedFromDocumentId:'person',expectedParentRevision:1,reason:'法人名義に訂正'});
 const docs=await records('documents'),sales=await records('sales'),ps=await records('payments');
 assert.equal(docs.find(x=>x.id==='person').status,'revised');assert.deepEqual(docs.find(x=>x.id==='person').snapshot,original);assert.equal(docs.find(x=>x.id==='company').status,'active');assert.equal(sales.length,1);assert.equal(sales[0].id,'sale_person');assert.equal(sales[0].documentId,'company');assert.equal(ps[0].saleId,'sale_person');assert.equal(A.receivables(sales,ps,'2026-09-30')[0].outstanding,80000);assert.equal(A.monthly({sales,payments:ps},'2026-09').sales,100000);
 await until(()=>phone.getRows().documents.some(r=>r.id==='person'&&r.payload.status==='revised'));
 await assert.rejects(exec(a,{type:'saveDocument',snapshot:{...inv,customerName:'overwrite'},expectedRevision:2}),/上書き/);
 const current=docs.find(x=>x.id==='company').snapshot;
 await exec(a,{type:'saveDocument',snapshot:{...current,documentId:'amount',items:[{content:'施工',qty:1,price:100000}]},expectedRevision:0,revisedFromDocumentId:'company',expectedParentRevision:1,reason:'金額訂正'});
 assert.equal((await records('sales')).length,1);assert.equal((await records('sales'))[0].amount,110000);
 await assert.rejects(exec(a,{type:'saveDocument',snapshot:{...current,documentId:'too-low',items:[]},expectedRevision:0,revisedFromDocumentId:'amount',expectedParentRevision:1,reason:'減額'}),/下回/);
 const logs=await getDocs(collection(db('admin'),'companies/tsukinowa/auditLogs'));const log=logs.docs.map(x=>x.data()).find(x=>x.documentId==='person'&&x.newStatus==='revised');assert.equal(log.oldStatus,'active');assert.equal(log.reason,'法人名義に訂正');assert(log.before.snapshot&&log.after.snapshot);
 }finally{phone.stop();admin.dispose();staff.dispose();}
});
test('duplicates/voids excluded from monthly, receivables, bank matching; reasons, targets and payments guarded',async()=>{
 const admin=await clientFor('admin'),a=createService(admin);
 try{
 for(const id of ['first','duplicate','void','cancel'])await exec(a,{type:'saveDocument',snapshot:snapshot(id),expectedRevision:0});
 await assert.rejects(exec(a,{type:'documentStatus',documentId:'void',status:'void',reason:'',expectedRevision:1}),/理由/);
 await assert.rejects(exec(a,{type:'documentStatus',documentId:'duplicate',status:'duplicate',reason:'重複',duplicateOfDocumentId:'duplicate',expectedRevision:1}),/有効/);
 for(const [id,status] of [['duplicate','duplicate'],['void','void'],['cancel','cancelled']])await exec(a,{type:'documentStatus',documentId:id,status,reason:'誤発行',duplicateOfDocumentId:'first',expectedRevision:1});
 const sales=await records('sales');assert.equal(A.monthly({sales},'2026-09').sales,100000);assert.equal(A.receivables(sales,[],'2026-09-30').length,1);
 const b={bankTxnId:'life-bank',bankTransactionDate:'2026-09-20',incoming:100000,outgoing:0,amount:100000,description:'共有テスト',bankAccount:'銀行'};
 assert.deepEqual([...new Set(A.suggestions(b,{sales,payments:[]}).map(x=>x.id))],['sale_first']);
 await exec(a,{type:'importBank',bank:b});await assert.rejects(exec(a,{type:'bankMatch',bankTxnId:b.bankTxnId,targetType:'sale',targetId:'sale_duplicate'}),/請求書/);
 await assert.rejects(exec(a,{type:'payment',saleId:'sale_void',paymentId:'no',amount:1,paymentDate:'2026-09-20',method:'現金'}),/有効/);
 assert.equal((await records('documents')).length,4);
 }finally{admin.dispose();}
});
test('staff cannot manage formal documents, forge lifecycle or overwrite snapshots; admin cannot physically delete',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);
 try{
 await exec(a,{type:'saveDocument',snapshot:snapshot('protected'),expectedRevision:0});
 for(const status of ['void','duplicate','cancelled'])await assert.rejects(exec(s,{type:'documentStatus',documentId:'protected',status,reason:'no',duplicateOfDocumentId:'other',expectedRevision:1}),/管理者/);
 await assert.rejects(exec(s,{type:'saveDocument',snapshot:snapshot('forged'),expectedRevision:0,revisedFromDocumentId:'protected',expectedParentRevision:1,reason:'no'}),/管理者/);
 const original=(await getDoc(ref(db('admin'),'documents','protected'))).data().payload;
 for(const payload of [{...original,status:'void',reason:'forged'},{...original,snapshot:{...original.snapshot,customerName:'changed'}}])await assertFails(staff.transact(crypto.randomUUID(),{payload},async({write})=>{await write('documents','protected',payload,'status change');return {};}));
 await assertFails(deleteDoc(ref(db('admin'),'documents','protected')));
 }finally{admin.dispose();staff.dispose();}
});
test('receipt and estimate revisions retain payment/project identities and Onoda tax snapshots',async()=>{
 const admin=await clientFor('admin'),a=createService(admin);
 try{
 await exec(a,{type:'saveDocument',snapshot:snapshot('invoice'),expectedRevision:0});
 const receipt={...snapshot('receipt-old','receipt'),saleId:'sale_invoice',receiptTotal:20000,paymentDate:'2026-09-21',paymentMethod:'現金'};
 await exec(a,{type:'saveDocument',snapshot:receipt,expectedRevision:0});
 await exec(a,{type:'saveDocument',snapshot:{...receipt,documentId:'receipt-new',customerName:'会社'},expectedRevision:0,revisedFromDocumentId:'receipt-old',expectedParentRevision:1,reason:'宛名'});
 assert.equal((await records('payments')).length,1);assert.equal((await records('payments'))[0].id,'pay_receipt-old');assert.equal((await records('cashLedger')).length,1);
 await assert.rejects(exec(a,{type:'documentStatus',documentId:'receipt-new',status:'void',reason:'no',expectedRevision:1}),/確認済み/);
 const e=snapshot('est-old','estimate');await exec(a,{type:'saveDocument',snapshot:e,expectedRevision:0});await exec(a,{type:'acceptEstimate',estimateId:'est_est-old',expectedRevision:1});
 await exec(a,{type:'saveDocument',snapshot:{...e,documentId:'est-new',customerName:'会社'},expectedRevision:0,revisedFromDocumentId:'est-old',expectedParentRevision:1,reason:'宛名'});
 assert.equal((await records('estimates')).length,1);assert.equal((await records('projects')).length,1);
 const o={...snapshot('onoda-old','onoda'),items:[{content:'課税',qty:1,price:100000,taxable:true},{content:'非課税',qty:1,price:5000,taxable:false}]};await exec(a,{type:'saveDocument',snapshot:o,expectedRevision:0});await exec(a,{type:'saveDocument',snapshot:{...o,documentId:'onoda-new',remarks:'訂正'},expectedRevision:0,revisedFromDocumentId:'onoda-old',expectedParentRevision:1,reason:'備考'});
 assert.equal((await records('sales')).find(x=>x.id==='sale_onoda-old').amount,115000);
 }finally{admin.dispose();}
});
test('concurrent payment and void cannot both commit; repeated revision downloads remain read-only',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);
 try{
 await exec(a,{type:'saveDocument',snapshot:snapshot('race'),expectedRevision:0});
 const result=await Promise.allSettled([exec(a,{type:'documentStatus',documentId:'race',status:'void',reason:'race',expectedRevision:1}),exec(s,{type:'payment',saleId:'sale_race',paymentId:'race-pay',amount:1000,paymentDate:'2026-09-20',method:'現金'})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 await exec(a,{type:'saveDocument',snapshot:snapshot('e1','estimate'),expectedRevision:0});
 await exec(a,{type:'saveDocument',snapshot:snapshot('e2','estimate'),expectedRevision:0,revisedFromDocumentId:'e1',expectedParentRevision:1,reason:'訂正'});
 const revised=(await records('documents')).find(d=>d.id==='e2').snapshot;
 for(let i=0;i<3;i++)assert((await exec(a,{type:'saveDocument',snapshot:revised,expectedRevision:1})).unchanged);
 assert.equal((await records('estimates')).length,1);
 }finally{admin.dispose();staff.dispose();}
});

// Exact-ID, audited cleanup against the deployed document/payment guards.
test('test cleanup is atomic audited and preserves formal records and Onoda',async()=>{
 const a=await clientFor('admin'),service=createService(a),C=require('../js/test-data-cleanup.js');
 await env.withSecurityRulesDisabled(async context=>{const store=context.firestore(),seed=(n,id,payload)=>setDoc(ref(store,n,id),{schemaVersion:2,companyId:company,revision:1,createdBy:'uid-admin',updatedBy:'uid-admin',createdAt:new Date(),updatedAt:new Date(),payload});
 await seed('documents',C.SEEDS[0],{...snapshot(C.SEEDS[0],'estimate'),snapshot:{...snapshot(C.SEEDS[0],'estimate'),customerName:'Test'},customerName:'Test',amount:0,confirmed:true,estimateId:'estimate'});
 await seed('estimates','estimate',{customer:'Test',documentId:C.SEEDS[0]});
 await seed('documents',C.SEEDS[1],{...snapshot(C.SEEDS[1]),snapshot:{...snapshot(C.SEEDS[1]),customerName:'test'},customerName:'test',amount:0,confirmed:true});
 await seed('sales','sale',{customer:'test',documentId:C.SEEDS[1],amount:0});
 await seed('documents','receipt',{documentId:'receipt',docType:'receipt',snapshot:{...snapshot('receipt','receipt'),remarks:'test',saleId:'sale'},customerName:'Customer',amount:89540,confirmed:true});
 await seed('payments','pay',{paymentId:'pay',documentId:'receipt',saleId:'sale',amount:89540,confirmation:'pending-bank',deletedAt:'2026-09-29',deleteReason:'test'});
 await seed('calendarLinks','event',{documentId:'receipt',customerName:'test',officialAmount:0,title:'test｜換壁紙 / 巣鴨｜0｜領収済'});
 });
 await exec(service,{type:'saveDocument',snapshot:snapshot('formal'),expectedRevision:0});
 await exec(service,{type:'saveDocument',snapshot:snapshot('formal-onoda','onoda'),expectedRevision:0});
 const before=(await getDoc(ref(db('admin'),'documents','formal'))).data();
 const result=await exec(service,{type:'cleanTestData',deletedAt:'2026-09-30T07:00:00.000Z'});assert.equal(result.cleaned.length,7);
 for(const id of [...C.SEEDS,'receipt']){const p=(await getDoc(ref(db('admin'),'documents',id))).data().payload;assert.equal(p.status,'void');assert.equal(p.reason,C.REASON);}
 assert.deepEqual((await getDoc(ref(db('admin'),'documents','formal'))).data(),before);
 assert.equal((await getDoc(ref(db('admin'),'documents','formal-onoda'))).data().payload.status,'active');
 const audit=await getDocs(collection(db('admin'),`companies/${company}/auditLogs`));assert.equal(audit.docs.filter(d=>d.data().after?.reason===C.REASON||d.data().after?.deleteReason===C.REASON).length,7);
 assert.equal((await exec(service,{type:'cleanTestData',deletedAt:'2026-09-30T07:01:00.000Z'})).cleaned.length,0);
 await assert.rejects(exec(createService(await clientFor('staff')),{type:'cleanTestData',deletedAt:'2026-09-30T07:01:00.000Z'}));
});

test('Japan minute numbering is global, atomic across devices and immutable on retries/revisions',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff');
 let time=new Date('2026-10-02T03:59:59Z');const now=()=>time,a=createService(admin,{now}),b=createService(staff,{now});
 const first=await exec(a,{type:'saveDocument',snapshot:{...snapshot('number-a','estimate'),invoiceNo:'draft-number'},expectedRevision:0});
 assert.equal(first.invoiceNo,'20261002-1259-01');
 time=new Date('2026-10-02T04:06:00Z');
 const results=await Promise.all([exec(a,{type:'saveDocument',snapshot:snapshot('number-b'),expectedRevision:0}),exec(b,{type:'saveDocument',snapshot:snapshot('number-c','onoda'),expectedRevision:0})]);
 assert.deepEqual(results.map(r=>r.invoiceNo).sort(),['20261002-1306-01','20261002-1306-02']);
 const original=(await records('documents')).find(d=>d.documentId==='number-b').snapshot;
 time=new Date('2026-10-03T15:01:00Z');
 for(let i=0;i<3;i++){const replay=await exec(b,{type:'saveDocument',snapshot:original,expectedRevision:1});assert.equal(replay.invoiceNo,original.invoiceNo);assert(replay.unchanged);}
 const revised=await exec(a,{type:'saveDocument',snapshot:{...original,documentId:'number-revised'},expectedRevision:0,revisedFromDocumentId:'number-b',expectedParentRevision:1,reason:'訂正'});
 assert.equal(revised.invoiceNo,'20261004-0001-01');
 const docs=await records('documents');assert.deepEqual(docs.find(d=>d.documentId==='number-b').snapshot,original);assert.equal(docs.find(d=>d.documentId==='number-revised').revisedFromDocumentId,'number-b');
 // Failed formal save consumes no sequence; a later valid receipt uses the first number.
 time=new Date('2026-10-04T15:02:00Z');
 await assert.rejects(exec(a,{type:'saveDocument',snapshot:snapshot('bad-receipt','receipt'),expectedRevision:0}));
 const receipt=await exec(b,{type:'saveDocument',snapshot:{...snapshot('good-receipt','receipt'),saleId:'sale_number-b',receiptTotal:100,paymentDate:'2026-10-05'},expectedRevision:0});
 assert.equal(receipt.invoiceNo,'20261005-0002-01');
 await assertFails(deleteDoc(ref(db('admin'),'operations','documentNumber_20261002-1306-01')));
 await assertFails(updateDoc(ref(db('admin'),'operations','documentNumber_20261002-1306-01'),{'result.invoiceNo':'reused'}));
});

test('outstanding balance: staff partial/final payments, idempotency, immutable old invoice, notice never posts sales/tax',async()=>{
 const O=require('../js/outstanding.js'),a=createService(await clientFor('admin')),s=createService(await clientFor('staff'));
 const form={...snapshot('dynast'),customerName:'dynast合同会社',invoiceDate:'2026-08-01',salesDate:'2026-07-31',remarks:'2026年7月分請求書',items:[{qty:1,price:708526.36,content:'7月工事'}]};
 await exec(a,{type:'saveDocument',snapshot:form,expectedRevision:0});
 const original=(await getDoc(ref(db('admin'),'documents','dynast'))).data(),saleBefore=(await getDoc(ref(db('admin'),'sales','sale_dynast'))).data().payload;
 const cmd={type:'payment',operationId:'partial-dynast',paymentId:'dynast-partial',saleId:'sale_dynast',documentId:'dynast',amount:770379,paymentDate:'2026-08-25',method:'銀行振込'};
 await s.execute(cmd);await s.execute(cmd);await exec(a,{type:'confirmBank',bankId:'dynast-bank',saleId:cmd.saleId,pendingPaymentId:cmd.paymentId,amount:cmd.amount,paymentDate:cmd.paymentDate});
 const records=async name=>(await getDocs(collection(db('admin'),`companies/${company}/${name}`))).docs.map(r=>({...r.data().payload,id:r.id}));
 const v=O.view(original,saleBefore,await records('payments'));assert.deepEqual([v.invoiceAmount,v.paidAmount,v.outstandingAmount,v.paymentStatus],[779379,770379,9000,'一部入金']);
 const state=JSON.stringify([await records('sales'),await records('payments'),await records('documents')]);for(let i=0;i<3;i++)O.notice(v,'2026-10-02');assert.equal(JSON.stringify([await records('sales'),await records('payments'),await records('documents')]),state);
 for(const bad of [{amount:1.5},{amount:Infinity},{paymentDate:'2026-02-31'},{method:'invalid'},{documentId:'different'}])await assert.rejects(exec(s,{...cmd,...bad,operationId:crypto.randomUUID(),paymentId:crypto.randomUUID()}));
 await exec(s,{...cmd,operationId:crypto.randomUUID(),paymentId:'dynast-final',amount:9000,method:'現金',paymentDate:'2026-10-02'});
 const final=O.view(original,saleBefore,await records('payments'));assert.deepEqual([final.paidAmount,final.outstandingAmount,final.paymentStatus],[779379,0,'入金済']);
 assert.equal((await records('sales')).length,1);assert.equal((await records('payments')).filter(p=>p.confirmation!=='bank-marker').length,2);assert.equal((await records('cashLedger')).length,1);
 assert.deepEqual((await getDoc(ref(db('admin'),'documents','dynast'))).data(),original);
 await exec(s,{type:'payment',paymentId:'existing-online-method',saleId:'sale_dynast',amount:1,paymentDate:'2026-10-03',method:'オンライン決済'});
 const after=(await getDoc(ref(db('admin'),'sales','sale_dynast'))).data().payload;for(const k of Object.keys(saleBefore))if(!['paymentIds','paymentVersion'].includes(k))assert.deepEqual(after[k],saleBefore[k]);
});

test('historical import: admin only, atomic original number/hash locks, non-sale receivable, staff payment and bank match',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),a=createService(admin),s=createService(staff);
 const draft={customerName:'dynast合同会社',invoiceNo:'20260801-001',issueDate:'2026-08-01',dueDate:'2026-09-01',invoiceAmount:779379,billingMonth:'2026-07',remarks:'2026年7月分',items:[]};
 const cmd={type:'historicalPdfImport',documentId:'historical-one',sourceHash:'a'.repeat(64),sourceFileName:'old.pdf',draft,createSale:false,linkedSaleId:''};
 await assert.rejects(exec(s,cmd),/管理者/);
 const raced=await Promise.allSettled([exec(a,cmd),exec(a,{...cmd,documentId:'historical-two'})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
 const result=raced.find(r=>r.status==='fulfilled').value,id=result.documentId,anchor=result.receivableId;
 assert.equal((await getDocs(collection(db('admin'),`companies/${company}/sales`))).size,0);
 const docBefore=(await getDoc(ref(db('admin'),'documents',id))).data();assert.equal(docBefore.payload.snapshot.invoiceNo,'20260801-001');assert.equal(docBefore.payload.amount,779379);assert.equal(docBefore.payload.issueDate,'2026-08-01');
 await assertSucceeds(getDocs(collection(db('staff'),`companies/${company}/receivables`)));
 // Bypass the service to verify Security Rules reject a forged staff import with a valid audit envelope.
 await assert.rejects(staff.transact('forged-old',{},async({write})=>write('documents','forged-old',{...docBefore.payload,documentId:'forged-old',snapshot:{...docBefore.payload.snapshot,documentId:'forged-old'}},'create',0)),/permission|PERMISSION/i);
 await exec(s,{type:'payment',paymentId:'historical-partial',documentId:id,saleId:anchor,amount:770379,paymentDate:'2026-08-25',method:'銀行振込'});
 const O=require('../js/outstanding'),pays=(await getDocs(collection(db('admin'),`companies/${company}/payments`))).docs.map(d=>({id:d.id,...d.data()}));const v=O.view(docBefore,null,pays);assert.equal(v.outstandingAmount,779379);assert.equal(v.paymentStatus,'未入金');
 await exec(a,{type:'importBank',bank:{bankTxnId:'bank-old',bankAccount:'test',bankTransactionDate:'2026-08-25',incoming:770379,outgoing:0,amount:770379,description:'dynast'}});
 await exec(a,{type:'bankMatch',bankTxnId:'bank-old',targetType:'sale',targetId:anchor,paymentId:'historical-partial',expectedRevision:1});
 assert.equal((await getDoc(ref(db('admin'),'payments','historical-partial'))).data().payload.confirmation,'bank-confirmed');const confirmedPays=(await getDocs(collection(db('admin'),`companies/${company}/payments`))).docs.map(d=>({id:d.id,...d.data()}));assert.equal(O.view(docBefore,null,confirmedPays).outstandingAmount,9000);
 assert.deepEqual((await getDoc(ref(db('admin'),'documents',id))).data(),docBefore);
 await assert.rejects(exec(a,{...cmd,documentId:'again',draft:{...draft,invoiceNo:'changed',invoiceAmount:1}}),/重複/);
 const audit=(await getDocs(collection(db('admin'),`companies/${company}/auditLogs`))).docs.map(d=>d.data()).find(r=>r.action==='historicalPdfImport');assert.equal(audit.whetherCreatedSale,false);assert.equal(audit.sourceHash,cmd.sourceHash);
 admin.dispose();staff.dispose();
});

test('staff Google cash synchronization atomically updates one sale/payment/cash mirror, locks formal data and flags cancellations',async()=>{
 const staff=await clientFor('staff'),service=createService(staff);const event={googleEventId:'cashgoogle',googleCalendarId:'shared',date:'2026-10-05',title:'下村 健朗、クロス張替、足立区、11万、現金、km'};
 const link=await exec(service,{type:'calendar',event});await exec(service,{type:'calendar',event});
 const all=async n=>(await getDocs(collection(db('admin'),`companies/${company}/${n}`))).docs.map(d=>({id:d.id,...d.data()}));
 assert.equal((await all('sales')).length,1);assert.equal((await all('payments')).length,1);assert.equal((await all('cashLedger')).length,1);
 await exec(service,{type:'calendar',event:{...event,date:'2026-10-06',title:'別 顧客、穴補修、足立区、12万、現金'}});assert.equal((await all('sales'))[0].payload.amount,120000);assert.equal((await all('payments'))[0].payload.amount,120000);assert.equal((await all('cashLedger'))[0].payload.amount,120000);
 // Staff can lock the same stable accounting anchor with a formal invoice.
 await exec(service,{type:'saveDocument',expectedRevision:0,snapshot:{...snapshot('cashformal'),calendarEventId:link.id}});
 await exec(service,{type:'calendar',event:{...event,title:'変更、クロス張替、99万、現金'}});assert.equal((await all('sales')).length,1);assert.equal((await all('sales'))[0].payload.amount,100000);
 await exec(service,{type:'calendar',event:{...event,googleStatus:'cancelled'}});assert((await all('sales'))[0].payload.accountingReviewRequired);
});

test('production gate: legacy slash construction date, undated acceptance, two-way timed location sync and unique calendar',async()=>{
 const c=await clientFor('admin'),s=createService(c);const originalExecute=s.execute;s.execute=async cmd=>{try{return await originalExecute(cmd);}catch(e){console.error('GATE STEP FAILED',cmd.type,cmd.workDate||cmd.event?.date||'');throw e;}};try{
 const snap={...snapshot('gate-est','estimate'),customerName:'琢居株式会社',salesDate:'',workDate:'',items:[{content:'クロス張替',qty:1,price:100000},{content:'穴補修',qty:1,price:2000},{content:'部分的補修',qty:1,price:100},{content:'出張費',qty:1,price:60}]};
 await exec(s,{type:'saveDocument',snapshot:snap,expectedRevision:0});assert.equal((await records('calendarLinks')).length,0);
 await exec(s,{type:'acceptEstimate',estimateId:'est_gate-est'});assert.equal((await records('projects'))[0].status,'受注・日程未定');assert.equal((await records('calendarLinks')).length,0);
 // Reproduce screenshot legacy project date that was validated but then passed raw to schedule().
 const project=await c.listRecords('projects');await env.withSecurityRulesDisabled(async ctx=>updateDoc(ref(ctx.firestore(),'projects',project[0].id),{'payload.workDate':'2026/10/7'}));
 await exec(s,{type:'acceptEstimate',estimateId:'est_gate-est'});let link=(await c.listRecords('calendarLinks'))[0];assert.equal(link.payload.workDate,'2026-10-07');assert.equal((await records('projects'))[0].workDate,'2026-10-07');
 await exec(s,{type:'calendarPrepareCreate',id:link.id,calendarId:'shared'});await exec(s,{type:'calendarCreated',id:link.id,calendarId:'shared',googleEventId:link.payload.googleEventId});link=(await c.listRecords('calendarLinks'))[0];await exec(s,{type:'calendarPatched',id:link.id,expectedRevision:link.revision,at:'2026-10-06T01:00:00Z'});
 await exec(s,{type:'calendar',event:{googleEventId:link.payload.googleEventId,googleCalendarId:'shared',date:'2026-10-09',start:'2026-10-09T09:00:00+09:00',end:'2026-10-09T12:00:00+09:00',location:'東京都現場',title:'偽顧客、99万、現金'}});
 for(const n of ['projects','estimates']){const r=(await records(n))[0];assert.equal(r.workDate,'2026-10-09');assert.equal(r.workStart,'2026-10-09T00:00:00.000Z');assert.equal(r.location,'東京都現場');assert.equal(r.customer,'琢居株式会社');}
 assert.equal((await records('sales')).length,0);assert.equal((await records('calendarLinks')).length,1);
 await Promise.all([exec(s,{type:'acceptEstimate',estimateId:'est_gate-est',workDate:'2026/10/10'}),exec(s,{type:'acceptEstimate',estimateId:'est_gate-est',workDate:'2026/10/10'})]);assert.equal((await records('calendarLinks')).length,1);assert.equal((await records('calendarLinks'))[0].googleCreatePending,false);
 }finally{c.dispose();}
});
test('production gate: staff independent cash receipt110000, linked receipt only payment, bank receipt no sale, read-only retries',async()=>{
 const c=await clientFor('staff'),s=createService(c);try{
 const receipt={...snapshot('cash-gate','receipt'),customerName:'下村 健朗',receiptTotal:110000,invoiceDate:'2026/10/5',salesDate:'',tadashi:'クロス張替'};
 const saved=await exec(s,{type:'saveDocument',snapshot:receipt,expectedRevision:0});for(let i=0;i<3;i++)await exec(s,{type:'saveDocument',snapshot:saved.snapshot,expectedRevision:1});
 assert.equal((await records('sales')).length,1);assert.equal((await records('payments')).length,1);assert.equal((await records('cashLedger')).length,1);const sale=(await records('sales'))[0];assert.equal(sale.sourceId,'cash-gate');assert.equal(sale.sourceType,'receipt-cash');assert.equal(sale.invoiceDate,'');assert.equal(sale.salesDate,'2026-10-05');assert.equal(A.receivables([sale],await records('payments'),'2026-10-31')[0].outstanding,0);
 await exec(s,{type:'saveDocument',snapshot:{...receipt,documentId:'bank-gate',paymentMethod:'銀行振込'},expectedRevision:0});assert.equal((await records('sales')).length,1);
 await exec(s,{type:'saveDocument',snapshot:snapshot('cash-invoice'),expectedRevision:0});await exec(s,{type:'saveDocument',snapshot:{...receipt,documentId:'linked-gate',saleId:'sale_cash-invoice'},expectedRevision:0});assert.equal((await records('sales')).length,2);assert.equal((await records('payments')).length,2);
 }finally{c.dispose();}
});
test('production gate: every collection normalizes invalid/empty/legacy dates before writes, no NaN and required invalid date atomic rejection',async()=>{
 const c=await clientFor('admin'),s=createService(c);try{
 for(const collection of ['documents','estimates','projects','sales','receivables','payments','calendarLinks','cashLedger']){
 const p={id:'date-'+collection,workDate:'2026/10/7',invoiceDate:'Invalid Date',salesDate:'2026-02-30',paymentDate:'',date:null,updatedAt:new Date(NaN)};
 if(collection==='documents')Object.assign(p,{documentId:p.id,docType:'estimate',snapshot:{documentId:p.id,docType:'estimate',invoiceDate:'2026/10/6'}});
 if(collection==='payments')continue;await exec(s,{type:'migrateRecord',collection,id:p.id,payload:p});const row=(await c.listRecords(collection))[0].payload;assert.equal(row.workDate,'2026-10-07');assert.equal(row.invoiceDate,'');assert.equal(row.salesDate,'');assert.equal(row.date,null);assert.equal(row.updatedAt,'');
 }
 await assert.rejects(exec(s,{type:'saveDocument',snapshot:{...snapshot('invalid-required','receipt'),receiptTotal:100,invoiceDate:'2026-99-99'},expectedRevision:0}));assert(!(await records('documents')).some(d=>d.documentId==='invalid-required'));
 }finally{c.dispose();}
});
test('production gate: only isolated system-error documents can be deleted, cloud backup/audit atomic, retry safe',async()=>{
 const c=await clientFor('admin'),s=createService(c);try{
 const p={documentId:'error-gate',docType:'estimate',sourceType:'system-error',confirmed:false,snapshot:{documentId:'error-gate',docType:'estimate',customerName:'誤生成'}};
 await exec(s,{type:'migrateRecord',collection:'documents',id:'error-gate',payload:p});const cmd={type:'deleteMisregistration',documentId:'error-gate',expectedRevision:1,reason:'システム誤生成'};
 const deleted=await exec(s,cmd);assert.equal(deleted.backup.documentId,'error-gate');assert.equal((await records('documents')).length,0);const audits=await getDocs(collection(db('admin'),'companies/tsukinowa/auditLogs'));assert(audits.docs.some(d=>d.data().action==='misregistration delete'&&d.data().before.documentId==='error-gate'&&d.data().after===null));await exec(s,cmd);
 await exec(s,{type:'saveDocument',snapshot:snapshot('formal-gate'),expectedRevision:0});await assert.rejects(exec(s,{...cmd,documentId:'formal-gate'}),/正式/);assert.equal((await records('documents')).length,1);
 }finally{c.dispose();}
});

test('production gate: previously saved independent cash receipt is backfilled without renumbering or snapshot change',async()=>{
 const c=await clientFor('staff'),s=createService(c);try{
 const old={...snapshot('old-cash','receipt'),customerName:'下村 健朗',receiptTotal:110000,invoiceDate:'2026-10-05',invoiceNo:'20261005-2236-01',saleId:''};
 await env.withSecurityRulesDisabled(async ctx=>setDoc(ref(ctx.firestore(),'documents','old-cash'),{schemaVersion:2,companyId:'tsukinowa',revision:1,createdBy:'uid-staff',createdAt:serverTimestamp(),updatedBy:'uid-staff',updatedAt:serverTimestamp(),lastOperationId:'old',lastAuditId:'old',payload:{documentId:'old-cash',docType:'receipt',status:'active',confirmed:true,customerName:old.customerName,invoiceDate:old.invoiceDate,amount:110000,saleId:'',paymentId:'',snapshot:old}}));
 await exec(s,{type:'backfillReceiptCash',documentId:'old-cash'});await exec(s,{type:'backfillReceiptCash',documentId:'old-cash'});const doc=(await c.listRecords('documents'))[0].payload;assert.deepEqual(doc.snapshot,old);assert.equal(doc.snapshot.invoiceNo,'20261005-2236-01');assert.equal((await records('sales')).length,1);assert.equal((await records('payments')).length,1);assert.equal((await records('cashLedger')).length,1);
 }finally{c.dispose();}
});
test('cash calendar receipt reuses existing anchors and formal authority for staff, including legacy backfill',async()=>{
 const c=await clientFor('staff'),s=createService(c);try{
 const event={googleEventId:'cash-anchor',googleCalendarId:'shared',title:'下村 健朗、クロス張替、11万、現金',date:'2026-10-05'};
 const link=await exec(s,{type:'calendar',event});const anchor=(await c.listRecords('calendarLinks'))[0].payload.cashSaleId;
 const receipt={...snapshot('anchored','receipt'),customerName:'下村健朗',receiptTotal:110000,invoiceDate:event.date,paymentDate:event.date,calendarEventId:link.id,saleId:''};
 const result=await exec(s,{type:'saveDocument',snapshot:receipt,expectedRevision:0});assert.equal(result.saleId,anchor);assert.equal(result.paymentId,'pay_'+anchor);assert.equal((await records('sales')).length,1);assert.equal((await records('payments')).length,1);assert.equal((await records('cashLedger')).length,1);
 await exec(s,{type:'calendar',event:{...event,title:'別名、クロス張替、12万、現金'}});assert.equal((await records('sales'))[0].customer,'下村健朗');assert.equal((await records('sales'))[0].amount,110000);
 const second=await exec(s,{type:'calendar',event:{...event,googleEventId:'legacy-anchor'}});
 const old={...receipt,documentId:'legacy-anchor-receipt',calendarEventId:second.id,invoiceNo:'20261005-2236-01'};
 await env.withSecurityRulesDisabled(async ctx=>setDoc(ref(ctx.firestore(),'documents',old.documentId),{schemaVersion:2,companyId:company,revision:1,createdBy:'uid-staff',createdAt:serverTimestamp(),updatedBy:'uid-staff',updatedAt:serverTimestamp(),lastOperationId:'old',lastAuditId:'old',payload:{documentId:old.documentId,docType:'receipt',status:'active',confirmed:true,customerName:old.customerName,invoiceDate:old.invoiceDate,calendarEventId:second.id,amount:110000,saleId:'',snapshot:old}}));
 await exec(s,{type:'backfillReceiptCash',documentId:old.documentId});assert.equal((await records('sales')).length,2);assert.equal((await records('payments')).length,2);assert.equal((await records('cashLedger')).length,2);assert.deepEqual((await c.listRecords('documents')).find(d=>d.id===old.documentId).payload.snapshot,old);
 }finally{c.dispose();}
});
test('explicit calendar duplicate reconciliation preserves originals and audit, archives only exact imported cash duplicate',async()=>{
 const c=await clientFor('admin'),s=createService(c);try{
 const event={googleEventId:'double-cash',googleCalendarId:'shared',title:'下村 健朗、クロス張替、11万、現金',date:'2026-10-05'};const link=await exec(s,{type:'calendar',event});
 const receipt={...snapshot('official-double','receipt'),customerName:'下村健朗',receiptTotal:110000,invoiceDate:event.date,paymentDate:event.date,saleId:''};await exec(s,{type:'saveDocument',snapshot:receipt,expectedRevision:0});
 await env.withSecurityRulesDisabled(async ctx=>updateDoc(ref(ctx.firestore(),'documents',receipt.documentId),{'payload.calendarEventId':link.id}));
 const original=(await c.listRecords('documents'))[0].payload.snapshot;
 const result=await exec(s,{type:'reconcileReceiptCalendarCash',documentId:receipt.documentId});assert(result.reconciled);assert((await exec(s,{type:'reconcileReceiptCalendarCash',documentId:receipt.documentId})).skipped);
 const A=require('../js/accounting.js');assert.equal((await records('sales')).filter(A.live).length,1);assert.equal((await records('payments')).filter(p=>!p.deletedAt).length,1);assert.equal((await records('cashLedger')).filter(p=>!p.deletedAt).length,1);assert.equal((await records('sales')).length,2);assert.deepEqual((await c.listRecords('documents'))[0].payload.snapshot,original);assert((await c.listRecords('auditLogs')).some(r=>r.after?.duplicateOfSaleId==='sale_official-double'));
 }finally{c.dispose();}
});


test('admin manual bank confirmation writes only one payment, no document/number, staff cannot bypass permissions',async()=>{
 const admin=await clientFor('admin'),service=createService(admin);await exec(service,{type:'saveDocument',snapshot:snapshot('manual-bank'),expectedRevision:0});
 const docs=JSON.stringify(await admin.listRecords('documents')),numbers=JSON.stringify((await getDocs(collection(db('admin'),'companies/tsukinowa/operations'))).docs.filter(d=>d.id.startsWith('documentNumber_')).map(d=>d.data()));
 const command={type:'payment',manualConfirmed:true,saleId:'sale_manual-bank',paymentId:'one',amount:50000,paymentDate:'2026-10-08',method:'銀行振込',memo:'確認済'};
 await exec(service,command);await exec(service,command);const payments=await admin.listRecords('payments');assert.equal(payments.length,1);assert.equal(payments[0].payload.confirmation,'bank-confirmed');
 assert.equal(JSON.stringify(await admin.listRecords('documents')),docs);assert.equal(JSON.stringify((await getDocs(collection(db('admin'),'companies/tsukinowa/operations'))).docs.filter(d=>d.id.startsWith('documentNumber_')).map(d=>d.data())),numbers);
 await assert.rejects(exec(createService(await clientFor('staff')),{...command,paymentId:'staff'}),/管理者/);
});

test('manual same-day same-amount real deposits are distinct; replay operation is idempotent',async()=>{const admin=await clientFor('admin'),service=createService(admin);try{await exec(service,{type:'saveDocument',snapshot:{...snapshot('two-real'),paymentMethod:'銀行振込'},expectedRevision:0});const command={type:'payment',manualConfirmed:true,saleId:'sale_two-real',paymentId:'real-one',operationId:'deposit-one',amount:20000,paymentDate:'2026-10-08',method:'銀行振込',memo:''};await Promise.all([service.execute(command),service.execute(command)]).catch(e=>{e.message='first concurrent: '+e.message;throw e;});await service.execute({...command,paymentId:'real-two',operationId:'deposit-two'}).catch(e=>{e.message='second real: '+e.message;throw e;});assert.equal((await admin.listRecords('payments')).length,2);}finally{admin.dispose();}});

// History removal is a document-only archive, with existing audit transaction enforcement.
test('inactive document history archive: four states, admin only, immutable audit and live relations',async()=>{
 const admin=await clientFor('admin'),staff=await clientFor('staff'),service=createService(admin),staffService=createService(staff);
 await exec(service,{type:'saveDocument',snapshot:snapshot('original'),expectedRevision:0});
 await exec(service,{type:'saveDocument',snapshot:snapshot('revised'),revisedFromDocumentId:'original',expectedParentRevision:1,reason:'訂正',expectedRevision:0});
 await exec(service,{type:'payment',saleId:'sale_original',paymentId:'real-payment',amount:500,paymentDate:'2026-09-21',method:'銀行振込',manualConfirmed:true});
 const saleBefore=await admin.listRecords('sales'),paymentsBefore=await admin.listRecords('payments');
 await assert.rejects(exec(service,{type:'archiveDocument',documentId:'revised',expectedRevision:1}),/無効/);
 for(const state of ['void','duplicate','cancelled']){
  await exec(service,{type:'saveDocument',snapshot:snapshot(state),expectedRevision:0});
  await exec(service,{type:'documentStatus',documentId:state,status:state,reason:'誤登録',duplicateOfDocumentId:'revised',expectedRevision:1});
 }
 const beforeSales=await admin.listRecords('sales'),beforePayments=await admin.listRecords('payments');
 for(const id of ['original','void','duplicate','cancelled']){
  const record=(await admin.listRecords('documents')).find(d=>d.id===id);
  await assert.rejects(exec(staffService,{type:'archiveDocument',documentId:id,expectedRevision:record.revision}),/管理者/);
  await assert.rejects(exec(service,{type:'archiveDocument',documentId:id,expectedRevision:0}),/変更|更新|revision|競合/i);
  await exec(service,{type:'archiveDocument',documentId:id,expectedRevision:record.revision});
  assert((await admin.listRecords('documents')).find(d=>d.id===id).payload.deletedAt);
  const audit=await getDocs(collection(db('admin'),'companies/tsukinowa/auditLogs'));
  assert(audit.docs.some(d=>d.data().entityId===id&&d.data().after?.deleteReason==='履歴から削除'));
  await assertFails(deleteDoc(audit.docs[0].ref));
 }
 assert.deepEqual(await admin.listRecords('sales'),beforeSales);assert.deepEqual(await admin.listRecords('payments'),beforePayments);
 assert.deepEqual(beforePayments,paymentsBefore);assert.deepEqual(beforeSales.find(s=>s.id==='sale_original'),saleBefore.find(s=>s.id==='sale_original'));
 // Direct forged active archive and snapshot edits are denied even for an administrator.
 await assertFails(updateDoc(ref(db('admin'),'documents','revised'),{'payload.deletedAt':'2026-10-08','payload.deleteReason':'履歴から削除'}));
});
