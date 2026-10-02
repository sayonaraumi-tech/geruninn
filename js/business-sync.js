(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./cloud-core.js'):root.TsukinowaCloudCore,typeof module==='object'&&module.exports?require('./business-domain.js'):root.TsukinowaBusiness);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaSync=api;})(globalThis,function(core,domain){
'use strict';
function createSync({client,storage,onData=()=>{},onStatus=()=>{},onCommitted=()=>{},online=()=>true}){
 const who=client.getState(),collections=domain.COLLECTIONS.filter(n=>who.role==='admin'||core.STAFF_READ.includes(n)),service=domain.createService(client),prefix=`tsukinowa_cloud_v2_${who.projectId}_${who.companyId}_${who.user.uid}_`,queueKey=prefix+'outbox';
 let stopped=false,running=null,error=null;const stops=[],rows={},serverSeen=new Set();let queue=[];
 function load(key,fallback){const raw=storage.getItem(key);if(!raw)return fallback;try{return JSON.parse(raw);}catch(e){throw Error('端末内の同期データを読み込めません。元データを保護して同期を停止しました。');}}
 queue=load(queueKey,[]);for(const name of collections)rows[name]=load(prefix+name,[]);
 function status(){onStatus({state:error?'error':!online()?'offline':queue.length||serverSeen.size<collections.length?'syncing':'synced',error,pending:queue.length,ready:serverSeen.size===collections.length});}
 function saveQueue(){storage.setItem(queueKey,JSON.stringify(queue));}
 function start(){onData(rows);for(const name of collections)stops.push(client.listen(name,null,(value,meta)=>{
   if(stopped)return;
   if(!meta?.fromCache){serverSeen.add(name);rows[name]=value;try{storage.setItem(prefix+name,JSON.stringify(value));}catch(e){error='キャッシュ保存に失敗しました。クラウドデータは保持されています。';}onData(rows);}
   else if(value.length){rows[name]=value;onData(rows);}
   status();
 },e=>{if(!stopped){if(name==='receivables'&&String(e.code||'').includes('permission-denied')){rows[name]=[];serverSeen.add(name);onData(rows);status();return;}error=e.message;status();}}));status();flush();}
 function enqueue(command){
   if(stopped)throw Error('ログイン状態が変更されました。');
   if(queue.some(x=>x.command.operationId===command.operationId))return command.operationId;
   const entry={command:JSON.parse(core.canonical(command)),createdAt:new Date().toISOString()};
   const next=[...queue,entry];storage.setItem(queueKey,JSON.stringify(next));queue=next;error=null;status();flush();return command.operationId;
 }
 function flush(){
  if(running)return running;if(stopped||!online()||!queue.length){status();return Promise.resolve();}
  running=(async()=>{
   while(queue.length&&!stopped&&online()){
    const item=queue[0];if(item.blocked){error=item.error;break;}
    try{const result=await service.execute(item.command);if(stopped)return;
      // Persist removal before issuing the next command. Replaying a committed operation is safe after a quota failure.
      const next=queue.slice(1);storage.setItem(queueKey,JSON.stringify(next));queue=next;error=null;onCommitted(item.command,result);
    }catch(e){
      if(stopped)return;
      const transient=['unavailable','deadline-exceeded','cancelled','network-request-failed'].some(x=>String(e.code||'').includes(x))||!online();
      error=e.message||'同期エラー';
      if(!transient){item.blocked=true;item.error=error;try{saveQueue();}catch(_){} }
      break;
    }
   }
  })().finally(()=>{running=null;if(!stopped)status();});status();return running;
 }
 function archiveBlocked(){if(!queue[0]?.blocked)return;const key=prefix+'conflicts_'+Date.now();storage.setItem(key,JSON.stringify(queue[0]));const next=queue.slice(1);storage.setItem(queueKey,JSON.stringify(next));queue=next;error=null;status();return key;}
 return {start,enqueue,flush,archiveBlocked,getRows:()=>rows,getQueue:()=>queue.map(x=>JSON.parse(JSON.stringify(x))),getRevision:(name,id)=>rows[name]?.find(r=>r.id===id)?.revision||0,stop:()=>{stopped=true;for(const stop of stops)stop();},service};
}
async function migrateLegacy({client,storage,onStatus=()=>{}}){
 if(client.getState().role!=='admin')throw Error('移行は管理者のみ実行できます。');
 const service=domain.createService(client),backup=core.backupLegacy(storage);if(backup.errors.length)throw Error('旧データに読込エラーがあります。原本を修復・確認してから移行してください。');
 const sourceHash=await client.digest(core.canonical(backup.raw)),sourceId='v2_'+sourceHash.slice(0,48),backupKey='tsukinowa_cloud_backup_'+sourceId;
 // A verified raw backup must be durable before any Firestore request is issued.
 const encoded=JSON.stringify(backup);if(!storage.getItem(backupKey))storage.setItem(backupKey,encoded);if(!storage.getItem(backupKey))throw Error('バックアップを保存できません。移行は開始していません。');
 const stateKey='tsukinowa_cloud_migration_'+client.getState().companyId+'_'+sourceId;
 storage.setItem(stateKey,JSON.stringify({migrationVersion:2,status:'running',backupKey}));onStatus('移行中（元データとバックアップを保持）');
 try{
  const existing=await service.execute({type:'migrationStatus',operationId:'check_'+sourceId,sourceId});if(existing?.migrationVersion===2&&existing.completed){storage.setItem(stateKey,JSON.stringify({migrationVersion:2,status:'success',backupKey,count:existing.count}));onStatus('移行済（重複インポートなし）');return {...existing,skipped:true};}
  const records=[],maps={documents:new Map(),estimates:new Map(),projects:new Map(),calendar:new Map(),sales:new Map()};
  const biz=backup.business;
  const stable=service.stable;
  for(const doc of backup.documents){if(!doc.historyId&&!doc.documentId)throw Error('IDのない旧帳票があります。移行を中止しました。');const id=doc.documentId||await stable('doc','legacy:'+doc.historyId);maps.documents.set(doc.historyId||doc.documentId,id);}
  for(const [key,rows] of [['estimates',biz.estimates||[]],['projects',biz.projects||[]],['calendar',biz.calendar||[]],['sales',biz.sales||[]]])for(const row of rows){if(!row.id)throw Error('IDのない旧レコードがあります。');let id;
    if(key==='calendar')id=await service.eventId(row);
    else if(key==='sales'&&maps.documents.has(row.sourceId))id='sale_'+maps.documents.get(row.sourceId);
    else if(key==='estimates'&&maps.documents.has(row.historyId))id='est_'+maps.documents.get(row.historyId);
    else id=await stable(key,'legacy:'+row.id);
    maps[key].set(row.id,id);
  }
  const links=row=>({calendarEventId:maps.calendar.get(row.calendarEventId)||'',projectId:maps.projects.get(row.projectId)||'',estimateId:maps.estimates.get(row.estimateId)||''});
  for(const row of backup.documents){const id=maps.documents.get(row.historyId||row.documentId);const snapshot={...row,...links(row),documentId:id};delete snapshot.historyId;
    const sale=(biz.sales||[]).find(x=>x.sourceId===row.historyId),pay=(biz.payments||[]).find(x=>x.sourceId===row.historyId);
    if(pay){snapshot.saleId=maps.sales.get(pay.saleId)||'';snapshot.paymentDate=pay.paymentDate||pay.date||row.invoiceDate||'';}
    const clean=domain.cleanSnapshot(snapshot);records.push(['documents',id,{documentId:id,docType:row.docType,snapshot:clean,amount:domain.total(row),customerName:row.customerName||'',salesDate:row.salesDate||sale?.saleDate||row.invoiceDate||'',invoiceDate:row.invoiceDate||'',paymentDate:snapshot.paymentDate||'',confirmed:true,...links(row)}]);
  }
  for(const row of biz.estimates||[]){const id=maps.estimates.get(row.id),documentId=maps.documents.get(row.historyId)||'';records.push(['estimates',id,{...row,...links(row),id,documentId,historyId:documentId||row.historyId||''}]);}
  for(const row of biz.projects||[]){const id=maps.projects.get(row.id);records.push(['projects',id,{...row,...links(row),id}]);}
  for(const row of biz.sales||[]){const id=maps.sales.get(row.id),documentId=maps.documents.get(row.sourceId)||'';records.push(['sales',id,{...row,...links(row),id,documentId,sourceId:documentId||row.sourceId||'',salesDate:row.salesDate||row.saleDate||'',invoiceDate:row.invoiceDate||''}]);}
  for(const row of biz.payments||[]){if(!row.id)throw Error('IDのない入金があります。');const docId=maps.documents.get(row.sourceId),id=docId?'pay_'+docId:await stable('pay','legacy:'+row.id);records.push(['payments',id,{...row,id,paymentId:id,documentId:docId||'',saleId:maps.sales.get(row.saleId)||row.saleId||'',paymentDate:row.paymentDate||row.date||'',confirmation:row.bankId?'bank-confirmed':row.method==='現金'?'cash-received':'pending-bank'}]);}
  for(const row of biz.calendar||[]){const id=maps.calendar.get(row.id);records.push(['calendarLinks',id,{...row,id,calendarId:row.googleCalendarId||row.calendarId||'',projectId:maps.projects.get(row.projectId)||'',estimateId:maps.estimates.get(row.linkedEstimateId)||'',linkedEstimateId:maps.estimates.get(row.linkedEstimateId)||'',linkedInvoiceId:maps.documents.get(row.linkedInvoiceId)||'',linkedReceiptId:maps.documents.get(row.linkedReceiptId)||'',documentId:maps.documents.get(row.linkedInvoiceId)||maps.documents.get(row.linkedReceiptId)||''}]);}
  // Preserve old audit content separately from the trusted importing user's identity/time.
  for(const [i,legacy] of (biz.audit||[]).entries()){const id=await stable('legacy_audit',legacy.id||core.canonical(legacy));await service.execute({type:'migrateAudit',operationId:await stable('miglog',sourceId+id+client.getState().user.uid),id,legacy});}
  let done=0;for(const [collection,id,payload] of records){await service.execute({type:'migrateRecord',operationId:await stable('mig',sourceId+collection+id+client.getState().user.uid),collection,id,payload});onStatus(`移行中 ${++done}/${records.length}（既存のクラウド記録は上書きしません）`);}
  await service.execute({type:'migrationComplete',operationId:await stable('done',sourceId+client.getState().user.uid),sourceId,count:records.length,backupKey});
  storage.setItem(stateKey,JSON.stringify({migrationVersion:2,status:'success',backupKey,count:records.length}));onStatus('移行成功（元データ・バックアップ保持）');return {sourceId,count:records.length,backupKey};
 }catch(e){try{storage.setItem(stateKey,JSON.stringify({migrationVersion:2,status:'failed',backupKey,error:e.message}));}catch(_){}onStatus('移行失敗：'+e.message+'（元データは保持されています）');throw e;}
}
return {createSync,migrateLegacy};
});
