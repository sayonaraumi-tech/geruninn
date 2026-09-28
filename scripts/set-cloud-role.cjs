// Trusted operator only. Uses Application Default Credentials, never a key committed to this repo.
// node scripts/set-cloud-role.cjs PROJECT_ID EMAIL admin|staff COMPANY_ID
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const [projectId,email,role,companyId]=process.argv.slice(2);
if(!projectId||!email||!['admin','staff'].includes(role)||!companyId||companyId.includes('/')){
  console.error('Usage: node scripts/set-cloud-role.cjs PROJECT_ID EMAIL admin|staff COMPANY_ID');process.exit(1);
}
initializeApp({credential:applicationDefault(),projectId});
(async()=>{
  const auth=getAuth(),user=await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid,{...user.customClaims,role,companyId});
  await auth.revokeRefreshTokens(user.uid);
  console.log('Role saved. The user must sign out and sign in again.');
})().catch(err=>{console.error(err.message);process.exitCode=1;});
