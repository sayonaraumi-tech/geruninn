(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./cloud-core.js'):root.TsukinowaCloudCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaBusiness=api;})(globalThis,function(core){
'use strict';
const COLLECTIONS=['estimates','projects','documents','sales','payments','calendarLinks','auditLogs'];
const clone=x=>JSON.parse(JSON.stringify(x));
function cleanSnapshot(s){const out=clone(s);for(const k of ['savedAt','scrollY','cloudRevision','historyId','version','_cloudIdentity'])delete out[k];return out;}
function total(s){if(s.docType==='receipt')return Number(s.receiptTotal)||0;let subtotal=0,nonTax=0;(s.items||[]).forEach(i=>{const a=(Number(i.qty)||0)*(Number(i.price)||0);subtotal+=a;if(s.docType==='onoda'&&i.taxable===false)nonTax+=a;});if(s.docType!=='onoda')subtotal+=Number(s.travelFee)||0;return Math.round(subtotal+(subtotal-nonTax)*.1);}
function summary(s){return s.docType==='onoda'?(s.invoiceDate||'').slice(0,7)+'月分 小野田月次施工':(s.bizJobMemo||(s.items||[]).map(x=>x.content).filter(Boolean).slice(0,2).join(' / ')||s.remarks||'工事').slice(0,120);}
function createService(client){
 const stable=async(prefix,value)=>prefix+'_'+(await client.digest(String(value))).slice(0,48);
 const eventId=event=>stable('cal',event.googleEventId||event.id);
 async function execute(cmd){return client.transact(cmd.operationId,cmd,async({read,write,who,archiveAudit})=>{
  const refs={};
  if(cmd.type==='calendar'){
    const e=clone(cmd.event),id=await eventId(e),row=await read('calendarLinks',id),old=row?.payload||{};
    if(old.calendarId&&e.googleCalendarId&&old.calendarId!==e.googleCalendarId)throw Error('同じGoogle event IDに異なるカレンダーが指定されています。');
    const formal=!!(old.documentId||old.linkedInvoiceId||old.linkedEstimateId||old.projectId);
    const incoming={id,googleEventId:e.googleEventId||'',calendarId:e.googleCalendarId||old.calendarId||'',googleCalendarId:e.googleCalendarId||old.calendarId||'',source:e.source||(e.googleEventId?'google':'ics')};
    for(const k of ['date','start','end','updated','htmlLink','uid'])incoming[k]=e[k]||'';
    incoming.googleLatestTitle=e.title||'';incoming.googleOriginalDescription=e.description||'';
    if(!formal)for(const k of ['title','originalTitle','description'])incoming[k]=e[k]||'';
    const revision=await write('calendarLinks',id,{...old,...incoming});return {id,revision};
  }
  if(cmd.type==='saveDocument'){
    const s=cleanSnapshot(cmd.snapshot),id=s.documentId;
    if(s.docType==='estimate')s.estimateId='est_'+id;
    if(!id||!['invoice','estimate','receipt','onoda'].includes(s.docType))throw Error('帳票IDまたは種類が不正です。');
    const old=await read('documents',id),amount=total(s);
    if(!Number.isFinite(amount)||amount<0)throw Error('金額を確認してください。');
    if(old&&old.payload.docType!==s.docType)throw Error('帳票の種類は変更できません。新規帳票を作成してください。');
    // A read/download with identical content never mutates the document or accounting records.
    if(old&&core.canonical(old.payload.snapshot)===core.canonical(s))return {documentId:id,revision:old.revision,unchanged:true};
    if((old?.revision||0)!==cmd.expectedRevision){const e=Error('帳票が別の端末で更新されました。保存内容を保持したまま再確認してください。');e.code='conflict';throw e;}
    const calendar=s.calendarEventId?await read('calendarLinks',s.calendarEventId):null;
    const link=calendar?.payload||null;
    if(['invoice','onoda'].includes(s.docType)&&link?.linkedInvoiceId&&link.linkedInvoiceId!==id)throw Error('この予定には既に正式請求書があります。保存帳票から元の請求書を開いてください。');
    if(s.docType==='estimate'&&link?.linkedEstimateId&&link.linkedEstimateId!=='est_'+id)throw Error('この予定には既に見積があります。見積履歴から開いてください。');
    const document={documentId:id,docType:s.docType,amount,customerName:s.customerName||'',salesDate:s.salesDate||s.invoiceDate||'',invoiceDate:s.invoiceDate||'',paymentDate:s.paymentDate||'',snapshot:s,googleEventId:link?.googleEventId||s.googleEventId||'',calendarId:link?.calendarId||s.calendarId||'',calendarEventId:s.calendarEventId||'',estimateId:s.estimateId||'',projectId:s.projectId||'',confirmed:true};
    let estimate=null,sale=null,payment=null;
    if(s.docType==='estimate')estimate=await read('estimates','est_'+id);
    if(s.docType==='invoice'||s.docType==='onoda')sale=await read('sales','sale_'+id);
    if(s.docType==='receipt'){
      if(!s.saleId)throw Error('領収書の対象請求書を選択してください。顧客名だけでは自動照合しません。');
      sale=await read('sales',s.saleId);if(!sale)throw Error('対象請求書が見つかりません。');
      if(amount<=0||!s.paymentDate)throw Error('入金額と入金日を確認してください。');
      payment=await read('payments','pay_'+id);if(payment?.payload.confirmation==='bank-confirmed'&&(payment.payload.amount!==amount||payment.payload.saleId!==s.saleId||payment.payload.paymentDate!==s.paymentDate))throw Error('銀行確認済の入金額・対象・日付は領収書から変更できません。');
    }
    const revision=await write('documents',id,document,undefined,cmd.expectedRevision);
    if(s.docType==='estimate'){
      refs.estimateId='est_'+id;
      await write('estimates',refs.estimateId,{...(estimate?.payload||{}),id:refs.estimateId,historyId:id,documentId:id,customer:s.customerName||'',date:s.invoiceDate||'',amount,content:summary(s),area:s.remarks||'',status:estimate?.payload.status||'見積済',calendarEventId:s.calendarEventId||'',googleEventId:document.googleEventId,calendarId:document.calendarId,projectId:estimate?.payload.projectId||''});
    }else if(s.docType==='invoice'||s.docType==='onoda'){
      refs.saleId='sale_'+id;
      await write('sales',refs.saleId,{...(sale?.payload||{}),id:refs.saleId,sourceId:id,documentId:id,docType:s.docType,invoiceNo:s.invoiceNo||'',customer:s.customerName||'',amount,salesDate:document.salesDate,saleDate:document.salesDate,invoiceDate:document.invoiceDate,content:summary(s),paymentMethod:s.paymentMethod||'銀行振込',calendarEventId:s.calendarEventId||'',googleEventId:document.googleEventId,calendarId:document.calendarId,estimateId:s.estimateId||'',projectId:s.projectId||''});
    }else{
      refs.paymentId='pay_'+id;
      await write('payments',refs.paymentId,{...(payment?.payload||{}),id:refs.paymentId,paymentId:refs.paymentId,sourceId:id,documentId:id,saleId:s.saleId,amount,paymentDate:s.paymentDate,date:s.paymentDate,method:s.paymentMethod||'現金',confirmation:payment?.payload.confirmation==='bank-confirmed'?'bank-confirmed':s.paymentMethod==='現金'?'cash-received':'pending-bank',memo:'領収書から登録'},'payment');
    }
    if(link){
      const status=s.docType==='estimate'?'見積済':s.docType==='receipt'?'領収済':'請求済';
      const linkedAmount=s.docType==='receipt'?(sale.payload.amount):amount;
      const customer=s.docType==='receipt'?sale.payload.customer:document.customerName;
      const next={...link,documentId:id,customerName:customer,officialAmount:linkedAmount,status,googlePatchPending:true};
      if(refs.estimateId){next.estimateId=refs.estimateId;next.linkedEstimateId=refs.estimateId;}
      if(refs.saleId)next.linkedInvoiceId=id;
      if(refs.paymentId)next.linkedReceiptId=id;
      next.title=[customer,summary(s),linkedAmount,status].filter(x=>x!==''&&x!==null).join('｜');
      await write('calendarLinks',s.calendarEventId,next);
    }
    return {documentId:id,revision,...refs};
  }
  if(cmd.type==='acceptEstimate'){
    const e=await read('estimates',cmd.estimateId);if(!e)throw Error('見積が見つかりません。');
    const id=e.payload.projectId||'project_'+cmd.estimateId,p=await read('projects',id);
    if(e.payload.status==='受注'&&p)return {projectId:id,unchanged:true};
    await write('estimates',cmd.estimateId,{...e.payload,status:'受注',projectId:id},'status change',cmd.expectedRevision);
    if(!p)await write('projects',id,{id,estimateId:cmd.estimateId,documentId:e.payload.documentId,customer:e.payload.customer,content:e.payload.content,amount:e.payload.amount,calendarEventId:e.payload.calendarEventId||'',googleEventId:e.payload.googleEventId||'',calendarId:e.payload.calendarId||'',status:'受注',workDate:cmd.workDate||''});
    if(e.payload.calendarEventId){const link=await read('calendarLinks',e.payload.calendarEventId);if(link)await write('calendarLinks',e.payload.calendarEventId,{...link.payload,projectId:id,status:'施工予定',workDate:cmd.workDate||''},'status change');}
    return {projectId:id};
  }
  if(cmd.type==='payment'){
    const sale=await read('sales',cmd.saleId);if(!sale)throw Error('対象請求書が見つかりません。');
    if(!(Number(cmd.amount)>0)||!cmd.paymentDate)throw Error('入金額と日付を確認してください。');
    const old=await read('payments',cmd.paymentId),payload={id:cmd.paymentId,paymentId:cmd.paymentId,saleId:cmd.saleId,amount:Number(cmd.amount),paymentDate:cmd.paymentDate,date:cmd.paymentDate,method:cmd.method||'現金',confirmation:cmd.method==='現金'?'cash-received':'pending-bank',memo:cmd.memo||'',documentId:''};
    if(old){if(core.canonical(old.payload)!==core.canonical(payload))throw Error('入金IDが既存の入金と競合しています。');return {paymentId:cmd.paymentId,unchanged:true};}
    await write('payments',cmd.paymentId,payload,'payment',0);return {paymentId:cmd.paymentId};
  }
  if(cmd.type==='confirmBank'){
    if(who.role!=='admin')throw Error('銀行照合は管理者のみです。');
    const sale=await read('sales',cmd.saleId);if(!sale)throw Error('対象請求書がありません。');
    const id=await stable('bankpay',cmd.bankId),old=await read('payments',id);
    if(old)return {paymentId:id,unchanged:true};
    if(!(cmd.amount>0)||!cmd.paymentDate)throw Error('銀行の入金日・金額を確認してください。');
    if(cmd.pendingPaymentId){const pending=await read('payments',cmd.pendingPaymentId);if(!pending||pending.payload.saleId!==cmd.saleId||pending.payload.amount!==cmd.amount||pending.payload.confirmation!=='pending-bank')throw Error('仮入金と銀行明細が一致しません。');await write('payments',cmd.pendingPaymentId,{...pending.payload,confirmation:'bank-confirmed',bankId:cmd.bankId,paymentDate:cmd.paymentDate,date:cmd.paymentDate},'payment');
      // A zero-value bank marker prevents importing the same bank row again.
      await write('payments',id,{id,paymentId:id,saleId:cmd.saleId,amount:0,confirmation:'bank-marker',bankId:cmd.bankId,confirmedPaymentId:cmd.pendingPaymentId,paymentDate:cmd.paymentDate,date:cmd.paymentDate},'payment',0);
    }else await write('payments',id,{id,paymentId:id,saleId:cmd.saleId,amount:cmd.amount,confirmation:'bank-confirmed',bankId:cmd.bankId,paymentDate:cmd.paymentDate,date:cmd.paymentDate,method:'GMO銀行',memo:'銀行CSV照合'},'payment',0);
    return {paymentId:id};
  }
  if(cmd.type==='calendarPatched'){
    const e=await read('calendarLinks',cmd.id);if(e&&e.revision===cmd.expectedRevision)await write('calendarLinks',cmd.id,{...e.payload,googlePatchPending:false,googlePatchedAt:cmd.at});return {id:cmd.id};
  }
  if(cmd.type==='migrateAudit'){await archiveAudit(cmd.id,cmd.legacy);return {id:cmd.id};}
  if(cmd.type==='migrateRecord'){
    if(who.role!=='admin')throw Error('移行は管理者のみ実行できます。');
    if(!COLLECTIONS.includes(cmd.collection)||cmd.collection==='auditLogs')throw Error('Invalid migration collection');
    const old=await read(cmd.collection,cmd.id);if(old)return {id:cmd.id,skipped:true};
    await write(cmd.collection,cmd.id,cmd.payload,'migration',0);return {id:cmd.id,skipped:false};
  }
  if(cmd.type==='migrationStatus'){if(who.role!=='admin')throw Error('管理者のみ');return (await read('migrations',cmd.sourceId))?.payload||null;}
  if(cmd.type==='migrationComplete'){
    if(who.role!=='admin')throw Error('移行は管理者のみ実行できます。');
    await write('migrations',cmd.sourceId,{migrationVersion:2,sourceId:cmd.sourceId,count:cmd.count,backupKey:cmd.backupKey,completed:true},'migration');return {completed:true};
  }
  throw Error('Unknown business command');
 });}
 return {execute,stable,eventId};
}
return {createService,COLLECTIONS,total,cleanSnapshot,summary};
});
