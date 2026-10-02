(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./cloud-core.js'):root.TsukinowaCloudCore,typeof module==='object'&&module.exports?require('./accounting.js'):root.TsukinowaAccounting,typeof module==='object'&&module.exports?require('./accounting-domain.js'):root.TsukinowaAccountingDomain);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaBusiness=api;})(globalThis,function(core,A,AD){
'use strict';
const COLLECTIONS=['estimates','projects','documents','sales','payments','calendarLinks','auditLogs',...A.COLLECTIONS];
const clone=x=>JSON.parse(JSON.stringify(x));
function cleanSnapshot(s){const out=clone(s);for(const k of ['savedAt','scrollY','cloudRevision','historyId','version','_cloudIdentity','documentStatus','statusReason','revisedFromDocumentId','duplicateOfDocumentId','revisedToDocumentId'])delete out[k];for(const k of ['customerCompany','customerAddress'])if(!out[k])delete out[k];return out;}
function total(s){if(s.docType==='receipt')return Number(s.receiptTotal)||0;let subtotal=0,nonTax=0;(s.items||[]).forEach(i=>{const a=(Number(i.qty)||0)*(Number(i.price)||0);subtotal+=a;if(s.docType==='onoda'&&i.taxable===false)nonTax+=a;});if(s.docType!=='onoda')subtotal+=Number(s.travelFee)||0;return Math.round(subtotal+(subtotal-nonTax)*.1);}
function summary(s){return s.docType==='onoda'?(s.invoiceDate||'').slice(0,7)+'月分 小野田月次施工':(s.bizJobMemo||(s.items||[]).map(x=>x.content).filter(Boolean).slice(0,2).join(' / ')||s.remarks||'工事').slice(0,120);}
function numberingMinute(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.year+parts.month+parts.day+'-'+parts.hour+parts.minute;
}
function createService(client,{now=()=>new Date()}={}){
 const stable=async(prefix,value)=>prefix+'_'+(await client.digest(String(value))).slice(0,48);
 const eventId=event=>stable('cal',event.googleEventId||event.id);
 async function execute(cmd,numberRetries=0){
 let allocated=null;
 const lifecycle=cmd.type==='documentStatus'||(cmd.type==='saveDocument'&&cmd.revisedFromDocumentId);
 const paymentSeed=lifecycle?await client.listRecords('payments'):[];
 const cleanup=typeof module==='object'&&module.exports?require('./test-data-cleanup.js'):globalThis.TsukinowaTestCleanup;
 const cleanupPlan=cmd.type==='cleanTestData'?cleanup.plan(Object.fromEntries(await Promise.all(cleanup.COLLECTIONS.map(async n=>[n,await client.listRecords(n)])))):null;
 try{return await client.transact(cmd.operationId,cmd,async({read,write:rawWrite,who,archiveAudit,reserveDocumentNumber})=>{
  const paymentSales=new Map();
  const write=async(name,id,payload,action,expectedRevision)=>{if(name==='payments'&&payload.saleId){const sale=await read('sales',payload.saleId);if(sale){if(!A.live(sale.payload)&&!payload.deletedAt)throw Error('無効な請求書には入金できません。');const ids=paymentSales.get(payload.saleId)||new Set(sale.payload.paymentIds||[]);ids.add(id);paymentSales.set(payload.saleId,ids);}}const revision=await rawWrite(name,id,payload,action,expectedRevision);await AD.mirrorCash(name,id,payload,read,rawWrite);return revision;};
  const result=await (async()=>{
  if(cmd.type==='cleanTestData'){
    if(who.role!=='admin')throw Error('テスト清理は管理者のみです。');
    for(const entry of cleanupPlan){const row=await read(entry.collection,entry.id);if(!row||row.revision!==entry.revision||core.canonical(row.payload)!==core.canonical(entry.payload))throw Error('関連データが変更されました。再確認してください。');}
    const at=cmd.deletedAt;
    if(!/^\d{4}-\d{2}-\d{2}T/.test(at||''))throw Error('清理日時が不正です。');
    for(const entry of cleanupPlan){
      const p=entry.payload,next=entry.collection==='documents'?{...p,status:'void',reason:cleanup.REASON}:{...p,deletedAt:at,deleteReason:cleanup.REASON,...(['sales','estimates'].includes(entry.collection)?{documentStatus:'void'}:{}),...(entry.collection==='calendarLinks'?{googlePatchPending:false}:{})};
      if(entry.collection==='sales'){next.paymentIds=Array.from(new Set([...(p.paymentIds||[]),...cleanupPlan.filter(e=>e.collection==='payments'&&e.payload.saleId===entry.id).map(e=>e.id)]));next.paymentVersion=(p.paymentVersion||0)+1;}
      await rawWrite(entry.collection,entry.id,next,'status change',entry.revision);
    }
    return {cleaned:cleanupPlan.map(e=>e.collection+'/'+e.id)};
  }
  if(AD.TYPES.includes(cmd.type))return AD.handle(cmd,{read,write,who,stable});
  const refs={};
  if(cmd.type==='calendar'){
    const e=clone(cmd.event),id=await eventId(e),row=await read('calendarLinks',id),old=row?.payload||{};
    if(old.calendarId&&e.googleCalendarId&&old.calendarId!==e.googleCalendarId)throw Error('同じGoogle event IDに異なるカレンダーが指定されています。');
    const formal=!!(old.documentId||old.linkedInvoiceId||old.linkedEstimateId||old.projectId);
    const incoming={id,googleEventId:e.googleEventId||'',calendarId:e.googleCalendarId||old.calendarId||'',googleCalendarId:e.googleCalendarId||old.calendarId||'',source:e.source||(e.googleEventId?'google':'ics')};
    for(const k of ['date','start','end','updated','htmlLink','uid'])incoming[k]=e[k]||'';
    incoming.googleLatestTitle=e.title||'';incoming.googleOriginalDescription=e.description||'';incoming.googleStatus=e.googleStatus||'confirmed';
    if(!formal)for(const k of ['title','originalTitle','description'])incoming[k]=e[k]||'';
    const revision=await write('calendarLinks',id,{...old,...incoming});return {id,revision};
  }
  async function relatedPayments(saleId,ownPaymentId=''){
    const sale=saleId?await read('sales',saleId):null;
    const ids=new Set([...(sale?.payload.paymentIds||[]),...paymentSeed.filter(p=>p.payload.saleId===saleId).map(p=>p.id),...(ownPaymentId?[ownPaymentId]:[])]);
    const ps=[];for(const id of ids){const p=await read('payments',id);if(p&&!p.payload.deletedAt&&p.payload.confirmation!=='bank-marker')ps.push(p.payload);}return ps;
  }
  if(cmd.type==='documentStatus'){
    if(who.role!=='admin')throw Error('帳票管理は管理者のみ実行できます。');
    if(!['void','cancelled','duplicate'].includes(cmd.status))throw Error('状態が不正です。');
    const row=await read('documents',cmd.documentId);if(!row||!A.live(row.payload))throw Error('有効な正式帳票を選択してください。');
    const p=row.payload,reason=String(cmd.reason||'').trim();if(!reason)throw Error('理由を入力してください。');
    const saleId=p.saleId||(['invoice','onoda'].includes(p.docType)?'sale_'+cmd.documentId:p.snapshot.saleId||'');
    const paymentId=p.paymentId||(p.docType==='receipt'?'pay_'+cmd.documentId:'');
    const payments=await relatedPayments(saleId,paymentId);
    if(payments.some(A.confirmed))throw Error('確認済み入金があります。付款関係・返金・取消を先に処理するか、訂正版を作成してください。');
    if(payments.length)throw Error('未確認の入金があります。先に入金関係を整理してください。');
    if(cmd.status==='duplicate'){
      const target=await read('documents',cmd.duplicateOfDocumentId||'missing');
      if(!target||target.payload.documentId===p.documentId||!A.live(target.payload)||target.payload.docType!==p.docType)throw Error('同じ種類の有効な原帳票IDを指定してください。');
    }
    await write('documents',p.documentId,{...p,status:cmd.status,reason,duplicateOfDocumentId:cmd.status==='duplicate'?cmd.duplicateOfDocumentId:''},'status change',cmd.expectedRevision);
    if(['invoice','onoda'].includes(p.docType)){const sale=await read('sales',saleId);if(sale)await write('sales',saleId,{...sale.payload,documentStatus:cmd.status},'status change');}
    if(p.docType==='estimate'){const id=p.estimateId||'est_'+p.documentId,e=await read('estimates',id);if(e)await write('estimates',id,{...e.payload,documentStatus:cmd.status},'status change');}
    if(p.calendarEventId){const link=await read('calendarLinks',p.calendarEventId);if(link&&link.payload.documentId===p.documentId)await write('calendarLinks',p.calendarEventId,{...link.payload,documentStatus:cmd.status,status:cmd.status==='duplicate'?'重複':cmd.status==='cancelled'?'取消':'無効',title:[p.customerName,summary(p.snapshot),cmd.status==='duplicate'?'重複':cmd.status==='cancelled'?'取消':'無効'].join('｜'),googlePatchPending:true},'status change');}
    return {documentId:p.documentId,status:cmd.status};
  }
  if(cmd.type==='saveDocument'){
    const s=cleanSnapshot(cmd.snapshot),id=s.documentId;
    if(!id||!['invoice','estimate','receipt','onoda'].includes(s.docType))throw Error('帳票IDまたは種類が不正です。');
    const old=await read('documents',id),amount=total(s);
    if(old){s.invoiceNo=old.payload.snapshot.invoiceNo;for(const k of ['numberingMinute','numberingSequence'])if(old.payload.snapshot[k]!==undefined)s[k]=old.payload.snapshot[k];}
    if(s.docType==='estimate')s.estimateId=old?.payload.estimateId||'est_'+id;
    const parent=cmd.revisedFromDocumentId?await read('documents',cmd.revisedFromDocumentId):null;
    if(cmd.revisedFromDocumentId){if(who.role!=='admin')throw Error('訂正版は管理者のみ作成できます。');if(!parent||!A.live(parent.payload)||parent.payload.docType!==s.docType||parent.payload.documentId===id)throw Error('訂正元は同じ種類の有効な帳票を選択してください。');if(parent.revision!==cmd.expectedParentRevision)throw Error('訂正元が変更されました。開き直してください。');if(!String(cmd.reason||'').trim())throw Error('訂正理由を入力してください。');
      for(const k of ['calendarEventId','googleEventId','calendarId','projectId','estimateId'])s[k]=parent.payload[k]||parent.payload.snapshot[k]||'';
      if(s.docType==='receipt')s.saleId=parent.payload.snapshot.saleId;
    }
    if(!Number.isFinite(amount)||amount<0)throw Error('金額を確認してください。');
    if(old&&old.payload.docType!==s.docType)throw Error('帳票の種類は変更できません。新規帳票を作成してください。');
    // A read/download with identical content never mutates the document or accounting records.
    if(old&&core.canonical(old.payload.snapshot)===core.canonical(s))return {documentId:id,revision:old.revision,snapshot:s,invoiceNo:s.invoiceNo,numberingMinute:s.numberingMinute||'',numberingSequence:s.numberingSequence||0,unchanged:true};
    if((old?.revision||0)!==cmd.expectedRevision){const e=Error('帳票が別の端末で更新されました。保存内容を保持したまま再確認してください。');e.code='conflict';throw e;}
    if(old)throw Error('正式帳票は上書きできません。「訂正版を作成」を使用してください。');

    const calendar=s.calendarEventId?await read('calendarLinks',s.calendarEventId):null;
    const link=calendar?.payload||null;
    if(['invoice','onoda'].includes(s.docType)&&link?.linkedInvoiceId&&link.linkedInvoiceId!==id&&link.linkedInvoiceId!==parent?.payload.documentId)throw Error('この予定には既に正式請求書があります。保存帳票から元の請求書を開いてください。');
    if(s.docType==='estimate'&&link?.linkedEstimateId&&link.linkedEstimateId!=='est_'+id&&link.linkedEstimateId!==(parent?(parent.payload.estimateId||'est_'+parent.payload.documentId):''))throw Error('この予定には既に見積があります。見積履歴から開いてください。');
    const saleId=parent?.payload.saleId|| (parent&&['invoice','onoda'].includes(s.docType)?'sale_'+parent.payload.documentId:'sale_'+id);
    const estimateId=parent?(parent.payload.estimateId||'est_'+parent.payload.documentId):'est_'+id;
    const paymentId=parent?.payload.paymentId||(parent&&s.docType==='receipt'?'pay_'+parent.payload.documentId:'pay_'+id);
    if(s.docType==='estimate')s.estimateId=estimateId;
    const minute=numberingMinute(now());
    const number=await reserveDocumentNumber(minute,id);allocated=number;
    Object.assign(s,number);
    const document={status:'active',reason:cmd.reason||'',revisedFromDocumentId:parent?.payload.documentId||'',saleId:['invoice','onoda'].includes(s.docType)?saleId:s.saleId||'',paymentId:s.docType==='receipt'?paymentId:'',documentId:id,docType:s.docType,amount,customerName:s.customerName||'',salesDate:s.salesDate||s.invoiceDate||'',invoiceDate:s.invoiceDate||'',paymentDate:s.paymentDate||'',snapshot:s,googleEventId:link?.googleEventId||s.googleEventId||'',calendarId:link?.calendarId||s.calendarId||'',calendarEventId:s.calendarEventId||'',estimateId:s.estimateId||'',projectId:s.projectId||'',confirmed:true};
    let estimate=null,sale=null,payment=null;
    if(s.docType==='estimate')estimate=await read('estimates',estimateId);
    if(s.docType==='invoice'||s.docType==='onoda')sale=await read('sales',saleId);
    if(s.docType==='receipt'){
      if(!s.saleId)throw Error('領収書の対象請求書を選択してください。顧客名だけでは自動照合しません。');
      sale=await read('sales',s.saleId);if(!sale||!A.live(sale.payload))throw Error('有効な対象請求書が見つかりません。');
      if(amount<=0||!s.paymentDate)throw Error('入金額と入金日を確認してください。');
      payment=await read('payments',paymentId);if(payment?.payload.deletedAt)throw Error('取消済み入金に関連する領収書です。管理者に確認してください。');if(payment?.payload.confirmation==='bank-confirmed'&&(payment.payload.amount!==amount||payment.payload.saleId!==s.saleId||payment.payload.paymentDate!==s.paymentDate))throw Error('銀行確認済の入金額・対象・日付は領収書から変更できません。');
    }
    if(parent){
      const ps=await relatedPayments(['invoice','onoda'].includes(s.docType)?saleId:s.saleId||'',s.docType==='receipt'?paymentId:'');
      const paid=ps.filter(A.confirmed).reduce((n,p)=>n+p.amount,0);
      if(['invoice','onoda'].includes(s.docType)&&amount<paid)throw Error('訂正金額が確認済み入金を下回ります。先に返金・取消を処理してください。');
      if(s.docType==='receipt'&&payment&&A.confirmed(payment.payload)&&(amount!==payment.payload.amount||s.paymentDate!==payment.payload.paymentDate||s.paymentMethod!==parent.payload.snapshot.paymentMethod))throw Error('確認済み領収書の金額・入金日・方法は変更できません。先に入金を訂正してください。');
      await write('documents',parent.payload.documentId,{...parent.payload,status:'revised',reason:cmd.reason,revisedToDocumentId:id},'status change',cmd.expectedParentRevision);
    }
    const revision=await write('documents',id,document,undefined,cmd.expectedRevision);
    if(s.docType==='estimate'){
      refs.estimateId=estimateId;
      await write('estimates',refs.estimateId,{...(estimate?.payload||{}),id:refs.estimateId,documentStatus:'active',historyId:id,documentId:id,customer:s.customerName||'',date:s.invoiceDate||'',amount,content:summary(s),area:s.remarks||'',status:estimate?.payload.status||'見積済',calendarEventId:s.calendarEventId||'',googleEventId:document.googleEventId,calendarId:document.calendarId,projectId:estimate?.payload.projectId||''});
    }else if(s.docType==='invoice'||s.docType==='onoda'){
      refs.saleId=saleId;
      await write('sales',refs.saleId,{...(sale?.payload||{}),id:refs.saleId,documentStatus:'active',sourceId:id,documentId:id,docType:s.docType,invoiceNo:s.invoiceNo||'',customer:s.customerName||'',amount,salesDate:document.salesDate,saleDate:document.salesDate,invoiceDate:document.invoiceDate,content:summary(s),paymentMethod:s.paymentMethod||'銀行振込',calendarEventId:s.calendarEventId||'',googleEventId:document.googleEventId,calendarId:document.calendarId,estimateId:s.estimateId||'',projectId:s.projectId||''});
    }else{
      refs.paymentId=paymentId;
      await write('payments',refs.paymentId,{...(payment?.payload||{}),id:refs.paymentId,paymentId:refs.paymentId,sourceId:id,documentId:id,saleId:s.saleId,amount,paymentDate:s.paymentDate,date:s.paymentDate,method:s.paymentMethod||'現金',confirmation:payment?.payload.confirmation==='bank-confirmed'?'bank-confirmed':s.paymentMethod==='現金'?'cash-received':'pending-bank',memo:'領収書から登録'},'payment');
    }
    if(link){
      const status=s.docType==='estimate'?'見積済':s.docType==='receipt'?'領収済':'請求済';
      const linkedAmount=s.docType==='receipt'?(sale.payload.amount):amount;
      const customer=s.docType==='receipt'?sale.payload.customer:document.customerName;
      const next={...link,documentStatus:'active',documentId:id,customerName:customer,officialAmount:linkedAmount,status,googlePatchPending:true};
      if(refs.estimateId){next.estimateId=refs.estimateId;next.linkedEstimateId=refs.estimateId;}
      if(refs.saleId)next.linkedInvoiceId=id;
      if(refs.paymentId)next.linkedReceiptId=id;
      next.title=[customer,summary(s),linkedAmount,status].filter(x=>x!==''&&x!==null).join('｜');
      await write('calendarLinks',s.calendarEventId,next);
    }
    return {documentId:id,revision,snapshot:s,invoiceNo:s.invoiceNo,numberingMinute:s.numberingMinute,numberingSequence:s.numberingSequence,...refs};
  }
  if(cmd.type==='acceptEstimate'){
    const e=await read('estimates',cmd.estimateId);if(!e||!A.live(e.payload))throw Error('有効な見積が見つかりません。');
    const id=e.payload.projectId||'project_'+cmd.estimateId,p=await read('projects',id);
    if(e.payload.status==='受注'&&p)return {projectId:id,unchanged:true};
    await write('estimates',cmd.estimateId,{...e.payload,status:'受注',projectId:id},'status change',cmd.expectedRevision);
    if(!p)await write('projects',id,{id,estimateId:cmd.estimateId,documentId:e.payload.documentId,customer:e.payload.customer,content:e.payload.content,amount:e.payload.amount,calendarEventId:e.payload.calendarEventId||'',googleEventId:e.payload.googleEventId||'',calendarId:e.payload.calendarId||'',status:'受注',workDate:cmd.workDate||''});
    if(e.payload.calendarEventId){const link=await read('calendarLinks',e.payload.calendarEventId);if(link)await write('calendarLinks',e.payload.calendarEventId,{...link.payload,projectId:id,status:'施工予定',workDate:cmd.workDate||''},'status change');}
    return {projectId:id};
  }
  if(cmd.type==='payment'){
    const sale=await read('sales',cmd.saleId);if(!sale||!A.live(sale.payload))throw Error('有効な対象請求書が見つかりません。');
    if(!(Number(cmd.amount)>0)||!cmd.paymentDate)throw Error('入金額と日付を確認してください。');
    const old=await read('payments',cmd.paymentId),payload={id:cmd.paymentId,paymentId:cmd.paymentId,saleId:cmd.saleId,amount:Number(cmd.amount),paymentDate:cmd.paymentDate,date:cmd.paymentDate,method:cmd.method||'現金',confirmation:cmd.method==='現金'?'cash-received':'pending-bank',memo:cmd.memo||'',documentId:''};
    if(old){if(core.canonical(old.payload)!==core.canonical(payload))throw Error('入金IDが既存の入金と競合しています。');return {paymentId:cmd.paymentId,unchanged:true};}
    await write('payments',cmd.paymentId,payload,'payment',0);return {paymentId:cmd.paymentId};
  }
  if(cmd.type==='confirmBank'){
    if(who.role!=='admin')throw Error('銀行照合は管理者のみです。');
    const sale=await read('sales',cmd.saleId);if(!sale||!A.live(sale.payload))throw Error('有効な対象請求書がありません。');
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
  })();
  for(const [saleId,ids] of paymentSales){const sale=await read('sales',saleId);await rawWrite('sales',saleId,{...sale.payload,paymentIds:[...ids],paymentVersion:(sale.payload.paymentVersion||0)+1},'payment');}
  return result;
 });}catch(error){
  // Some Firestore rule checks reject an occupied reservation before the SDK retries it.
  // Retry only when another formal save actually consumed the proposed number.
  if(cmd.type==='saveDocument'&&allocated&&numberRetries<4&&String(error.code||'').includes('permission-denied')){
   if(await client.isDocumentNumberReserved(allocated.invoiceNo))return execute(cmd,numberRetries+1);
  }
  throw error;
 }}
 return {execute,stable,eventId};
}
return {numberingMinute,createService,COLLECTIONS,total,cleanSnapshot,summary};
});
