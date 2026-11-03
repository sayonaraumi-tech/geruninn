(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./accounting.js'):root.TsukinowaAccounting);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaAccountingDomain=api;})(globalThis,function(A){
'use strict';
const TYPES=['reviewBankIncome','settleSupplierInvoice','supplierFromBank','bankCancelDuplicate','bankRestoreDuplicate','saveBankRule','saveExpenseCategoryRule','saveExpense','deleteExpense','cashAdjustment','saveSupplier','supplierTransaction','deleteSupplierTransaction','importBank','bankMatch','expenseFromBank','bankUnmatch','bankExclude','backfillCash','migrateAccounting','accountingMigrationComplete'];

async function mirrorCash(name,id,p,read,write){
 let eligible=false,type='expense',category='',description='',date='',linkedPaymentId='',linkedExpenseId='',linkedSupplierTransactionId='';
 if(name==='payments'){eligible=p.confirmation==='cash-received'&&p.method==='現金';type='income';category='現金入金';description=p.memo||'現場入金';date=p.paymentDate;linkedPaymentId=id;}
 else if(name==='expenses'){eligible=p.paymentMethod==='現金';category=p.category;description=p.description;date=p.expenseDate;linkedExpenseId=id;}
 else if(name==='supplierTransactions'){eligible=['prepayment','payment'].includes(p.type)&&p.paymentMethod==='現金';category='仕入先支払';description=p.description;date=p.date;linkedSupplierTransactionId=id;}
 else return;
 const cashTxnId='cash_'+id,old=await read('cashLedger',cashTxnId);
 if(eligible&&!p.deletedAt&&p.amount>0)await write('cashLedger',cashTxnId,{cashTxnId,date,type,category,description:description||'',amount:p.amount,linkedPaymentId,linkedExpenseId,linkedSupplierTransactionId,deletedAt:null},'cash transaction');
 else if(old&&!old.payload.deletedAt)await write('cashLedger',cashTxnId,{...old.payload,deletedAt:new Date().toISOString()},'cash transaction');
}
async function handle(cmd,context){
 const {read,write,who,stable,expenseSeed=[],relatedPayments}=context;
 if(who.role!=='admin')throw Error('この会計操作は管理者のみ実行できます。');
 const now=()=>new Date().toISOString(),required=(s,label)=>{if(typeof s!=='string'||!s.trim())throw Error(label+'を入力してください。');return s.trim();};
 if(cmd.type==='saveBankRule'){
  if(!['bankAccountAlias','bankPartyAlias','bankSpecialPolicy'].includes(cmd.ruleType))throw Error('ルール区分を確認してください。');
  const key=A.classificationKey(required(cmd.key,'対象')),id=await stable('bank_rule',cmd.ruleType+'|'+key),old=await read('settings',id);
  const payload={type:cmd.ruleType,key,enabled:cmd.enabled!==false,reviewedBy:who.uid,deletedAt:null};
  if(cmd.ruleType==='bankAccountAlias'){payload.canonical=A.classificationKey(required(cmd.canonical,'同一口座の固定名'));if(payload.canonical===key)throw Error('別名と固定名を分けてください。');const target=await read('settings',await stable('bank_rule','bankAccountAlias|'+payload.canonical));if(payload.enabled&&target&&target.payload.enabled!==false)throw Error('固定名に別名は使えません。実口座の固定名を指定してください。');}
  if(cmd.ruleType==='bankPartyAlias')payload.customerKey=A.classificationKey(required(cmd.customer,'顧客名'));
  if(cmd.ruleType==='bankSpecialPolicy'){if(!['受取利息','支払手数料'].includes(key))throw Error('科目を確認してください。');payload.taxTreatment='要確認';}
  await write('settings',id,payload,'adjustment',cmd.expectedRevision??old?.revision??0);return {ruleId:id};
 }
 if(cmd.type==='saveExpenseCategoryRule'){
  const key=A.classificationKey(required(cmd.vendor,'取引先'));if(key.length<2||key.length>160)throw Error('取引先名を確認してください。');
  if(!A.CATEGORIES.includes(cmd.category))throw Error('科目を確認してください。');
  const id=await stable('expense_rule',key),old=await read('settings',id);
  if(old&&old.payload.type!=='expenseCategoryRule')throw Error('設定が一致しません。');
  await write('settings',id,{type:'expenseCategoryRule',vendor:cmd.vendor.trim(),key,category:cmd.category,enabled:cmd.enabled!==false,deletedAt:cmd.deleted?now():null},'adjustment',cmd.expectedRevision??0);return {ruleId:id};
 }
 if(cmd.type==='saveExpense'){
  const e=A.expenseInput(cmd.expense);
  if(cmd.learnCategory){const id=await stable('expense_rule',A.classificationKey(e.vendor)),r=await read('settings',id);await handle({type:'saveExpenseCategoryRule',vendor:e.vendor,category:e.category,expectedRevision:r?.revision||0},context);}
  if(cmd.skipDuplicate){for(const seed of expenseSeed){const row=await read('expenses',seed.id);if(row&&A.live(row.payload)&&A.expenseKey(row.payload)===A.expenseKey(e))return {expenseId:seed.id,unchanged:true};}}
  const id=cmd.skipDuplicate?await stable('expense_csv',A.expenseKey(e)):cmd.expenseId,old=await read('expenses',id);if(cmd.skipDuplicate&&old)return {expenseId:id,unchanged:true};if(old?.payload.supplierTransactionId)throw Error('仕入先台帳から月次請求を訂正してください。');if(old?.payload.bankTxnId||old?.payload.platformSettlementBankId)throw Error('照合済み支出は先に銀行照合を解除してください。');if(old?.payload.deletedAt)throw Error('取消済み支出です。新規登録してください。');
  await write('expenses',id,{expenseId:id,expenseDate:A.date(e.expenseDate),category:A.CATEGORIES.includes(e.category)?e.category:'その他',vendor:e.vendor||'',description:e.description||'',amount:A.money(e.amount),paymentMethod:required(e.paymentMethod,'支払方法'),bankAccount:e.paymentMethod==='現金'?'cash':e.bankAccount||'',receiptAttachmentRef:e.receiptAttachmentRef||'',deletedAt:null},old?'expense update':'expense create',cmd.expectedRevision);return {expenseId:id};
 }
 if(cmd.type==='deleteExpense'){const e=await read('expenses',cmd.expenseId);if(!e)throw Error('支出がありません。');if(e.payload.deletedAt)return {unchanged:true};if(e.payload.bankTxnId||e.payload.platformSettlementBankId||e.payload.supplierTransactionId)throw Error('銀行照合を解除、または仕入先台帳から訂正してください。');await write('expenses',cmd.expenseId,{...e.payload,deletedAt:now(),deleteReason:required(cmd.reason,'取消理由')},'expense delete',cmd.expectedRevision);return {expenseId:cmd.expenseId};}
 if(cmd.type==='cashAdjustment'){const old=await read('cashLedger',cmd.cashTxnId);if(old)return {unchanged:true};if(!['income','expense'].includes(cmd.direction))throw Error('収支区分が不正です。');await write('cashLedger',cmd.cashTxnId,{cashTxnId:cmd.cashTxnId,date:A.date(cmd.date),type:cmd.direction,category:'残高調整',description:required(cmd.description,'調整理由'),amount:A.money(cmd.amount),linkedPaymentId:'',linkedExpenseId:'',linkedSupplierTransactionId:'',deletedAt:null},'adjustment',0);return {cashTxnId:cmd.cashTxnId};}
 if(cmd.type==='reviewBankIncome'){
  const row=await read('bankTransactions',cmd.bankTxnId);if(row&&A.live(row.payload)&&row.payload.status==='照合済'&&row.payload.matchType==='bankIncome'&&row.payload.category===(cmd.interest?'受取利息':'雑収入'))return {unchanged:true};if(!row||!A.live(row.payload)||!row.payload.incoming||['照合済','除外'].includes(row.payload.status))throw Error('未照合の銀行入金を選択してください。');const b=row.payload,note=required(cmd.note,'原本確認内容');
  if(cmd.interest||cmd.cashback||cmd.category==='雑収入'){
   if(A.platformBank(b))throw Error('プラットフォーム精算から既存の注文・入金明細を確認してください。');
   if(cmd.interest&&A.bankSpecial(b)!=='受取利息')throw Error('受取利息の明細ではありません。');
   if(cmd.cashback&&(!A.bankCashback(b)||cmd.interest))throw Error('デビットのキャッシュバック明細を確認してください。');
   await write('bankTransactions',cmd.bankTxnId,{...b,status:'照合済',matchType:'bankIncome',matchId:cmd.bankTxnId,category:cmd.interest?'受取利息':'雑収入',taxTreatment:'要確認',reviewNote:note,confirmedBy:who.uid},'bank match confirm',cmd.expectedRevision);
  }
  else await write('bankTransactions',cmd.bankTxnId,{...b,reviewNote:note,reviewedBy:who.uid},'adjustment',cmd.expectedRevision);
  return {bankTxnId:cmd.bankTxnId};
 }
 if(cmd.type==='settleSupplierInvoice'){
  const t=cmd.transaction;if(!t?.reviewed)throw Error('請求書と実際の控除額を確認してください。');
  const supplier=await read('suppliers',t.supplierId);if(!supplier||!A.live(supplier.payload))throw Error('仕入先がありません。');
  const invoiceNo=required(t.invoiceNo|| (t.simpleMonthly?t.invoiceMonth:''),'請求書番号'),month=required(t.invoiceMonth,'請求月');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請求月が不正です。');
  const id=await stable('supplierinvoice',t.supplierId+'|'+month),old=await read('supplierTransactions',id);
  const evidenceId=await stable('supplier_evidence',t.supplierId+'|'+A.classificationKey(invoiceNo)),evidence=await read('settings',evidenceId);
  const hashId=t.sourceHash?await stable('supplier_pdf',t.sourceHash):null,hash=hashId?await read('settings',hashId):null;
  if(cmd.correct&&(!Number.isInteger(cmd.expectedRevision)||cmd.expectedRevision!==old?.revision))throw Error('別端末で変更されています。再読込して訂正してください。');
  if(cmd.correct ? (!old||!A.live(old.payload)||old.payload.supplierId!==t.supplierId||old.payload.invoiceMonth!==month||!t.simpleMonthly||old.payload.sourceHash||old.payload.invoiceNo!==invoiceNo) : (old||evidence||hash))throw Error('同じ請求月・請求書番号・PDFの登録があります。重複控除はできません。');
  const amount=A.money(t.amount),deductionAmount=t.simpleMonthly?amount:A.money(t.deductionAmount,true),previousDeduction=cmd.correct?Number(old.payload.deductionAmount||0):0;if(deductionAmount<0||deductionAmount>amount||deductionAmount>Number(supplier.payload.currentBalance||0)+previousDeduction)throw Error('控除額が請求額または前渡残高を超えています。');
  const payload={transactionId:id,supplierId:t.supplierId,type:'monthlyInvoice',date:A.date(t.date),amount,deductionAmount,invoiceMonth:month,invoiceNo,description:required(t.description||(t.simpleMonthly?'材料請求 '+month:''),'材料購入内容'),paymentMethod:'月締',bankAccount:'',sourceHash:t.sourceHash||'',sourceName:t.sourceName||'',reviewedBy:who.uid,deletedAt:null};
  await write('supplierTransactions',id,payload,'supplier transaction',cmd.correct?cmd.expectedRevision:0);
  await write('suppliers',t.supplierId,{...supplier.payload,currentBalance:Number(supplier.payload.currentBalance||0)+previousDeduction-deductionAmount},'supplier transaction');
  const expenseId='expense_'+id;const priorExpense=await read('expenses',expenseId);if(cmd.correct&&(!priorExpense||priorExpense.payload.bankTxnId||priorExpense.payload.platformSettlementBankId||priorExpense.payload.deletedAt))throw Error('関連費用の状態を確認してください。');await write('expenses',expenseId,{expenseId,expenseDate:payload.date,category:'材料費',vendor:supplier.payload.supplierName,description:payload.description,amount,paymentMethod:'月締',bankAccount:'',receiptAttachmentRef:payload.sourceHash,supplierTransactionId:id,supplierId:t.supplierId,invoiceMonth:month,deletedAt:null},cmd.correct?'expense update':'expense create',cmd.correct?priorExpense.revision:0);
  const marker={type:'supplierInvoiceEvidence',transactionId:id,supplierId:t.supplierId,invoiceNo,deletedAt:null};if(!cmd.correct)await write('settings',evidenceId,marker,'create',0);if(hashId)await write('settings',hashId,marker,'create',0);return {transactionId:id};
 }
 if(cmd.type==='supplierFromBank'){
  const row=await read('bankTransactions',cmd.bankTxnId);if(!row||!A.live(row.payload))throw Error('銀行明細がありません。');const b=row.payload;
  const id=await stable('supplierprepay',cmd.bankTxnId),old=await read('supplierTransactions',id);
  if(b.status==='照合済'){if(b.matchType==='supplier'&&b.matchId===id&&old?.payload.bankTxnId===cmd.bankTxnId)return {unchanged:true};throw Error('既に照合済みです。既存記録を確認してください。');}
  if(!b.outgoing||b.incoming||b.status==='除外'||old)throw Error('未照合の出金を選択してください。');
  if(!cmd.supplierId&&cmd.supplierName){
   const supplierName=required(cmd.supplierName,'仕入先名'),key=A.classificationKey(supplierName);
   for(const seed of context.bankSeed?.suppliers||[]){const r=await read('suppliers',seed.id);if(r&&A.live(r.payload)&&A.classificationKey(r.payload.supplierName)===key){cmd={...cmd,supplierId:seed.id};break;}}
   if(!cmd.supplierId){const supplierId=await stable('supplier',key),r=await read('suppliers',supplierId);if(r&&!A.live(r.payload))throw Error('同名の取消済み仕入先があります。管理者が確認してください。');if(!r)await handle({type:'saveSupplier',supplierId,supplier:{supplierName,openingBalance:0,openingDate:b.bankTransactionDate},expectedRevision:0},context);cmd={...cmd,supplierId};}
  }
  const supplier=await read('suppliers',cmd.supplierId);if(!supplier||!A.live(supplier.payload))throw Error('仕入先を選択してください。');
  for(const seed of context.bankSeed?.supplierTransactions||[]){const r=await read('supplierTransactions',seed.id);if(r&&A.live(r.payload)&&r.payload.supplierId===cmd.supplierId&&['payment','prepayment'].includes(r.payload.type)&&r.payload.amount===b.outgoing&&r.payload.date===b.bankTransactionDate)throw Error('同日同額の仕入先支払があります。既存取引を照合してください。');}
  for(const seed of context.bankSeed?.expenses||[]){const r=await read('expenses',seed.id);if(r&&A.live(r.payload)&&A.expenseMatch(b,{expenses:[{...r.payload,id:seed.id}]}).candidates.length)throw Error('既存支出候補があります。確認してから前渡金を登録してください。');}
  const description=required(cmd.description,'前渡金の確認内容');
  await write('supplierTransactions',id,{transactionId:id,supplierId:cmd.supplierId,date:b.bankTransactionDate,type:'prepayment',amount:b.outgoing,description,invoiceMonth:'',paymentMethod:'銀行振込',bankAccount:b.bankAccount,bankTxnId:cmd.bankTxnId,bankTransactionDate:b.bankTransactionDate,deletedAt:null},'supplier transaction',0);
  await write('suppliers',cmd.supplierId,{...supplier.payload,currentBalance:(Number(supplier.payload.currentBalance)||0)+b.outgoing},'supplier transaction');
  await write('bankTransactions',cmd.bankTxnId,{...b,status:'照合済',matchType:'supplier',matchId:id,paymentId:'',confirmedBy:who.uid},'bank match confirm',cmd.expectedRevision);return {transactionId:id};
 }
 if(cmd.type==='saveSupplier'){
  const id=cmd.supplierId,old=await read('suppliers',id),s=cmd.supplier,openingBalance=A.money(s.openingBalance,true);const prior=old?.payload||{};
  await write('suppliers',id,{supplierId:id,supplierName:required(s.supplierName,'仕入先名'),openingBalance,openingDate:A.date(s.openingDate),currentBalance:(prior.currentBalance||0)-(prior.openingBalance||0)+openingBalance,deletedAt:null},old?'adjustment':'create',cmd.expectedRevision);return {supplierId:id};
 }
 if(cmd.type==='supplierTransaction'||cmd.type==='deleteSupplierTransaction'){
  let id=cmd.transactionId;const t=cmd.transaction;
  if(t?.type==='monthlyInvoice'){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(t.invoiceMonth))throw Error('請求月を指定してください。');id=await stable('supplierinvoice',t.supplierId+'|'+t.invoiceMonth);}
  const old=await read('supplierTransactions',id);let payload;
  if(cmd.type==='deleteSupplierTransaction'){if(!old)throw Error('仕入先取引がありません。');if(old.payload.deletedAt)return {unchanged:true};payload={...old.payload,deletedAt:now(),deleteReason:required(cmd.reason,'取消理由')};}
  else{if(old?.payload.deletedAt)throw Error('取消済みの月次請求です。管理者が記録を確認してください。');if(!['prepayment','monthlyInvoice','payment','adjustment'].includes(t.type))throw Error('取引区分が不正です。');payload={transactionId:id,supplierId:t.supplierId,date:A.date(t.date),type:t.type,amount:A.money(t.amount,t.type==='adjustment'),description:required(t.description,'摘要・理由'),invoiceMonth:t.invoiceMonth||'',paymentMethod:t.type==='monthlyInvoice'?'月締':t.paymentMethod||'銀行振込',bankAccount:t.bankAccount||'',deletedAt:null};}
  if(old?.payload.deductionAmount!==undefined)throw Error('確認済み請求書は監査履歴を確認して訂正してください。');if(old?.payload.bankTxnId||old?.payload.platformSettlementBankId)throw Error('照合済み取引は先に銀行照合を解除してください。');
  if(old&&(old.payload.supplierId!==payload.supplierId||old.payload.type!==payload.type))throw Error('仕入先・区分は変更できません。取消と新規登録を使用してください。');
  const supplier=await read('suppliers',payload.supplierId);if(!supplier||supplier.payload.deletedAt)throw Error('仕入先がありません。');
  await write('supplierTransactions',id,payload,cmd.type==='deleteSupplierTransaction'?'adjustment':'supplier transaction',cmd.expectedRevision);
  await write('suppliers',payload.supplierId,{...supplier.payload,currentBalance:supplier.payload.currentBalance-A.delta(old?.payload||{amount:0})+A.delta(payload)},'supplier transaction');
  if(payload.type==='monthlyInvoice'){const expenseId='expense_'+id,e=await read('expenses',expenseId);await write('expenses',expenseId,{...(e?.payload||{}),expenseId,expenseDate:payload.date,category:'材料費',vendor:supplier.payload.supplierName,description:payload.description,amount:payload.amount,paymentMethod:'月締',bankAccount:'',receiptAttachmentRef:'',supplierTransactionId:id,supplierId:payload.supplierId,invoiceMonth:payload.invoiceMonth,deletedAt:payload.deletedAt},payload.deletedAt?'expense delete':e?'expense update':'expense create');}
  return {transactionId:id};
 }
 if(['bankCancelDuplicate','bankRestoreDuplicate'].includes(cmd.type)){
  const snapshot={},data={};
  for(const [n,seeds] of Object.entries(context.bankSeed||{})){snapshot[n]=[];data[n]=[];for(const seed of seeds){const r=await read(n,seed.id);if(r){snapshot[n].push({id:seed.id,...r});data[n].push({...r.payload,id:seed.id});}}}
  const b=await read('bankTransactions',cmd.bankTxnId),k=await read('bankTransactions',cmd.keeperId);
  if(!b||!k||b.revision!==cmd.expectedRevision||k.revision!==cmd.keeperRevision)throw Error('記録が変更されました。再確認してください。');
  const reason=required(cmd.reason,'理由');
  if(cmd.type==='bankRestoreDuplicate'){
   const saved=b.payload.duplicateCancellation;
   if(b.payload.status!=='cancelled'||!saved||saved.keeperId!==cmd.keeperId)throw Error('重複取消の記録ではありません。');
   await write('bankTransactions',cmd.bankTxnId,saved.before,'bank duplicate restore',cmd.expectedRevision);
  }else{
   const review=A.bankCancellationReview({...b.payload,id:cmd.bankTxnId},{...k.payload,id:cmd.keeperId},data);
   if(review.reasons.length)throw Error(review.reasons.join(' / '));
   if(cmd.sourceVerified!==true||!cmd.sourceEvidence?.trim()||!cmd.backupDigest)throw Error('原本確認とバックアップが必要です。');
   // The downloaded backup must match every freshly read business record.
   const digest=await context.backupDigest(snapshot);
   if(digest!==cmd.backupDigest)throw Error('バックアップ後にデータが変更されました。再出力してください。');
   await write('bankTransactions',cmd.bankTxnId,{...b.payload,status:'cancelled',duplicateCancellation:{before:b.payload,keeperId:cmd.keeperId,keeperRevision:k.revision,reason,sourceEvidence:cmd.sourceEvidence,backupDigest:digest,actorId:who.uid,at:now()}},'bank duplicate cancel',cmd.expectedRevision);
  }
  return {bankTxnId:cmd.bankTxnId,keeperId:cmd.keeperId};
 }
 if(cmd.type==='importBank'){

  let b={...cmd.bank};const data={};
  for(const [name,seeds] of Object.entries(context.bankSeed||{})){data[name]=[];for(const seed of seeds){const r=await read(name,seed.id);if(r)data[name].push({...r.payload,id:seed.id});}}
  const rules=data.settings||[],identity=A.bankIdentity(b,rules);
  // Strong identity bridges legacy account labels without changing the old record.
  const duplicates=identity?(data.bankTransactions||[]).filter(r=>A.live(r)&&A.bankIdentity(r,rules)===identity):[];
  if(duplicates.length){if(duplicates.some(r=>r.incoming!==b.incoming||r.outgoing!==b.outgoing||r.bankTransactionDate!==b.bankTransactionDate||A.classificationKey(r.description)!==A.classificationKey(b.description)))throw Error('同一取引IDの内容が異なります。要確認');return {bankTxnId:duplicates[0].bankTxnId||duplicates[0].id,unchanged:true,duplicateIds:duplicates.map(r=>r.id)};}
  if(identity)b.bankTxnId=await stable('bank',identity);
  const old=await read('bankTransactions',b.bankTxnId);if(old){const p=old.payload;if(p.incoming!==b.incoming||p.outgoing!==b.outgoing||p.bankTransactionDate!==b.bankTransactionDate)throw Error('同一銀行取引IDの金額・日付が既存データと異なります。');return {bankTxnId:b.bankTxnId,unchanged:true};}
  if((b.incoming>0)===(b.outgoing>0))throw Error('銀行の入出金区分が不正です。');A.money(b.incoming||b.outgoing);A.date(b.bankTransactionDate);
  await write('bankTransactions',b.bankTxnId,{...b,status:'未照合',deletedAt:null},'bank csv import',0);
  if(cmd.autoKnownIncome&&(A.bankSpecial(b)==='受取利息'||A.bankCashback(b)))return handle({type:'reviewBankIncome',bankTxnId:b.bankTxnId,interest:A.bankSpecial(b)==='受取利息',cashback:A.bankCashback(b),note:'銀行CSVの明確な摘要による自動分類',expectedRevision:1},context);
  const target=A.autoBankTarget(b,data);
  if(target)return handle({type:'bankMatch',bankTxnId:b.bankTxnId,...target,expectedRevision:1},context);
  const category=A.bankSpecial(b),policies=rules.filter(r=>r.type==='bankSpecialPolicy'&&r.key===category&&A.live(r)&&r.enabled!==false);
  if(category&&policies.length===1&&identity){
   if(category==='受取利息')await write('bankTransactions',b.bankTxnId,{...b,status:'照合済',matchType:'bankIncome',matchId:b.bankTxnId,category,taxTreatment:'要確認',confirmedBy:who.uid,deletedAt:null},'bank match confirm');
   else if(!(data.expenses||[]).some(e=>A.live(e)&&e.amount===b.outgoing&&e.expenseDate===b.bankTransactionDate)){
    const {expenseId}=await handle({type:'saveExpense',skipDuplicate:true,expense:{expenseDate:b.bankTransactionDate,category,vendor:b.bankAccount,description:b.description,amount:b.outgoing,paymentMethod:'銀行振込',bankAccount:b.bankAccount},expectedRevision:0},context);
    await handle({type:'bankMatch',bankTxnId:b.bankTxnId,targetType:'expense',targetId:expenseId,expectedRevision:1},context);
   }
  }
  return {bankTxnId:b.bankTxnId};
 }
 if(cmd.type==='bankExclude'){const b=await read('bankTransactions',cmd.bankTxnId);if(!b||!A.live(b.payload)||b.payload.status==='照合済')throw Error('照合を解除してから除外してください。');await write('bankTransactions',cmd.bankTxnId,{...b.payload,status:cmd.excluded?'除外':'未照合',excludeReason:required(cmd.reason,'理由')},'adjustment',cmd.expectedRevision);return {bankTxnId:cmd.bankTxnId};}
 if(cmd.type==='expenseFromBank'){
  const advance=await read('bankTransactions',cmd.bankTxnId);if(A.knownSupplierAdvance(advance?.payload))throw Error('東鵬の壁紙前渡金は費用ではありません。前渡金として処理してください。');
  const linkedBank=await read('bankTransactions',cmd.bankTxnId);
  if(linkedBank&&A.live(linkedBank.payload)&&linkedBank.payload.status==='照合済'&&linkedBank.payload.matchType==='expense'){
   const b=linkedBank.payload,linked=await read('expenses',b.matchId);
   if(linked&&A.live(linked.payload)&&linked.payload.bankTxnId===cmd.bankTxnId&&linked.payload.amount===b.outgoing&&linked.payload.bankTransactionDate===b.bankTransactionDate&&cmd.expense?.expenseDate===b.bankTransactionDate&&Number(cmd.expense?.amount)===b.outgoing)return {unchanged:true,bankTxnId:cmd.bankTxnId,expenseId:b.matchId};
   throw Error('既存の支出候補があります。参照を確認してください。');
  }
  const row=linkedBank;if(!row||!A.live(row.payload)||['照合済','除外'].includes(row.payload.status)||!row.payload.outgoing||A.cardSettlement(row.payload))throw Error('未一致の銀行出金を選択してください。');
  const b=row.payload,e=A.expenseInput(cmd.expense);if(e.amount!==b.outgoing||e.expenseDate!==b.bankTransactionDate||!A.bankExpense(e)||!e.vendor||!e.description)throw Error('金額・日付・科目・取引先・内容・銀行支払方法を確認してください。');
  const existing=[];for(const seed of expenseSeed){const row=await read('expenses',seed.id);if(row)existing.push({...row.payload,id:seed.id});}if(existing.some(x=>A.live(x)&&(A.creditExpense(x)||x.paymentMethod==='法人カード決済')&&x.amount===b.outgoing&&Math.abs(Date.parse(b.bankTransactionDate)-Date.parse(x.expenseDate))/86400000<=120)||A.expenseMatch(b,{expenses:existing}).candidates.length||existing.some(x=>{try{return A.live(x)&&A.expenseKey(x)===A.expenseKey(e);}catch(_){return false;}}))throw Error('既存の支出候補があります。銀行照合から確認してください。');
  // Retain the historical bank ID check; new records share the CSV/manual
  // identity so a concurrent import must retry rather than create a second cost.
  const legacyId=await stable('expense_bank',cmd.bankTxnId);if(await read('expenses',legacyId))throw Error('この銀行明細の支出は登録済みです。');
  const expenseId=await stable('expense_csv',A.expenseKey(e));if(await read('expenses',expenseId))throw Error('既存の支出候補があります。銀行照合から確認してください。');
  await handle({type:'saveExpense',expenseId,expense:{...e,bankAccount:b.bankAccount},learnCategory:cmd.learnCategory,expectedRevision:0},context);
  return handle({type:'bankMatch',bankTxnId:cmd.bankTxnId,targetType:'expense',targetId:expenseId,expectedRevision:cmd.expectedRevision},context);
 }
 if(cmd.type==='bankMatch'){
  const row=await read('bankTransactions',cmd.bankTxnId);if(!row)throw Error('銀行取引がありません。');const b=row.payload;if(!A.live(b))throw Error('取消済み銀行明細です。');if(b.status==='照合済'){if(b.matchId===cmd.targetId&&b.matchType===cmd.targetType&&(cmd.targetType!=='cardSettlement'||JSON.stringify([...(cmd.expenseIds||[])].sort())===JSON.stringify(b.expenseIds))&&(cmd.targetType!=='platformSettlement'||JSON.stringify([...(cmd.paymentIds||[])].sort())===JSON.stringify((b.platformPayments||[]).map(p=>p.id).sort())&&(cmd.feeExpenseId||'')===(b.feeExpenseId||'')))return {unchanged:true};throw Error('別の記録と照合済みです。先に解除してください。');}if(b.status==='除外')throw Error('除外を解除してください。');
  if(cmd.targetType==='expense'&&A.knownSupplierAdvance(b))throw Error('東鵬の壁紙前渡金は費用ではありません。仕入先の前渡金を選択してください。');
  let paymentId='',pendingBefore=null,expenseIds=[],platformPayments=[],platformBefore=[],feeExpenseId='';
  if(cmd.targetType==='platformSettlement'){
   const ids=[...new Set(cmd.paymentIds||[])];
   if(!A.platformBank(b)||cmd.targetId!==cmd.bankTxnId||!ids.length||ids.length>5||ids.length!==cmd.paymentIds.length)throw Error('精算明細に対応する既存入金を1〜5件選択してください。');
   const statement=required(cmd.statement,'精算書番号・確認内容');
   for(const id of ids){const r=await read('payments',id);if(!r||!A.platformPayments(b,{payments:[{...r.payload,id}]}).length)throw Error('平台・入金日・照合状態を確認してください。');const p=r.payload,sale=await read(String(p.saleId).startsWith('receivable_')?'receivables':'sales',p.saleId);if(!sale||!A.live(sale.payload)||sale.payload.paymentMethod==='現金'||!(sale.payload.paymentIds||[]).includes(id))throw Error('注文の売上・未収リンクを修復してください。');
    const others=await relatedPayments(p.saleId);if(p.confirmation!=='bank-confirmed'&&others.filter(A.confirmed).reduce((n,v)=>n+v.amount,0)+others.filter(v=>ids.includes(v.id||v.paymentId)&&v.confirmation==='pending-bank').reduce((n,v)=>n+v.amount,0)>sale.payload.amount)throw Error('注文の未収金額を超えています。');
    platformPayments.push({id,amount:A.money(p.amount)});platformBefore.push({id,payload:p});
   }
   feeExpenseId=cmd.feeExpenseId||'';if(feeExpenseId&&ids.length>4)throw Error('手数料控除がある精算は最大4件です。明細の管理者確認が必要です。');let fee=0;
   if(feeExpenseId){const e=await read('expenses',feeExpenseId);if(!e||!A.live(e.payload)||e.payload.category!=='支払手数料'||e.payload.bankTxnId||e.payload.platformSettlementBankId||e.payload.expenseDate>b.bankTransactionDate)throw Error('既存の未照合手数料を確認してください。');fee=A.money(e.payload.amount);}
   if(platformPayments.reduce((n,p)=>n+p.amount,0)!==b.incoming+fee)throw Error('入金明細合計 − 既存手数料が銀行入金額と一致しません。精算書を確認してください。');
   // Existing payment IDs are already on the sale. Read sale/payments for concurrency,
   // but avoid rewriting sales solely for bank evidence (Firestore rule access budget).
   for(const {id,payload:p} of platformBefore)await context.writePaymentEvidence(id,{...p,...(p.confirmation==='bank-confirmed'?{}:{paymentDate:b.bankTransactionDate,date:b.bankTransactionDate}),confirmation:'bank-confirmed',bankTxnId:cmd.bankTxnId,bankTransactionDate:b.bankTransactionDate,platformStatement:statement});
   if(feeExpenseId){const e=await read('expenses',feeExpenseId);await write('expenses',feeExpenseId,{...e.payload,platformSettlementBankId:cmd.bankTxnId},'bank match confirm');}
  }else if(cmd.targetType==='cardSettlement'){
   expenseIds=[...new Set(cmd.expenseIds||[])].sort();
   if(!A.cardSettlement(b)||cmd.targetId!==cmd.bankTxnId||!expenseIds.length||expenseIds.length>5||expenseIds.length!==cmd.expenseIds.length)throw Error('カード引落と既存支出を1〜5件選択してください。');
   const cardAccount=required(cmd.cardAccount,'カード識別名'),entries=[];
   for(const id of expenseIds){const r=await read('expenses',id);if(!r||!A.cardExpenses(b,{expenses:[r.payload]}).length||r.payload.bankAccount!==cardAccount)throw Error('カード・日付・照合状態を確認してください。');entries.push([id,r.payload]);}
   if(entries.reduce((n,[,e])=>n+e.amount,0)!==b.outgoing)throw Error('カード引落額と選択した支出合計が一致しません。');
   for(const [id,e]of entries)await write('expenses',id,{...e,bankTxnId:b.bankTxnId,bankTransactionDate:b.bankTransactionDate},'bank match confirm');
  }else
  if(cmd.targetType==='sale'){
   if(!b.incoming)throw Error('入金取引を選択してください。');const sale=await read(String(cmd.targetId).startsWith('receivable_')?'receivables':'sales',cmd.targetId);if(!sale||!A.live(sale.payload))throw Error('請求書がありません。');if(sale.payload.paymentMethod==='現金'||['calendar-cash','receipt-cash'].includes(sale.payload.sourceType)||/代表者立替/.test(sale.payload.paymentMethod||''))throw Error('現金・立替は銀行照合の対象外です。');const existing=await relatedPayments(cmd.targetId),paid=existing.filter(A.confirmed).reduce((n,p)=>n+Number(p.amount),0),eligible=existing.filter(p=>!p.bankTxnId&&!p.bankId&&p.amount===b.incoming&&['pending-bank','bank-confirmed'].includes(p.confirmation));
   if(A.platformBank(b)&&!eligible.some(p=>A.paymentChannel(p).channel==='プラットフォーム経由'&&(!cmd.paymentId||cmd.paymentId===(p.id||p.paymentId))))throw Error('プラットフォーム精算を使用してください。');
   if(!cmd.paymentId&&eligible.length>1)throw Error('既存入金が複数あります。照合する入金を選択してください。');
   paymentId=cmd.paymentId||(eligible.length===1?(eligible[0].id||eligible[0].paymentId):'pay_'+b.bankTxnId);const storedPayment=await read('payments',paymentId),p=storedPayment&&!storedPayment.payload.deletedAt?storedPayment:null;
   if(!p&&b.incoming>sale.payload.amount-paid)throw Error('確認済み入金または未収金額を確認してください。');
   if(p){if(p.payload.saleId!==cmd.targetId||p.payload.amount!==b.incoming||!['pending-bank','bank-confirmed'].includes(p.payload.confirmation)||p.payload.bankTxnId||p.payload.bankId||p.payload.deletedAt)throw Error('仮入金の金額・対象・状態が一致しません。');pendingBefore=p.payload;}
   if(p?.payload.confirmation!=='bank-confirmed'&&b.incoming>sale.payload.amount-paid)throw Error('未収金額を超える入金です。');
   const confirmed=p?.payload.confirmation==='bank-confirmed';
   // Bank evidence must not move an already confirmed business receipt into another period.
   await write('payments',paymentId,{...(p?.payload||{}),id:paymentId,paymentId,saleId:cmd.targetId,amount:b.incoming,paymentDate:confirmed?p.payload.paymentDate||p.payload.date:b.bankTransactionDate,date:confirmed?p.payload.date||p.payload.paymentDate:b.bankTransactionDate,bankTransactionDate:b.bankTransactionDate,method:confirmed||p&&A.paymentChannel(p.payload).channel==='プラットフォーム経由'?p.payload.method:'銀行振込',bankAccount:b.bankAccount,bankTxnId:b.bankTxnId,confirmation:'bank-confirmed',memo:confirmed?p.payload.memo||'':b.description,deletedAt:null},'payment confirm');
  }else if(cmd.targetType==='expense'||cmd.targetType==='supplier'){
   if(!b.outgoing)throw Error('出金取引を選択してください。');const collection=cmd.targetType==='expense'?'expenses':'supplierTransactions',target=await read(collection,cmd.targetId);if(!target||target.payload.deletedAt||target.payload.amount!==b.outgoing||(cmd.targetType==='expense'&&(!A.expenseBankEligible(b,target.payload)||A.cardSettlement(b)))||target.payload.paymentMethod==='現金'||target.payload.bankTxnId||cmd.targetType==='expense'&&target.payload.paymentMethod==='月締'||cmd.targetType==='supplier'&&(!A.bankExpense(target.payload)||!['payment','prepayment'].includes(target.payload.type)))throw Error('支出・支払の金額/状態が一致しません。');
   await write(collection,cmd.targetId,{...target.payload,bankTxnId:b.bankTxnId,bankTransactionDate:b.bankTransactionDate},'bank match confirm');
  }else throw Error('照合先を選択してください。');
  await write('bankTransactions',cmd.bankTxnId,{...b,status:'照合済',matchType:cmd.targetType,matchId:cmd.targetId,expenseIds,paymentId,pendingBefore,...(cmd.targetType==='platformSettlement'?{platformPayments,platformBefore,feeExpenseId,platformStatement:cmd.statement}:{}),confirmedBy:who.uid},'bank match confirm',cmd.expectedRevision);return {bankTxnId:cmd.bankTxnId,paymentId};
 }
 if(cmd.type==='bankUnmatch'){
  const row=await read('bankTransactions',cmd.bankTxnId);if(!row||row.payload.status!=='照合済')throw Error('照合済み取引を選択してください。');const b=row.payload,reason=required(cmd.reason,'解除理由');
  if(b.matchType==='platformSettlement'){
   for(const {id,payload} of b.platformBefore||[]){const p=await read('payments',id);if(!p||p.payload.bankTxnId!==cmd.bankTxnId)throw Error('関連入金が変更されています。');const next={...p.payload};for(const key of ['confirmation','paymentDate','date','bankTxnId','bankTransactionDate','platformStatement']){if(Object.hasOwn(payload,key))next[key]=payload[key];else delete next[key];}await context.writePaymentEvidence(id,next);}
   if(b.feeExpenseId){const e=await read('expenses',b.feeExpenseId);if(!e||e.payload.platformSettlementBankId!==cmd.bankTxnId)throw Error('手数料の関連が変更されています。');const p={...e.payload};delete p.platformSettlementBankId;await write('expenses',b.feeExpenseId,p,'adjustment');}
  }else if(b.matchType==='sale'){const p=await read('payments',b.paymentId);if(!p||p.payload.bankTxnId!==b.bankTxnId)throw Error('関連入金が変更されています。');await write('payments',b.paymentId,b.pendingBefore?{...b.pendingBefore}:{...p.payload,deletedAt:now(),deleteReason:reason},'adjustment');}
  else if(b.matchType==='cardSettlement'){
   for(const id of b.expenseIds||[]){const r=await read('expenses',id);if(!r||r.payload.bankTxnId!==b.bankTxnId)throw Error('関連支出が変更されています。');const p={...r.payload};delete p.bankTxnId;delete p.bankTransactionDate;await write('expenses',id,p,'adjustment');}
  }else if(b.matchType!=='bankIncome'){const n=b.matchType==='expense'?'expenses':'supplierTransactions',r=await read(n,b.matchId);if(!r||r.payload.bankTxnId!==b.bankTxnId)throw Error('関連取引が変更されています。');const p={...r.payload};delete p.bankTxnId;delete p.bankTransactionDate;await write(n,b.matchId,p,'adjustment');}
  await write('bankTransactions',cmd.bankTxnId,{...b,status:'未照合',matchType:'',matchId:'',expenseIds:[],paymentId:'',pendingBefore:null,...(b.matchType==='platformSettlement'?{platformPayments:[],platformBefore:[],feeExpenseId:'',platformStatement:''}:{}),unmatchReason:reason},'adjustment',cmd.expectedRevision);return {bankTxnId:cmd.bankTxnId};
 }
 if(cmd.type==='backfillCash'){if(!['payments','expenses','supplierTransactions'].includes(cmd.collection))throw Error('対象が不正です。');const r=await read(cmd.collection,cmd.id);if(r)await mirrorCash(cmd.collection,cmd.id,r.payload,read,write);return {id:cmd.id};}
 if(cmd.type==='migrateAccounting'){if(!['expenses','bankTransactions'].includes(cmd.collection))throw Error('対象が不正です。');const r=await read(cmd.collection,cmd.id);if(r)return {unchanged:true};await write(cmd.collection,cmd.id,cmd.payload,'migration',0);return {id:cmd.id};}
 if(cmd.type==='accountingMigrationComplete'){await write('migrations',cmd.sourceId,{migrationVersion:3,completed:true,sourceId:cmd.sourceId,backupKey:cmd.backupKey,count:cmd.count},'migration');return {completed:true};}
 throw Error('Unknown accounting command');
}
return {TYPES,handle,mirrorCash};
});
