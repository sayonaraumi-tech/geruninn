(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./cloud-core.js'):root.TsukinowaCloudCore,typeof module==='object'&&module.exports?require('./accounting.js'):root.TsukinowaAccounting,typeof module==='object'&&module.exports?require('./accounting-domain.js'):root.TsukinowaAccountingDomain);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaBusiness=api;})(globalThis,function(core,A,AD){
'use strict';
const COLLECTIONS=['estimates','projects','documents','sales','receivables','payments','calendarLinks','auditLogs',...A.COLLECTIONS];
const H=typeof module==='object'&&module.exports?require('./historical-import.js'):globalThis.TsukinowaHistorical;
const anchorCollection=id=>String(id).startsWith('receivable_')?'receivables':'sales';
const clone=x=>JSON.parse(JSON.stringify(x));
function cleanSnapshot(s){const out=core.normalizeDates(s);for(const k of ['savedAt','scrollY','cloudRevision','historyId','version','_cloudIdentity','documentStatus','statusReason','revisedFromDocumentId','duplicateOfDocumentId','revisedToDocumentId'])delete out[k];for(const k of ['customerCompany','customerAddress'])if(!out[k])delete out[k];return out;}
function total(s){if(s.docType==='receipt')return Number(s.receiptTotal)||0;let subtotal=0,nonTax=0;(s.items||[]).forEach(i=>{const a=(Number(i.qty)||0)*(Number(i.price)||0);subtotal+=a;if(s.docType==='onoda'&&i.taxable===false)nonTax+=a;});if(s.docType!=='onoda')subtotal+=Number(s.travelFee)||0;return Math.round(subtotal+(subtotal-nonTax)*.1);}
function summary(s){return s.docType==='onoda'?(s.invoiceDate||'').slice(0,7)+'月分 小野田月次施工':(s.bizJobMemo||(s.items||[]).map(x=>x.content).filter(Boolean).slice(0,2).join(' / ')||s.remarks||'工事').slice(0,120);}
// Presentation metadata only: never used to calculate tax or sales.
const CATEGORY_RULES=[['クロス張替',/クロス|壁紙/],['穴補修',/穴.*(?:補修|修理|埋)|(?:補修|修理).*穴/],['ドア補修',/(?:ドア|扉).*補修|補修.*(?:ドア|扉)/],['窓枠補修',/窓枠/],['CF/クッションフロア',/\bCF\b|クッションフロア/i],['巾木',/巾木|幅木/],['障子',/障子/],['天井塗装',/天井.*塗装|塗装.*天井/],['ガラスシート',/ガラス.*(?:シート|フィルム)/],['ダイノック',/ダイノック|ダイノク/],['フロアタイル',/フロアタイル/]];
function rawContent(s){return (s.items||s.snapshot?.items||[]).map(i=>String(i.content||'')).filter(Boolean).join(' / ')||s.content||s.snapshot?.content||(s.linkedInvoice?.items||[]).map(i=>String(i.content||'')).filter(Boolean).join(' / ')||s.linkedInvoice?.content||s.tadashi||s.snapshot?.tadashi||'';}
const formalType=t=>['receipt','invoice','onoda'].includes(t);
const formalContent=s=>s.docType==='receipt'?s.tadashi||summary(s):summary(s);
const formalDate=s=>s.docType==='receipt'?s.invoiceDate||s.paymentDate:s.workDate||s.salesDate||s.invoiceDate;
function formalCalendarTitle(s,amount){
 const short=value=>String(value||'').split(/\r?\n|\s*[／/｜|、,]\s*/).map(t=>t.trim()).find(Boolean)?.slice(0,120)||'';
 const content=String(s.items?.[0]?.content||'').trim().slice(0,120)||[s.summary,s.bizJobMemo,s.tadashi,s.content,formalContent(s)].map(short).find(Boolean)||'工事';
 return [s.customerName,content,'¥'+amount.toLocaleString('ja-JP'),s.docType==='receipt'?'領収済':'請求済'].join('｜');
}
// Only the document currently owning the schedule's status may refresh its title.
function formalTitleNeedsRepair(row,link){
 const p=row.payload,s=p.snapshot||{},receipt=p.docType==='receipt';
 return A.live(p)&&formalType(p.docType)&&s.customerName?.trim()&&p.amount>0&&link&&A.live(link)&&link.googleStatus!=='cancelled'&&link[receipt?'linkedReceiptId':'linkedInvoiceId']===row.id&&link.status===(receipt?'領収済':'請求済')&&link.title!==formalCalendarTitle(s,Number(link.officialAmount??p.amount));
}
function projectCategory(s){const texts=(s.items||s.snapshot?.items||[]).map(i=>String(i.content||'')).filter(Boolean);if(!texts.length)texts.push(rawContent(s)||s.projectCategory||'');const found=new Set();for(const text of texts){let matched=false;for(const [name,re]of CATEGORY_RULES)if(re.test(text.normalize('NFKC'))){found.add(name);matched=true;}}return [...CATEGORY_RULES.map(r=>r[0]),'その他'].filter(n=>found.has(n)).join('・')||'その他';}
// Filename selection is independent of the multi-category Calendar metadata.
const FEE_ITEM=/出張費|材料費|雑費|諸経費|交通費|駐車(?:場)?(?:代|料金|費)|処分費|運搬費/;
function filenameProject(s){
 const source={...(s.snapshot||{}),...s},linked=source.linkedInvoice||{};
 const texts=(source.items?.length?source.items:linked.items||[]).map(i=>String(i.content||'').trim()).filter(Boolean);
 if(!texts.length)texts.push(...String(source.content||linked.content||source.tadashi||'').split(/\s*[／/・、,]\s*/).filter(Boolean));
 const work=texts.filter(t=>!FEE_ITEM.test(t.normalize('NFKC')));
 for(const text of work){const normalized=text.normalize('NFKC');const matches=[...CATEGORY_RULES,['網戸張替',/網戸/]].map(([name,re])=>({name,index:normalized.search(re)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index);if(matches.length)return matches[0].name;}
 return work[0]||'工事';
}
const safeFilename=name=>name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_')+'.pdf';
function filenameDate(s){const date=s.invoiceDate||s.date||'',m=String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?{date:m[1].slice(-2)+'／'+Number(m[2])+'／'+Number(m[3]),month:Number(m[2])}:{date:'',month:''};}
function onodaFilename(s){const value=s.invoiceDate||s.date||'',m=String(value).match(/^(\d{4})-(\d{2})/),last=m?new Date(Date.UTC(Number(m[1]),Number(m[2]),0)).getUTCDate():null;const {date,month}=filenameDate({...s,invoiceDate:m?m[1]+'-'+m[2]+'-'+String(last).padStart(2,'0'):value});return safeFilename(date+' dynast合同会社様'+(month?month+'月分':'')+'クロス張替請求書');}
function documentFilename(value){const s={...(value.snapshot||{}),...value};if(s.docType==='onoda')return onodaFilename(s);const customer=String(s.customerName||s.customer||'').trim(),honorific=customer?(customer.endsWith('様')?customer:customer+'様'):'';return safeFilename(filenameDate(s).date+' '+honorific+filenameProject(s)+({invoice:'請求書',estimate:'見積書',receipt:'領収書'}[s.docType||'estimate']));}
function estimateFilename(s){return documentFilename({...s,docType:'estimate'});}
function parseCalendar(title){
 const tokens=String(title||'').normalize('NFKC').replace(/(\d),(?=\d{3}(?:\D|$))/g,'$1').split(/[、,，｜|]/).map(t=>t.trim()).filter(Boolean);
 let amount=0,payment='',area='',customer='',work='';
 const amountPattern=/^[¥￥]?([0-9]+(?:\.[0-9]+)?)(万)?円?$/;
 for(const t of tokens){const m=t.replace(/\s/g,'').match(amountPattern);if(m&&(m[2]||Number(m[1])>=1000))amount=Math.round(Number(m[1])*(m[2]?10000:1));if(/現金/.test(t))payment='現金';else if(/振込|振り込み|振込み/.test(t))payment='銀行振込';if(/(?:区|市|町|村)$/.test(t))area=t;}
 const words=tokens.flatMap(t=>{const m=t.match(/^(.+?様)\s+(.+)$/);return m?[m[1],m[2]]:[t];}).filter(t=>!amountPattern.test(t.replace(/\s/g,''))&&!/現金|振込|請求|領収|見積|施工予定|入金済|^(?:[0-9.]+\s*)?km$/i.test(t)&&t!==area);
 work=words.find(t=>CATEGORY_RULES.some(([,re])=>re.test(t)))||words[1]||'';
 customer=(words.find(t=>t!==work&&!/^¥/.test(t))||'').replace(/\s+/g,'');
 return {amount,payment,area,customer,work,projectCategory:projectCategory({content:work})};
}
function schedule(e,p,link,ids,date){date=A.date(date);const end=new Date(date+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);return {...link,id:ids.calendarEventId,documentId:link.documentId||e.documentId||'',estimateId:e.id,linkedEstimateId:e.id,projectId:p.id,customerName:e.customer,projectCategory:projectCategory(e),officialAmount:e.amount,status:'施工予定',workDate:date,date,start:date,end:end.toISOString().slice(0,10),title:[e.customer,projectCategory(e),'¥'+Number(e.amount||0).toLocaleString('ja-JP'),'施工予定'].join('｜'),source:'google',googleEventId:link.googleEventId||e.googleEventId||ids.googleEventId,googleCalendarId:link.googleCalendarId||link.calendarId||e.calendarId||'',calendarId:link.calendarId||link.googleCalendarId||e.calendarId||'',googleCreatePending:link.googleEventId||e.googleEventId?!!link.googleCreatePending:true,googlePatchPending:true};}
function canDeleteMisregistration(p){return p.sourceType==='system-error'&&p.confirmed!==true&&!p.invoiceNo&&!p.snapshot?.invoiceNo&&!['saleId','receivableId','paymentId','calendarEventId','googleEventId','projectId','estimateId','revisedFromDocumentId','revisedToDocumentId','duplicateOfDocumentId'].some(k=>p[k]||p.snapshot?.[k]);}
function calendarTime(value){if(!value||String(value).length<=10)return '終日';const text=String(value),d=new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(text)?text:text+'+09:00');return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d):'未定';}
function numberingMinute(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.year+parts.month+parts.day+'-'+parts.hour+parts.minute;
}
function createService(client,{now=()=>new Date()}={}){
 const stable=async(prefix,value)=>prefix+'_'+(await client.digest(String(value))).slice(0,48);
 const eventId=event=>stable('cal',event.googleEventId||event.id);
 async function execute(cmd,numberRetries=0){
 cmd=core.normalizeDates(cmd);
 // Compatibility dispatch only: keep persisted commands and fingerprints intact.
 const receiptRepair=['repairReceipt','backfillReceiptCash','backfillReceiptAccounting'].includes(cmd.type);
 // Identity belongs to the submitted operation, never to its business contents.
 if(cmd.type==='payment'&&cmd.manualConfirmed){if(client.getState().role!=='admin')throw Error('確認済み入金の登録は管理者のみです。');if(!cmd.paymentId||!cmd.operationId)throw Error('入金の操作IDがありません。');}
 if(cmd.type==='deleteMisregistration')cmd={...cmd,operationId:'delete_error_'+cmd.documentId+'_'+cmd.expectedRevision};
 let allocated=null;const observed=[];
 const lifecycle=cmd.type==='documentStatus'||(cmd.type==='saveDocument'&&cmd.revisedFromDocumentId);
 if(cmd.type==='historicalPdfImport'&&client.getState().role!=='admin')throw Error('過去帳票取込は管理者のみです。');
 const importSeed=cmd.type==='historicalPdfImport'?{documents:await client.listRecords('documents'),sales:await client.listRecords('sales')}:null;
 const repairing=receiptRepair||cmd.type==='repairFormalDocument';
 if(repairing&&client.getState().role!=='admin')throw Error('正式帳票の補録は管理者のみです。');
 const calendarSeed=(repairing||['calendar','registerCalendarSale'].includes(cmd.type)||cmd.type==='saveDocument'&&formalType(cmd.snapshot?.docType))?await client.listRecords('calendarLinks'):[];
 const saleSeed=(repairing||cmd.type==='registerCalendarSale'||cmd.type==='saveDocument'&&cmd.snapshot?.docType==='receipt')?await client.listRecords('sales'):[];
 const deletionSeed=cmd.type==='deleteMisregistration'?Object.fromEntries(await Promise.all(['documents','sales','receivables','payments','projects','estimates','calendarLinks','bankTransactions','cashLedger'].map(async n=>[n,await client.listRecords(n)]))):null;
 const paymentSeed=(repairing||lifecycle||cmd.type==='saveDocument'&&cmd.snapshot?.docType==='receipt')?await client.listRecords('payments'):[];
 const cleanup=typeof module==='object'&&module.exports?require('./test-data-cleanup.js'):globalThis.TsukinowaTestCleanup;
 const cleanupPlan=cmd.type==='cleanTestData'?cleanup.plan(Object.fromEntries(await Promise.all(cleanup.COLLECTIONS.map(async n=>[n,await client.listRecords(n)])))):null;
 try{return await client.transact(cmd.operationId,cmd,async({read,write:rawWrite,remove,who,archiveAudit,reserveDocumentNumber,reserveUnique})=>{
  const paymentSales=new Map();
  const write=async(name,id,payload,action,expectedRevision)=>{if(name==='payments'&&payload.saleId&&!(cmd.type==='calendar'&&payload.sourceType==='calendar-cash')){const sale=await read(anchorCollection(payload.saleId),payload.saleId);if(sale){if(!A.live(sale.payload)&&!payload.deletedAt)throw Error('無効な請求書には入金できません。');const ids=paymentSales.get(payload.saleId)||new Set(sale.payload.paymentIds||[]);ids.add(id);paymentSales.set(payload.saleId,ids);}}const revision=await rawWrite(name,id,payload,action,expectedRevision);await AD.mirrorCash(name,id,payload,read,rawWrite);return revision;};
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
  if(cmd.type==='registerCalendarSale'){
    if(who.role!=='admin')throw Error('売上登録は管理者のみです。');
    const row=await read('calendarLinks',cmd.id);if(!row||row.payload.deletedAt)throw Error('日程が見つかりません。');
    const e=row.payload,ids=new Set([cmd.id,...calendarSeed.filter(r=>e.googleEventId&&r.payload.googleEventId===e.googleEventId).map(r=>r.id)]);
    const candidates=new Set(saleSeed.filter(r=>ids.has(r.payload.calendarEventId)||e.googleEventId&&r.payload.googleEventId===e.googleEventId).map(r=>r.id));
    for(const id of ids){const link=await read('calendarLinks',id);for(const key of ['saleId','cashSaleId','receiptSaleId'])if(link?.payload[key])candidates.add(link.payload[key]);candidates.add('calendar_cash_'+id);for(const key of ['documentId','linkedInvoiceId','linkedReceiptId'])if(link?.payload[key]){const doc=await read('documents',link.payload[key]);if(doc?.payload.saleId)candidates.add(doc.payload.saleId);candidates.add('sale_'+link.payload[key]);}}
    for(const id of candidates){const sale=await read('sales',id);if(sale&&A.live(sale.payload))return {saleId:id,registered:true};}
    if(e.googleStatus==='cancelled')throw Error('取消済みの日程は登録できません。');
    const s=cmd.sale||{},amount=A.money(s.amount),date=A.date(s.salesDate),customer=String(s.customer||'').trim()||'現金客',content=String(s.content||'').trim(),method=s.paymentMethod;
    if(!content||amount<=0||!['銀行振込','現金','プラットフォーム経由','その他'].includes(method))throw Error('内容・金額・入金経路を確認してください。');
    const id='calendar_cash_'+cmd.id,prior=await read('sales',id);if(prior)throw Error('過去の売上記録があります。管理者が確認してください。');
    const paymentId='pay_'+id,cash=method==='現金';
    await write('sales',id,{id,sourceType:cash?'calendar-cash':'calendar-manual',sourceId:cmd.id,documentId:'',documentStatus:'active',customer,content,projectCategory:projectCategory({content}),amount,salesDate:date,saleDate:date,invoiceDate:'',paymentMethod:method,calendarEventId:cmd.id,googleEventId:e.googleEventId||'',calendarId:e.calendarId||e.googleCalendarId||'',manualConfirmed:true,memo:String(s.memo||''),paymentIds:cash?[paymentId]:[],paymentVersion:0});
    if(cash)await write('payments',paymentId,{id:paymentId,paymentId,saleId:id,sourceType:'calendar-cash',sourceId:cmd.id,documentId:'',amount,paymentDate:date,date,method,confirmation:'cash-received',memo:String(s.memo||'日程から売上登録')},'payment');
    for(const alias of ids){const link=await read('calendarLinks',alias);if(link)await write('calendarLinks',alias,{...link.payload,saleId:id,...(cash?{cashSaleId:id}:{}),manualSaleConfirmed:true});}
    return {saleId:id,registered:true};
  }
  if(cmd.type==='calendar'){
    const e=clone(cmd.event),existing=e.googleEventId?calendarSeed.find(r=>r.payload.googleEventId===e.googleEventId):null,id=existing?.id||await eventId(e),row=await read('calendarLinks',id),old=row?.payload||{};
    if(old.calendarId&&e.googleCalendarId&&old.calendarId!==e.googleCalendarId)throw Error('同じGoogle event IDに異なるカレンダーが指定されています。');
    const formal=!!(old.documentId||old.linkedInvoiceId||old.linkedEstimateId||old.projectId);
    const incoming={id,googleEventId:e.googleEventId||'',calendarId:e.googleCalendarId||old.calendarId||'',googleCalendarId:e.googleCalendarId||old.calendarId||'',source:e.source||(e.googleEventId?'google':'ics')};
    for(const k of ['date','start','end','updated','htmlLink','uid'])incoming[k]=e[k]||'';
    incoming.googleLatestTitle=e.title||'';incoming.googleOriginalDescription=e.description||'';incoming.googleStatus=e.googleStatus||'confirmed';
    const parsed=parseCalendar(e.title);
    if(!formal){for(const k of ['title','originalTitle','description','location'])incoming[k]=e[k]||'';Object.assign(incoming,{customerName:parsed.customer,projectCategory:parsed.projectCategory,area:parsed.area,amount:parsed.amount,paymentMethod:parsed.payment});}
    const cashSaleId=old.cashSaleId||'calendar_cash_'+id,paymentId='pay_'+cashSaleId,cashSale=await read('sales',cashSaleId),cashPayment=await read('payments',paymentId);
    if(old.manualSaleConfirmed){/* Explicitly confirmed accounting survives later title parsing. */}
    else if(e.googleStatus==='cancelled'&&cashSale){incoming.accountingReviewRequired=true;await write('sales',cashSaleId,{...cashSale.payload,accountingReviewRequired:true,reviewReason:'Google予定が取消・削除されました。入金を確認してください。'});}
    else if(!formal&&!cashSale?.payload.documentId&&parsed.work&&parsed.amount>0&&parsed.payment==='現金'&&(!cashSale||cashSale.payload.amount===parsed.amount)&&(!cashPayment||cashPayment.payload.amount===parsed.amount)){
      A.date(e.date);incoming.cashSaleId=cashSaleId;
      // The parser keeps absent customers empty; persisted cash anchors share the rules-compatible placeholder.
      const customer=parsed.customer||'現金客';incoming.customerName=customer;
      // Stable event anchors update the existing accounting records; formal documents lock them.
      const sale={...(cashSale?.payload||{}),id:cashSaleId,sourceType:'calendar-cash',sourceId:id,documentId:'',documentStatus:'active',customer,content:parsed.work,projectCategory:parsed.projectCategory,area:parsed.area,amount:parsed.amount,salesDate:e.date,saleDate:e.date,invoiceDate:'',paymentMethod:'現金',calendarEventId:id,googleEventId:e.googleEventId,calendarId:incoming.calendarId,paymentIds:[...new Set([...(cashSale?.payload.paymentIds||[]),paymentId])],paymentVersion:(cashSale?.payload.paymentVersion||0)+1};
      await write('sales',cashSaleId,sale);
      await write('payments',paymentId,{...(cashPayment?.payload||{}),id:paymentId,paymentId,saleId:cashSaleId,sourceType:'calendar-cash',sourceId:id,documentId:'',amount:parsed.amount,paymentDate:e.date,date:e.date,method:'現金',confirmation:'cash-received',memo:'Google現場現金入金'} ,'payment');
    }else if(!formal&&cashSale&&!cashSale.payload.documentId){incoming.accountingReviewRequired=true;await write('sales',cashSaleId,{...cashSale.payload,accountingReviewRequired:true,reviewReason:'Google予定の現金・金額情報が変更されました。入金を確認してください。'});}

    if(old.workDate){if(old.googlePatchPending||!e.date){for(const k of ['date','start','end'])incoming[k]=old[k];}else{incoming.workDate=e.date||old.workDate;incoming.location=e.location||'';for(const [collection,ref] of [['estimates',old.linkedEstimateId],['projects',old.projectId]])if(ref){const linked=await read(collection,ref);if(linked)await write(collection,ref,{...linked.payload,workDate:incoming.workDate,workStart:e.start||'',workEnd:e.end||'',location:e.location||''});}}}
    const revision=await write('calendarLinks',id,{...old,...incoming});return {id,revision};
  }
  async function relatedPayments(saleId,ownPaymentId=''){
    const sale=saleId?await read(anchorCollection(saleId),saleId):null;
    const ids=new Set([...(sale?.payload.paymentIds||[]),...paymentSeed.filter(p=>p.payload.saleId===saleId).map(p=>p.id),...(ownPaymentId?[ownPaymentId]:[])]);
    const ps=[];for(const id of ids){const p=await read('payments',id);if(p&&!p.payload.deletedAt&&p.payload.confirmation!=='bank-marker')ps.push(p.payload);}return ps;
  }
  const tracked=async(n,id)=>{const r=await read(n,id);observed.push([n,id,r?.revision||0]);return r;};
  const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
  const conflict=()=>{throw Error('正式帳票の売上・入金・日程が一致しません。要確認');};
  async function findFormalDocumentCalendar(id,p,s,amount,date,{saving=false,parent=null,anchor=null,anchorId=p.saleId||s.saleId}={}){
    // Read every candidate again inside the transaction; list results are discovery only.
    const calendars=[];const explicit=p.calendarEventId||s.calendarEventId||anchor?.payload.calendarEventId;
    const generatedGoogleEventId=(s.docType==='receipt'?'r':'i')+(await client.digest((s.docType==='receipt'?'receipt_':'invoice_')+id)).slice(0,48),stableCalendarId=await eventId({googleEventId:p.googleEventId||s.googleEventId||generatedGoogleEventId});
    for(const key of new Set((explicit?[explicit]:[...calendarSeed.map(r=>r.id),stableCalendarId]).filter(Boolean))){
      const r=await tracked('calendarLinks',key),e=r?.payload;if(!e)continue;
      const parsed=parseCalendar(e.googleLatestTitle||e.title);
      const linked=key===explicit||e.linkedReceiptId===id||e.linkedInvoiceId===id||e.documentId===id||(p.googleEventId||s.googleEventId)&&e.googleEventId===(p.googleEventId||s.googleEventId)||anchorId&&[e.saleId,e.receiptSaleId,e.cashSaleId].includes(anchorId);
      const details=(e.workDate||e.date)===date&&norm(e.customerName||parsed.customer)===norm(s.customerName)&&norm(e.content||parsed.work)===norm(formalContent(s));
      if(!linked&&!details)continue;
      if(!A.live(e)||e.googleStatus==='cancelled')conflict();
      const knownAmount=Number(e.officialAmount??e.amount??parsed.amount);
      if(!(parent&&s.docType!=='receipt')&&!(s.docType==='receipt'&&e.manualSaleConfirmed)&&(details||knownAmount>0)&&knownAmount!==amount&&!(anchor&&s.saleId===anchorId&&anchor.payload.amount===knownAmount&&knownAmount>=amount))conflict();
      if(s.docType==='receipt'&&e.linkedReceiptId&&![id,parent?.payload.documentId].includes(e.linkedReceiptId)&&!s.saleId)throw Error('この日程には既に領収書があります。要確認');
      calendars.push({id:key,...r});
    }
    if(saving&&!parent&&explicit&&!calendars.length)conflict();
    if(calendars.length>1)conflict();
    const calendar=calendars[0],link=calendar?.payload||{};
    if((p.googleEventId||s.googleEventId)&&link.googleEventId&&(p.googleEventId||s.googleEventId)!==link.googleEventId)conflict();
    if(s.docType!=='receipt'&&link.linkedInvoiceId&&![id,parent?.payload.documentId].includes(link.linkedInvoiceId))throw Error('この予定には既に正式請求書があります。要確認');
    return {calendar,link,explicit,generatedGoogleEventId,stableCalendarId};
  }
  async function reconcileFormalDocumentCalendar(id,p,s,saleId,amount,date,{calendar,link,explicit,generatedGoogleEventId,stableCalendarId},{preserveDate=false,saving=false}={}){
    const googleEventId=link.googleEventId||p.googleEventId||s.googleEventId||generatedGoogleEventId;
    const calendarEventId=calendar?.id||explicit||stableCalendarId;
    if(!calendar&&await tracked('calendarLinks',calendarEventId))conflict();
    A.date(date);const end=new Date(date+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);
    const calendarId=link.googleCalendarId||link.calendarId||p.calendarId||s.calendarId||'';
    const receipt=s.docType==='receipt';
    const nextLink={...link,id:calendarEventId,documentId:id,[receipt?'linkedReceiptId':'linkedInvoiceId']:id,...(receipt?{receiptSaleId:saleId}:{}),saleId,customerName:s.customerName,content:formalContent(s),officialAmount:amount,projectCategory:projectCategory(s),paymentMethod:s.paymentMethod||'銀行振込',status:receipt?'領収済':'請求済',documentStatus:'active',date,workDate:date,start:date,end:end.toISOString().slice(0,10),source:'google',googleEventId,calendarId,googleCalendarId:calendarId,title:formalCalendarTitle(s,amount)};
    if(preserveDate&&calendar)for(const key of ['date','workDate','start','end']){if(link[key]!==undefined)nextLink[key]=link[key];else delete nextLink[key];}
    if(saving&&!Object.hasOwn(link,'saleId'))delete nextLink.saleId;
    if(core.canonical(link)!==core.canonical(nextLink)){nextLink.googleCreatePending=link.googleEventId?!!link.googleCreatePending:!(p.googleEventId||s.googleEventId);nextLink.googlePatchPending=true;}
    return {nextLink,calendarEventId,googleEventId,calendarId};
  }
  async function reconcileReceipt(id,p,{saving=false,parent=null}={}){
    const row=await read('documents',id),s=core.normalizeDates(p.snapshot||{}),amount=Number(p.amount),date=s.invoiceDate||p.invoiceDate||s.paymentDate||p.paymentDate;
    if(!A.live(p)||p.docType!=='receipt'||!s.customerName?.trim()||!(amount>0)||!date)return {skipped:true};
    const current={documents:[{id,payload:p}],sales:[],receivables:[],payments:[],calendarLinks:[],cashLedger:[]};
    for(const [n,key]of [[anchorCollection(p.saleId),p.saleId],['payments',p.paymentId],['calendarLinks',p.calendarEventId],['cashLedger',p.paymentId&&'cash_'+p.paymentId]])if(key){const r=await read(n,key);if(r)current[n].push({id:key,...r});}
    if(!saving&&!receiptAccountingNeedsRepair({id,payload:p},current))return {documentId:id,skipped:true};
    A.date(date);const paymentDate=A.date(s.paymentDate||p.paymentDate||date),method=s.paymentMethod;
    if(total(s)!==amount||!['現金','銀行振込','プラットフォーム経由','その他','オンライン決済'].includes(method))throw Error('領収書の金額・支払方法を確認してください。要確認');
    observed.push(['documents',id,row?.revision||0]);
    const anchorId=p.saleId||s.saleId,anchor=anchorId?await tracked(anchorCollection(anchorId),anchorId):null;
    const found=await findFormalDocumentCalendar(id,p,s,amount,date,{saving,parent,anchor,anchorId}),{calendar,link}=found;
    const saleIds=new Set([p.saleId,s.saleId,link.saleId,link.receiptSaleId,link.cashSaleId,'sale_'+id].filter(Boolean)),candidates=[];
    if(link.linkedInvoiceId){const d=await tracked('documents',link.linkedInvoiceId);if(!d||!A.live(d.payload)||!['invoice','onoda'].includes(d.payload.docType))conflict();saleIds.add(d.payload.saleId||'sale_'+link.linkedInvoiceId);}
    for(const seed of saleSeed){const a=seed.payload;
      if(a.documentId===id||calendar&&a.calendarEventId===calendar.id||link.googleEventId&&a.googleEventId===link.googleEventId||!a.documentId&&['calendar-cash','calendar-manual'].includes(a.sourceType)&&(a.salesDate||a.saleDate)===date&&norm(a.customer)===norm(s.customerName)&&norm(a.content)===norm(formalContent(s)))saleIds.add(seed.id);
    }
    for(const key of saleIds){const r=await tracked(anchorCollection(key),key);if(!r)continue;if(!A.live(r.payload))conflict();candidates.push({id:key,...r});}
    if(candidates.length>1)conflict();
    const sale=candidates[0],a=sale?.payload,saleId=sale?.id||'sale_'+id;
    const invoiceReceipt=a&&(s.saleId===saleId||a.documentId&&![id,parent?.payload.documentId].includes(a.documentId))&&!['receipt','receipt-cash','calendar-cash','calendar-manual'].includes(a.sourceType);
    if(calendar&&!invoiceReceipt&&(link.workDate||link.date)&&(link.workDate||link.date)!==date)conflict();
    const unnamedCash=a?.sourceType==='calendar-cash'&&!a.documentId&&a.customer==='現金客'&&calendar?.id===a.calendarEventId;
    if(a&&((a.amount!==amount&&!(invoiceReceipt&&a.amount>=amount))||!unnamedCash&&!parent&&!(saving&&invoiceReceipt)&&norm(a.customer)!==norm(s.customerName)))conflict();
    if(a&&!a.documentId&&!invoiceReceipt&&(!['calendar-cash','calendar-manual'].includes(a.sourceType)||(a.salesDate||a.saleDate)!==date))conflict();
    // An existing invoice remains the accounting anchor; never replace its document identity.
    if(a?.documentId&&![id,parent?.payload.documentId].includes(a.documentId)){const d=await tracked('documents',a.documentId);if(!d||!A.live(d.payload)||!['invoice','onoda'].includes(d.payload.docType)||d.payload.amount!==a.amount)conflict();}
    if(link.linkedInvoiceId&&link.linkedInvoiceId!==a?.documentId)conflict();
    if(link.documentId&&!invoiceReceipt&&![id,a?.documentId,parent?.payload.documentId].includes(link.documentId))conflict();
    const payments=[];
    for(const key of new Set([p.paymentId,parent?.payload.paymentId,'pay_'+id,...(a?.paymentIds||[]),...paymentSeed.filter(r=>r.payload.saleId===saleId||r.payload.documentId===id).map(r=>r.id)].filter(Boolean))){
      const r=await tracked('payments',key);if(!r)continue;
      const v=r.payload;
      if(invoiceReceipt&&v.documentId&&![id,parent?.payload.documentId].includes(v.documentId))continue;
      const compatible=A.confirmed(v)||v.confirmation==='pending-bank'&&method!=='現金'&&!v.bankTxnId;
      if(v.deletedAt||!compatible||v.saleId!==saleId||v.amount!==amount||v.paymentDate!==paymentDate||v.method!==method||v.documentId&&![id,parent?.payload.documentId].includes(v.documentId))conflict();payments.push({id:key,...r});
    }
    if(payments.length>1)conflict();
    const payment=payments[0],paymentId=payment?.id||parent?.payload.paymentId||'pay_'+id;
    if(invoiceReceipt){const others=await relatedPayments(saleId,paymentId);if(others.filter(A.confirmed).reduce((n,v)=>n+v.amount,0)+amount>a.amount)conflict();}
    if(parent&&payment&&A.confirmed(payment.payload)&&(payment.payload.amount!==amount||payment.payload.paymentDate!==paymentDate||payment.payload.method!==method))conflict();
    const {nextLink,calendarEventId,googleEventId,calendarId}=await reconcileFormalDocumentCalendar(id,p,s,saleId,invoiceReceipt?a.amount:amount,date,found,{preserveDate:invoiceReceipt,saving});
    if(saving)Object.assign(s,{calendarEventId});
    const document={...p,snapshot:saving?s:p.snapshot,saleId,paymentId,calendarEventId,googleEventId,calendarId,paymentDate};
    const sourceType=method==='現金'?'receipt-cash':'receipt';
    const nextSale=invoiceReceipt?(saving?a:{...a,calendarEventId,googleEventId,calendarId}):{...(a||{}),id:saleId,sourceType,sourceId:id,documentId:id,documentStatus:'active',customer:s.customerName,content:formalContent(s),projectCategory:projectCategory(s),amount,salesDate:date,saleDate:date,invoiceDate:'',paymentMethod:method,calendarEventId,googleEventId,calendarId};
    const nextPayment={...(payment?.payload||{}),id:paymentId,paymentId,saleId,documentId:id,sourceId:id,sourceType,amount,paymentDate,date:paymentDate,method,confirmation:method==='現金'?'cash-received':'bank-confirmed',platformName:s.platformName||payment?.payload.platformName||'',memo:payment?.payload.memo||'領収書から登録'};
    // A complete graph is a true no-op, including Google flags after successful sync.
    const same=(x,y)=>core.canonical(x??null)===core.canonical(y??null);
    const cash=method==='現金'?await tracked('cashLedger','cash_'+paymentId):null;
    const cashComplete=method!=='現金'||cash&&!cash.payload.deletedAt&&cash.payload.amount===amount&&cash.payload.date===paymentDate;
    if(same(p,document)&&same(a,nextSale)&&same(payment?.payload,nextPayment)&&same(link,nextLink)&&cashComplete)return {documentId:id,skipped:true};
    if(parent)await write('documents',parent.payload.documentId,{...parent.payload,status:'revised',reason:cmd.reason,revisedToDocumentId:id},'status change',cmd.expectedParentRevision);
    const revision=await write('documents',id,document,undefined,saving?cmd.expectedRevision:undefined);
    await write(anchorCollection(saleId),saleId,nextSale);
    await write('payments',paymentId,nextPayment,'payment');
    await write('calendarLinks',calendarEventId,nextLink);
    return saving?{documentId:id,saleId,paymentId,revision,snapshot:s,invoiceNo:s.invoiceNo,numberingMinute:s.numberingMinute,numberingSequence:s.numberingSequence}:{documentId:id,saleId,paymentId,repaired:true};
  }
  if(repairing){
    const row=await read('documents',cmd.documentId);if(!row||!A.live(row.payload)||!formalType(row.payload.docType))return {skipped:true};
    const key=row.payload.calendarEventId||row.payload.snapshot?.calendarEventId||calendarSeed.find(r=>r.payload[row.payload.docType==='receipt'?'linkedReceiptId':'linkedInvoiceId']===cmd.documentId)?.id;
    const existing=key?await tracked('calendarLinks',key):null;
    if(formalTitleNeedsRepair({id:cmd.documentId,...row},existing?.payload)){
      const link=existing.payload;
      await write('calendarLinks',key,{...link,title:formalCalendarTitle(row.payload.snapshot,Number(link.officialAmount??row.payload.amount)),googlePatchPending:true});
      return {documentId:cmd.documentId,repaired:true};
    }
    if(row.payload.docType==='receipt')return reconcileReceipt(cmd.documentId,row.payload);
    const p=row.payload,s=core.normalizeDates(p.snapshot||{}),date=formalDate(s),saleId=p.saleId;
    if(!date||!s.customerName?.trim()||!(p.amount>0)||!saleId)return {skipped:true};
    const sale=await tracked(anchorCollection(saleId),saleId);if(!sale||!A.live(sale.payload)||sale.payload.documentId!==cmd.documentId||sale.payload.amount!==p.amount)conflict();
    const found=await findFormalDocumentCalendar(cmd.documentId,p,s,p.amount,date,{anchor:sale,anchorId:saleId});
    if([found.link.saleId,found.link.receiptSaleId,found.link.cashSaleId].filter(Boolean).some(key=>key!==saleId))conflict();
    if(found.link.linkedInvoiceId===cmd.documentId&&found.link.googleEventId)return {skipped:true};
    const {nextLink,calendarEventId}=await reconcileFormalDocumentCalendar(cmd.documentId,p,s,saleId,p.amount,date,found);
    if(core.canonical(nextLink)===core.canonical(found.link))return {skipped:true};
    await write('calendarLinks',calendarEventId,nextLink);
    return {documentId:cmd.documentId,repaired:true};
  }
  if(cmd.type==='reconcileReceiptCalendarCash'){
    if(who.role!=='admin')return {skipped:true};
    const d=await read('documents',cmd.documentId);if(!d||!A.live(d.payload)||d.payload.docType!=='receipt')return {skipped:true};
    const p=d.payload,s=p.snapshot||{},calendarId=p.calendarEventId||s.calendarEventId,link=calendarId?await read('calendarLinks',calendarId):null;
    if(!link?.payload.cashSaleId||!p.saleId||link.payload.cashSaleId===p.saleId)return {skipped:true};
    const oldId=link.payload.cashSaleId,old=await read('sales',oldId),oldPay=await read('payments','pay_'+oldId),official=await read('sales',p.saleId),payment=await read('payments',p.paymentId||'pay_'+p.documentId);
    if(!old||!oldPay||!official||!payment)return {skipped:true,reviewRequired:true};
    const a=old.payload,b=oldPay.payload,r=official.payload,v=payment.payload,amount=total(s);
    if(a.sourceType!=='calendar-cash'||a.documentId||a.calendarEventId!==calendarId||a.sourceId!==calendarId||b.sourceType!=='calendar-cash'||b.documentId||b.bankTxnId||a.deletedAt||b.deletedAt||b.confirmation!=='cash-received'||r.sourceType!=='receipt-cash'||r.documentId!==p.documentId||v.documentId!==p.documentId||v.confirmation!=='cash-received'||v.bankTxnId||v.deletedAt||a.amount!==amount||b.amount!==amount||r.amount!==amount||v.amount!==amount||b.paymentDate!==s.invoiceDate||v.paymentDate!==s.invoiceDate||(a.paymentIds||[]).some(id=>id!=='pay_'+oldId))return {skipped:true,reviewRequired:true};
    const at=now().toISOString(),reason='同じ日程に関連する正式現金領収書へ統合（自動取込の重複）';
    await write('sales',oldId,{...a,documentStatus:'duplicate',deletedAt:at,deleteReason:reason,duplicateOfSaleId:p.saleId},'status change');
    await write('payments','pay_'+oldId,{...b,deletedAt:at,deleteReason:reason,duplicateOfPaymentId:v.paymentId},'adjustment');
    await write('calendarLinks',calendarId,{...link.payload,cashSaleId:'',receiptSaleId:p.saleId,documentId:p.documentId,linkedReceiptId:p.documentId,customerName:p.customerName,officialAmount:amount,status:'領収済',title:formalCalendarTitle({...s,customerName:p.customerName},amount),googlePatchPending:true},'status change');
    return {documentId:p.documentId,reconciled:true};
  }
  if(cmd.type==='archiveDocument'){
    if(who.role!=='admin')throw Error('履歴削除は管理者のみです。');
    const row=await read('documents',cmd.documentId);
    if(!row||!['void','duplicate','revised','cancelled'].includes(row.payload.status))throw Error('無効な履歴帳票を選択してください。');
    if(row.payload.deletedAt)return {documentId:cmd.documentId,unchanged:true};
    await write('documents',cmd.documentId,{...row.payload,deletedAt:now().toISOString(),deleteReason:'履歴から削除'},'status change',cmd.expectedRevision);
    return {documentId:cmd.documentId};
  }
  if(cmd.type==='deleteMisregistration'){
    if(who.role!=='admin')throw Error('誤登録削除は管理者のみです。');
    const row=await read('documents',cmd.documentId);if(!row)return {documentId:cmd.documentId,unchanged:true};
    const p=row.payload,reason=String(cmd.reason||'').trim();
    if(!reason||!canDeleteMisregistration(p))throw Error('正式帳票・関連記録は削除できません。無効化を使用してください。');
    for(const [name,records] of Object.entries(deletionSeed))for(const r of records){
      if(name==='documents'&&r.id===cmd.documentId)continue;
      if(['sale_'+cmd.documentId,'pay_'+cmd.documentId,'est_'+cmd.documentId,'receivable_'+cmd.documentId].includes(r.id)||JSON.stringify(r.payload).includes(JSON.stringify(cmd.documentId)))throw Error('関連記録があります。無効化を使用してください。');
    }
    await remove('documents',cmd.documentId,cmd.expectedRevision);
    return {documentId:cmd.documentId,backup:p,backupRevision:row.revision,reason};
  }
  if(cmd.type==='documentStatus'){
    if(who.role!=='admin')throw Error('帳票管理は管理者のみ実行できます。');
    if(!['void','cancelled','duplicate'].includes(cmd.status))throw Error('状態が不正です。');
    const row=await read('documents',cmd.documentId);if(row?.payload.status===cmd.status)return {documentId:cmd.documentId,status:cmd.status,unchanged:true};if(!row||!A.live(row.payload))throw Error('有効な正式帳票を選択してください。');
    const p=row.payload,reason=String(cmd.reason||'').trim();if(!reason)throw Error('理由を入力してください。');
    const saleId=p.saleId||p.receivableId||(['invoice','onoda'].includes(p.docType)?'sale_'+cmd.documentId:p.snapshot?.saleId||'');
    const paymentId=p.paymentId||(p.docType==='receipt'?'pay_'+cmd.documentId:'');
    const payments=await relatedPayments(saleId,paymentId);
    if(payments.some(A.confirmed))throw Error('確認済み入金があります。付款関係・返金・取消を先に処理するか、訂正版を作成してください。');
    if(payments.length)throw Error('未確認の入金があります。先に入金関係を整理してください。');
    if(cmd.status==='duplicate'){
      const target=await read('documents',cmd.duplicateOfDocumentId||'missing');
      if(!target||target.payload.documentId===p.documentId||!A.live(target.payload)||target.payload.docType!==p.docType||String(target.payload.customerName||'').normalize('NFKC').replace(/\s/g,'')!==String(p.customerName||'').normalize('NFKC').replace(/\s/g,''))throw Error('同じ種類の有効な原帳票IDを指定してください。');
    }
    await write('documents',p.documentId,{...p,status:cmd.status,reason,duplicateOfDocumentId:cmd.status==='duplicate'?cmd.duplicateOfDocumentId:''},'status change',cmd.expectedRevision);
    if(saleId){const sale=await read(anchorCollection(saleId),saleId);if(sale)await write(anchorCollection(saleId),saleId,{...sale.payload,documentStatus:cmd.status},'status change');}
    if(p.docType==='estimate'){const id=p.estimateId||'est_'+p.documentId,e=await read('estimates',id);if(e){await write('estimates',id,{...e.payload,documentStatus:cmd.status},'status change');if(e.payload.projectId){const project=await read('projects',e.payload.projectId);if(project)await write('projects',e.payload.projectId,{...project.payload,documentStatus:cmd.status},'status change');}}}
    if(p.calendarEventId){const link=await read('calendarLinks',p.calendarEventId);if(link&&link.payload.documentId===p.documentId)await write('calendarLinks',p.calendarEventId,{...link.payload,documentStatus:cmd.status,status:cmd.status==='duplicate'?'重複':cmd.status==='cancelled'?'取消':'無効',title:[p.customerName,summary(p.snapshot),cmd.status==='duplicate'?'重複':cmd.status==='cancelled'?'取消':'無効'].join('｜'),googlePatchPending:true},'status change');}
    return {documentId:p.documentId,status:cmd.status};
  }
  if(cmd.type==='historicalPdfImport'){
    if(who.role!=='admin')throw Error('過去帳票取込は管理者のみです。');
    const d=H.validate(cmd.draft),hash=String(cmd.sourceHash||''),id=cmd.documentId;
    if(!id||!/^([a-f0-9]{64})$/.test(hash)||!String(cmd.sourceFileName||'').trim())throw Error('PDF原本情報を確認してください。');
    const check=H.check(d,importSeed.documents,importSeed.sales,hash);
    if(check.duplicate)throw Error('既存帳票 '+check.duplicate.id+' と重複します。保存帳票を確認してください。');
    if(check.matches.length>1)throw Error('対応する売上が複数あります。既存記録を整理してください。');
    const matched=check.matches[0];
    if((matched?.id||'')!==(cmd.linkedSaleId||''))throw Error('対応する売上が変更されました。再確認してください。');
    const sale=matched?await read('sales',matched.id):null;
    if(matched&&(!sale||sale.revision!==matched.revision||!A.live(sale.payload)))throw Error('既存売上が変更されました。再確認してください。');
    if(sale&&(!H.sameTuple(sale.payload,d)||sale.payload.documentId&&importSeed.documents.some(r=>r.id===sale.payload.documentId)))throw Error('既存売上の金額・顧客・日付または関連帳票を確認してください。');
    if(await read('documents',id))throw Error('帳票IDは既に存在します。');
    for(const value of ['invoice:'+H.normalize(d.invoiceNo),'source:'+hash,'tuple:'+JSON.stringify([H.normalize(d.customerName),d.issueDate,d.invoiceAmount])])await reserveUnique('historical_'+await client.digest(value),{documentId:id,invoiceNo:d.invoiceNo});
    // Also share the formal numbering reservation namespace when the original number is a valid ID.
    if(/^[A-Za-z0-9_-]+$/.test(d.invoiceNo))await reserveUnique('documentNumber_'+d.invoiceNo,{documentId:id,invoiceNo:d.invoiceNo});
    const whetherCreatedSale=!sale&&cmd.createSale===true,saleId=sale?matched.id:whetherCreatedSale?'sale_'+id:'',receivableId=saleId?'':'receivable_'+id;
    const snapshot={documentId:id,docType:'invoice',customerName:d.customerName,invoiceNo:d.invoiceNo,invoiceDate:d.issueDate,issueDate:d.issueDate,dueDate:d.dueDate,salesDate:d.issueDate,billingMonth:d.billingMonth,remarks:d.remarks,items:d.items,invoiceAmount:d.invoiceAmount,sourceType:'historicalPdfImport'};
    const source={sourceType:'historicalPdfImport',sourceFileName:cmd.sourceFileName,sourceHash:hash,importedAt:now().toISOString(),whetherCreatedSale};
    const document={...source,documentId:id,docType:'invoice',status:'active',confirmed:true,customerName:d.customerName,invoiceNo:d.invoiceNo,amount:d.invoiceAmount,invoiceAmount:d.invoiceAmount,issueDate:d.issueDate,invoiceDate:d.issueDate,dueDate:d.dueDate,salesDate:d.issueDate,saleId,receivableId,snapshot};
    await write('documents',id,document,'historicalPdfImport',0);
    if(sale)await write('sales',saleId,{...sale.payload,documentId:id,sourceId:id},'update',sale.revision);
    else await write(whetherCreatedSale?'sales':'receivables',saleId||receivableId,{...source,id:saleId||receivableId,documentId:id,sourceId:id,docType:'invoice',invoiceNo:d.invoiceNo,customer:d.customerName,amount:d.invoiceAmount,salesDate:d.issueDate,saleDate:d.issueDate,invoiceDate:d.issueDate,documentStatus:'active',content:d.remarks,receivableOnly:!whetherCreatedSale,paymentIds:[],paymentVersion:0},'create',0);
    return {documentId:id,saleId,receivableId,whetherCreatedSale};
  }
  if(cmd.type==='saveDocument'){
    const s=cleanSnapshot(cmd.snapshot),id=s.documentId;
    if(!id||!['invoice','estimate','receipt','onoda'].includes(s.docType))throw Error('帳票IDまたは種類が不正です。');
    const old=await read('documents',id),amount=total(s);
    if(old){s.invoiceNo=old.payload.snapshot.invoiceNo;if(s.docType==='receipt'&&old.payload.snapshot.paymentDate&&!s.paymentDate)s.paymentDate=s.invoiceDate;if(formalType(s.docType)&&!s.calendarEventId&&old.payload.snapshot.calendarEventId)s.calendarEventId=old.payload.snapshot.calendarEventId;for(const k of ['numberingMinute','numberingSequence'])if(old.payload.snapshot[k]!==undefined)s[k]=old.payload.snapshot[k];}
    if(s.docType==='estimate')s.estimateId=old?.payload.estimateId||'est_'+id;
    const parent=cmd.revisedFromDocumentId?await read('documents',cmd.revisedFromDocumentId):null;
    if(cmd.revisedFromDocumentId){if(who.role!=='admin')throw Error('訂正版は管理者のみ作成できます。');if(!parent||!A.live(parent.payload)||parent.payload.docType!==s.docType||parent.payload.documentId===id)throw Error('訂正元は同じ種類の有効な帳票を選択してください。');if(parent.revision!==cmd.expectedParentRevision)throw Error('訂正元が変更されました。開き直してください。');if(!String(cmd.reason||'').trim())throw Error('訂正理由を入力してください。');
      for(const k of ['calendarEventId','googleEventId','calendarId','projectId','estimateId'])s[k]=parent.payload[k]||parent.payload.snapshot[k]||'';
      if(s.docType==='receipt')s.saleId=parent.payload.snapshot.saleId||'';
    }
    if(!Number.isFinite(amount)||amount<0)throw Error('金額を確認してください。');
    if(old&&old.payload.docType!==s.docType)throw Error('帳票の種類は変更できません。新規帳票を作成してください。');
    // A read/download with identical content never mutates the document or accounting records.
    if(old&&core.canonical(old.payload.snapshot)===core.canonical(s))return {documentId:id,revision:old.revision,snapshot:s,invoiceNo:s.invoiceNo,numberingMinute:s.numberingMinute||'',numberingSequence:s.numberingSequence||0,unchanged:true};
    if((old?.revision||0)!==cmd.expectedRevision){const e=Error('帳票が別の端末で更新されました。保存内容を保持したまま再確認してください。');e.code='conflict';throw e;}
    if(old)throw Error('正式帳票は上書きできません。「訂正版を作成」を使用してください。');
    if(s.docType==='receipt'){if(!s.customerName?.trim()||amount<=0||!s.invoiceDate||!s.paymentMethod)throw Error('お客様名・領収金額・日付・支払方法を確認してください。');s.paymentDate=s.paymentDate||s.invoiceDate;}

    if(s.docType==='receipt'){
      const number=await reserveDocumentNumber(numberingMinute(now()),id);allocated=number;Object.assign(s,number);
      const document={status:'active',reason:cmd.reason||'',revisedFromDocumentId:parent?.payload.documentId||'',documentId:id,docType:'receipt',amount,customerName:s.customerName,salesDate:s.salesDate||s.invoiceDate,workDate:'',invoiceDate:s.invoiceDate,paymentDate:s.paymentDate,snapshot:s,saleId:s.saleId||parent?.payload.saleId||'',paymentId:parent?.payload.paymentId||'',calendarEventId:s.calendarEventId||'',googleEventId:s.googleEventId||'',calendarId:s.calendarId||'',estimateId:s.estimateId||'',projectId:s.projectId||'',confirmed:true};
      return reconcileReceipt(id,document,{saving:true,parent});
    }
    const formal=s.docType!=='estimate',date=formalDate(s);
    const found=formal?await findFormalDocumentCalendar(id,{},s,amount,date,{saving:true,parent,anchorId:s.saleId||parent?.payload.saleId||'sale_'+id}):null;
    const calendar=formal?found.calendar:s.calendarEventId?await read('calendarLinks',s.calendarEventId):null;
    const link=calendar?.payload||null;
    if(s.docType==='estimate'&&link?.linkedEstimateId&&link.linkedEstimateId!=='est_'+id&&link.linkedEstimateId!==(parent?(parent.payload.estimateId||'est_'+parent.payload.documentId):''))throw Error('この予定には既に見積があります。見積履歴から開いてください。');
    if(formal&&s.saleId&&[link?.saleId,link?.cashSaleId,link?.receiptSaleId].filter(Boolean).some(key=>key!==s.saleId))conflict();
    if(formal&&link?.documentId&&![id,parent?.payload.documentId].includes(link.documentId)){const linked=await read('documents',link.documentId);if(linked&&['invoice','onoda'].includes(linked.payload.docType))conflict();}
    const saleId=link?.saleId||link?.cashSaleId||link?.receiptSaleId||s.saleId||parent?.payload.saleId||parent?.payload.receivableId|| (parent&&['invoice','onoda'].includes(s.docType)?'sale_'+parent.payload.documentId:'sale_'+id);
    const estimateId=parent?(parent.payload.estimateId||'est_'+parent.payload.documentId):'est_'+id;
    if(s.docType==='estimate')s.estimateId=estimateId;
    const minute=numberingMinute(now());
    const number=await reserveDocumentNumber(minute,id);allocated=number;
    Object.assign(s,number);
    const document={status:'active',reason:cmd.reason||'',revisedFromDocumentId:parent?.payload.documentId||'',saleId:['invoice','onoda'].includes(s.docType)?saleId:'',paymentId:'',documentId:id,docType:s.docType,amount,customerName:s.customerName||'',salesDate:s.docType==='estimate'?'':s.salesDate||s.invoiceDate||'',workDate:s.docType==='estimate'?(s.workDate||s.salesDate||''):'',invoiceDate:s.invoiceDate||'',paymentDate:s.paymentDate||'',snapshot:s,googleEventId:link?.googleEventId||s.googleEventId||'',calendarId:link?.calendarId||s.calendarId||'',calendarEventId:s.calendarEventId||'',estimateId:s.estimateId||'',projectId:s.projectId||'',confirmed:true};
    let estimate=null,sale=null;
    if(s.docType==='estimate')estimate=await read('estimates',estimateId);
    if(s.docType==='invoice'||s.docType==='onoda'){sale=await read(anchorCollection(saleId),saleId);if(sale&&(sale.payload.manualConfirmed||['receipt','receipt-cash'].includes(sale.payload.sourceType))){const ps=await relatedPayments(saleId);if(amount<ps.filter(A.confirmed).reduce((n,p)=>n+p.amount,0))throw Error('請求金額が確認済み入金を下回ります。入金を確認してください。');}}
    if(formal&&sale?.payload.documentId&&![id,parent?.payload.documentId].includes(sale.payload.documentId)){const linked=await read('documents',sale.payload.documentId);if(linked&&['invoice','onoda'].includes(linked.payload.docType))conflict();}
    if(parent){
      const ps=await relatedPayments(saleId);
      const paid=ps.filter(A.confirmed).reduce((n,p)=>n+p.amount,0);
      if(['invoice','onoda'].includes(s.docType)&&amount<paid)throw Error('訂正金額が確認済み入金を下回ります。先に返金・取消を処理してください。');
      await write('documents',parent.payload.documentId,{...parent.payload,status:'revised',reason:cmd.reason,revisedToDocumentId:id},'status change',cmd.expectedParentRevision);
    }
    if(formal){const reconciled=await reconcileFormalDocumentCalendar(id,document,s,saleId,amount,date,found,{saving:true});Object.assign(document,{calendarEventId:reconciled.calendarEventId,googleEventId:reconciled.googleEventId,calendarId:reconciled.calendarId});s.calendarEventId=document.calendarEventId;await write('calendarLinks',document.calendarEventId,reconciled.nextLink);}
    const revision=await write('documents',id,document,undefined,cmd.expectedRevision);
    if(s.docType==='estimate'){
      refs.estimateId=estimateId;
      await write('estimates',refs.estimateId,{...(estimate?.payload||{}),id:refs.estimateId,documentStatus:'active',historyId:id,documentId:id,customer:s.customerName||'',date:s.invoiceDate||'',workDate:s.workDate||s.salesDate||estimate?.payload.workDate||'',amount,content:rawContent(s),projectCategory:projectCategory(s),snapshot:s,area:s.remarks||'',status:estimate?.payload.status||'見積済',calendarEventId:s.calendarEventId||'',googleEventId:document.googleEventId,calendarId:document.calendarId,projectId:estimate?.payload.projectId||''});
    }else if(s.docType==='invoice'||s.docType==='onoda'){
      refs.saleId=saleId;
      await write(anchorCollection(refs.saleId),refs.saleId,{...(sale?.payload||{}),id:refs.saleId,documentStatus:'active',sourceId:id,documentId:id,docType:s.docType,invoiceNo:s.invoiceNo||'',customer:s.customerName||'',amount,salesDate:document.salesDate,saleDate:document.salesDate,invoiceDate:document.invoiceDate,content:summary(s),paymentMethod:s.paymentMethod||'銀行振込',calendarEventId:s.calendarEventId||'',googleEventId:document.googleEventId,calendarId:document.calendarId,estimateId:s.estimateId||'',projectId:s.projectId||''});
    }
    return {documentId:id,revision,snapshot:s,invoiceNo:s.invoiceNo,numberingMinute:s.numberingMinute,numberingSequence:s.numberingSequence,...refs};
  }
  if(cmd.type==='acceptEstimate'){
    const row=await read('estimates',cmd.estimateId);if(!row||!A.live(row.payload))throw Error('有効な見積が見つかりません。');
    const document=row.payload.documentId||row.payload.historyId?await read('documents',row.payload.documentId||row.payload.historyId):null;
    const e={...row.payload,snapshot:row.payload.snapshot||document?.payload.snapshot||{},id:cmd.estimateId},id=e.projectId||'project_'+cmd.estimateId,old=await read('projects',id),p=old?.payload||{id,estimateId:e.id,documentId:e.documentId||'',customer:e.customer,content:e.content,amount:e.amount};
    observed.push(['estimates',cmd.estimateId,row.revision],['projects',id,old?.revision||0]);
    const rawDate=String(cmd.workDate||p.workDate||e.workDate||'').trim(),date=rawDate?A.date(rawDate):'';
    const status=date?'受注':'受注・日程未定';
    const googleEventId='e'+(await client.digest(id)).slice(0,48);
    const calendarEventId=e.calendarEventId||p.calendarEventId||(date?await eventId({googleEventId}):'');
    let next=null;if(date){const link=await read('calendarLinks',calendarEventId);observed.push(['calendarLinks',calendarEventId,link?.revision||0]);next=schedule(e,p,link?.payload||{}, {calendarEventId,googleEventId},date);await write('calendarLinks',calendarEventId,next,'status change');}
    // Both clients read the same estimate/project; Firestore retries contention, with stable IDs.
    await write('estimates',e.id,{...e,status,projectId:id,workDate:date,calendarEventId},'status change');
    await write('projects',id,{...p,status,workDate:date,calendarEventId,googleEventId:next?.googleEventId||p.googleEventId||'',calendarId:next?.calendarId||p.calendarId||''});
    return {projectId:id,calendarEventId};
  }
  if(cmd.type==='calendarPrepareCreate'){
    const row=await read('calendarLinks',cmd.id);if(!row)throw Error('施工予定が見つかりません。');
    const e=row.payload;if(!e.googleCreatePending)return {event:e,revision:row.revision};
    const calendarId=e.googleCalendarId||e.calendarId||String(cmd.calendarId||'');if(!calendarId)throw Error('同期カレンダーを選択してください。');
    const next={...e,calendarId,googleCalendarId:calendarId};const revision=await write('calendarLinks',cmd.id,next);return {event:next,revision};
  }
  if(cmd.type==='calendarCreated'){
    const row=await read('calendarLinks',cmd.id);if(!row)return {};
    const e=row.payload;if(e.googleEventId!==cmd.googleEventId||e.googleCalendarId!==cmd.calendarId)throw Error('Google関連が変更されました。');
    const revision=await write('calendarLinks',cmd.id,{...e,googleCreatePending:false,htmlLink:cmd.htmlLink||e.htmlLink||''});return {revision};
  }
  if(cmd.type==='payment'){
    const sale=await read(anchorCollection(cmd.saleId),cmd.saleId);if(!sale||!A.live(sale.payload))throw Error('有効な対象請求書が見つかりません。');
    const amount=A.money(cmd.amount),paymentDate=A.date(cmd.paymentDate);
    if(!['現金','銀行振込','プラットフォーム経由','その他','オンライン決済'].includes(cmd.method||'現金'))throw Error('入金経路を確認してください。');
    if(cmd.documentId&&sale.payload.documentId!==cmd.documentId)throw Error('対象請求書が訂正されています。読み込み直してください。');
    const old=await read('payments',cmd.paymentId),payload={id:cmd.paymentId,paymentId:cmd.paymentId,saleId:cmd.saleId,amount,paymentDate,date:paymentDate,method:cmd.method||'現金',confirmation:cmd.method==='現金'?'cash-received':cmd.manualConfirmed?'bank-confirmed':'pending-bank',memo:cmd.memo||'',...(cmd.method==='プラットフォーム経由'&&String(cmd.platformName||'').trim()?{platformName:String(cmd.platformName).trim()}:{}),documentId:''};
    if(old){if(core.canonical(old.payload)!==core.canonical(payload))throw Error('入金IDが既存の入金と競合しています。');return {paymentId:cmd.paymentId,unchanged:true};}
    await write('payments',cmd.paymentId,payload,'payment',0);return {paymentId:cmd.paymentId};
  }
  if(cmd.type==='confirmBank'){
    if(who.role!=='admin')throw Error('銀行照合は管理者のみです。');
    const sale=await read(anchorCollection(cmd.saleId),cmd.saleId);if(!sale||!A.live(sale.payload))throw Error('有効な対象請求書がありません。');
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
  for(const [saleId,ids] of paymentSales){const sale=await read(anchorCollection(saleId),saleId);await rawWrite(anchorCollection(saleId),saleId,{...sale.payload,paymentIds:[...ids],paymentVersion:(sale.payload.paymentVersion||0)+1},'payment');}
  return result;
 });}catch(error){
  // Some Firestore rule checks reject an occupied reservation before the SDK retries it.
  // Retry only when another formal save actually consumed the proposed number.
  if((cmd.type==='acceptEstimate'||repairing)&&numberRetries<4&&String(error.code||'').includes('permission-denied')){for(const [collection,id,revision] of observed){const latest=(await client.listRecords(collection)).find(r=>r.id===id);if((latest?.revision||0)!==revision)return execute(cmd,numberRetries+1);}}
  if(cmd.type==='saveDocument'&&allocated&&numberRetries<4&&String(error.code||'').includes('permission-denied')){
   if(await client.isDocumentNumberReserved(allocated.invoiceNo))return execute(cmd,numberRetries+1);
  }
  throw error;
 }}
 const paymentOperations=new Map();
 async function executeCommand(cmd){
  if(cmd.type!=='payment')return execute(cmd);
  const key=cmd.operationId,fingerprint=core.canonical(cmd),previous=paymentOperations.get(key);
  if(previous){if(previous.fingerprint!==fingerprint)return Promise.reject(Error('Operation ID conflict'));return previous.promise;}
  const promise=execute(cmd).finally(()=>paymentOperations.delete(key));paymentOperations.set(key,{fingerprint,promise});return promise;
 }
 return {execute:executeCommand,stable,eventId};
}
function receiptAccountingNeedsRepair(row,rows){
 const p=row.payload,s=p.snapshot||{},date=s.invoiceDate||p.invoiceDate||s.paymentDate||p.paymentDate;
 if(!A.live(p)||p.docType!=='receipt'||!s.customerName?.trim()||!(p.amount>0)||!date)return false;
 const find=(n,id)=>(rows[n]||[]).find(r=>r.id===id)?.payload;
 const sale=find(anchorCollection(p.saleId||''),p.saleId),payment=find('payments',p.paymentId),link=find('calendarLinks',p.calendarEventId),cash=find('cashLedger','cash_'+p.paymentId);
 // Explicit invoice receipts can be installments sharing one schedule. That schedule
 // represents the invoice and its latest receipt, not each earlier installment.
 const invoiceReceipt=sale&&s.saleId===p.saleId&&sale.documentId&&sale.documentId!==row.id&&!['receipt','receipt-cash','calendar-cash','calendar-manual'].includes(sale.sourceType);
 const validAmount=sale&&total(s)===p.amount&&(sale.amount===p.amount||sale.amount>p.amount&&invoiceReceipt);
 const validCalendar=link&&A.live(link)&&link.receiptSaleId===p.saleId&&link.googleEventId&&link.officialAmount===sale?.amount&&(invoiceReceipt?link.linkedReceiptId&&(!link.linkedInvoiceId||link.linkedInvoiceId===sale.documentId):link.linkedReceiptId===row.id&&link.status==='領収済'&&link.date===date&&link.customerName===s.customerName&&link.title?.includes('領収済'));
 return !(sale&&A.live(sale)&&validAmount&&payment&&A.confirmed(payment)&&!payment.deletedAt&&payment.saleId===p.saleId&&payment.documentId===row.id&&payment.amount===p.amount&&payment.method===s.paymentMethod&&payment.paymentDate===(s.paymentDate||p.paymentDate||date)&&validCalendar&&(s.paymentMethod!=='現金'||cash&&!cash.deletedAt&&cash.amount===p.amount&&cash.date===payment.paymentDate));
}
function formalDocumentNeedsRepair(row,rows){
 const p=row.payload,s=p.snapshot||{};
 const current=(rows.calendarLinks||[]).find(r=>r.id===(p.calendarEventId||s.calendarEventId)||r.payload[p.docType==='receipt'?'linkedReceiptId':'linkedInvoiceId']===row.id)?.payload;
 if(formalTitleNeedsRepair(row,current))return true;
 if(p.docType==='receipt')return receiptAccountingNeedsRepair(row,rows);
 if(!A.live(p)||!formalType(p.docType)||!p.saleId||!s.customerName?.trim()||!(p.amount>0)||!formalDate(s))return false;
 return !current||!current.googleEventId||current.linkedInvoiceId!==row.id;
}
return {formalDocumentNeedsRepair,formalCalendarTitle,receiptAccountingNeedsRepair,calendarTime,canDeleteMisregistration,CATEGORY_RULES,rawContent,projectCategory,filenameProject,onodaFilename,documentFilename,estimateFilename,parseCalendar,schedule,numberingMinute,createService,COLLECTIONS,total,cleanSnapshot,summary};
});
