(function(root){
  'use strict';
  root.createTsukinowaFirebaseDriver=async function(){
    const base='https://www.gstatic.com/firebasejs/12.19.0/';
    const [appSDK,authSDK,dbSDK]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]);
    let auth,db;
    return {
      async initialize(config){
        const existing=appSDK.getApps().find(a=>a.name==='tsukinowa-cloud');
        if(existing&&existing.options.projectId!==config.projectId)throw Error('Firebase設定を変更した場合はページを再読込してください。');
        const app=existing||appSDK.initializeApp(config,'tsukinowa-cloud');
        auth=authSDK.getAuth(app);
        // No persistent Firestore cache: switching accounts must not expose another role's cached records.
        db=existing?dbSDK.getFirestore(app):dbSDK.initializeFirestore(app,{localCache:dbSDK.memoryLocalCache()});
        await authSDK.setPersistence(auth,authSDK.browserSessionPersistence);
      },
      observeAuth:(next,error)=>authSDK.onIdTokenChanged(auth,next,error),
      claims:async user=>(await authSDK.getIdTokenResult(user)).claims,
      signIn:(email,password)=>authSDK.signInWithEmailAndPassword(auth,email,password),
      signOut:()=>authSDK.signOut(auth),
      listen(path,isCollection,next,error){
        const ref=isCollection?dbSDK.collection(db,path):dbSDK.doc(db,path);
        return dbSDK.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>next(isCollection?snapshot.docs.map(d=>({id:d.id,...d.data()})):(snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null),{fromCache:snapshot.metadata.fromCache,hasPendingWrites:snapshot.metadata.hasPendingWrites}),error);
      },
      transaction:fn=>dbSDK.runTransaction(db,tx=>fn({get:async path=>{const snap=await tx.get(dbSDK.doc(db,path));return snap.exists()?snap.data():null;},set:(path,value)=>tx.set(dbSDK.doc(db,path),value)})),
      timestamp:()=>dbSDK.serverTimestamp(),
      async digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
    };
  };
})(window);
