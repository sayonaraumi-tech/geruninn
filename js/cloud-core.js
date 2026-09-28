/* Phase 1: independent cloud repository; never replaces the legacy business state. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TsukinowaCloudCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const COLLECTIONS=Object.freeze(['calendarLinks','estimates','projects','documents','sales','payments','expenses','suppliers','cashLedger','auditLogs','settings','bankTransactions']);
  const STAFF_READ=Object.freeze(['calendarLinks','estimates','projects','documents']);
  const LOCAL_KEYS=Object.freeze({business:'tsukinowa_business_v1',documents:'tsukinowa_chohyo_confirmed_history_v1',settings:'tsukinowa_business_settings_v1'});
  function segment(value){if(typeof value!=='string'||!value||value.length>200||/[\/\x00-\x1f]/.test(value)||value==='.'||value==='..')throw Error('Invalid record ID');return value;}
  function validateConfig(config){
    if(!config||config.enabled!==true)return null;
    segment(config.companyId);
    const source=config.firebase||{},firebase={};
    for(const key of ['apiKey','authDomain','projectId','appId'])if(typeof source[key]!=='string'||!source[key].trim())throw Error('Firebase設定が未完了です。');
    if(source.private_key||source.client_email||source.type==='service_account')throw Error('サービスアカウントの秘密鍵は使用できません。');
    for(const key of ['apiKey','authDomain','projectId','appId','storageBucket','messagingSenderId'])if(typeof source[key]==='string')firebase[key]=source[key].trim();
    return {companyId:config.companyId,firebase};
  }
  function readLegacy(storage){
    const errors=[],read=(key,fallback,valid)=>{
      try{const raw=storage.getItem(key);if(raw===null)return fallback;const data=JSON.parse(raw);if(!valid(data))throw Error('Unexpected data shape');return data;}
      catch(e){errors.push({key,message:e.message});return fallback;}
    };
    const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
    return {business:read(LOCAL_KEYS.business,{},object),documents:read(LOCAL_KEYS.documents,[],Array.isArray),settings:read(LOCAL_KEYS.settings,{},object),errors};
  }
  // Export raw strings as well as parsed data so even malformed old data can be recovered.
  function backupLegacy(storage,now=new Date()){
    const raw={};
    for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key&&(key.startsWith('tsukinowa_')||key.startsWith('chohyoLastSeq_')))raw[key]=storage.getItem(key);}
    return {format:'tsukinowa-local-backup',schemaVersion:1,createdAt:now.toISOString(),raw,...readLegacy(storage)};
  }
  function canonical(value){
    if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
    if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    throw Error('Cloud data must contain JSON values only');
  }
  function createClient(driver,onState=()=>{}){
    let state={phase:'unconfigured',user:null,role:null,companyId:null,error:null};
    let config=null,authStop=null,generation=0;
    const subscriptions=new Set();
    const emit=patch=>{state={...state,...patch};onState({...state});};
    function clearSubscriptions(){for(const stop of subscriptions)stop();subscriptions.clear();}
    function identity(){if(state.phase!=='ready'||!state.user||!state.role)throw Error('権限のあるアカウントでログインしてください。');return {uid:state.user.uid,role:state.role,companyId:state.companyId,generation};}
    function scope(name){if(!COLLECTIONS.includes(name))throw Error('Unknown collection');return name;}
    function readable(name,id){const who=identity();scope(name);if(who.role==='staff'&&!STAFF_READ.includes(name)&&!(name==='settings'&&id==='system'))throw Error('この操作は管理者のみ利用できます。');return who;}
    async function start(input){
      generation++;clearSubscriptions();if(authStop){authStop();authStop=null;}
      config=validateConfig(input);
      if(!config){emit({phase:'unconfigured',user:null,role:null,companyId:null,error:null});return;}
      emit({phase:'initializing',user:null,role:null,companyId:config.companyId,error:null});
      try{
        await driver.initialize(config.firebase);
        authStop=driver.observeAuth(async user=>{
          const ticket=++generation;clearSubscriptions();
          emit({phase:user?'authorizing':'signed-out',user:user?{uid:user.uid,email:user.email||''}:null,role:null,error:null});
          if(!user)return;
          try{
            const claims=await driver.claims(user);
            if(ticket!==generation)return;
            if(claims.companyId!==config.companyId||!['admin','staff'].includes(claims.role)){
              emit({phase:'denied',role:null,error:'この会社へのアクセス権が未設定です。管理者に確認してください。'});return;
            }
            emit({phase:'ready',role:claims.role,error:null});
          }catch(e){if(ticket===generation)emit({phase:'error',role:null,error:e.message});}
        },e=>{generation++;clearSubscriptions();emit({phase:'error',user:null,role:null,error:e.message});});
      }catch(e){emit({phase:'error',user:null,role:null,error:e.message});throw e;}
    }
    async function signIn(email,password){if(!config)throw Error('クラウド接続はまだ設定されていません。');if(!email||!password)throw Error('メールとパスワードを入力してください。');return driver.signIn(email.trim(),password);}
    async function signOut(){generation++;clearSubscriptions();emit({phase:'signed-out',user:null,role:null,error:null});try{await driver.signOut();}catch(e){emit({phase:'error',error:'ログアウトを完了できませんでした。再試行してください。'});throw e;}}
    function listen(name,id,onData,onError=()=>{}){
      const who=readable(name,id);if(id!==null)segment(id);
      const path=`companies/${who.companyId}/${name}`+(id===null?'':'/'+id);
      let active=true;
      const off=driver.listen(path,id===null,(value,meta)=>{if(active&&who.generation===generation)onData(value,meta);},err=>{if(active&&who.generation===generation)onError(err);});
      const stop=()=>{active=false;off();subscriptions.delete(stop);};subscriptions.add(stop);return stop;
    }
    async function put(name,id,payload,{operationId,expectedRevision=0}={}){
      const who=identity();scope(name);segment(id);segment(operationId);
      // Staff writes need the document-confirmation workflow in phase 2; fail closed in phase 1.
      if(who.role!=='admin'||name==='auditLogs')throw Error('この操作は許可されていません。');
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid revision');
      const serialized=canonical(payload);if(serialized.length>300000)throw Error('Record too large');
      const fingerprint=await driver.digest(canonical({name,id,payload,expectedRevision}));
      const path=`companies/${who.companyId}`;
      const recordPath=`${path}/${name}/${id}`,operationPath=`${path}/operations/${operationId}`,auditPath=`${path}/auditLogs/${operationId}`;
      const result=await driver.transaction(async tx=>{
        if(who.generation!==generation)throw Error('ログイン状態が変更されました。');
        const operation=await tx.get(operationPath);
        if(operation){if(operation.fingerprint!==fingerprint||operation.actorId!==who.uid)throw Error('Operation ID conflict');return {revision:operation.revision,replayed:true};}
        const existing=await tx.get(recordPath),revision=existing?.revision||0;
        if(revision!==expectedRevision)throw Error('別の端末で更新されています。再読込して確認してください。');
        if(who.generation!==generation)throw Error('ログイン状態が変更されました。');
        const next=revision+1,at=driver.timestamp();
        tx.set(recordPath,{schemaVersion:1,companyId:who.companyId,payload:JSON.parse(serialized),revision:next,createdBy:existing?.createdBy||who.uid,updatedBy:who.uid,updatedAt:at,lastOperationId:operationId});
        tx.set(operationPath,{actorId:who.uid,collection:name,recordId:id,fingerprint,revision:next,createdAt:at});
        tx.set(auditPath,{actorId:who.uid,action:'upsert',collection:name,recordId:id,operationId,revision:next,createdAt:at});
        return {revision:next,replayed:false};
      });
      if(who.generation!==generation)throw Error('ログイン状態が変更されました。操作履歴を確認してください。');
      return result;
    }
    return {start,signIn,signOut,listen,put,getState:()=>({...state}),dispose:()=>{generation++;clearSubscriptions();if(authStop)authStop();}};
  }
  return {COLLECTIONS,STAFF_READ,LOCAL_KEYS,validateConfig,readLegacy,backupLegacy,canonical,createClient};
});
