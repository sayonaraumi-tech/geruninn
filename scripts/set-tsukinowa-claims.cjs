'use strict';
// One-time operator script. Only getUser and setCustomUserClaims are used.
// Usage: node scripts/set-tsukinowa-claims.cjs FIREBASE_PROJECT_ID
const COMPANY_ID = 'tsukinowa';
const USERS = Object.freeze([
  Object.freeze({uid: 'Du6KeSndv5UKijU10kZgrkRDPQQ2', role: 'admin'}),
  Object.freeze({uid: 'sBbSB4IDaPM3BTeWho17kqz1YV82', role: 'staff'}),
]);

async function setClaims(auth, print = console.log) {
  // Check both UIDs before the first write; preserve unrelated existing claims.
  const users = await Promise.all(USERS.map(({uid}) => auth.getUser(uid)));
  const updates = USERS.map(({uid, role}, i) => ({
    uid, customClaims: {...(users[i].customClaims || {}), companyId: COMPANY_ID, role},
  }));
  for (const {customClaims} of updates) {
    if (Buffer.byteLength(JSON.stringify(customClaims), 'utf8') > 1000) {
      throw new Error('Merged custom claims exceed the Firebase 1000-byte limit. No claims were written.');
    }
  }
  let writeError;
  try {
    for (const {uid, customClaims} of updates) await auth.setCustomUserClaims(uid, customClaims);
  } catch (error) {
    writeError = error;
  }
  // Firebase Auth has no atomic two-user update. Print actual state even after a partial failure.
  const verified = await Promise.allSettled(USERS.map(({uid}) => auth.getUser(uid)));
  let verificationFailed = false;
  verified.forEach((result, i) => {
    const {uid, role} = USERS[i];
    if (result.status === 'rejected') {
      verificationFailed = true;
      print(JSON.stringify({uid, verification: 'failed', error: result.reason.code || result.reason.message}));
      return;
    }
    const customClaims = result.value.customClaims || {};
    print(JSON.stringify({uid, customClaims}));
    if (customClaims.companyId !== COMPANY_ID || customClaims.role !== role) verificationFailed = true;
  });
  if (writeError) throw new Error(`Claims update failed; review the printed state and rerun: ${writeError.code || writeError.message}`);
  if (verificationFailed) throw new Error('Claims verification failed. Review the printed state and rerun.');
  return verified.map(result => result.value);
}

async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(args[0])) {
    throw new Error('Usage: node scripts/set-tsukinowa-claims.cjs FIREBASE_PROJECT_ID (not companyId)');
  }
  const {initializeApp, applicationDefault, deleteApp} = require('firebase-admin/app');
  const {getAuth} = require('firebase-admin/auth');
  const projectId = args[0];
  const app = initializeApp({credential: applicationDefault(), projectId}, 'tsukinowa-initial-claims');
  try {
    console.log(`Firebase project: ${projectId}; companyId: ${COMPANY_ID}`);
    await setClaims(getAuth(app));
    console.log('Verified both users. Sign out and sign in again to obtain tokens with the new claims.');
  } finally {
    // Disposes the SDK instance only; does not delete the Firebase project or users.
    await deleteApp(app);
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = {COMPANY_ID, USERS, setClaims, main};
