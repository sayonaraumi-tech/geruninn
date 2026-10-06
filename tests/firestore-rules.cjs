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
  transaction:fn=>runTransaction(store,tx=>fn({get:async p=>{const s=await tx.get(doc(store,p));return s.exists()?s.data():null},set:(p,v)=>tx.set(doc(store,p),v)}))});
 await client.start({enabled:true,companyId:company,firebase:{apiKey:'x',authDomain:'x',projectId:'demo-tsukinowa',appId:'x'}});await callback({uid:'uid-'+role,claims:{role,companyId:company}});return client;
}
async function until(fn){const start=Date.now();while(!fn()){if(Date.now()-start>12000)throw Error('snapshot timeout');await new Promise(r=>setTimeout(r,30));}}
const snapshot=(id,type='invoice')=>({documentId:id,docType:type,customerName:'共有テスト',invoiceDate:'2026-09-20',salesDate:'2026-09-10',items:[{content:'施工',qty:1,price:90909.09}],travelFee:0,paymentMethod:'現金'});
const exec=(service,cmd)=>service.execute({operationId:crypto.randomUUID(),...cmd});
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
 await s.execute(cmd);await s.execute(cmd);
 const records=async name=>(await getDocs(collection(db('admin'),`companies/${company}/${name}`))).docs.map(r=>({...r.data().payload,id:r.id}));
 const v=O.view(original,saleBefore,await records('payments'));assert.deepEqual([v.invoiceAmount,v.paidAmount,v.outstandingAmount,v.paymentStatus],[779379,770379,9000,'一部入金']);
 const state=JSON.stringify([await records('sales'),await records('payments'),await records('documents')]);for(let i=0;i<3;i++)O.notice(v,'2026-10-02');assert.equal(JSON.stringify([await records('sales'),await records('payments'),await records('documents')]),state);
 for(const bad of [{amount:1.5},{amount:Infinity},{paymentDate:'2026-02-31'},{method:'invalid'},{documentId:'different'}])await assert.rejects(exec(s,{...cmd,...bad,operationId:crypto.randomUUID(),paymentId:crypto.randomUUID()}));
 await exec(s,{...cmd,operationId:crypto.randomUUID(),paymentId:'dynast-final',amount:9000,method:'現金',paymentDate:'2026-10-02'});
 const final=O.view(original,saleBefore,await records('payments'));assert.deepEqual([final.paidAmount,final.outstandingAmount,final.paymentStatus],[779379,0,'入金済']);
 assert.equal((await records('sales')).length,1);assert.equal((await records('payments')).length,2);assert.equal((await records('cashLedger')).length,1);
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
 const O=require('../js/outstanding'),pays=(await getDocs(collection(db('admin'),`companies/${company}/payments`))).docs.map(d=>({id:d.id,...d.data()}));const v=O.view(docBefore,null,pays);assert.equal(v.outstandingAmount,9000);assert.equal(v.paymentStatus,'一部入金');
 await exec(a,{type:'importBank',bank:{bankTxnId:'bank-old',bankAccount:'test',bankTransactionDate:'2026-08-25',incoming:770379,outgoing:0,amount:770379,description:'dynast'}});
 await exec(a,{type:'bankMatch',bankTxnId:'bank-old',targetType:'sale',targetId:anchor,paymentId:'historical-partial',expectedRevision:1});
 assert.equal((await getDoc(ref(db('admin'),'payments','historical-partial'))).data().payload.confirmation,'bank-confirmed');
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
