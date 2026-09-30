/* Bridge existing screens to the shared repository. Legacy originals remain recoverable. */
(function(root){
'use strict';
const el=id=>document.getElementById(id),uuid=()=>crypto.randomUUID(),copy=x=>JSON.parse(JSON.stringify(x));
let enabled=false,sync=null,client=null,identity='',rows={},history=[],docId='',docRevision=0,applying=false,lastStatus={},timer=null,pendingInvoice=null,revisionSource=null,formBase={};
const original={};
for(const name of ['collectFormState','applyFormState','setDocType','saveConfirmedHistory','loadConfirmedHistory','writeConfirmedHistory','deleteConfirmedHistory','bizPersist','bizAudit','bizAcceptEstimate','bizConvertEstimateRecordToInvoice','convertEstimateToInvoice','bizRegisterEstimatePayment','addPayment','selectSaleForPayment','matchBankSale','bizGoogleMergeEvent','bizGooglePatchNow','bizLoadDocFromEvent','bizSwitchPage','openManualSale','doPrint','onodaStorageKey','saveOnodaDraft','restoreOnodaDraft','importBackup','bizEstimateFromHistory','renderAllSavedDocs','renderConfirmedHistory'])original[name]=root[name];
function ready(){if(!sync||client?.getState().phase!=='ready'){alert('クラウドアカウントにログインしてください。端末内の原本は保持されています。');return false;}return true;}
function command(value){if(!ready())return;try{return sync.enqueue({...value,operationId:value.operationId||uuid()});}catch(e){showError(e.message);return null;}}
function showError(message){el('cloudError').textContent=message;el('coreSyncStatus').textContent='同期エラー';}
function status(value){lastStatus=value;el('coreSyncStatus').textContent=({synced:'クラウド同期済',syncing:'同期中',offline:'オフライン',error:'同期エラー'})[value.state]||'';el('cloudRealtime').textContent=(value.pending?`未同期 ${value.pending}件。`:'')+(value.error||'');el('cloudRetryQueue').hidden=!value.error;el('cloudArchiveQueue').hidden=!sync?.getQueue()[0]?.blocked;}
function receiptOptions(){const select=el('receiptSale');if(!select)return;const value=select.value;select.replaceChildren(new Option('対象請求書を選択',''));for(const s of bizState.sales)select.add(new Option(`${s.customer} / ${s.invoiceNo||s.documentId||s.id} / 未収 ${bizMoney(bizOutstanding(s))}`,s.id));select.value=value;el('cloudReceiptFields').hidden=!enabled||docType!=='receipt';}
function hydrate(value){
 rows=value;root.TsukinowaAccountingUI?.hydrate(value);applying=true;
 try{
  for(const [key,name] of [['estimates','estimates'],['projects','projects'],['sales','sales'],['payments','payments'],['calendar','calendarLinks']])bizState[key]=(value[name]||[]).map(r=>({...copy(r.payload),id:r.id})).filter(r=>!r.deletedAt&&(!['sales','estimates'].includes(key)||root.TsukinowaAccounting.live(r)));
  bizState.audit=(value.auditLogs||[]).map(r=>({id:r.id,at:r.timestamp?.seconds?new Date(r.timestamp.seconds*1000).toISOString():'',user:r.userId,action:r.action,detail:r.entityType+' / '+r.entityId,before:r.before,after:r.after}));
  history=(value.documents||[]).filter(r=>!root.TsukinowaTestCleanup.removed(r.payload)).map(r=>({...copy(r.payload.snapshot),documentId:r.id,historyId:r.id,cloudRevision:r.revision,documentStatus:r.payload.status||'active',statusReason:r.payload.reason||'',revisedFromDocumentId:r.payload.revisedFromDocumentId||'',duplicateOfDocumentId:r.payload.duplicateOfDocumentId||'',revisedToDocumentId:r.payload.revisedToDocumentId||'',savedAt:r.createdAt?.seconds?new Date(r.createdAt.seconds*1000).toISOString():''})).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  bizRefreshAll();renderConfirmedHistory();receiptOptions();
 }finally{applying=false;}
 completePendingInvoice();
}
function completePendingInvoice(){if(pendingInvoice&&bizState.estimates.some(e=>e.id===pendingInvoice&&e.status==='受注')){const id=pendingInvoice;pendingInvoice=null;setTimeout(()=>bizConvertEstimateRecordToInvoice(id),0);}}
function download(value,name,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
root.collectFormState=function(){const s=original.collectFormState();if(!docId)docId='doc_'+uuid();if(enabled&&s.docType==='onoda'&&!docRevision&&!revisionSource)docId=history.find(h=>h.documentStatus==='active'&&h.docType==='onoda'&&h.invoiceDate?.slice(0,7)===s.invoiceDate?.slice(0,7))?.documentId||'onoda_'+s.invoiceDate.slice(0,7);return {...formBase,...(revisionSource?.snapshot||{}),...s,customerCompany:el('customerCompany')?.value||'',customerAddress:el('customerAddress')?.value||'',_cloudIdentity:identity,documentId:docId,cloudRevision:docRevision,...(enabled&&docType==='receipt'?{saleId:el('receiptSale')?.value||'',paymentDate:el('receiptPaymentDate')?.value||''}:{})};};
root.setDocType=function(type){if(!_simpleRestoring){revisionSource=null;formBase={};for(const k of ['customerCompany','customerAddress'])if(el(k))el(k).value='';docId='doc_'+uuid();docRevision=0;}const r=original.setDocType(type);if(el('onodaRegenerate'))el('onodaRegenerate').hidden=type!=='onoda';receiptOptions();return r;};
root.applyFormState=function(s,type){revisionSource=null;formBase=copy(s);original.applyFormState(s,type);docId=s.documentId||(enabled?'doc_'+uuid():'legacy_'+encodeURIComponent(s.historyId||uuid()));docRevision=s.cloudRevision||0;for(const k of ['customerCompany','customerAddress'])if(el(k))el(k).value=s[k]||'';receiptOptions();if(el('receiptSale'))el('receiptSale').value=s.saleId||'';if(el('receiptPaymentDate'))el('receiptPaymentDate').value=s.paymentDate||todayISO();};
root.loadConfirmedHistory=function(){return enabled?history:original.loadConfirmedHistory();};
root.writeConfirmedHistory=function(value){if(!enabled)return original.writeConfirmedHistory(value);throw Error('共有帳票は正式保存から更新してください。');};
root.deleteConfirmedHistory=function(index){alert('正式帳票は削除できません。管理者が無効化または訂正版を作成してください。');};
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
 const previous=history.find(h=>h.documentId===clean.documentId);if(previous){const stored=rows.documents.find(r=>r.id===clean.documentId)?.payload.snapshot;if(root.TsukinowaCloudCore.canonical(stored)!==root.TsukinowaCloudCore.canonical(clean))return alert('正式帳票は上書きできません。「訂正版を作成」を使用してください。');}
 command({type:'saveDocument',snapshot:clean,expectedRevision:snapshot.cloudRevision||0,...(revisionSource?{revisedFromDocumentId:revisionSource.id,expectedParentRevision:revisionSource.revision,reason:revisionSource.reason}:{})});
};
root.doPrint=function(){if(enabled){if(!ready())return;if(docRevision){const stored=rows.documents.find(r=>r.id===docId)?.payload.snapshot;if(!stored||root.TsukinowaCloudCore.canonical(stored)!==root.TsukinowaCloudCore.canonical(root.TsukinowaBusiness.cleanSnapshot(collectFormState())))return alert('正式帳票の内容が変更されています。「訂正版を作成」から保存してください。');}}return original.doPrint();};
root.onodaStorageKey=function(month){if(!enabled)return original.onodaStorageKey(month);return 'tsukinowa_cloud_onoda_'+identity.replaceAll('/','_')+'_'+month;};
root.saveOnodaDraft=function(){if(enabled&&!sync)return;return original.saveOnodaDraft();};
root.restoreOnodaDraft=function(){
 if(!enabled){original.restoreOnodaDraft();return root.importOnodaFromCalendar({month:currentMonthKey(),silent:true});}
 if(!sync)return;
 return root.importOnodaFromCalendar({month:currentMonthKey(),silent:true});
};
root.importBackup=function(){if(!enabled)return original.importBackup();alert('共有モードでは一括置換できません。旧データの移行ボタンを使用してください。元データは削除しません。');};
root.bizEstimateFromHistory=function(id){original.bizEstimateFromHistory(id);if(enabled){const e=bizState.estimates.find(x=>x.id===id);if(e){bizCurrentEstimateId=id;bizCurrentProjectId=e.projectId||'';bizCurrentCalendarId=e.calendarEventId||'';}}};
root.bizPersist=function(){if(!enabled)return original.bizPersist();};
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
function clearView(){pendingInvoice=null;revisionSource=null;history=[];rows={};root.TsukinowaAccountingUI?.hydrate({});for(const key of ['estimates','projects','sales','payments','calendar','audit','expenses','bank'])bizState[key]=[];applying=true;try{bizRefreshAll();renderConfirmedHistory();docType='invoice';resetNormalFormBlank();if(el('bizJobMemo'))el('bizJobMemo').value='';if(el('receiptSale'))el('receiptSale').value='';docId='';docRevision=0;bizClearDocLink();}finally{applying=false;}}
const documentLabels={active:'有効',void:'無効',cancelled:'取消',duplicate:'重複',revised:'訂正済'};
function manageDocument(index,action){
 if(!enabled||!ready()||client.getState().role!=='admin')return alert('帳票管理は管理者のみ実行できます。');
 const h=history[index];if(!h||h.documentStatus!=='active')return alert('有効な帳票を選択してください。');
 if(action!=='revision'){const p=rows.documents.find(r=>r.id===h.documentId)?.payload;const saleId=p?.saleId||(['invoice','onoda'].includes(h.docType)?'sale_'+h.documentId:h.saleId);const linked=(rows.payments||[]).filter(r=>!r.payload.deletedAt&&r.payload.confirmation!=='bank-marker'&&(r.payload.saleId===saleId||r.id===(p?.paymentId||'pay_'+h.documentId)));if(linked.length)return alert('関連入金があります。先に付款関係・返金・取消を処理するか、訂正版を作成してください。');}
 const reason=prompt(action==='revision'?'訂正理由（新帳票を正式保存するまで原帳票は有効です）':'無効化の理由');if(!reason?.trim())return;
 if(action==='revision'){
  const source=rows.documents.find(r=>r.id===h.documentId),draft={...copy(h),documentId:'doc_'+uuid(),historyId:'',cloudRevision:0};
  applyFormState(draft,h.docType);revisionSource={id:h.documentId,revision:h.cloudRevision,reason,snapshot:copy(source.payload.snapshot)};
  bizSwitchPage('chohyo');alert('訂正版の下書きを作成しました。内容を編集し「正式保存」してください。原本と売上・入金の関係は保持されます。');return;
 }
 const duplicateOfDocumentId=action==='duplicate'?prompt('原となる有効な同種帳票の document ID（保存帳票一覧のID）'):'';if(action==='duplicate'&&!duplicateOfDocumentId?.trim())return;
 command({type:'documentStatus',documentId:h.documentId,status:action,reason,duplicateOfDocumentId:duplicateOfDocumentId?.trim()||'',expectedRevision:h.cloudRevision});
}
root.manageFormalDocument=manageDocument;
root.cleanConfirmedTestData=async function(){
 try{
  if(!ready()||client.getState().role!=='admin')throw Error('管理者のみ実行できます。');
  await sync.flush();if(sync.getQueue().length)throw Error('同期完了後に再実行してください。');
  const C=root.TsukinowaTestCleanup,records=Object.fromEntries(await Promise.all(C.COLLECTIONS.map(async n=>[n,await client.listRecords(n)]))),plan=C.plan(records);
  if(!plan.length)return alert('確認済みテストデータは清理済みです。');
  // Retain a recoverable original before the audited atomic soft deletion.
  const backup={companyId:client.getState().companyId,exportedAt:new Date().toISOString(),records};
  const key='tsukinowa_cloud_test_cleanup_backup_'+identity.replaceAll('/','_');
  localStorage.setItem(key,JSON.stringify(backup));if(!localStorage.getItem(key))throw Error('清理前バックアップを保存できません。');
  const result=await sync.service.execute({type:'cleanTestData',operationId:uuid(),deletedAt:new Date().toISOString()});
  alert('確認済みテストデータ '+result.cleaned.length+'件を清理しました。監査・復元用原本は保持されています。');
 }catch(e){alert('テスト清理を停止しました：'+e.message);}
};
function renderDocuments(boxId,kind){
 const box=el(boxId);if(!box)return;box.replaceChildren();const q=(el('savedDocSearch')?.value||'').toLowerCase();
 history.forEach((h,i)=>{if(kind&&h.docType!==kind||!kind&&q&&![h.customerName,h.invoiceNo,h.documentId].join(' ').toLowerCase().includes(q))return;
  const row=document.createElement('div');row.className='biz-card';row.style.cssText='padding:12px;margin-bottom:8px;border:1px solid #ddd';
  const label=document.createElement('strong');label.textContent=`${documentLabels[h.documentStatus]} ｜ ${docTypeLabel(h.docType)} ｜ ${h.customerName||''}`;if(h.documentStatus!=='active')label.style.color='#a23';row.append(label);
  const detail=document.createElement('p');detail.textContent=`${h.invoiceDate||''} ｜ ID: ${h.documentId}`+(h.statusReason?' ｜ 理由: '+h.statusReason:'')+(h.revisedFromDocumentId?' ｜ 訂正元: '+h.revisedFromDocumentId:'')+(h.duplicateOfDocumentId?' ｜ 原帳票: '+h.duplicateOfDocumentId:'')+(h.revisedToDocumentId?' ｜ 訂正版: '+h.revisedToDocumentId:'');row.append(detail);
  const add=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='biz-btn';b.textContent=text;b.onclick=fn;row.append(b);};
  add('開く',()=>openSavedDoc(i));add('再ダウンロード',()=>redownloadSavedDoc(i));
  if(client?.getState().role==='admin'&&h.documentStatus==='active'){add('訂正版を作成',()=>manageDocument(i,'revision'));add('無効にする',()=>manageDocument(i,'void'));add('重複として無効',()=>manageDocument(i,'duplicate'));}
  box.append(row);
 });if(!box.childNodes.length)box.textContent='保存済み帳票はありません。';
}
root.renderAllSavedDocs=function(){if(!enabled)return original.renderAllSavedDocs();renderDocuments('allSavedDocsList');};
root.renderConfirmedHistory=function(){if(!enabled)return original.renderConfirmedHistory();renderDocuments('confirmedHistoryList',docType);};
root.TsukinowaBusinessUI={
 configure(value){const changed=enabled!==value;enabled=value;if(enabled){if(changed)clearView();el('coreSyncStatus').textContent='ログイン待ち';}else el('coreSyncStatus').textContent='端末内保存';},
 auth(state,instance){client=instance;const next=state.phase==='ready'?`${state.projectId}/${state.companyId}/${state.user.uid}/${state.role}`:'';
  // The core removes listeners on every token refresh, so rebuild once per auth-ready transition.
  if(sync){sync.stop();sync=null;}clearInterval(timer);const previousIdentity=identity;if(next)identity=next;
  if(!enabled)return;
  root.TsukinowaAccountingUI?.role(state.role);
  if((next&&next!==previousIdentity)||(!next&&state.phase!=='authorizing'))clearView();el('cloudMigration').hidden=state.role!=='admin';
  for(const b of document.querySelectorAll('#bizNav button'))b.hidden=state.role==='staff'&&!['calendar','estimates','chohyo','savedDocs'].includes(b.dataset.page);
  if(next)el('bizSyncState').textContent='クラウド共有';
  if(!next){if(state.phase!=='authorizing')identity='';el('coreSyncStatus').textContent=state.phase==='error'?'同期エラー':['initializing','authorizing'].includes(state.phase)?'ログイン状態確認中':'ログイン待ち';return;}
  try{const local=JSON.parse(localStorage.getItem(`tsukinowa_cloud_local_${state.projectId}_${state.companyId}_${state.user.uid}`)||'{}');bizState.expenses=[];bizState.bank=[];
   sync=root.TsukinowaSync.createSync({client,storage:localStorage,online:()=>navigator.onLine,onData:hydrate,onStatus:status,onCommitted:(cmd,result)=>{
    if(cmd.type==='saveDocument'&&result.documentId===docId){docRevision=result.revision;revisionSource=null;}
    if(cmd.type==='acceptEstimate'&&cmd.openInvoice){pendingInvoice=cmd.estimateId;completePendingInvoice();}
    if(cmd.type==='confirmBank'){const b=bizState.bank.find(x=>x.id===cmd.localBankId);if(b){b.matched=true;b.matchType='sale';b.matchId=cmd.saleId;bizPersist();}}
    setTimeout(patchPending,300);
   }});sync.start();timer=setInterval(()=>{sync?.flush();patchPending();},15000);if(state.role==='staff')bizSwitchPage('calendar');
  }catch(e){showError(e.message);}
 },prepareOnodaDraft(month){
  const saved=history.find(h=>h.documentStatus==='active'&&h.docType==='onoda'&&h.invoiceDate?.slice(0,7)===month);
  if(saved){
   const source=rows.documents.find(r=>r.id===saved.documentId);
   if(client.getState().role!=='admin')throw Error('保存済み月次の訂正版は管理者が作成してください。');
   applyFormState({...copy(saved),documentId:'doc_'+uuid(),historyId:'',cloudRevision:0},'onoda');
   revisionSource={id:saved.documentId,revision:saved.cloudRevision,reason:'最新日程による月次再生成',snapshot:copy(source.payload.snapshot)};
  }else root.setDocType('onoda');
 },getSync:()=>sync,getClient:()=>client,enqueue:command,isEnabled:()=>enabled
};
document.addEventListener('DOMContentLoaded',()=>{
 const badge=document.createElement('span');badge.id='coreSyncStatus';badge.setAttribute('role','status');badge.textContent='端末内保存';el('bizCloudAccountButton').prepend(badge);badge.style.cssText='display:block;font-size:10px;font-weight:normal';
 const controls=document.createElement('div');controls.innerHTML='<div id="cloudMigration" hidden><button class="biz-btn" id="cloudMigrate">旧データを安全に移行</button><p id="cloudMigrationStatus" role="status"></p></div><button class="biz-btn" id="cloudExport">共有データ・未同期をJSON出力</button> <button class="biz-btn" id="cloudCSV">売上CSV</button><button class="biz-btn" id="cloudRetryQueue" hidden>同期を再試行</button><button class="biz-btn" id="cloudArchiveQueue" hidden>競合を保管して次の同期へ</button>';
 el('cloudDialog').append(controls);
 const receipt=document.createElement('div');receipt.id='cloudReceiptFields';receipt.hidden=true;receipt.className='biz-field';receipt.innerHTML='<label for="receiptSale">対象請求書（部分入金可）</label><select id="receiptSale"></select><label for="receiptPaymentDate">入金日</label><input id="receiptPaymentDate" type="date">';el('receiptTotal').parentElement.append(receipt);
 const recipient=document.createElement('div');recipient.innerHTML='<label>会社名<input id="customerCompany" type="text"></label><label>宛先住所<input id="customerAddress" type="text"></label>';el('customerName').parentElement.append(recipient);for(const k of ['customerCompany','customerAddress'])el(k).addEventListener('input',()=>recalc());
 const cleanupButton=document.createElement('button');cleanupButton.type='button';cleanupButton.className='biz-btn';cleanupButton.textContent='確認済みTest / testデータを清理';cleanupButton.onclick=root.cleanConfirmedTestData;el('pageSettings').append(cleanupButton);
 const discard=document.createElement('button');discard.type='button';discard.className='biz-btn';discard.textContent='下書きを破棄';discard.onclick=()=>{if(docRevision)return alert('正式帳票は削除できません。');revisionSource=null;setDocType(docType);resetNormalFormBlank();if(docType==='onoda')localStorage.removeItem(onodaStorageKey(currentMonthKey()));for(const k of ['customerCompany','customerAddress'])el(k).value='';};el('pageChohyo').prepend(discard);
 const save=document.createElement('button');save.type='button';save.className='biz-btn primary';save.textContent='正式保存';save.onclick=()=>saveConfirmedHistory();el('pageChohyo').prepend(save);
 el('receiptPaymentDate').value=todayISO();
 el('cloudMigrate').onclick=async()=>{if(!ready())return;el('cloudMigrate').disabled=true;try{await root.TsukinowaSync.migrateLegacy({client,storage:localStorage,onStatus:t=>el('cloudMigrationStatus').textContent=t});}catch(e){el('cloudMigrationStatus').textContent='移行失敗：'+e.message+'（元データ保持）';}finally{el('cloudMigrate').disabled=false;}};
 el('cloudExport').onclick=()=>{if(ready())download({exportedAt:new Date().toISOString(),records:rows,pending:sync.getQueue()},'tsukinowa-cloud-backup.json');};
 el('cloudCSV').onclick=()=>{if(!ready())return;const q=x=>'"'+String(x??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';const data=[['documentId','顧客','売上日','請求日','請求額','入金済','未収'],...bizState.sales.map(s=>[s.documentId,s.customer,s.salesDate,s.invoiceDate,s.amount,bizPaid(s),bizOutstanding(s)])];download('\ufeff'+data.map(r=>r.map(q).join(',')).join('\r\n'),'sales.csv','text/csv;charset=utf-8');};
 el('cloudRetryQueue').onclick=()=>sync?.flush();el('cloudArchiveQueue').onclick=()=>{if(confirm('競合した未同期内容を端末に保管し、クラウドの正式データを優先します。保管内容はJSON出力で取得できます。')){const key=sync?.archiveBlocked();if(key)download(JSON.parse(localStorage.getItem(key)),'tsukinowa-conflict.json');sync?.flush();}};
 window.addEventListener('online',()=>sync?.flush());window.addEventListener('offline',()=>sync?.flush());
});
})(window);
