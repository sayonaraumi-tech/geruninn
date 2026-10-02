/* Scoped repository: atomic, revision-checked business writes with immutable audit. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TsukinowaCloudCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const COLLECTIONS=Object.freeze(['calendarLinks','estimates','projects','documents','sales','receivables','payments','expenses','suppliers','cashLedger','auditLogs','settings','bankTransactions','supplierTransactions','migrations']);
  const STAFF_READ=Object.freeze(['calendarLinks','estimates','projects','documents','sales','receivables','payments']);
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
    for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key&&!key.startsWith('tsukinowa_cloud_')&&(key.startsWith('tsukinowa_')||key.startsWith('chohyoLastSeq_')))raw[key]=storage.getItem(key);}
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
      emit({phase:'initializing',user:null,role:null,companyId:config.companyId,projectId:config.firebase.projectId,error:null});
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
    async function transact(operationId,command,planner){
      const who=identity();segment(operationId);
      const fingerprint=await driver.digest(canonical(command)),base=`companies/${who.companyId}`;
      const result=await driver.transaction(async tx=>{
        if(who.generation!==generation)throw Error('ログイン状態が変更されました。');
        const opPath=`${base}/operations/${operationId}`,previous=await tx.get(opPath);
        if(previous){if(previous.fingerprint!==fingerprint||previous.actorId!==who.uid)throw Error('Operation ID conflict');return previous.result;}
        const cache=new Map(),writes=[],legacyAudits=[],numberReservations=[];
        const read=async(name,id)=>{scope(name);segment(id);const path=`${base}/${name}/${id}`;if(!cache.has(path))cache.set(path,await tx.get(path));return cache.get(path);};
        const write=async(name,id,payload,action,expectedRevision)=>{
          if(name==='auditLogs')throw Error('Audit records are append-only');
          const old=await read(name,id);if(expectedRevision!==undefined&&(old?.revision||0)!==expectedRevision){const e=Error('別の端末で更新されています。クラウドの内容を確認してください。');e.code='conflict';throw e;}
          const clean=JSON.parse(canonical(payload));
          if(canonical(old?.payload??null)===canonical(clean))return old?.revision||0;
          if(writes.some(w=>w.name===name&&w.id===id))throw Error('Duplicate transaction target');
          const revision=(old?.revision||0)+1;writes.push({name,id,payload:clean,old,revision,action:action||(old?'update':'create')});return revision;
        };
        const archiveAudit=async(id,legacy)=>{if(who.role!=='admin')throw Error('管理者のみ');if(await read('auditLogs',id))return;legacyAudits.push({id,legacy:JSON.parse(canonical(legacy))});};
        const reserveUnique=async(key,result)=>{segment(key);const path=`${base}/operations/${key}`;if(await tx.get(path))throw Error("重複する旧請求書が既に取り込まれています。");numberReservations.push({path,result});};
        const reserveDocumentNumber=async(minute,documentId)=>{
          if(!/^\d{8}-\d{4}$/.test(minute))throw Error('Invalid numbering minute');
          segment(documentId);
          let sequence=1,invoiceNo,path;
          // Existing immutable operations provide a company-wide reservation namespace.
          // The reservation and formal snapshot commit in the same transaction.
          do{invoiceNo=minute+'-'+String(sequence).padStart(2,'0');path=`${base}/operations/documentNumber_${invoiceNo}`;if(!await tx.get(path))break;sequence++;}while(true);
          numberReservations.push({path,result:{documentId,invoiceNo,numberingMinute:minute,numberingSequence:sequence}});
          return {invoiceNo,numberingMinute:minute,numberingSequence:sequence};
        };
        const result=await planner({read,write,who,archiveAudit,reserveDocumentNumber,reserveUnique});
        if(who.generation!==generation)throw Error('ログイン状態が変更されました。');
        if(writes.length>30)throw Error('Transaction too large');
        if(!writes.length&&!legacyAudits.length)return result;
        const at=driver.timestamp();
        for(let i=0;i<writes.length;i++){
          const w=writes[i],auditId=operationId+'_'+i;
          tx.set(`${base}/${w.name}/${w.id}`,{schemaVersion:2,companyId:who.companyId,payload:w.payload,revision:w.revision,createdBy:w.old?.createdBy||who.uid,createdAt:w.old?.createdAt||w.old?.updatedAt||at,updatedBy:who.uid,updatedAt:at,lastOperationId:operationId,lastAuditId:auditId});
          tx.set(`${base}/auditLogs/${auditId}`,{userId:who.uid,timestamp:at,entityType:w.name,entityId:w.id,action:w.action,before:w.old?.payload??null,after:w.payload,operationId,...(w.name==='documents'?{documentId:w.id,oldStatus:w.old?.payload.status|| (w.old?'active':null),newStatus:w.payload.status||'active',reason:w.payload.reason||'',revisedFromDocumentId:w.payload.revisedFromDocumentId||'',duplicateOfDocumentId:w.payload.duplicateOfDocumentId||'',...(w.action==='historicalPdfImport'?{invoiceNo:w.payload.snapshot.invoiceNo,sourceFileName:w.payload.sourceFileName,sourceHash:w.payload.sourceHash,linkedSaleId:w.payload.saleId||'',whetherCreatedSale:w.payload.whetherCreatedSale}: {})}:{})});
        }
        for(const reservation of numberReservations)tx.set(reservation.path,{actorId:who.uid,fingerprint,result:reservation.result,createdAt:at});
        for(const a of legacyAudits)tx.set(`${base}/auditLogs/${a.id}`,{userId:who.uid,timestamp:at,entityType:'auditLogs',entityId:a.id,action:'migration',before:null,after:{legacy:a.legacy},operationId});
        tx.set(opPath,{actorId:who.uid,fingerprint,result:JSON.parse(canonical(result)),createdAt:at});
        return result;
      });
      if(who.generation!==generation)throw Error('ログイン状態が変更されました。');return result;
    }
    async function isDocumentNumberReserved(invoiceNo){
      const who=identity();segment(invoiceNo);
      return driver.transaction(async tx=>!!await tx.get(`companies/${who.companyId}/operations/documentNumber_${invoiceNo}`));
    }
    async function listRecords(name){const who=readable(name,null);if(!driver.list)throw Error('安全確認のため最新データを取得できません。再読込してください。');return driver.list(`companies/${who.companyId}/${name}`);}
    async function put(name,id,payload,{operationId,expectedRevision=0}={}){
      if(identity().role!=='admin'||name==='auditLogs')throw Error('この操作は許可されていません。');
      return transact(operationId,{name,id,payload,expectedRevision},async({read,write})=>{
        const old=await read(name,id);const revision=await write(name,id,payload,undefined,expectedRevision);return {revision,replayed:!!old&&canonical(old.payload)===canonical(payload)};
      });
    }
    return {start,signIn,signOut,listen,listRecords,put,transact,isDocumentNumberReserved,digest:driver.digest,getState:()=>({...state}),dispose:()=>{generation++;clearSubscriptions();if(authStop)authStop();}};
  }
  return {COLLECTIONS,STAFF_READ,LOCAL_KEYS,validateConfig,readLegacy,backupLegacy,canonical,createClient};
});
