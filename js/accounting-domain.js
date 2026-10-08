(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./accounting.js'):root.TsukinowaAccounting);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaAccountingDomain=api;})(globalThis,function(A){
'use strict';
const TYPES=['saveExpense','deleteExpense','cashAdjustment','saveSupplier','supplierTransaction','deleteSupplierTransaction','importBank','bankMatch','bankUnmatch','bankExclude','backfillCash','migrateAccounting','accountingMigrationComplete'];
async function mirrorCash(name,id,p,read,write){
 let eligible=false,type='expense',category='',description='',date='',linkedPaymentId='',linkedExpenseId='',linkedSupplierTransactionId='';
 if(name==='payments'){eligible=p.confirmation==='cash-received';type='income';category='現金入金';description=p.memo||'現場入金';date=p.paymentDate;linkedPaymentId=id;}
 else if(name==='expenses'){eligible=p.paymentMethod==='現金';category=p.category;description=p.description;date=p.expenseDate;linkedExpenseId=id;}
 else if(name==='supplierTransactions'){eligible=['prepayment','payment'].includes(p.type)&&p.paymentMethod==='現金';category='仕入先支払';description=p.description;date=p.date;linkedSupplierTransactionId=id;}
 else return;
 const cashTxnId='cash_'+id,old=await read('cashLedger',cashTxnId);
 if(eligible&&!p.deletedAt&&p.amount>0)await write('cashLedger',cashTxnId,{cashTxnId,date,type,category,description:description||'',amount:p.amount,linkedPaymentId,linkedExpenseId,linkedSupplierTransactionId,deletedAt:null},'cash transaction');
 else if(old&&!old.payload.deletedAt)await write('cashLedger',cashTxnId,{...old.payload,deletedAt:new Date().toISOString()},'cash transaction');
}
async function handle(cmd,{read,write,who,stable}){
 if(who.role!=='admin')throw Error('この会計操作は管理者のみ実行できます。');
 const now=()=>new Date().toISOString(),required=(s,label)=>{if(typeof s!=='string'||!s.trim())throw Error(label+'を入力してください。');return s.trim();};
 if(cmd.type==='saveExpense'){
  const id=cmd.expenseId,old=await read('expenses',id);if(old?.payload.supplierTransactionId)throw Error('仕入先台帳から月次請求を訂正してください。');if(old?.payload.bankTxnId)throw Error('照合済み支出は先に銀行照合を解除してください。');if(old?.payload.deletedAt)throw Error('取消済み支出です。新規登録してください。');
  const e=cmd.expense;await write('expenses',id,{expenseId:id,expenseDate:A.date(e.expenseDate),category:A.CATEGORIES.includes(e.category)?e.category:'その他',vendor:e.vendor||'',description:e.description||'',amount:A.money(e.amount),paymentMethod:required(e.paymentMethod,'支払方法'),bankAccount:e.paymentMethod==='現金'?'cash':e.bankAccount||'',receiptAttachmentRef:e.receiptAttachmentRef||'',deletedAt:null},old?'expense update':'expense create',cmd.expectedRevision);return {expenseId:id};
 }
 if(cmd.type==='deleteExpense'){const e=await read('expenses',cmd.expenseId);if(!e)throw Error('支出がありません。');if(e.payload.deletedAt)return {unchanged:true};if(e.payload.bankTxnId||e.payload.supplierTransactionId)throw Error('銀行照合を解除、または仕入先台帳から訂正してください。');await write('expenses',cmd.expenseId,{...e.payload,deletedAt:now(),deleteReason:required(cmd.reason,'取消理由')},'expense delete',cmd.expectedRevision);return {expenseId:cmd.expenseId};}
 if(cmd.type==='cashAdjustment'){const old=await read('cashLedger',cmd.cashTxnId);if(old)return {unchanged:true};if(!['income','expense'].includes(cmd.direction))throw Error('収支区分が不正です。');await write('cashLedger',cmd.cashTxnId,{cashTxnId:cmd.cashTxnId,date:A.date(cmd.date),type:cmd.direction,category:'残高調整',description:required(cmd.description,'調整理由'),amount:A.money(cmd.amount),linkedPaymentId:'',linkedExpenseId:'',linkedSupplierTransactionId:'',deletedAt:null},'adjustment',0);return {cashTxnId:cmd.cashTxnId};}
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
  if(old?.payload.bankTxnId)throw Error('照合済み取引は先に銀行照合を解除してください。');
  if(old&&(old.payload.supplierId!==payload.supplierId||old.payload.type!==payload.type))throw Error('仕入先・区分は変更できません。取消と新規登録を使用してください。');
  const supplier=await read('suppliers',payload.supplierId);if(!supplier||supplier.payload.deletedAt)throw Error('仕入先がありません。');
  await write('supplierTransactions',id,payload,cmd.type==='deleteSupplierTransaction'?'adjustment':'supplier transaction',cmd.expectedRevision);
  await write('suppliers',payload.supplierId,{...supplier.payload,currentBalance:supplier.payload.currentBalance-A.delta(old?.payload||{amount:0})+A.delta(payload)},'supplier transaction');
  if(payload.type==='monthlyInvoice'){const expenseId='expense_'+id,e=await read('expenses',expenseId);await write('expenses',expenseId,{...(e?.payload||{}),expenseId,expenseDate:payload.date,category:'材料費',vendor:supplier.payload.supplierName,description:payload.description,amount:payload.amount,paymentMethod:'月締',bankAccount:'',receiptAttachmentRef:'',supplierTransactionId:id,supplierId:payload.supplierId,invoiceMonth:payload.invoiceMonth,deletedAt:payload.deletedAt},payload.deletedAt?'expense delete':e?'expense update':'expense create');}
  return {transactionId:id};
 }
 if(cmd.type==='importBank'){
  const b=cmd.bank,old=await read('bankTransactions',b.bankTxnId);if(old){const p=old.payload;if(p.incoming!==b.incoming||p.outgoing!==b.outgoing||p.bankTransactionDate!==b.bankTransactionDate)throw Error('同一銀行取引IDの金額・日付が既存データと異なります。');return {bankTxnId:b.bankTxnId,unchanged:true};}
  if((b.incoming>0)===(b.outgoing>0))throw Error('銀行の入出金区分が不正です。');A.money(b.incoming||b.outgoing);A.date(b.bankTransactionDate);
  await write('bankTransactions',b.bankTxnId,{...b,status:'未照合',deletedAt:null},'bank csv import',0);return {bankTxnId:b.bankTxnId};
 }
 if(cmd.type==='bankExclude'){const b=await read('bankTransactions',cmd.bankTxnId);if(!b||b.payload.status==='照合済')throw Error('照合を解除してから除外してください。');await write('bankTransactions',cmd.bankTxnId,{...b.payload,status:cmd.excluded?'除外':'未照合',excludeReason:required(cmd.reason,'理由')},'adjustment',cmd.expectedRevision);return {bankTxnId:cmd.bankTxnId};}
 if(cmd.type==='bankMatch'){
  const row=await read('bankTransactions',cmd.bankTxnId);if(!row)throw Error('銀行取引がありません。');const b=row.payload;if(b.status==='照合済'){if(b.matchId===cmd.targetId&&b.matchType===cmd.targetType)return {unchanged:true};throw Error('別の記録と照合済みです。先に解除してください。');}if(b.status==='除外')throw Error('除外を解除してください。');
  let paymentId='',pendingBefore=null;
  if(cmd.targetType==='sale'){
   if(!b.incoming)throw Error('入金取引を選択してください。');const sale=await read(String(cmd.targetId).startsWith('receivable_')?'receivables':'sales',cmd.targetId);if(!sale||!A.live(sale.payload))throw Error('請求書がありません。');paymentId=cmd.paymentId||'pay_'+b.bankTxnId;const p=await read('payments',paymentId);
   if(cmd.paymentId){if(!p||p.payload.saleId!==cmd.targetId||p.payload.amount!==b.incoming||p.payload.confirmation!=='pending-bank'||p.payload.deletedAt)throw Error('仮入金の金額・対象・状態が一致しません。');pendingBefore=p.payload;}
   else if(p&&!p.payload.deletedAt)throw Error('この銀行取引の入金は登録済みです。');
   await write('payments',paymentId,{...(p?.payload||{}),id:paymentId,paymentId,saleId:cmd.targetId,amount:b.incoming,paymentDate:b.bankTransactionDate,date:b.bankTransactionDate,bankTransactionDate:b.bankTransactionDate,method:'銀行振込',bankAccount:b.bankAccount,bankTxnId:b.bankTxnId,confirmation:'bank-confirmed',memo:b.description,deletedAt:null},'payment confirm');
  }else if(cmd.targetType==='expense'||cmd.targetType==='supplier'){
   if(!b.outgoing)throw Error('出金取引を選択してください。');const collection=cmd.targetType==='expense'?'expenses':'supplierTransactions',target=await read(collection,cmd.targetId);if(!target||target.payload.deletedAt||target.payload.amount!==b.outgoing||target.payload.paymentMethod==='現金'||target.payload.bankTxnId||cmd.targetType==='expense'&&target.payload.paymentMethod==='月締'||cmd.targetType==='supplier'&&!['payment','prepayment'].includes(target.payload.type))throw Error('支出・支払の金額/状態が一致しません。');
   await write(collection,cmd.targetId,{...target.payload,bankTxnId:b.bankTxnId,bankTransactionDate:b.bankTransactionDate},'bank match confirm');
  }else throw Error('照合先を選択してください。');
  await write('bankTransactions',cmd.bankTxnId,{...b,status:'照合済',matchType:cmd.targetType,matchId:cmd.targetId,paymentId,pendingBefore,confirmedBy:who.uid},'bank match confirm',cmd.expectedRevision);return {bankTxnId:cmd.bankTxnId,paymentId};
 }
 if(cmd.type==='bankUnmatch'){
  const row=await read('bankTransactions',cmd.bankTxnId);if(!row||row.payload.status!=='照合済')throw Error('照合済み取引を選択してください。');const b=row.payload,reason=required(cmd.reason,'解除理由');
  if(b.matchType==='sale'){const p=await read('payments',b.paymentId);if(!p||p.payload.bankTxnId!==b.bankTxnId)throw Error('関連入金が変更されています。');await write('payments',b.paymentId,b.pendingBefore?{...b.pendingBefore}:{...p.payload,deletedAt:now(),deleteReason:reason},'adjustment');}
  else{const n=b.matchType==='expense'?'expenses':'supplierTransactions',r=await read(n,b.matchId);if(!r||r.payload.bankTxnId!==b.bankTxnId)throw Error('関連取引が変更されています。');const p={...r.payload};delete p.bankTxnId;delete p.bankTransactionDate;await write(n,b.matchId,p,'adjustment');}
  await write('bankTransactions',cmd.bankTxnId,{...b,status:'未照合',matchType:'',matchId:'',paymentId:'',pendingBefore:null,unmatchReason:reason},'adjustment',cmd.expectedRevision);return {bankTxnId:cmd.bankTxnId};
 }
 if(cmd.type==='backfillCash'){if(!['payments','expenses','supplierTransactions'].includes(cmd.collection))throw Error('対象が不正です。');const r=await read(cmd.collection,cmd.id);if(r)await mirrorCash(cmd.collection,cmd.id,r.payload,read,write);return {id:cmd.id};}
 if(cmd.type==='migrateAccounting'){if(!['expenses','bankTransactions'].includes(cmd.collection))throw Error('対象が不正です。');const r=await read(cmd.collection,cmd.id);if(r)return {unchanged:true};await write(cmd.collection,cmd.id,cmd.payload,'migration',0);return {id:cmd.id};}
 if(cmd.type==='accountingMigrationComplete'){await write('migrations',cmd.sourceId,{migrationVersion:3,completed:true,sourceId:cmd.sourceId,backupKey:cmd.backupKey,count:cmd.count},'migration');return {completed:true};}
 throw Error('Unknown accounting command');
}
return {TYPES,handle,mirrorCash};
});
