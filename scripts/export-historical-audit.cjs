'use strict';
// Explicit read-only Firestore transaction. Requires operator-provided ADC with read-only IAM.
const fs=require('node:fs');
const {COLLECTIONS}=require('./historical-duplicate-audit.cjs');
async function collect(db){return db.runTransaction(async tx=>{
  const collections={};
  for(const c of COLLECTIONS){const snap=await tx.get(db.collection('companies/tsukinowa/'+c));collections[c]=snap.docs.map(d=>({id:d.id,data:d.data(),updateTime:d.updateTime.toDate().toISOString()}));}
  return collections;
},{readOnly:true});}
async function main(){const [projectId,companyId,destination]=process.argv.slice(2);
 if(projectId!=='tsukinowa-business'||companyId!=='tsukinowa'||!destination||process.env.FIRESTORE_EMULATOR_HOST)throw Error('Usage: node scripts/export-historical-audit.cjs tsukinowa-business tsukinowa NEW_PRIVATE_SNAPSHOT.json (production ADC required)');
 if(fs.existsSync(destination))throw Error('Destination exists');
 const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');
 const app=initializeApp({projectId,credential:applicationDefault()},'historical-readonly-audit');
 try{const startedAt=new Date().toISOString();const collections=await collect(getFirestore(app));fs.writeFileSync(destination,JSON.stringify({format:'geruninn-readonly-audit-v1',projectId,companyId,productionVerified:true,startedAt,completedAt:new Date().toISOString(),collections},null,2),{flag:'wx',mode:0o600});}
 finally{await deleteApp(app);}
}
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
module.exports={collect};
