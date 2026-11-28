const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveUsers, setClaims, main} = require('../scripts/set-tsukinowa-claims.cjs');
const USERS = resolveUsers({TSUKINOWA_ADMIN_UID:'unit-admin-000001',TSUKINOWA_STAFF_UID:'unit-staff-000002'});
const apply=(auth, print)=>setClaims(auth, print, USERS);
function fixture() {
  const records = new Map(USERS.map(u => [u.uid, {uid:u.uid, customClaims:{existing:'keep'}}]));
  const calls = [], output = [];
  const auth = {
    getUser: async uid => {calls.push(['getUser',uid]); if(!records.has(uid))throw Error('missing user');return structuredClone(records.get(uid));},
    setCustomUserClaims: async (uid, customClaims) => {calls.push(['setCustomUserClaims',uid]);records.get(uid).customClaims=structuredClone(customClaims);},
  };
  return {records,calls,output,auth};
}
test('exact UIDs, merged claims, readback verification; repeat execution is safe', async () => {
  const f=fixture();await apply(f.auth,x=>f.output.push(JSON.parse(x)));
  assert.deepEqual(f.calls.slice(0,2).map(x=>x[0]),['getUser','getUser']);
  assert.equal(f.output.length,2);
  for(const {uid,role} of USERS)assert.deepEqual(f.records.get(uid).customClaims,{existing:'keep',companyId:'tsukinowa',role});
  await apply(f.auth,()=>{});
  assert(f.calls.every(([method])=>['getUser','setCustomUserClaims'].includes(method)));
});
test('missing second user prevents any claims write', async () => {
  const f=fixture();f.records.delete(USERS[1].uid);await assert.rejects(apply(f.auth),/missing/);
  assert(!f.calls.some(x=>x[0]==='setCustomUserClaims'));
});
test('partial write failure still reads and prints both actual claim sets', async () => {
  const f=fixture(),set=f.auth.setCustomUserClaims;f.auth.setCustomUserClaims=async(uid,c)=>{if(uid===USERS[1].uid)throw Error('permission denied');return set(uid,c);};
  await assert.rejects(apply(f.auth,x=>f.output.push(JSON.parse(x))),/Claims update failed/);
  assert.equal(f.output.length,2);assert.equal(f.output[0].customClaims.role,'admin');assert.equal(f.output[1].customClaims.role,undefined);
});
test('mismatched readback fails verification', async () => {
  const f=fixture();f.auth.setCustomUserClaims=async()=>{};await assert.rejects(apply(f.auth,()=>{}),/verification failed/);
});
test('invalid project argument fails before initializing credentials', async () => {
  await assert.rejects(main([]),/Usage:/);await assert.rejects(main(['bad project']),/Usage:/);
});

test('production account UIDs are required and never hardcoded', () => {
  assert.throws(()=>resolveUsers({}),/TSUKINOWA_ADMIN_UID/);
  assert.throws(()=>resolveUsers({TSUKINOWA_ADMIN_UID:'sameuser00001',TSUKINOWA_STAFF_UID:'sameuser00001'}),/distinct/);
});
