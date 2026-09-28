const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,collection,setDoc,deleteDoc,updateDoc,runTransaction,serverTimestamp,onSnapshot}=require('firebase/firestore');
const {createClient}=require('../js/cloud-core.js');
let env;
const company='tsukinowa';
const ref=(db,name,id='one')=>doc(db,`companies/${company}/${name}/${id}`);
const db=(role,tenant=company)=>env.authenticatedContext('uid-'+role,{role,companyId:tenant}).firestore();
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});});
after(async()=>{await env?.cleanup();});beforeEach(async()=>env.clearFirestore());
async function seed(name,payload={}){await env.withSecurityRulesDisabled(async c=>setDoc(ref(c.firestore(),name),{payload,revision:1,companyId:company,schemaVersion:1,createdBy:'uid-admin',updatedBy:'uid-admin'}));}
async function clientFor(role){
 const store=db(role);let callback;
 const client=createClient({initialize:async()=>{},observeAuth:f=>{callback=f;return()=>{};},claims:async u=>u.claims,
  digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:serverTimestamp,
  transaction:fn=>runTransaction(store,tx=>fn({get:async p=>{const s=await tx.get(doc(store,p));return s.exists()?s.data():null;},set:(p,v)=>tx.set(doc(store,p),v)}))});
 await client.start({enabled:true,companyId:company,firebase:{apiKey:'x',authDomain:'x',projectId:'x',appId:'x'}});await callback({uid:'uid-'+role,claims:{role,companyId:company}});return client;
}
test('unauthenticated and cross-company access denied',async()=>{
 await seed('documents');await assertFails(getDoc(ref(env.unauthenticatedContext().firestore(),'documents')));await assertFails(getDoc(ref(db('admin','other'),'documents')));
});
test('staff operational reads allowed; accounting, audit and private settings denied',async()=>{
 const staff=db('staff');for(const name of ['calendarLinks','estimates','projects','documents']){await seed(name);await assertSucceeds(getDoc(ref(staff,name)));await assertSucceeds(getDocs(collection(staff,`companies/${company}/${name}`)));}
 for(const name of ['sales','payments','expenses','suppliers','cashLedger','auditLogs','bankTransactions','settings']){await seed(name);await assertFails(getDoc(ref(staff,name)));}
 await assertSucceeds(getDoc(ref(staff,'settings','system')));await assertFails(getDocs(collection(staff,`companies/${company}/settings`)));
});
test('all unaudited writes denied, including admin bypass and staff self-promotion',async()=>{
 const admin=db('admin'),staff=db('staff');await assertFails(setDoc(ref(admin,'sales'),{payload:{amount:1}}));await assertFails(setDoc(ref(staff,'documents'),{payload:{}}));
 await assertFails(setDoc(doc(staff,'users/uid-staff'),{role:'admin'}));
});
test('repository transaction writes atomically, replays once, and rejects stale revisions',async()=>{
 const client=await clientFor('admin');assert.deepEqual(await client.put('sales','one',{salesDate:'2026-09-01',invoiceDate:'2026-09-10',amount:500},{operationId:'save-one'}),{revision:1,replayed:false});
 const again=await client.put('sales','one',{salesDate:'2026-09-01',invoiceDate:'2026-09-10',amount:500},{operationId:'save-one'});assert.equal(again.replayed,true);
 const admin=db('admin');assert.equal((await getDocs(collection(admin,`companies/${company}/auditLogs`))).size,1);
 await assert.rejects(client.put('sales','one',{amount:2},{operationId:'stale'}),/別の端末/);
 await client.put('sales','one',{amount:600},{operationId:'second',expectedRevision:1});assert.equal((await getDoc(ref(admin,'sales'))).data().payload.amount,600);
});
test('audit logs and idempotency markers cannot be changed or deleted even by admin',async()=>{
 const client=await clientFor('admin');await client.put('documents','one',{docType:'invoice'},{operationId:'save-doc'});const admin=db('admin');
 for(const name of ['auditLogs','operations']){await assertFails(updateDoc(ref(admin,name,'save-doc'),{actorId:'other'}));await assertFails(deleteDoc(ref(admin,name,'save-doc')));}
 await assertFails(deleteDoc(ref(admin,'documents')));
});
test('independent clients receive realtime changes through permitted listener',async()=>{
 const staff=db('staff'),client=await clientFor('admin');let stop;
 const observed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stop?.();reject(Error('listener timeout'));},10000);stop=onSnapshot(ref(staff,'projects'),s=>{if(s.exists()&&s.data().payload.label==='shared'){clearTimeout(timer);stop();resolve(s.data());}},reject);});
 await client.put('projects','one',{label:'shared'},{operationId:'project'});assert.equal((await observed).revision,1);
});
