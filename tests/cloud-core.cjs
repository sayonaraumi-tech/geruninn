const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const core=require('../js/cloud-core.js');
function harness(){
 const records=new Map(),listeners=[];let authCallback,authError,commits=0;
 const driver={initialize:async()=>{},observeAuth:(next,error)=>{authCallback=next;authError=error;return()=>{};},claims:async user=>user.claims,signIn:async()=>{},signOut:async()=>authCallback(null),listen:(path,many,next,error)=>{const l={path,next,error,stopped:false};listeners.push(l);return()=>l.stopped=true;},digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,
 transaction:async fn=>{const writes=[];const result=await fn({get:async p=>records.get(p)||null,set:(p,v)=>writes.push([p,v])});for(const [p,v] of writes)records.set(p,v);commits+=writes.length;return result;}};
 const client=core.createClient(driver);return {client,driver,records,listeners,auth:user=>authCallback(user),error:e=>authError(e),commits:()=>commits};
}
const config={enabled:true,companyId:'tsukinowa',firebase:{apiKey:'public-key',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test-app'}};
const user=role=>({uid:'uid-'+role,email:role+'@example.com',claims:{role,companyId:'tsukinowa'}});
async function ready(role='admin'){const h=harness();await h.client.start(config);await h.auth(user(role));return h;}
test('disabled config never initializes Firebase; rejects invalid config and server keys',async()=>{
 const h=harness();h.driver.initialize=()=>{throw Error('must not run');};await h.client.start({enabled:false});assert.equal(h.client.getState().phase,'unconfigured');
 assert.throws(()=>core.validateConfig({...config,companyId:'../other'}));assert.throws(()=>core.validateConfig({...config,firebase:{...config.firebase,private_key:'DO NOT USE'}}));
});
test('legacy reads and backup do not mutate any original values, including corrupt JSON',()=>{
 const values=new Map([[core.LOCAL_KEYS.business,'{"sales":[{"id":"s","amount":100}]}'],[core.LOCAL_KEYS.documents,'invalid-json'],['tsukinowa_old_draft','keep'],['chohyoLastSeq_2026','8'],['other','leave']]);
 const storage={getItem:k=>values.get(k)??null,get length(){return values.size;},key:i=>[...values.keys()][i]},before=JSON.stringify([...values]);
 const read=core.readLegacy(storage);assert.equal(read.business.sales[0].amount,100);assert.equal(read.errors.length,1);
 const backup=core.backupLegacy(storage);assert.equal(backup.raw[core.LOCAL_KEYS.documents],'invalid-json');assert.equal(backup.raw.tsukinowa_old_draft,'keep');assert(!backup.raw.other);assert.equal(JSON.stringify([...values]),before);
});
test('signed-out/unknown role/wrong company cannot access records',async()=>{
 const h=harness();await h.client.start(config);await h.auth(null);assert.throws(()=>h.client.listen('documents',null,()=>{}));
 await h.auth({...user('admin'),claims:{role:'admin',companyId:'other'}});assert.equal(h.client.getState().phase,'denied');
 await assert.rejects(h.client.put('sales','id',{}, {operationId:'op'}));await h.auth(user('owner'));assert.equal(h.client.getState().phase,'denied');
});
test('staff operational reads allowed; finance reads and all phase-one writes denied',async()=>{
 const h=await ready('staff');h.client.listen('documents',null,()=>{});h.client.listen('settings','system',()=>{});
 assert.throws(()=>h.client.listen('sales',null,()=>{}));assert.throws(()=>h.client.listen('settings',null,()=>{}));
 await assert.rejects(h.client.put('documents','d',{}, {operationId:'op'}));assert.equal(h.commits(),0);
});
test('signout/account switches cancel listeners and suppress stale callbacks',async()=>{
 const h=await ready();let deliveries=0;h.client.listen('sales',null,()=>deliveries++);const old=h.listeners[0];old.next([]);assert.equal(deliveries,1);
 await h.auth(user('staff'));assert(old.stopped);old.next([]);assert.equal(deliveries,1);await h.client.signOut();assert.equal(h.client.getState().user,null);
});
test('slow claims from prior user cannot grant access to the next account',async()=>{
 const h=harness();let finish;h.driver.claims=()=>new Promise(r=>finish=r);await h.client.start(config);const pending=h.auth(user('admin'));await h.auth(null);finish(user('admin').claims);await pending;assert.equal(h.client.getState().phase,'signed-out');
});
test('idempotent atomic record+operation+audit; stale revision and reused key rejected',async()=>{
 const h=await ready(),payload={salesDate:'2026-09-01',invoiceDate:'2026-09-10',paymentDate:'2026-09-20',amount:100};
 assert.deepEqual(await h.client.put('sales','document-1',payload,{operationId:'first'}),{revision:1,replayed:false});assert.equal(h.commits(),3);
 assert.deepEqual(await h.client.put('sales','document-1',payload,{operationId:'first'}),{revision:1,replayed:true});assert.equal(h.commits(),3);
 await assert.rejects(h.client.put('sales','document-1',{amount:1},{operationId:'first'}),/conflict/);
 await assert.rejects(h.client.put('sales','document-1',payload,{operationId:'stale'}),/別の端末/);assert.equal(h.commits(),3);
 await h.client.put('sales','document-1',{...payload,amount:150},{operationId:'second',expectedRevision:1});assert.equal(h.records.get('companies/tsukinowa/sales/document-1').revision,2);assert.equal(h.records.get('companies/tsukinowa/auditLogs/first').revision,1);
});
test('failed transaction, offline write and invalid path do not change local or cloud records',async()=>{
 const h=await ready();await assert.rejects(h.client.put('sales','../id',{}, {operationId:'x'}));await assert.rejects(h.client.put('auditLogs','id',{}, {operationId:'x'}));
 h.driver.transaction=async()=>{throw Error('offline');};await assert.rejects(h.client.put('sales','d',{amount:1},{operationId:'op'}),/offline/);assert.equal(h.records.size,0);
});
test('auth error clears role and removes all active subscriptions',async()=>{const h=await ready();h.client.listen('documents',null,()=>{});h.error(Error('expired'));assert.equal(h.client.getState().role,null);assert(h.listeners[0].stopped);});
