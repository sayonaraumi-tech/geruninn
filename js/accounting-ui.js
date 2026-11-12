/* Extend the existing desktop pages; mobile keeps its four operational tabs. */
(function(root){
'use strict';
const A=root.TsukinowaAccounting,el=id=>document.getElementById(id),B=()=>root.TsukinowaBusinessUI,enabled=()=>B().isEnabled(),uid=()=>crypto.randomUUID(),esc=s=>bizEsc(String(s??''));
let duplicateBackup=null;
let data={},expenseEdit=null,importing=false,expensePreview=null,expenseBank=null,categoryChosen=false;
const old={};for(const n of ['deleteExpense','renderExpenses','matchBankSale','bizPaid','bizOutstanding','exportBackup'])old[n]=root[n];
function isAdmin(){if(!enabled()||B().getClient()?.getState().role!=='admin'){root.bizOpenCloudAccount();return false;}return true;}
function rev(n,id){return B().getSync()?.getRevision(n,id)||0;}
function send(c){if(!isAdmin())return;return B().enqueue(c);}
const value=id=>el(id)?.value||'',table=(headers,body)=>`<div class="biz-table-wrap"><table class="biz-table"><thead><tr>${headers.map(h=>'<th>'+esc(h)+'</th>').join('')}</tr></thead><tbody>${body||'<tr><td colspan="20">記録はありません。</td></tr>'}</tbody></table></div>`,cell=x=>'<td>'+esc(x)+'</td>',money=x=>bizMoney(Number(x)||0);
function notice(message){el('accountingMessage').textContent=message;}
function guard(fn){return async(...args)=>{try{return await fn(...args);}catch(e){notice(e.message);alert(e.message);}};}
function flatten(rows){return rows.map(r=>({...r.payload,id:r.id,createdAt:r.createdAt,updatedAt:r.updatedAt,createdBy:r.createdBy,updatedBy:r.updatedBy,revision:r.revision}));}
function hydrate(rows){data={};for(const n of ['documents','sales','payments',...A.COLLECTIONS])data[n]=flatten(rows[n]||[]);data.sales.push(...flatten(rows.receivables||[]));bizState.expenses=data.expenses.filter(A.live).map(e=>({...e,date:e.expenseDate,method:e.paymentMethod,memo:e.description}));bizState.bank=data.bankTransactions.map(b=>({...b,date:b.bankTransactionDate,desc:b.description,matched:b.status==='照合済'}));renderCash();root.renderSales();renderCategoryRules();renderBankRules();renderDuplicateReview();renderSupplierLedger();}
root.TsukinowaAccountingUI={hydrate,role:()=>{supplierCorrection=null;if(el('supplierMonth'))el('supplierMonth').disabled=false;if(el('supplierChoice'))el('supplierChoice').disabled=false;duplicateBackup=null;expenseBank=null;expenseEdit=null;expensePreview=null;if(el('expenseImportCommit'))el('expenseImportCommit').disabled=true;},getData:()=>data};
root.bizPaid=function(s){if(!enabled())return old.bizPaid(s);return A.ledger([s],data.payments||[]).sales[0]?.paid||0;};
root.bizOutstanding=function(s){if(!enabled())return old.bizOutstanding(s);return Number(s.amount)-bizPaid(s);};
root.addExpense=guard(async()=>{if(!enabled())return alert('支出登録はクラウドにログインしてご利用ください。');const expense={expenseDate:value('expDate'),category:value('expCategory'),paymentMethod:value('expMethod'),vendor:value('expVendor'),description:value('expMemo'),amount:A.money(value('expAmount')),bankAccount:value('expBankAccount'),receiptAttachmentRef:value('expAttachment')};A.date(expense.expenseDate);const learnCategory=!!el('expenseLearnCategory')?.checked&&A.classificationKey(expense.vendor).length>=2;const expenseId=expenseEdit?.id||'expense_csv_'+(await B().getClient().digest(A.expenseKey(expense))).slice(0,48);if(expenseBank&&!confirm('入力した科目・取引先・内容・支払方法で新規支出を登録し、この銀行明細と照合しますか？'))return;if(send(expenseBank?{type:'expenseFromBank',bankTxnId:expenseBank.id,expense,expectedRevision:expenseBank.revision,learnCategory}:{type:'saveExpense',expenseId,expense,skipDuplicate:!expenseEdit,learnCategory,expectedRevision:expenseEdit?.revision||0})){expenseEdit=null;expenseBank=null;categoryChosen=false;if(el('expenseLearnCategory'))el('expenseLearnCategory').checked=true;['expAmount','expVendor','expMemo','expAttachment'].forEach(id=>el(id).value='');notice('支出を同期キューに保存しました。');}});
root.accountingEditExpense=function(id){if(!isAdmin())return;const e=data.expenses.find(x=>x.id===id);if(!e)return;expenseBank=null;expenseEdit={id,revision:rev('expenses',id)};el('expenseLearnCategory').checked=false;for(const [input,key] of [['expDate','expenseDate'],['expCategory','category'],['expMethod','paymentMethod'],['expVendor','vendor'],['expMemo','description'],['expAmount','amount'],['expBankAccount','bankAccount'],['expAttachment','receiptAttachmentRef']])el(input).value=e[key]||'';el('expAmount').scrollIntoView({behavior:'smooth'});};
root.deleteExpense=function(id){if(!enabled())return old.deleteExpense(id);if(!isAdmin())return;const reason=prompt('支出の取消理由（記録は保持されます）');if(reason)send({type:'deleteExpense',expenseId:id,reason,expectedRevision:rev('expenses',id)});};
root.renderExpenses=function(){if(!enabled())return old.renderExpenses();const m=value('expenseMonth')||bizNowMonth();el('expenseMonth').value=m;el('expenseRows').innerHTML=A.expenseRegister(data.expenses||[],m).map(e=>'<tr>'+[e.expenseDate,e.category,e.vendor,e.description,e.paymentMethod+' / '+A.expenseStatus(e),money(e.amount)].map(cell).join('')+`<td><button class="biz-btn" onclick="accountingEditExpense('${esc(e.id)}')">訂正</button><button class="biz-btn danger" onclick="deleteExpense('${esc(e.id)}')">取消</button></td></tr>`).join('');renderCash();};
function cashCustomerKey(name){return A.classificationKey(name).replace(/\s/g,'');}
function googleCashDuplicateCandidates(cash){
 const oldPayment=(data.payments||[]).find(p=>p.id===cash.linkedPaymentId&&A.live(p)&&p.sourceType==='calendar-cash'&&p.confirmation==='cash-received');
 const oldSale=oldPayment&&(data.sales||[]).find(s=>s.id===oldPayment.saleId&&A.live(s)&&s.sourceType==='calendar-cash'&&!s.documentId);
 if(!oldSale||oldSale.id!=='calendar_cash_'+oldSale.calendarEventId||cash.type!=='income'||oldPayment.amount!==cash.amount)return [];
 return (data.documents||[]).filter(d=>A.live(d)&&d.confirmed===true&&d.docType==='receipt'&&d.snapshot?.paymentMethod==='現金'&&d.saleId&&d.paymentId&&d.amount===cash.amount&&d.snapshot?.invoiceDate===oldSale.salesDate&&cashCustomerKey(d.customerName||d.snapshot?.customerName)===cashCustomerKey(oldSale.customer)).filter(d=>(data.sales||[]).some(s=>A.live(s)&&s.id===d.saleId&&s.sourceType==='receipt-cash'&&s.documentId===d.id)&&(data.payments||[]).some(p=>A.live(p)&&p.id===d.paymentId&&p.saleId===d.saleId&&p.confirmation==='cash-received'));
}
function renderCash(){
 if(!el('cashRows'))return;
 const m=value('expenseMonth'),rows=A.cashRows(data.cashLedger||[]);
 el('cashBalance').textContent=money(rows.at(-1)?.runningBalance||0);
 el('cashRows').innerHTML=table(['日付','区分','分類','摘要','金額','残高','操作'],rows.filter(r=>!m||r.date.startsWith(m)).map(r=>{
  const choices=googleCashDuplicateCandidates(r);
  const oldPay=(data.payments||[]).find(p=>p.id===r.linkedPaymentId&&A.live(p)&&p.sourceType==='calendar-cash'&&p.confirmation==='cash-received');
  const oldSale=oldPay&&(data.sales||[]).find(s=>s.id===oldPay.saleId&&A.live(s)&&s.sourceType==='calendar-cash'&&!s.documentId);
  const admin=enabled()&&B().getClient()?.getState().role==='admin';
  const action=admin&&oldSale&&oldSale.id==='calendar_cash_'+oldSale.calendarEventId?'<button class="biz-btn" data-google-duplicate-cash="'+esc(r.cashTxnId)+'">'+(choices.length===1?'重複したGoogle現金記録を除外':'重複記録の照合')+'</button>':'';
  return '<tr>'+[r.date,r.type==='income'?'収入':'支出',r.category,r.description,money(r.amount),money(r.runningBalance)].map(cell).join('')+'<td>'+action+'</td></tr>';
 }).join(''));
}
root.accountingExcludeGoogleCash=guard(async cashId=>{
 if(!isAdmin())return;
 const cash=(data.cashLedger||[]).find(c=>c.cashTxnId===cashId&&A.live(c));
 const matches=cash?googleCashDuplicateCandidates(cash):[];
 if(matches.length!==1)throw Error(matches.length===0?'正式領収書との自動照合ができません。帳票ID・顧客名・日付・金額と旧売上の関連を確認してください。':'複数の正式領収書候補があります。正しい帳票IDを特定してください。');
 if(!confirm('重複したGoogle自動計上のみ取り消します。正式領収書の売上・現金入金とGoogle日程は保持します。続行しますか？'))return;
 const doc=matches[0],oldPay=data.payments.find(p=>p.id===cash.linkedPaymentId),oldSale=data.sales.find(s=>s.id===oldPay?.saleId);
 if(!doc||!oldSale||!oldPay)throw Error('元の現金記録がありません。');
 const reason='管理者が同一工事の重複自動計上であることを確認';
 if(!send({type:'resolveDuplicateCalendarCash',operationId:uid(),calendarSaleId:oldSale.id,documentId:doc.id,confirmedDuplicate:true,reason,expectedSaleRevision:rev('sales',oldSale.id),expectedDocumentRevision:rev('documents',doc.id)}))return;
 notice('重複Google現金記録の除外処理を同期キューに登録しました。同期完了後に売上・HOME・現金帳を再確認してください。');
});

root.accountingCashAdjustment=guard(()=>{const cashTxnId='adjust_'+uid();if(send({type:'cashAdjustment',cashTxnId,date:value('cashAdjustDate'),direction:value('cashAdjustType'),amount:A.money(value('cashAdjustAmount')),description:value('cashAdjustReason')})){el('cashAdjustAmount').value='';el('cashAdjustReason').value='';}});
root.importBankCsv=guard(async()=>{if(!enabled())return alert('銀行CSV取込はクラウドにログインしてご利用ください。');if(!isAdmin()||importing)return;const file=el('bankFile').files[0];if(!file)throw Error('CSVを選択してください。');importing=true;try{const bytes=await file.arrayBuffer();let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){text=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}const records=await A.parseBank(text,value('bankAccountName'),B().getClient().digest);let count=0;for(const bank of records){if(!send({type:'importBank',bank}))throw Error('端末に同期キューを保存できませんでした。元CSVを保持して再試行してください。');count++;}el('bankImportStatus').textContent=count+'件を確認しました。重複を除いて同期します。';}finally{importing=false;}});
root.autoSuggestBank=function(){};
root.accountingBankRule=()=>{if(!isAdmin())return;const ruleType=value('bankRuleType'),key=value('bankRuleKey'),target=value('bankRuleValue');if(!key)return alert('対象を入力してください。');if(confirm('ルールを保存します。口座別名は同じ実口座のみ、顧客名は確認した名称のみ登録してください。今後のCSV取込に適用し、過去の会計記録は変更しません。'))send({type:'saveBankRule',ruleType,key,canonical:target,customer:target,enabled:true});};
root.accountingToggleBankRule=id=>{if(!isAdmin())return;const r=(data.settings||[]).find(r=>r.id===id);if(r)send({type:'saveBankRule',ruleType:r.type,key:r.key,canonical:r.canonical,customer:r.customerKey,enabled:r.enabled===false,expectedRevision:r.revision});};
function renderDuplicateReview(){
 if(!el('bankDuplicateReview'))return;
 const banks=data.bankTransactions||[],admin=enabled()&&B().getClient()?.getState().role==='admin';
 el('bankDuplicateReview').replaceChildren();if(!admin)return;
 for(const b of banks.filter(b=>A.classificationKey(b.bankAccount)==='メイン口座')){
  const saved=b.duplicateCancellation;
  const keepers=saved?[banks.find(k=>k.id===saved.keeperId)].filter(Boolean):banks.filter(k=>A.live(k)&&A.classificationKey(k.bankAccount).replace(/ /g,'')==='gmoあおぞら'&&k.bankTransactionDate===b.bankTransactionDate&&k.incoming===b.incoming&&k.outgoing===b.outgoing);
  for(const k of keepers){const review=saved?{reasons:[],refs:[]}:A.bankCancellationReview(b,k,data),row=document.createElement('div');row.style.cssText='padding:12px;border-bottom:1px solid #ccc;overflow-wrap:anywhere';
   const detail=document.createElement('p');detail.textContent=b.bankTransactionDate+' / '+b.description+' / 入金 '+money(b.incoming)+' / 出金 '+money(b.outgoing)+' / 取消対象 ID '+b.id+' (v'+b.revision+') / 保留 ID '+k.id+' (v'+k.revision+') / '+(saved?'重複取消済':review.reasons.join(' / ')||'強い証拠が一致・原本を確認してください。')+' / 参照 '+(review.refs.join(', ')||'検出なし')+' / 証拠 '+(review.evidence||saved?.sourceEvidence||'なし');row.append(detail);
   const button=document.createElement('button');button.className='biz-btn';button.textContent='取消・復元は無効（監査のみ）';button.disabled=true;row.append(button);el('bankDuplicateReview').append(row);
  }
 }
}
root.accountingDuplicateBackup=guard(async()=>{
 if(!isAdmin())return;if(B().getSync().getQueue().length)throw Error('同期キューの完了後に再試行してください。');
 const client=B().getClient(),records={};for(const n of root.TsukinowaBusiness.COLLECTIONS)records[n]=(await client.listRecords(n)).sort((a,b)=>a.id.localeCompare(b.id));
 const normalized=root.TsukinowaCloudCore.normalizeDates(records),business={...normalized};delete business.auditLogs;
 const digest=await client.digest(root.TsukinowaCloudCore.canonical(business));
 const backup={format:'geruninn-bank-review-backup-v1',projectId:client.getState().projectId,companyId:client.getState().companyId,exportedAt:new Date().toISOString(),digest,records:normalized};
 const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='geruninn-bank-review-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);duplicateBackup={digest};
 el('bankDuplicateStatus').textContent='バックアップを出力しました。安全な場所に保存されたことを確認してください。変更時は再出力が必要です。';
});
root.accountingDuplicateAction=guard(async(bankTxnId,keeperId,restore)=>{
 if(!isAdmin())return;const b=data.bankTransactions.find(r=>r.id===bankTxnId),k=data.bankTransactions.find(r=>r.id===keeperId);if(!b||!k)return;
 throw Error('取消・復元は無効です。安全な参照ロックの導入までは監査・バックアップのみ利用できます。');

});
let bankView='todo';
root.accountingBankView=view=>{bankView=view;document.querySelectorAll('[data-bank-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bankView===view)));root.renderBank();};
root.accountingPrepay=id=>{
 if(!isAdmin())return;const b=data.bankTransactions.find(b=>b.id===id);if(!b)return;
 let host=el('bankPrepayForm');host?.remove();host=document.createElement('form');host.id='bankPrepayForm';
 host.innerHTML='<h3>前渡金（費用計上なし）</h3><p>'+esc(b.bankTransactionDate+' / '+b.description+' / '+money(b.outgoing))+'</p><label>仕入先<select name="supplier"><option value="">選択してください</option>'+data.suppliers.filter(A.live).map(s=>'<option value="'+esc(s.id)+'">'+esc(s.supplierName)+'</option>').join('')+'</select></label><label>仕入先がない場合は新規登録<input name="supplierName" placeholder="例：東鵬"></label><p>銀行の出金は追加しません。月次請求の実際の材料購入額だけを別途確認して前渡残高から控除します。</p><button class="biz-btn primary">確認して前渡金を登録</button><button type="button" class="biz-btn" onclick="this.form.remove()">閉じる</button><p role="alert"></p>';
 const detail=[...el('bankRows').querySelectorAll('details')].find(e=>e.dataset.bankDetail===id);detail.open=true;detail.append(host);
 host.onsubmit=e=>{e.preventDefault();if(!host.elements.supplier.value&&!host.elements.supplierName.value.trim()){host.querySelector('[role=alert]').textContent='仕入先を選択、または新規仕入先名を入力してください。';return;}if(!confirm('選択した仕入先の前渡金として登録します。費用・追加出金は作成しません。よろしいですか？'))return;if(send({type:'supplierFromBank',bankTxnId:id,supplierId:host.elements.supplier.value,supplierName:host.elements.supplierName.value.trim(),description:b.description,expectedRevision:rev('bankTransactions',id)}))host.remove();};
};

function renderSupplierLedger(){
 if(!el('supplierLedger'))return;
 const choice=value('supplierChoice'),suppliers=(data.suppliers||[]).filter(A.live);el('supplierChoice').innerHTML='<option value="">仕入先を選択</option>'+suppliers.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.supplierName)+'</option>').join('');
 el('supplierChoice').value=choice||suppliers.find(s=>A.classificationKey(s.supplierName)==='東鵬')?.id||'';root.accountingSupplierPreview?.();el('supplierLedger').innerHTML=table(['仕入先','前渡残高'],suppliers.map(s=>'<tr>'+cell(s.supplierName)+cell(money(A.supplierBalance({...s,supplierId:s.supplierId||s.id},data.supplierTransactions||[])))+'</tr>').join(''))+table(['日付','仕入先','内容','材料請求','前渡増減','銀行証拠','操作'],(data.supplierTransactions||[]).filter(A.live).map(t=>'<tr>'+[t.date,suppliers.find(s=>s.id===t.supplierId)?.supplierName,t.description,t.type==='monthlyInvoice'?money(t.amount):'',money(A.delta(t)),t.bankTxnId||'月次請求 / '+(t.invoiceNo||t.invoiceMonth||'')].map(cell).join('')+(t.type==='monthlyInvoice'&&!t.sourceHash&&t.invoiceNo===t.invoiceMonth?'<td><button class="biz-btn" onclick="accountingCorrectSupplier(&quot;'+esc(t.id)+'&quot;)">訂正</button></td>':'<td></td>')+'</tr>').join(''));
}
root.accountingCreateSupplier=guard(async()=>{
 const name=value('supplierNewName').trim();if(!name)throw Error('仕入先名を入力してください。');if((data.suppliers||[]).some(s=>A.live(s)&&A.classificationKey(s.supplierName)===A.classificationKey(name)))throw Error('同名の仕入先があります。');
 const id='supplier_'+(await B().getClient().digest(A.classificationKey(name))).slice(0,48);send({type:'saveSupplier',supplierId:id,supplier:{supplierName:name,openingBalance:0,openingDate:todayISO()},expectedRevision:0});
});
let supplierCorrection=null;
root.accountingSupplierPreview=()=>{const s=(data.suppliers||[]).find(s=>s.id===value('supplierChoice')),balance=s?A.supplierBalance({...s,supplierId:s.supplierId||s.id},data.supplierTransactions||[]):0;el('supplierBalance').textContent=money(balance);el('supplierAfter').textContent=money(balance+(supplierCorrection?.deductionAmount||0)-(Number(value('supplierAmount'))||0));};
root.accountingCorrectSupplier=id=>{const t=data.supplierTransactions.find(t=>t.id===id);if(!t)return;supplierCorrection=t;el('supplierChoice').value=t.supplierId;el('supplierMonth').value=t.invoiceMonth;el('supplierAmount').value=t.amount;el('supplierMonth').disabled=true;el('supplierChoice').disabled=true;root.accountingSupplierPreview();el('supplierAmount').focus();};
root.accountingSettleSupplier=guard(()=>{
 const month=value('supplierMonth');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請求月を選択してください。');
 const last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).getUTCDate();
 const transaction={supplierId:value('supplierChoice'),date:month+'-'+last,invoiceMonth:month,amount:A.money(value('supplierAmount')),simpleMonthly:true,reviewed:true};
 if(send({type:'settleSupplierInvoice',transaction,correct:!!supplierCorrection,expectedRevision:supplierCorrection?.revision})){supplierCorrection=null;el('supplierMonth').disabled=false;el('supplierChoice').disabled=false;el('supplierAmount').value='';notice('材料請求を同期キューに保存しました。');}
});
root.accountingReviewIncome=id=>{
 if(!isAdmin())return;const b=data.bankTransactions.find(b=>b.id===id);if(!b)return;
 const interest=A.bankSpecial(b)==='受取利息',cashback=A.bankCashback(b);
 const category=interest?'受取利息':cashback?'雑収入（デビット利用還元）':'';
 const note=category?'銀行明細の'+category+'を確認':prompt('入金の確認内容',b.reviewNote||'');if(!note)return;
 const miscellaneous=!category&&confirm('既存の請求・入金に該当せず、営業外の雑収入として処理しますか？');
 if(confirm(category?b.bankTransactionDate+' / '+money(b.incoming)+' を「'+category+'」として照合しますか？売上は追加しません。':miscellaneous?'雑収入として照合しますか？売上は追加しません。':'確認内容のみ保存し、未照合のまま保持しますか？'))send({type:'reviewBankIncome',bankTxnId:id,note,interest,cashback,...(miscellaneous?{category:'雑収入'}:{}),expectedRevision:rev('bankTransactions',id)});
};
function bankRows(){
 const groups=new Map(),rows=[];
 for(const b of (data.bankTransactions||[]).filter(A.live)){const key=A.bankIdentity(b,data.settings);if(!key){rows.push(b);continue;}if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
 for(const group of groups.values()){
  const matched=group.filter(b=>b.status==='照合済');
  if(matched.length>1||group.some(b=>b.incoming!==group[0].incoming||b.outgoing!==group[0].outgoing||b.bankTransactionDate!==group[0].bankTransactionDate||A.classificationKey(b.description)!==A.classificationKey(group[0].description))){rows.push(...group.map(b=>({...b,duplicateNotice:'重複・照合競合：要確認'})));continue;}
  const b=matched[0]||group[0];rows.push({...b,duplicateNotice:group.length>1?'同一証拠 '+group.length+'件をまとめて表示（原記録保持）':''});
 }
 return rows.sort((a,b)=>b.bankTransactionDate.localeCompare(a.bankTransactionDate));
}
root.matchBankSale=(bankTxnId,targetId)=>enabled()?root.accountingConfirmBank(bankTxnId,{targetType:'sale',targetId,paymentId:''}):old.matchBankSale(bankTxnId,targetId);
root.accountingConfirmBank=(bankTxnId,target)=>{if(!isAdmin())return;const b=data.bankTransactions.find(b=>b.id===bankTxnId);if(!b)return;if(!target){try{target=JSON.parse(value('bankTarget_'+bankTxnId));}catch(_){return alert('照合先を選択してください。');}}if(confirm(`${b.bankTransactionDate} ${b.bankAccount} ${money(b.amount)}\nこの銀行明細と選択した記録を照合しますか？`))send({type:'bankMatch',bankTxnId,...target,expectedRevision:rev('bankTransactions',bankTxnId)});};
root.accountingUnmatchBank=bankTxnId=>{if(!isAdmin())return;const reason=prompt('照合解除の理由（変更履歴は保持されます）');if(reason)send({type:'bankUnmatch',bankTxnId,reason,expectedRevision:rev('bankTransactions',bankTxnId)});};
root.accountingExcludeBank=(bankTxnId,excluded)=>{if(!isAdmin())return;const reason=prompt(excluded?'除外理由':'除外解除の理由');if(reason)send({type:'bankExclude',bankTxnId,excluded,reason,expectedRevision:rev('bankTransactions',bankTxnId)});};
root.accountingCardSettlement=function(id){if(!isAdmin())return;const expenseIds=[...document.querySelectorAll('[data-card-bank="'+CSS.escape(id)+'"]:checked')].map(e=>e.value),entries=data.expenses.filter(e=>expenseIds.includes(e.id));if(!entries.length)return alert('既存のカード支出を選択してください。');const b=data.bankTransactions.find(b=>b.id===id);if(confirm('カード '+entries[0].bankAccount+' / '+entries.length+'件 / '+money(entries.reduce((n,e)=>n+e.amount,0))+'\n銀行引落 '+money(b.outgoing)+' と照合しますか？'))send({type:'bankMatch',bankTxnId:id,targetType:'cardSettlement',targetId:id,expenseIds,cardAccount:entries[0].bankAccount,expectedRevision:rev('bankTransactions',id)});};
root.accountingManualBank=id=>{
 if(!isAdmin())return;const b=data.bankTransactions.find(b=>b.id===id),detail=[...el('bankRows').querySelectorAll('details')].find(e=>e.dataset.bankDetail===id);if(!b||!detail)return;el('bankManualForm')?.remove();const form=document.createElement('form');form.id='bankManualForm';
 const candidates=(data.sales||[]).filter(s=>A.live(s)&&s.paymentMethod!=='現金'&&!['calendar-cash','receipt-cash'].includes(s.sourceType)&&!/代表者立替/.test(s.paymentMethod||''));
 form.innerHTML='<h3>既存売上・未収への手動照合</h3><p>請求書の原本と既存売上IDを確認してください。断リンクの帳票は再登録せず、対応する既存売上を指定します。別の売上や金額の曖昧な記録を選択しないでください。</p><label>既存売上<select name="sale" required><option value="">選択してください</option>'+candidates.map(s=>'<option value="'+esc(s.id)+'">'+esc((s.invoiceNo||s.id)+' / '+s.customer+' / '+(s.salesDate||s.saleDate)+' / '+money(s.amount))+'</option>').join('')+'</select></label><label><input type="checkbox" name="reviewed" required>請求書・金額・既存入金を確認しました</label><button class="biz-btn primary" '+(!candidates.length?'disabled':'')+'>既存記録と照合</button><button class="biz-btn" type="button" onclick="this.form.remove()">閉じる</button>'+(!candidates.length?'<p>有効な売上・未収記録がありません。原本と売上リンクの管理者修復が必要です。銀行記録は未照合で保持します。</p>':'');detail.open=true;detail.append(form);form.onsubmit=e=>{e.preventDefault();root.accountingConfirmBank(id,{targetType:'sale',targetId:form.elements.sale.value,paymentId:''});};
};
root.accountingPlatform=id=>{
 if(!isAdmin())return;const b=data.bankTransactions.find(b=>b.id===id),detail=[...el('bankRows').querySelectorAll('details')].find(e=>e.dataset.bankDetail===id);if(!b||!detail)return;el('bankPlatformForm')?.parentElement?.remove();el('bankPlatformSource')?.remove();
 const source=document.createElement('form');source.id='bankPlatformSource';source.innerHTML='<h3>くらしのマーケット入金の確認</h3><p>Stripe Japan / '+esc(money(b.incoming))+'</p><label><input type="checkbox" required>くらしのマーケットの振込であることを確認しました</label><button class="biz-btn primary">入金元を確認・明細は照合待ち</button><p>売上・入金・手数料を追加せず、未照合で保持します。注文明細の関連付けは必要な場合に行います。</p>';source.onsubmit=e=>{e.preventDefault();if(send({type:'reviewBankIncome',bankTxnId:id,note:'くらしのマーケット入金元確認済・明細配分待ち',expectedRevision:rev('bankTransactions',id)}))source.remove();};detail.open=true;detail.append(source);
 const host=document.createElement('form');host.id='bankPlatformForm';const ps=A.platformPayments(b,data);
 host.innerHTML='<h3>くらしのマーケット / プラットフォーム精算</h3><p>精算書と注文・既存入金を照合します。売上・入金・手数料は新規作成しません。最大5件（手数料控除ありは4件）を同じ銀行入金額に一致する精算単位で確認してください。超える精算は管理者確認が必要です。</p>'+ps.map(p=>'<label class="bank-order"><input type="checkbox" name="payment" value="'+esc(p.id)+'">'+esc((data.sales.find(s=>s.id===p.saleId)?.customer||'売上リンク要確認')+' / '+p.saleId+' / '+(p.paymentDate||p.date)+' / '+money(p.amount))+'</label>').join('')+(!ps.length?'<p role="status">対象入金がありません。「売上・入金」で既存注文の入金経路をくらしのマーケットに設定し、精算書と照合してください。銀行明細は未照合のまま保持します。</p>':'')+'<label>精算書番号・確認内容<input name="statement" required></label><label>精算書で控除された既存手数料<select name="fee"><option value="">控除なし</option>'+(data.expenses||[]).filter(e=>A.live(e)&&e.category==='支払手数料'&&!e.bankTxnId&&!e.platformSettlementBankId&&e.expenseDate<=b.bankTransactionDate).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.expenseDate+' / '+e.vendor+' / '+money(e.amount))+'</option>').join('')+'</select></label><p>別途支払済みの手数料は選択しないでください。</p><p role="status" data-total></p><button class="biz-btn primary" '+(!ps.length?'disabled':'')+'>明細確認・照合</button><button class="biz-btn" type="button" onclick="this.form.remove()">閉じる</button><p role="alert"></p>';
 const more=document.createElement('details');more.innerHTML='<summary>必要な場合：注文・精算明細を関連付け</summary>';more.append(host);detail.append(more);const totals=()=>{const ids=[...host.querySelectorAll('[name=payment]:checked')].map(e=>e.value),gross=ps.filter(p=>ids.includes(p.id)).reduce((n,p)=>n+p.amount,0),fee=(data.expenses||[]).find(e=>e.id===host.elements.fee.value)?.amount||0;host.querySelector('[data-total]').textContent='入金合計 '+money(gross)+' − 手数料 '+money(fee)+' / 銀行入金 '+money(b.incoming);return {ids,gross,fee};};host.onchange=totals;totals();
 host.onsubmit=e=>{e.preventDefault();const {ids,gross,fee}=totals();if(!ids.length||ids.length>(host.elements.fee.value?4:5)||gross-fee!==b.incoming){host.querySelector('[role=alert]').textContent='1〜5件の既存入金を選択し、控除後合計を銀行入金額と一致させてください。';return;}if(confirm('精算書と注文・控除を確認しましたか？既存記録に銀行証拠だけを追加します。'))send({type:'bankMatch',bankTxnId:id,targetType:'platformSettlement',targetId:id,paymentIds:ids,feeExpenseId:host.elements.fee.value,statement:host.elements.statement.value,expectedRevision:rev('bankTransactions',id)});};
};
function targets(b,match){if(b.incoming)return match.candidates.map(c=>({targetType:c.kind,targetId:c.id,paymentId:c.paymentId,blocked:c.blocked||false,label:`${c.invoiceNo||c.id} / ${c.customer||''} / 未収 ${money(c.outstanding)}${c.blocked?' / 売上・未収リンク要確認':''}`}));return [...(data.supplierTransactions||[]).filter(t=>A.live(t)&&['prepayment','payment'].includes(t.type)&&t.paymentMethod!=='現金'&&!t.bankTxnId&&t.amount===b.outgoing).map(t=>({targetType:'supplier',targetId:t.id,paymentId:'',label:'仕入先支払 / '+t.description+' / '+money(t.amount)})),...match.candidates.filter(c=>c.kind==='expense').map(c=>{const e=data.expenses.find(e=>e.id===c.id);return {targetType:'expense',targetId:c.id,paymentId:'',label:e.vendor+' / '+e.expenseDate+' / '+money(e.amount)};})];}
root.renderBank=function(){if(!enabled()||!B().getClient()?.getState().role){el('bankRows').innerHTML='<tr><td colspan="6">銀行照合はクラウドにログインしてご利用ください。<button class="biz-btn" onclick="bizOpenCloudAccount()">ログイン</button></td></tr>';return;}const drafts=[...el('bankRows').querySelectorAll('details>form')].map(form=>({form,id:form.parentElement.dataset.bankDetail}));const opened=new Set([...el('bankRows').querySelectorAll('details[open]')].map(e=>e.dataset.bankDetail));const selected=new Map([...el('bankRows').querySelectorAll('select')].map(e=>[e.id,e.value])),checked=new Set([...el('bankRows').querySelectorAll('[data-card-bank]:checked')].map(e=>e.dataset.cardBank+'|'+e.value));const rows=bankRows().filter(b=>bankView==='all'||(bankView==='done'?['照合済','除外'].includes(b.status):!['照合済','除外'].includes(b.status)));el('bankRows').innerHTML=rows.map(b=>{const match=A.bankMatch(b,data),suggestions=match.candidates,available=targets(b,match),state=match.card?'未一致 / カード決済まとめ候補':!['照合済','除外'].includes(b.status)&&A.bankSpecial(b)?A.bankSpecial(b)+' / 確認待ち':match.status;let controls='';if(b.status==='照合済')controls=`${esc(b.matchType==='platformSettlement'?'くらしのマーケット精算 / '+b.platformStatement:b.matchType==='bankIncome'?'営業外収益 / '+b.category:b.matchType==='sale'?'売上・入金 / '+(data.sales.find(s=>s.id===b.matchId)?.customer||''):b.matchType==='expense'?'支出':b.matchType==='cardSettlement'?'カード引落 / '+(b.expenseIds||[]).join(' / '):'仕入先支払')} <button class="biz-btn" onclick="accountingUnmatchBank('${esc(b.id)}')">解除</button>`;else if(b.status==='除外')controls=`${esc(b.excludeReason)} <button class="biz-btn" onclick="accountingExcludeBank('${esc(b.id)}',false)">除外解除</button>`;else if(A.platformBank(b)){controls=`<button class="biz-btn primary" onclick="accountingPlatform('${esc(b.id)}')">入金元を確認</button>`;}else if(b.outgoing&&A.cardSettlement(b)){controls='カード決済まとめ候補。カード識別名・明細を確認し、引落額と一致する既存費用を選択（最大5件）。'+A.cardExpenses(b,data).map(e=>`<label style="display:block"><input type="checkbox" data-card-bank="${esc(b.id)}" value="${esc(e.id)}">${esc(e.bankAccount+' / '+e.expenseDate+' / '+e.vendor+' / '+money(e.amount))}</label>`).join('')+`<button class="biz-btn" onclick="accountingCardSettlement('${esc(b.id)}')">選択支出の引落照合</button>`;}else{controls=available.length?`<select aria-label="照合先" id="bankTarget_${esc(b.id)}"><option value="">例外の照合先を選択</option>`+available.map(t=>{const sug=suggestions.find(s=>s.kind===t.targetType&&s.id===t.targetId&&s.paymentId===t.paymentId);const {label,blocked,...v}=t;return `<option ${blocked?'disabled':''} value="${esc(JSON.stringify(v))}">${esc((sug?`候補 ${sug.score}点 (${sug.reasons.join('・')}) / `:'')+label)}</option>`;}).join('')+`</select>${available.some(t=>!t.blocked)?`<button class="biz-btn ok" onclick="accountingConfirmBank('${esc(b.id)}')">照合確定</button>`:''}${available.filter(t=>t.blocked).map(t=>'<p role="status">'+esc(t.label)+'：保存帳票で原本と売上IDを確認してください。売上を再登録せず、管理者が既存リンクを修復してください。</p>').join('')}`:'';controls+=`${b.outgoing&&!A.knownSupplierAdvance(b)&&!suggestions.length?`<button class="biz-btn" onclick="accountingExpenseFromBank('${esc(b.id)}')">この銀行明細から支出登録</button>`:''}`;}if(b.incoming&&!A.platformBank(b)&&!A.bankSpecial(b)&&!A.bankCashback(b)&&!['照合済','除外'].includes(b.status))controls+=`<button class="biz-btn" onclick="accountingManualBank('${esc(b.id)}')">既存売上・未収を手動選択</button>`;if(!['照合済','除外'].includes(b.status))controls+=`<button class="biz-btn" onclick="accountingExcludeBank('${esc(b.id)}',true)">除外</button>`;return '<tr>'+[b.bankTransactionDate,b.description+' / '+b.bankAccount+(b.duplicateNotice?' / '+b.duplicateNotice:''),b.incoming?'＋'+money(b.incoming):'',b.outgoing?'−'+money(b.outgoing):''].map(cell).join('')+'<td><details data-bank-detail="'+esc(b.id)+'"><summary><span class="bank-candidate">'+esc(['照合済','除外'].includes(b.status)?'照合内容':suggestions.length?suggestions.length+'件の候補 / '+suggestions.map(c=>c.customer||c.invoiceNo||c.id).join('・'):A.platformBank(b)?(b.reviewNote||'くらしのマーケット / 元確認'):A.bankSpecial(b)||'候補なし・手動処理')+'</span>確認・処理</summary><div class="bank-controls">'+controls+(b.outgoing&&!['照合済','除外'].includes(b.status)?`<button class="biz-btn" onclick="accountingPrepay('${esc(b.id)}')">前渡金として処理</button>`:'')+(b.incoming&&!A.platformBank(b)&&!['照合済','除外'].includes(b.status)?`<button class="biz-btn" onclick="accountingReviewIncome('${esc(b.id)}')">${A.bankSpecial(b)==='受取利息'?'受取利息を確認':A.bankCashback(b)?'キャッシュバックを確認':'入金内容を確認'}</button><p>${esc(b.reviewNote||'')}</p>`:'')+'</div></details></td><td><span class="bank-status '+(['照合済','除外'].includes(b.status)?'done':'')+'">'+esc(state)+'</span></td></tr>';}).join('');for(const detail of el('bankRows').querySelectorAll('details'))detail.open=opened.has(detail.dataset.bankDetail);for(const select of el('bankRows').querySelectorAll('select')){const saved=selected.get(select.id);if([...select.options].some(o=>o.value===saved&&!o.disabled))select.value=saved;}for(const input of el('bankRows').querySelectorAll('[data-card-bank]'))input.checked=checked.has(input.dataset.cardBank+'|'+input.value);for(const {form,id} of drafts){const detail=[...el('bankRows').querySelectorAll('details')].find(e=>e.dataset.bankDetail===id);if(detail&&!['照合済','除外'].includes(data.bankTransactions.find(b=>b.id===id)?.status))detail.append(form);}};
// Import and manual entry share the saveExpense command and its cash mirror.
root.accountingPreviewExpenses=guard(async()=>{
 if(!isAdmin()||importing)return;expensePreview=null;el('expenseImportCommit').disabled=true;
 const file=el('expenseFile').files[0];if(!file)throw Error('CSVを選択してください。');
 const bytes=await file.arrayBuffer();let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){text=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}
 const pending=B().getSync().getQueue().map(x=>x.command).filter(c=>c.type==='saveExpense').map(c=>c.expense);
 expensePreview=A.expensePreview(text,[...(data.expenses||[]),...pending],data.settings||[]);
 if(el('expenseFile').files[0]!==file){expensePreview=null;return;}
 const p=expensePreview;el('expenseImportRows').innerHTML=table(['行','日付','科目','支払方法','取引先','金額','内容・備考','取込'],p.records.map(r=>'<tr>'+[r.line,r.expense.expenseDate,(r.classification.review?'要確認 / ':'')+r.expense.category+' / '+r.classification.source,r.expense.paymentMethod,r.expense.vendor,money(r.expense.amount),r.expense.description,r.duplicate?'重複候補・スキップ':'取込対象'].map(cell).join('')+'</tr>').join(''));el('expenseImportPreview').textContent=p.count+'件 / 取込対象合計 '+money(p.total)+' / 重複候補 '+p.duplicates+'件（スキップ） / エラー '+p.errors.length+'件 '+p.errors.join(' / ');
 el('expenseImportCommit').disabled=!!p.errors.length||!p.records.some(r=>!r.duplicate);
});
root.accountingImportExpenses=guard(async()=>{
 if(!isAdmin()||importing||!expensePreview||expensePreview.errors.length)return;
 if(expensePreview.records.some(r=>!r.duplicate&&r.classification.review)&&!confirm('科目ルールのない行は「その他」で登録します。科目を確認しましたか？'))return;
 importing=true;el('expenseImportCommit').disabled=true;
 try{let count=0;for(const r of expensePreview.records.filter(r=>!r.duplicate)){
 const hash=await B().getClient().digest(r.key);
 if(!send({type:'saveExpense',expenseId:'expense_csv_'+hash.slice(0,48),expense:r.expense,skipDuplicate:true,expectedRevision:0}))throw Error('同期キューを保存できません。再試行してください。');count++;
 }el('expenseImportPreview').textContent=count+'件を同期キューに保存しました。重複はスキップします。';expensePreview=null;
 }finally{importing=false;}
});
root.accountingExpenseFromBank=bankTxnId=>{
 if(!isAdmin())return;const b=data.bankTransactions.find(b=>b.id===bankTxnId);
 if(!b||!b.outgoing||b.status==='照合済'||A.cardSettlement(b))return;
 if(A.expenseMatch(b,data).candidates.length)return alert('既存の支出候補を選択して照合してください。新規支出は作成しません。');
 let dialog=el('bankExpenseDialog');if(dialog)dialog.remove();
 dialog=document.createElement('dialog');dialog.id='bankExpenseDialog';dialog.setAttribute('aria-label','銀行明細から支出登録');dialog.style.cssText='margin:auto;width:min(520px,calc(100% - 24px));max-height:90vh;overflow:auto;border:0;border-radius:14px;padding:20px';
 dialog.innerHTML='<h2>銀行明細から支出登録</h2><p>既存支出を確認し、科目・取引先を確定してください。</p><form id="bankExpenseForm">'+
 [['expenseDate','日付','date',b.bankTransactionDate],['amount','金額','number',b.outgoing],['vendor','取引先','text',b.description],['description','内容','text',b.description],['receiptAttachmentRef','領収書参照','text','']].map(([key,label,type,v])=>`<label style="display:block;margin:12px 0">${label}<input style="width:100%" name="${key}" type="${type}" value="${esc(v)}" ${['expenseDate','amount'].includes(key)?'readonly':''}></label>`).join('')+
 '<label>科目<select name="category">'+A.CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('')+'</select></label><label>支払方法<select name="paymentMethod"><option>銀行振込</option><option>法人銀行デビット</option><option>口座振替</option></select></label><p id="bankExpenseClassification"></p><label><input name="learnCategory" type="checkbox" checked>取引先→科目を学習</label><p id="bankExpenseError" role="alert"></p><button class="biz-btn ok" type="submit">支出登録・照合確認</button><button class="biz-btn" type="button" id="bankExpenseClose">閉じる</button></form>';
 document.body.append(dialog);const form=el('bankExpenseForm');let chosen=false;
 const classify=()=>{if(chosen)return;const c=A.classifyExpense(form.elements.vendor.value,'',data.settings||[]);form.elements.category.value=c.category||'その他';el('bankExpenseClassification').textContent=c.source+'：科目を確認してください。';};
 form.elements.vendor.addEventListener('change',classify);form.elements.category.addEventListener('change',()=>chosen=true);classify();
 if(/デビット|debit/i.test(b.description))form.elements.paymentMethod.value='法人銀行デビット';
 el('bankExpenseClose').onclick=()=>dialog.close();
 form.onsubmit=event=>{event.preventDefault();try{const expense=Object.fromEntries(new FormData(form));expense.amount=A.money(expense.amount);A.date(expense.expenseDate);if(A.expenseMatch(b,data).candidates.length)throw Error('既存の支出候補があります。閉じて照合先を選択してください。');if(!confirm('この内容で支出を登録し、銀行明細と照合しますか？'))return;if(send({type:'expenseFromBank',bankTxnId,expense,learnCategory:form.elements.learnCategory.checked,expectedRevision:rev('bankTransactions',bankTxnId)})){dialog.close();notice('支出・照合を同期キューに保存しました。');}}catch(e){el('bankExpenseError').textContent=e.message;}};
 dialog.showModal();
};
function renderCategoryRules(){if(!el('expenseCategoryRules'))return;el('expenseCategoryRules').innerHTML=table(['取引先（完全一致）','科目','状態','操作'],(data.settings||[]).filter(r=>r.type==='expenseCategoryRule'&&!r.deletedAt).map(r=>'<tr>'+cell(r.vendor)+cell(r.category)+cell(r.enabled?'有効':'停止')+`<td><button class="biz-btn" onclick="accountingChangeRule('${esc(r.id)}','edit')">変更</button><button class="biz-btn" onclick="accountingChangeRule('${esc(r.id)}','toggle')">有効・停止</button><button class="biz-btn" onclick="accountingChangeRule('${esc(r.id)}','delete')">削除</button></td></tr>`).join(''));}
root.accountingChangeRule=(id,action)=>{if(!isAdmin())return;const r=(data.settings||[]).find(r=>r.id===id);if(!r)return;let category=r.category;if(action==='edit'){category=prompt('科目: '+A.CATEGORIES.join(' / '),r.category);if(!category)return;if(!A.CATEGORIES.includes(category))return alert('科目を確認してください。');}if(action==='delete'&&!confirm('学習ルールを削除しますか？過去の支出は変更しません。'))return;send({type:'saveExpenseCategoryRule',vendor:r.vendor,category,enabled:action==='toggle'?!r.enabled:r.enabled,deleted:action==='delete',expectedRevision:r.revision});};
function prefillCategory(){if(expenseEdit||categoryChosen)return;const c=A.classifyExpense(value('expVendor'),'',data.settings||[]);el('expCategory').value=c.category||'その他';el('expenseLearnCategory').checked=!(data.settings||[]).some(r=>r.type==='expenseCategoryRule'&&r.key===A.classificationKey(value('expVendor')));el('expenseClassificationStatus').textContent=c.source+(c.review?'：科目を確認してください。':'：登録前に確認してください。');}
const registerHeaders=['売上日','顧客','内容','請求書発行日','領収書発行日','請求額','入金済','未収','最終入金日','経過日数','状態'];
let registerView={asOf:'',rows:[],sales:[]};
function registerData(){return enabled()?data:{sales:bizState.sales,payments:bizState.payments,documents:(root.loadConfirmedHistory?.()||[]).map(d=>({...d,confirmed:true,snapshot:d}))};}
function homeData(){if(enabled())return root.TsukinowaYearEnd.effective(data);return {sales:bizState.sales.map(s=>({...s,salesDate:s.salesDate||s.saleDate})),payments:bizState.payments.map(p=>({...p,paymentDate:p.paymentDate||p.date})),expenses:bizState.expenses.map(e=>({...e,expenseDate:e.expenseDate||e.date,paymentMethod:e.paymentMethod||e.method,description:e.description||e.memo})),bankTransactions:[],cashLedger:[]};}
// HOME-only projection; accounting rows and CSV evidence remain untouched.
function homeMerchant(value){
 const raw=String(value||'').trim();
 if(!/Visa\s*デビット利用/i.test(raw))return raw;
 return raw.replace(/^.*?Visa\s*デビット利用\s*/i,'').replace(/(?:承認番号|TID)\s*[:：]?.*$/i,'').replace(/^[\s:：/]+|[\s/]+$/g,'').trim()||'取引先要確認';
}
function homePresentation(r,d){
 const expense=(d.expenses||[]).find(e=>'expense:'+(e.id||e.expenseId)===r.id);
 return {type:/代表者立替/.test(expense?.paymentMethod||'')?'立替':({'過月売上の入金':'入金','未関連入金':'入金','前渡金':'前渡','営業外収益':'雑収','代表者立替（交通系IC）':'立替'})[r.type]||r.type,
 direction:r.outgoing>0?'out':r.incoming>0?'in':'neutral',amount:r.outgoing||r.incoming||r.sales||0,
 customer:homeMerchant(r.customer),description:expense?(expense.category&&!expense.reviewRequired&&!expense.accountingReviewRequired?expense.category:'内容要確認'):r.description,
 hint:r.type==='過月売上の入金'?'売上日 '+r.date+' / 入金 '+r.paymentDates:r.type==='未関連入金'?'売上リンクなし':r.sales&&r.incoming?'期間内売上 '+money(r.sales):''};
}
function homeRows(d,p){
 const rows=A.ledgerRows(d,p);
 for(const t of (d.supplierTransactions||[]).filter(t=>A.live(t)&&t.type==='prepayment'&&p.includes(t.date))){
  if(rows.some(r=>r.id==='cash:'+t.cashTxnId))continue;
  rows.push({id:'prepayment:'+(t.id||t.transactionId),date:t.date,type:'前渡金',customer:(d.suppliers||[]).find(s=>(s.id||s.supplierId)===t.supplierId)?.supplierName||'取引先要確認',description:'前渡金（費用計上なし）',method:t.paymentMethod||'',outgoing:Number(t.amount)||0,status:'確認済'});
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
function homePeriod(){const mode=value('homePeriodMode');return A.periodFilter(mode==='year'?{year:value('homeYear')}:mode==='custom'?{start:value('homeStart'),end:value('homeEnd')}:{month:value('homeMonth')||bizNowMonth()});}
root.renderDashboard=function(){if(!el('homeMonth'))return;const now=bizNowMonth();if(!value('homeMonth'))el('homeMonth').value=now;if(!value('homeYear'))el('homeYear').value=+now.slice(0,4)-(+now.slice(5)<10?1:0);if(!value('homeStart'))el('homeStart').value=now+'-01';if(!value('homeEnd'))el('homeEnd').value=A.periodFilter({month:now}).end;
 const mode=value('homePeriodMode');for(const [id,shown] of [['homeMonthField',mode==='month'],['homeYearField',mode==='year'],['homeStartField',mode==='custom'],['homeEndField',mode==='custom']])el(id).hidden=!shown;
 let p;try{p=homePeriod();}catch(e){el('dashPeriod').textContent=e.message;return;}const d=homeData(),m=A.aggregate(d,p);el('dashPeriod').textContent=p.start+' ～ '+p.end;for(const [id,k] of [['kpiSales','sales'],['kpiPayments','income'],['kpiExpenses','expenseTotal'],['kpiReceivable','receivables'],['kpiDifference','cashFlowDifference']])el(id).textContent=money(m[k]);el('kpiAttention').textContent=m.attention;for(const [id,label] of [['kpiSales','売上'],['kpiPayments','入金'],['kpiExpenses','支出']])el(id).previousElementSibling.textContent=label;
 el('attentionList').replaceChildren(...m.reminders.map(message=>{const p=document.createElement('p');p.textContent=message;return p;}));if(!m.reminders.length)el('attentionList').textContent='確認事項はありません。';
 el('homeLedger').innerHTML=table(['日付','区分','取引先','内容','支払方法','金額','状態'],homeRows(d,p).map(r=>{const v=homePresentation(r,d),status=(r.homeStatus||r.status.replace(/^照合済/,'入金済').split(' / ').filter(v=>!['銀行未照合','照合済','引落照合待ち'].includes(v)).join(' / ')).replace(/未入金/g,'入金待ち'),textCell=x=>'<td><span class="home-text" title="'+esc(x)+'">'+esc(x)+'</span></td>';return '<tr>'+cell(r.date)+'<td><span class="home-kind" data-kind="'+esc(v.type)+'" title="'+esc(v.hint)+'">'+esc(v.type)+'</span></td>'+[v.customer,v.description,r.method].map(textCell).join('')+'<td class="home-amount '+v.direction+'" title="'+esc(v.hint)+'">'+(v.direction==='in'?'＋':v.direction==='out'?'−':'')+esc(money(v.amount))+'</td><td><span class="home-status '+(/要確認|未入金|待ち/.test(status)?'pending':'')+'">'+esc(status)+'</span></td></tr>';}).join(''));
 el('homeBreakdown').innerHTML=table(['内訳','金額'],[...Object.entries(m.categories).filter(([,v])=>v).map(([k,v])=>['支出 / '+(!k||k==='undefined'?'内容要確認':k),v]),...m.incomeChannels.map(c=>['入金経路 / '+c.channel+(c.platformName?' / '+c.platformName:''),c.amount])].map(([k,v])=>'<tr>'+cell(k)+cell(money(v))+'</tr>').join(''));root.renderYearEnd?.();};
root.TsukinowaAccountingUI.homePeriod=homePeriod;root.TsukinowaAccountingUI.homeData=homeData;
root.renderSales=function(){
 if(!el('salesRegisterTable'))return;
 const now=bizNowMonth(),mode=value('salesPeriodMode')||'month';
 for(const [id,v] of [['salesMonth',now],['salesYear',String(+now.slice(0,4)-(+now.slice(5)<10?1:0))],['salesStart',now+'-01'],['salesEnd',A.periodFilter({month:now}).end],['receivableAsOf',todayISO()]])if(!value(id))el(id).value=v;
 for(const [id,show] of [['salesMonthField',mode==='month'],['salesYearField',mode==='year'],['salesStartField',mode==='custom'],['salesEndField',mode==='custom']])el(id).hidden=!show;
 try{
 const period=A.periodFilter(mode==='year'?{year:value('salesYear')}:mode==='custom'?{start:value('salesStart'),end:value('salesEnd')}:{month:value('salesMonth')}),asOf=A.date(value('receivableAsOf'));
 const sales=A.salesRegister(registerData(),period,asOf,value('salesSort')==='desc'),rows=sales.map(s=>[s.salesDate,s.customer,s.content,s.invoiceIssueDate,s.receiptIssueDate,money(s.amount),money(s.paid),money(s.outstanding),s.lastPaymentDate,s.ageDays,s.status].map(v=>String(v??'')));
 el('salesRegisterTable').innerHTML=table([...registerHeaders,'必要操作'],rows.map((r,i)=>'<tr data-sale-id="'+esc(sales[i].id)+'">'+r.map((v,j)=>j===10?'<td><span class="register-status '+(v==='入金済'?'paid':'')+'">'+esc(v)+'</span></td>':cell(v)).join('')+'<td>'+(sales[i].outstanding>0&&bizOutstanding(sales[i])>0?'<button class="biz-btn" data-sale-payment="'+i+'">入金登録</button> ':'')+'<button class="biz-btn" data-sale-detail="'+i+'">詳細</button></td></tr>').join(''));
 el('salesRegisterTable').querySelector('tbody').id='salesRows';registerView={asOf,rows,sales};el('salesDetails').hidden=true;
 el('salesViewStatus').textContent=period.start+' ～ '+period.end+' ｜ 入金基準日 '+asOf+' ｜ '+sales.length+'件';
 }catch(e){el('salesViewStatus').textContent=e.message+' 表示・CSVは直前の有効な条件です。';}
 renderPaymentSaleOptions();
};
root.TsukinowaAccountingUI.renderSales=root.renderSales;
function exportRows(kind){switch(kind){case'monthly':return A.settlementExport(homeData(),homePeriod());
case'expenses':return A.expenseExport(homeData().expenses||[],value('expenseMonth')||bizNowMonth());
case'payments':return [['入金ID','売上ID','入金日','金額','入金経路','プラットフォーム名','確認状態'],...(data.payments||[]).filter(p=>homePeriod().includes(p.paymentDate||p.date)).map(p=>[p.id,p.saleId,p.paymentDate||p.date,p.amount,A.paymentChannel(p).channel,A.paymentChannel(p).platformName,p.confirmation])];
case'salesRegister':return [registerHeaders,...registerView.rows].map(r=>r.slice());
case'suppliers':return [['仕入先ID','仕入先','取引ID','日付','区分','金額','請求月','摘要','取消日','期首残高','現在残高'],...(data.suppliers||[]).map(s=>[s.id,s.supplierName,'',s.openingDate,'期首',s.openingBalance,'','','',s.openingBalance,A.supplierBalance(s,data.supplierTransactions||[])]),...(data.supplierTransactions||[]).map(t=>[t.supplierId,data.suppliers.find(s=>s.id===t.supplierId)?.supplierName,t.id,t.date,t.type,t.amount,t.invoiceMonth,t.description,t.deletedAt,'',''])];
case'bank':return [['bankTxnId','銀行取引日','銀行口座','摘要','入金','出金','残高','メモ','状態','照合区分','照合先','入金ID','固定口座名','取引番号','hash','出現番号','同一証拠の別ID','監査判定'],...(data.bankTransactions||[]).map(b=>[b.id,b.bankTransactionDate,b.bankAccount,b.description,b.incoming,b.outgoing,b.balance,b.memo,A.bankMatch(b,data).status,b.matchType,b.matchType==='cardSettlement'?(b.expenseIds||[]).join(' / '):b.matchId,b.paymentId,A.bankAccountKey(b.bankAccount,data.settings),b.externalId,b.hash,b.occurrence,A.bankDuplicate(b,data.bankTransactions,data.settings).map(r=>r.id).join(' / '),A.bankDuplicate(b,data.bankTransactions,data.settings).length?'原記録を照合してから個別承認':!A.bankIdentity(b,data.settings)?'取引番号・残高なし：自動統合不可':'証拠キーあり'])];
case'cash':return [['cashTxnId','日付','区分','分類','摘要','金額','残高','入金ID','支出ID'],...A.cashRows(data.cashLedger||[]).map(c=>[c.cashTxnId,c.date,c.type,c.category,c.description,c.amount,c.runningBalance,c.linkedPaymentId,c.linkedExpenseId])];default:throw Error('出力形式が不正です。');}}
root.accountingExport=guard(kind=>{if(!isAdmin())return;const text=A.csv(exportRows(kind)),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=kind+'_'+(kind==='salesRegister'?registerView.asOf:kind==='expenses'?value('expenseMonth')||bizNowMonth():todayISO())+'.csv';a.hidden=true;document.body.append(a);try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
root.exportBackup=function(){if(!enabled())return old.exportBackup();if(!isAdmin())return;const sync=B().getSync(),blob=new Blob([JSON.stringify({schemaVersion:3,exportedAt:new Date().toISOString(),records:sync.getRows(),pending:sync.getQueue()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='tsukinowa-accounting-backup_'+todayISO()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
root.exportDecisionCsv=function(){root.accountingExport('monthly');};
root.TsukinowaAccountingUI.exportRows=exportRows;
function section(title,html){const d=document.createElement('div');d.className='biz-section';d.innerHTML='<div class="biz-section-head"><h2>'+title+'</h2></div>'+html;return d;}
const field=(label,id,type='text',extra='')=>`<div class="biz-field"><label for="${id}">${label}</label><input id="${id}" type="${type}" ${extra}></div>`;
const select=(label,id,values)=>`<div class="biz-field"><label for="${id}">${label}</label><select id="${id}">${values.map(v=>`<option value="${esc(v[0])}">${esc(v[1])}</option>`).join('')}</select></div>`;
function renderBankRules(){if(!el('bankRules'))return;el('bankRules').innerHTML=table(['区分','対象','対応','状態'],(data.settings||[]).filter(r=>['bankAccountAlias','bankPartyAlias','bankSpecialPolicy'].includes(r.type)&&A.live(r)).map(r=>'<tr>'+cell({bankAccountAlias:'口座別名',bankPartyAlias:'銀行摘要→顧客名',bankSpecialPolicy:'利息・手数料'}[r.type])+cell(r.key)+cell(r.canonical||r.customerKey||'税務要確認')+`<td><button class="biz-btn" onclick="accountingToggleBankRule('${esc(r.id)}')">${r.enabled===false?'停止中・有効にする':'有効・停止する'}</button></td></tr>`).join(''));}
document.addEventListener('DOMContentLoaded',()=>{
 const message=document.createElement('p');message.id='accountingMessage';message.setAttribute('role','status');el('cloudDialog').append(message);

 el('expMethod').replaceChildren(...A.METHODS.map(c=>new Option(c,c)),...['GMO銀行','クレジットカード','月締'].map(c=>{const o=new Option(c+'（旧記録）',c);o.hidden=true;return o;}));
 el('expCategory').replaceChildren(...A.CATEGORIES.map(c=>new Option(c,c)));
 const supplemental=document.createElement('div');supplemental.innerHTML=field('銀行口座 / 信用カード識別名（例 VISA末尾1234）','expBankAccount')+field('領収書参照','expAttachment');el('expMethod').parentElement.after(supplemental);
 const learning=document.createElement('div');learning.innerHTML='<p id="expenseClassificationStatus" role="status">要確認：科目を確認してください。</p><label><input type="checkbox" id="expenseLearnCategory" checked> 確認した取引先→科目を学習ルールとして保存（過去記録は変更しません）</label>';el('expCategory').parentElement.after(learning);el('expVendor').addEventListener('change',prefillCategory);el('expCategory').addEventListener('change',()=>{categoryChosen=true;el('expenseLearnCategory').checked=true;});el('pageExpenses').append(section('支出科目の学習ルール','<p>全角・半角、英字大小、空白のみ正規化して完全一致。CSVの科目を優先します。</p><div id="expenseCategoryRules"></div>'));
 el('pageExpenses').querySelectorAll('.biz-section')[1].before(section('支出CSV取込','<p>日付, 科目, 支払方法, 金額, 取引先, 内容・備考。完全一致の支出はスキップします。</p><input type="file" id="expenseFile" accept=".csv,text/csv"><button class="biz-btn" onclick="accountingPreviewExpenses()">取込前確認</button><p id="expenseImportPreview" role="status"></p><div id="expenseImportRows"></div><button class="biz-btn primary" id="expenseImportCommit" disabled onclick="accountingImportExpenses()">確認した支出を取込</button>'));
 el('expenseFile').addEventListener('change',()=>{expensePreview=null;el('expenseImportCommit').disabled=true;el('expenseImportPreview').textContent='';el('expenseImportRows').innerHTML='';});
 el('pageExpenses').append(section('現金帳（確認済み実収支）','<p>現在残高 <b id="cashBalance">0</b>。日付順に自動再計算します。</p><button class="biz-btn" onclick="accountingExport(\'cash\')">現金帳CSV</button><div id="cashRows"></div>'));
 el('cashRows').parentElement.append(section('現金残高の調整',`<div class="biz-form-grid">${field('日付','cashAdjustDate','date')}${select('区分','cashAdjustType',[['income','増額'],['expense','減額']])}${field('金額','cashAdjustAmount','number')}${field('理由','cashAdjustReason')}</div><button class="biz-btn" onclick="accountingCashAdjustment()">調整を記録</button>`));
 el('pageBank').append(section('東鵬｜前渡金管理','<p>銀行照合した前渡金から、毎月の実際の材料請求額を控除します。前渡時には費用・追加出金を作成しません。</p><label>仕入先<select id="supplierChoice" onchange="accountingSupplierPreview()"></select></label><details><summary>仕入先を追加</summary><label>仕入先名<input id="supplierNewName" placeholder="東鵬"></label><button class="biz-btn" onclick="accountingCreateSupplier()">追加</button></details><p>前渡金残高 <strong id="supplierBalance">0</strong></p><div class="biz-form-grid">'+field('請求月','supplierMonth','month')+field('当月材料請求金額（円）','supplierAmount','number')+'</div><p>控除後の前渡金残高 <strong id="supplierAfter">0</strong></p><button class="biz-btn primary" onclick="accountingSettleSupplier()">確認して控除</button><p>同じ月は重複登録できません。登録済み金額は履歴の「訂正」から修正できます。残高不足時は実際の再送金を銀行照合してください。</p><details><summary>前渡金履歴</summary><div id="supplierLedger"></div></details>'));
 el('supplierAmount').addEventListener('input',root.accountingSupplierPreview);el('supplierMonth').addEventListener('change',root.accountingSupplierPreview);

 const filters=document.createElement('div');filters.className='bank-status-filter';filters.innerHTML=[['todo','要処理'],['all','すべて'],['done','照合済・除外']].map(([v,l])=>`<button class="biz-btn" data-bank-view="${v}" aria-pressed="${v==='todo'}" onclick="accountingBankView('${v}')">${l}</button>`).join('');el('bankRows').closest('.biz-table-wrap').before(filters);
 el('pageBank').append(section('確認済み銀行ルール','<p>口座別名→同じ実口座の固定名、銀行摘要→顧客名（完全一致）を一度確認して保存。利息・手数料は会計口径を確認後に有効化します。給与・外注費・控除・部分入金は自動確定しません。</p><select id="bankRuleType"><option value="bankAccountAlias">口座別名</option><option value="bankPartyAlias">銀行摘要→顧客名</option><option value="bankSpecialPolicy">利息・手数料の会計口径</option></select><input id="bankRuleKey" placeholder="別名 / 銀行の完全な摘要 / 受取利息・支払手数料"><input id="bankRuleValue" placeholder="同じ口座の固定名 / 顧客の完全な名前"><button class="biz-btn" onclick="accountingBankRule()">確認して保存</button><div id="bankRules"></div>'));
 el('pageBank').querySelector('.biz-title .biz-muted').textContent='銀行CSVを実収支の証拠として照合します。確認済みルールの唯一一致は自動処理し、例外だけ確認します。利息は受取利息、デビット還元は雑収入に分類します。Stripeは入金元を確認し、明細未配分は未照合で保持します。';
 el('pageBank').append(section('歴史銀行明細の重複確認（管理者・1件ずつ）','<p>現在、正式庫は監査・バックアップのみ。取消・復元は無効です。同日同額は候補のみ。確認済み口座別名と強い取引証拠、関連なしでも、このリリースでは取消できません。GMO あおぞらの原記録は保持します。既存の取消済み記録も復元できません。</p><button class="biz-btn" onclick="accountingDuplicateBackup()">最新の全業務記録・監査履歴をバックアップ</button><p id="bankDuplicateStatus" role="status"></p><div id="bankDuplicateReview"></div>'));
 const bankOptions=document.createElement('div');bankOptions.className='biz-field span2';bankOptions.innerHTML=field('口座名（別名は確認済みルールで統一）','bankAccountName','text','value="メイン口座"')+'<p class="biz-muted">UTF-8 / Shift_JIS。日付・摘要・入金・出金の列が必要です。信頼済み名称・唯一の全額一致は取込時に自動照合。その他は要確認。手入力の入金日は銀行証拠ではありません。</p><p id="bankImportStatus" role="status"></p><button class="biz-btn" onclick="accountingExport(\'bank\')">銀行照合結果CSV</button>';el('bankFile').parentElement.before(bankOptions);
 el('cashAdjustDate').value=todayISO();
 el('cashRows').addEventListener('click',e=>{const button=e.target.closest('[data-google-duplicate-cash]');if(button){button.disabled=true;root.accountingExcludeGoogleCash(button.dataset.googleDuplicateCash);}});
 el('salesRegisterTable').addEventListener('click',e=>{
  const payment=e.target.closest('[data-sale-payment]'),detail=e.target.closest('[data-sale-detail]');
  if(payment){const sale=registerView.sales[Number(payment.dataset.salePayment)];if(sale)root.selectSaleForPayment(sale.id);}
  if(detail){
   const sale=registerView.sales[Number(detail.dataset.saleDetail)];if(!sale)return;
   const source=registerData(),ps=A.unique(source.payments||[]).filter(p=>A.live(p)&&p.saleId===sale.id);
   const receipt=(source.documents||[]).find(d=>A.live(d)&&(d.id===sale.documentId||d.documentId===sale.documentId)&&d.docType==='receipt'&&d.saleId===sale.id&&d.snapshot?.paymentMethod==='現金');
   const review=(sale.accountingReviewRequired||sale.reviewRequired)?'<p role="alert">確認理由：'+esc(sale.reviewReason||'売上と正式帳票・入金の関連を再確認してください。')+'</p>':'';
   const repairable=receipt&&sale.sourceType==='receipt-cash'&&sale.status==='要確認'&&B().getClient()?.getState().role==='admin';
   el('salesDetails').innerHTML='<h3>'+esc(sale.customer)+' / '+esc(sale.salesDate)+'</h3><p>'+esc(sale.content)+'</p><p>売上ID：'+esc(sale.id)+' / 帳票ID：'+esc(sale.documentId||'未連携')+'</p>'+review+table(['入金日','入金額','確認状態'],ps.map(p=>'<tr>'+[p.paymentDate||p.date||'',money(p.amount),p.confirmation||''].map(cell).join('')+'</tr>').join(''))+(repairable?'<button class="biz-btn" id="reviewCashReceipt">現金領収書の整合性を再検証</button><p>正式帳票・入金・現金台帳と日程のIDを検証します。不一致なら変更せず要確認のままです。</p>':'')+'<button class="biz-btn" id="closeSalesDetails">閉じる</button>';
   el('salesDetails').hidden=false;
   el('closeSalesDetails').onclick=()=>el('salesDetails').hidden=true;
   if(repairable)el('reviewCashReceipt').onclick=guard(async()=>{if(!isAdmin())return;el('reviewCashReceipt').disabled=true;try{await send({type:'repairReceipt',documentId:receipt.id||receipt.documentId,operationId:uid()});notice('領収書の整合性再検証を受け付けました。同期結果を確認してください。');}catch(e){el('reviewCashReceipt').disabled=false;throw e;}});
  }
 });
 root.renderSales();
});
})(window);
