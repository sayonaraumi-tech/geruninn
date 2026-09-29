/* Bridge existing screens to the shared repository. Legacy originals remain recoverable. */
(function(root){
'use strict';
const el=id=>document.getElementById(id),uuid=()=>crypto.randomUUID(),copy=x=>JSON.parse(JSON.stringify(x));
let enabled=false,sync=null,client=null,identity='',rows={},history=[],docId='',docRevision=0,applying=false,lastStatus={},timer=null,pendingInvoice=null;
const original={};
for(const name of ['collectFormState','applyFormState','setDocType','saveConfirmedHistory','loadConfirmedHistory','writeConfirmedHistory','deleteConfirmedHistory','bizPersist','bizAudit','bizAcceptEstimate','bizConvertEstimateRecordToInvoice','convertEstimateToInvoice','bizRegisterEstimatePayment','addPayment','selectSaleForPayment','matchBankSale','bizGoogleMergeEvent','bizGooglePatchNow','bizLoadDocFromEvent','bizSwitchPage','openManualSale','doPrint','onodaStorageKey','saveOnodaDraft','restoreOnodaDraft','importBackup','bizEstimateFromHistory'])original[name]=root[name];
function ready(){if(!sync||client?.getState().phase!=='ready'){alert('クラウドアカウントにログインしてください。端末内の原本は保持されています。');return false;}return true;}
function command(value){if(!ready())return;try{return sync.enqueue({...value,operationId:value.operationId||uuid()});}catch(e){showError(e.message);return null;}}
function showError(message){el('cloudError').textContent=message;el('coreSyncStatus').textContent='同期エラー';}
function status(value){lastStatus=value;el('coreSyncStatus').textContent=({synced:'クラウド同期済',syncing:'同期中',offline:'オフライン',error:'同期エラー'})[value.state]||'';el('cloudRealtime').textContent=(value.pending?`未同期 ${value.pending}件。`:'')+(value.error||'');el('cloudRetryQueue').hidden=!value.error;el('cloudArchiveQueue').hidden=!sync?.getQueue()[0]?.blocked;}
function receiptOptions(){const select=el('receiptSale');if(!select)return;const value=select.value;select.replaceChildren(new Option('対象請求書を選択',''));for(const s of bizState.sales)select.add(new Option(`${s.customer} / ${s.invoiceNo||s.documentId||s.id} / 未収 ${bizMoney(bizOutstanding(s))}`,s.id));select.value=value;el('cloudReceiptFields').hidden=!enabled||docType!=='receipt';}
function hydrate(value){
 rows=value;applying=true;
 try{
  for(const [key,name] of [['estimates','estimates'],['projects','projects'],['sales','sales'],['payments','payments'],['calendar','calendarLinks']])bizState[key]=(value[name]||[]).map(r=>({...copy(r.payload),id:r.id}));
  bizState.audit=(value.auditLogs||[]).map(r=>({id:r.id,at:r.timestamp?.seconds?new Date(r.timestamp.seconds*1000).toISOString():'',user:r.userId,action:r.action,detail:r.entityType+' / '+r.entityId,before:r.before,after:r.after}));
  history=(value.documents||[]).map(r=>({...copy(r.payload.snapshot),documentId:r.id,historyId:r.id,cloudRevision:r.revision,savedAt:r.updatedAt?.seconds?new Date(r.updatedAt.seconds*1000).toISOString():''})).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  bizRefreshAll();renderConfirmedHistory();receiptOptions();
 }finally{applying=false;}
 completePendingInvoice();
}
function completePendingInvoice(){if(pendingInvoice&&bizState.estimates.some(e=>e.id===pendingInvoice&&e.status==='受注')){const id=pendingInvoice;pendingInvoice=null;setTimeout(()=>bizConvertEstimateRecordToInvoice(id),0);}}
function download(value,name,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
root.collectFormState=function(){const s=original.collectFormState();if(!docId)docId='doc_'+uuid();if(enabled&&s.docType==='onoda'&&!docRevision)docId=history.find(h=>h.docType==='onoda'&&h.invoiceDate?.slice(0,7)===s.invoiceDate?.slice(0,7))?.documentId||'onoda_'+s.invoiceDate.slice(0,7);return {...s,_cloudIdentity:identity,documentId:docId,cloudRevision:docRevision,...(enabled&&docType==='receipt'?{saleId:el('receiptSale')?.value||'',paymentDate:el('receiptPaymentDate')?.value||''}:{})};};
root.setDocType=function(type){if(!_simpleRestoring){docId='doc_'+uuid();docRevision=0;}const r=original.setDocType(type);receiptOptions();return r;};
root.applyFormState=function(s,type){original.applyFormState(s,type);docId=s.documentId||(enabled?'doc_'+uuid():'legacy_'+encodeURIComponent(s.historyId||uuid()));docRevision=s.cloudRevision||0;receiptOptions();if(el('receiptSale'))el('receiptSale').value=s.saleId||'';if(el('receiptPaymentDate'))el('receiptPaymentDate').value=s.paymentDate||todayISO();};
root.loadConfirmedHistory=function(){return enabled?history:original.loadConfirmedHistory();};
root.writeConfirmedHistory=function(value){if(!enabled)return original.writeConfirmedHistory(value);throw Error('共有帳票は正式保存から更新してください。');};
root.deleteConfirmedHistory=function(index){if(!enabled)return original.deleteConfirmedHistory(index);alert('正式帳票は削除できません。訂正は元の帳票を開いて保存してください。');};
root.saveConfirmedHistory=function(captured){
 if(!enabled)return original.saveConfirmedHistory(captured);
 if(!ready()||_simpleArchiveMode)return;
 const snapshot=captured||collectFormState();
 if(snapshot._cloudIdentity!==identity){alert('アカウントが変更されたため、この帳票は保存していません。元のアカウントで開き直してください。');return;}
 if(!snapshot.customerName?.trim()){alert('顧客名を入力してください。');return;}
 if(snapshot.docType==='receipt'&&(!snapshot.saleId||!snapshot.paymentDate)){alert('領収書の対象請求書と入金日を選択してください。');return;}
 // Duplicate clicks use the same queued command. A later edit gets its own revision check.
 const clean=root.TsukinowaBusiness.cleanSnapshot(snapshot);
 if(sync.getQueue().some(x=>x.command.type==='saveDocument'&&root.TsukinowaCloudCore.canonical(x.command.snapshot)===root.TsukinowaCloudCore.canonical(clean)))return;
 command({type:'saveDocument',snapshot:clean,expectedRevision:snapshot.cloudRevision||0});
};
root.doPrint=function(){if(enabled&&!ready())return;return original.doPrint();};
root.onodaStorageKey=function(month){if(!enabled)return original.onodaStorageKey(month);return 'tsukinowa_cloud_onoda_'+identity.replaceAll('/','_')+'_'+month;};
root.saveOnodaDraft=function(){if(enabled&&!sync)return;return original.saveOnodaDraft();};
root.restoreOnodaDraft=function(){if(!enabled)return original.restoreOnodaDraft();if(!sync)return;const saved=history.find(h=>h.docType==='onoda'&&h.invoiceDate?.slice(0,7)===currentMonthKey());if(saved&&!localStorage.getItem(onodaStorageKey(currentMonthKey())))return applyFormState(saved,'onoda');return original.restoreOnodaDraft();};
root.importBackup=function(){if(!enabled)return original.importBackup();alert('共有モードでは一括置換できません。旧データの移行ボタンを使用してください。元データは削除しません。');};
root.bizEstimateFromHistory=function(id){original.bizEstimateFromHistory(id);if(enabled){const e=bizState.estimates.find(x=>x.id===id);if(e){bizCurrentEstimateId=id;bizCurrentProjectId=e.projectId||'';bizCurrentCalendarId=e.calendarEventId||'';}}};
root.bizPersist=function(){if(!enabled)return original.bizPersist();if(applying||!sync)return;
 // Only out-of-scope legacy modules remain local. Never serialize cloud core over the legacy migration source.
 try{const who=client.getState();localStorage.setItem(`tsukinowa_cloud_local_${who.projectId}_${who.companyId}_${who.user.uid}`,JSON.stringify({expenses:bizState.expenses,bank:bizState.bank}));}catch(e){showError('端末内データ保存に失敗しました。');}
};
root.bizAudit=function(a,d){if(!enabled)return original.bizAudit(a,d);};
root.bizAcceptEstimate=function(id,invoice=false){if(!enabled)return original.bizAcceptEstimate(id,invoice);if(!ready())return;const workDate=prompt('施工日 YYYY-MM-DD（未定なら空欄）','');if(workDate===null)return;command({type:'acceptEstimate',estimateId:id,workDate,expectedRevision:sync.getRevision('estimates',id),openInvoice:invoice});};
root.bizConvertEstimateRecordToInvoice=function(id){if(!enabled)return original.bizConvertEstimateRecordToInvoice(id);if(!ready())return;const estimate=bizState.estimates.find(x=>x.id===id);if(!estimate)return;if(estimate.status!=='受注')return bizAcceptEstimate(id,true);original.bizConvertEstimateRecordToInvoice(id);const existing=bizState.sales.find(s=>s.estimateId===id||(estimate.calendarEventId&&s.calendarEventId===estimate.calendarEventId));docId=existing?.documentId||'invoice_'+id;docRevision=sync.getRevision('documents',docId);};
root.convertEstimateToInvoice=function(){if(!enabled)return original.convertEstimateToInvoice();if(!bizCurrentEstimateId)return alert('先に見積を正式保存して、見積履歴から受注してください。');bizConvertEstimateRecordToInvoice(bizCurrentEstimateId);};
root.bizRegisterEstimatePayment=function(id){if(!enabled)return original.bizRegisterEstimatePayment(id);const sale=bizState.sales.find(x=>x.estimateId===id);if(sale)return selectSaleForPayment(sale.id);alert('対象請求書を正式保存してから入金を登録してください。見積だけでは売上を作成しません。');};
root.addPayment=function(){if(!enabled)return original.addPayment();const amount=Number(el('paymentAmount').value);if(!amount||!el('paymentSale').value)return alert('対象請求書と入金額を確認してください。');if(command({type:'payment',paymentId:'pay_'+uuid(),saleId:el('paymentSale').value,amount,paymentDate:el('paymentDate').value,method:el('paymentType').value,memo:el('paymentMemo').value})){el('paymentAmount').value='';el('paymentMemo').value='';}};
root.selectSaleForPayment=function(id){if(!enabled)return original.selectSaleForPayment(id);if(!ready())return;const sale=bizState.sales.find(x=>x.id===id);if(!sale)return;setDocType('receipt');el('receiptSale').value=id;el('customerName').value=sale.customer;el('receiptTotal').value=bizOutstanding(sale);el('receiptPaymentDate').value=todayISO();el('paymentMethod').value='現金';bizSwitchPage('chohyo');recalc();};
root.matchBankSale=function(bankId,saleId){if(!enabled)return original.matchBankSale(bankId,saleId);if(!ready()||client.getState().role!=='admin')return;const b=bizState.bank.find(x=>x.id===bankId);if(!b)return;const pending=bizState.payments.filter(p=>p.saleId===saleId&&p.confirmation==='pending-bank'&&p.amount===b.incoming);if(pending.length>1)return alert('同額の仮入金が複数あります。照合前に管理者が確認してください。');command({type:'confirmBank',bankId:b.key||bankId,localBankId:bankId, saleId,amount:b.incoming,paymentDate:b.date,pendingPaymentId:pending[0]?.id||''});};
root.openManualSale=function(){if(!enabled)return original.openManualSale();alert('売上は請求書の正式保存から登録してください。');};
root.bizGoogleMergeEvent=function(e){if(!enabled)return original.bizGoogleMergeEvent(e);if(!ready())throw Error('クラウドにログインしてください。');const exists=bizState.calendar.some(x=>x.googleEventId===e.googleEventId);command({type:'calendar',event:copy(e)});return exists?'updated':'added';};
root.bizLoadDocFromEvent=function(e,type){if(!enabled)return original.bizLoadDocFromEvent(e,type);if(!ready())return;original.bizLoadDocFromEvent(e,type);if(!docRevision&&type!=='receipt'){docId=type+'_'+e.id;docRevision=sync.getRevision('documents',docId);}if(type==='receipt'){const sale=bizState.sales.find(x=>x.calendarEventId===e.id);if(sale)el('receiptSale').value=sale.id;}};
root.bizGooglePatchNow=async function(id){if(!enabled)return original.bizGooglePatchNow(id);if(!sync)return;const revision=sync.getRevision('calendarLinks',id);await original.bizGooglePatchNow(id);const e=bizState.calendar.find(x=>x.id===id);if(e&&!e.googlePatchPending)command({type:'calendarPatched',id,expectedRevision:revision,at:e.googlePatchedAt});};
root.bizSwitchPage=function(page){if(enabled&&client?.getState().role==='staff'&&!['calendar','estimates','chohyo','savedDocs'].includes(page))page='calendar';return original.bizSwitchPage(page);};
function patchPending(){if(!sync||!navigator.onLine||bizGoogleNeedToken())return;for(const e of bizState.calendar.filter(x=>x.googlePatchPending&&x.googleEventId))if(!bizGooglePatchJobs.has(e.id))bizGooglePatchEvent(e);}
function clearView(){pendingInvoice=null;history=[];rows={};for(const key of ['estimates','projects','sales','payments','calendar','audit','expenses','bank'])bizState[key]=[];applying=true;try{bizRefreshAll();renderConfirmedHistory();docType='invoice';resetNormalFormBlank();if(el('bizJobMemo'))el('bizJobMemo').value='';if(el('receiptSale'))el('receiptSale').value='';docId='';docRevision=0;bizClearDocLink();}finally{applying=false;}}
root.TsukinowaBusinessUI={
 configure(value){const changed=enabled!==value;enabled=value;if(enabled){if(changed)clearView();el('coreSyncStatus').textContent='ログイン待ち';}else el('coreSyncStatus').textContent='端末内保存';},
 auth(state,instance){client=instance;const next=state.phase==='ready'?`${state.projectId}/${state.companyId}/${state.user.uid}/${state.role}`:'';
  // The core removes listeners on every token refresh, so rebuild once per auth-ready transition.
  if(sync){sync.stop();sync=null;}clearInterval(timer);const previousIdentity=identity;if(next)identity=next;
  if(!enabled)return;
  if((next&&next!==previousIdentity)||(!next&&state.phase!=='authorizing'))clearView();el('cloudMigration').hidden=state.role!=='admin';
  for(const b of document.querySelectorAll('#bizNav button'))b.hidden=state.role==='staff'&&!['calendar','estimates','chohyo','savedDocs'].includes(b.dataset.page);
  if(!next){if(state.phase!=='authorizing')identity='';el('coreSyncStatus').textContent=state.phase==='error'?'同期エラー':'ログイン待ち';return;}
  try{const local=JSON.parse(localStorage.getItem(`tsukinowa_cloud_local_${state.projectId}_${state.companyId}_${state.user.uid}`)||'{}');bizState.expenses=local.expenses||[];bizState.bank=local.bank||[];
   sync=root.TsukinowaSync.createSync({client,storage:localStorage,online:()=>navigator.onLine,onData:hydrate,onStatus:status,onCommitted:(cmd,result)=>{
    if(cmd.type==='saveDocument'&&result.documentId===docId)docRevision=result.revision;
    if(cmd.type==='acceptEstimate'&&cmd.openInvoice){pendingInvoice=cmd.estimateId;completePendingInvoice();}
    if(cmd.type==='confirmBank'){const b=bizState.bank.find(x=>x.id===cmd.localBankId);if(b){b.matched=true;b.matchType='sale';b.matchId=cmd.saleId;bizPersist();}}
    setTimeout(patchPending,300);
   }});sync.start();timer=setInterval(()=>{sync?.flush();patchPending();},15000);if(state.role==='staff')bizSwitchPage('calendar');
  }catch(e){showError(e.message);}
 },getSync:()=>sync,isEnabled:()=>enabled
};
document.addEventListener('DOMContentLoaded',()=>{
 const badge=document.createElement('span');badge.id='coreSyncStatus';badge.setAttribute('role','status');badge.textContent='端末内保存';el('bizCloudAccountButton').prepend(badge);badge.style.cssText='display:block;font-size:10px;font-weight:normal';
 const controls=document.createElement('div');controls.innerHTML='<div id="cloudMigration" hidden><button class="biz-btn" id="cloudMigrate">旧データを安全に移行</button><p id="cloudMigrationStatus" role="status"></p></div><button class="biz-btn" id="cloudExport">共有データ・未同期をJSON出力</button> <button class="biz-btn" id="cloudCSV">売上CSV</button><button class="biz-btn" id="cloudRetryQueue" hidden>同期を再試行</button><button class="biz-btn" id="cloudArchiveQueue" hidden>競合を保管して次の同期へ</button>';
 el('cloudDialog').append(controls);
 const receipt=document.createElement('div');receipt.id='cloudReceiptFields';receipt.hidden=true;receipt.className='biz-field';receipt.innerHTML='<label for="receiptSale">対象請求書（部分入金可）</label><select id="receiptSale"></select><label for="receiptPaymentDate">入金日</label><input id="receiptPaymentDate" type="date">';el('receiptTotal').parentElement.append(receipt);
 const save=document.createElement('button');save.type='button';save.className='biz-btn primary';save.textContent='正式保存';save.onclick=()=>saveConfirmedHistory();el('pageChohyo').prepend(save);
 el('receiptPaymentDate').value=todayISO();
 el('cloudMigrate').onclick=async()=>{if(!ready())return;el('cloudMigrate').disabled=true;try{await root.TsukinowaSync.migrateLegacy({client,storage:localStorage,onStatus:t=>el('cloudMigrationStatus').textContent=t});}catch(e){el('cloudMigrationStatus').textContent='移行失敗：'+e.message+'（元データ保持）';}finally{el('cloudMigrate').disabled=false;}};
 el('cloudExport').onclick=()=>{if(ready())download({exportedAt:new Date().toISOString(),records:rows,pending:sync.getQueue()},'tsukinowa-cloud-backup.json');};
 el('cloudCSV').onclick=()=>{if(!ready())return;const q=x=>'"'+String(x??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';const data=[['documentId','顧客','売上日','請求日','請求額','入金済','未収'],...bizState.sales.map(s=>[s.documentId,s.customer,s.salesDate,s.invoiceDate,s.amount,bizPaid(s),bizOutstanding(s)])];download('\ufeff'+data.map(r=>r.map(q).join(',')).join('\r\n'),'sales.csv','text/csv;charset=utf-8');};
 el('cloudRetryQueue').onclick=()=>sync?.flush();el('cloudArchiveQueue').onclick=()=>{if(confirm('競合した未同期内容を端末に保管し、クラウドの正式データを優先します。保管内容はJSON出力で取得できます。')){const key=sync?.archiveBlocked();if(key)download(JSON.parse(localStorage.getItem(key)),'tsukinowa-conflict.json');sync?.flush();}};
 window.addEventListener('online',()=>sync?.flush());window.addEventListener('offline',()=>sync?.flush());
});
})(window);
