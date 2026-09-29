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
  const event={googleEventId:'google-1',googleCalendarId:'shared',title:'仮の予定',date:'2026-09-10'};const link=await exec(s,{type:'calendar',event});await exec(s,{type:'calendar',event});assert.equal((await getDocs(collection(db('admin'),`companies/${company}/calendarLinks`))).size,1);
  await exec(s,{type:'saveDocument',snapshot:{...snapshot('linked'),calendarEventId:link.id},expectedRevision:0});await exec(s,{type:'calendar',event:{...event,title:'変更 1円'}});assert.equal((await getDoc(ref(db('admin'),'documents','linked'))).data().payload.amount,100000);
  await assert.rejects(exec(a,{type:'saveDocument',snapshot:{...inv,customerName:'stale'},expectedRevision:0}),/別の端末/);
  online=false;phone.enqueue({type:'payment',paymentId:'offline',saleId:'sale_invoice-1',amount:1000,paymentDate:'2026-09-23',method:'現金',operationId:'offline-payment'});await phone.flush();assert.equal(phone.getQueue().length,1);online=true;await phone.flush();await until(()=>desktop.getRows().payments.some(r=>r.id==='offline'));assert.equal(phone.getQueue().length,0);
  const audits=await getDocs(collection(db('admin'),`companies/${company}/auditLogs`));assert(audits.docs.some(d=>d.data().action==='status change'&&d.data().before.status==='見積済'&&d.data().after.status==='受注'));
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
