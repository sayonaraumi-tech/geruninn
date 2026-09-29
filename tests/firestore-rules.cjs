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
 for(const n of ['documents','estimates','projects','sales','payments','calendarLinks','auditLogs'])await assertSucceeds(getDocs(collection(db('staff'),`companies/${company}/${n}`)));
 for(const n of ['expenses','suppliers','cashLedger','settings','migrations'])await assertFails(getDocs(collection(db('staff'),`companies/${company}/${n}`)));
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
