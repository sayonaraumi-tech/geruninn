// Safe Firestore restore drill: hard-fails outside the demo emulator.
// Never authorize deleting or overwriting production business data.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const project='demo-tsukinowa',host=process.env.FIRESTORE_EMULATOR_HOST||'';
if(!host||!/^((127\.0\.0\.1|localhost)(:[0-9]+)?)$/.test(host)||process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==project)
 throw Error('REFUSED: restoration drill is permitted only on localhost Firestore Emulator with demo project');
const app=initializeApp({projectId:project});
const db=getFirestore(app);db.settings({ignoreUndefinedProperties:true});
const company='backup-safety-smoke',base='companies/'+company+'/';
const fixtures=[
 ['documents/doc-a',{schemaVersion:2,companyId:company,payload:{documentId:'doc-a',docType:'invoice',invoiceNo:'20261116-1200-01',amount:8000},revision:1}],
 ['sales/sale-a',{schemaVersion:2,companyId:company,payload:{saleId:'sale-a',documentId:'doc-a',amount:8000},revision:1}],
 ['payments/pay-a',{schemaVersion:2,companyId:company,payload:{paymentId:'pay-a',saleId:'sale-a',amount:5000},revision:1}],
 ['bankTransactions/bank-a',{schemaVersion:2,companyId:company,payload:{bankTxnId:'bank-a',amount:5000,status:'照合済'},revision:1}],
 ['auditLogs/audit-a',{entityType:'documents',entityId:'doc-a',action:'create',after:{amount:8000}}],
 ['operations/operation-a',{actorId:'test',fingerprint:'fixture',result:{documentId:'doc-a'}}]
];
const serialize=x=>JSON.stringify(x,Object.keys(x).sort());
(async()=>{
 const prefix=fs.mkdtempSync(path.join(os.tmpdir(),'tsukinowa-firestore-restore-'));
 try{
  // Initialize isolated fixture and explicitly verify source data.
  for(const [key,data] of fixtures)await db.doc(base+key).set(data);
  const exported=[];
  for(const [key] of fixtures){
   const snap=await db.doc(base+key).get();assert(snap.exists);exported.push({path:key,data:snap.data()});
  }
  const file=path.join(prefix,'demo-backup.json');
  fs.writeFileSync(file,JSON.stringify({project,company,records:exported},null,2),{mode:0o600});
  const backup=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(backup.project,project);assert.equal(backup.company,company);
  // This deletion touches ONLY these named synthetic fixture IDs.
  for(const [key] of fixtures)await db.doc(base+key).delete();
  for(const [key] of fixtures)assert.equal((await db.doc(base+key).get()).exists,false);
  for(const entry of backup.records)await db.doc(base+entry.path).set(entry.data);
  for(const entry of backup.records){
   const restored=(await db.doc(base+entry.path).get()).data();
   assert.deepEqual(restored,entry.data,'restored record mismatch: '+entry.path);
  }
  const docs=backup.records.filter(x=>x.path.startsWith('documents/'));
  const sales=backup.records.filter(x=>x.path.startsWith('sales/'));
  const payments=backup.records.filter(x=>x.path.startsWith('payments/'));
  assert.equal(docs.length,1);assert.equal(sales.length,1);assert.equal(payments.length,1);
  console.log('PASS emulator only: backup -> delete synthetic fixtures -> restore -> compare 6 records, preserving finance/audit/idempotency links');
 }finally{
  for(const [key] of fixtures)await db.doc(base+key).delete();
  fs.rmSync(prefix,{recursive:true,force:true});
  await deleteApp(app);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
