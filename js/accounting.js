(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaAccounting=api;})(globalThis,function(){
'use strict';
const COLLECTIONS=['expenses','cashLedger','suppliers','supplierTransactions','bankTransactions','settings'];
const METHODS=['現金','代表者立替','代表者立替（交通系IC）','法人銀行デビット','法人信用カード','法人カード決済','銀行振込','口座振替','その他'];
const CATEGORIES=['材料費','材料仕入','旅費交通費','地代家賃','租税公課','給与','家賃','交通費','車両費','通信費','消耗品費','外注費','支払手数料','その他'];
const live=r=>!r.deletedAt&&!['void','cancelled','duplicate','revised'].some(status=>[r.documentStatus,r.status].includes(status)),amount=r=>Number(r.amount)||0,sum=rs=>rs.reduce((n,r)=>n+amount(r),0);
const confirmed=p=>live(p)&&['cash-received','bank-confirmed'].includes(p.confirmation);
// Read legacy methods without rewriting historical records. Confirmation remains authoritative.
function paymentChannel(p={}){
 const method=String(p.channel||p.method||'').trim(),platform=/(?:くらし|暮らし)のマーケット/.test(method);
 const channel=platform||['プラットフォーム経由','オンライン決済'].includes(method)?'プラットフォーム経由':method==='現金'?'現金':['銀行振込','GMO銀行'].includes(method)?'銀行振込':method&&method!=='未設定'?'その他':'未設定';
 const detail=String(p.platformName||p.channelDetail||'').trim().replace(/^暮らしのマーケット$/,'くらしのマーケット');
 return {channel,platformName:channel==='プラットフォーム経由'?(detail||(platform||/(?:くらし|暮らし)のマーケット/.test(p.memo||'')?'くらしのマーケット':'')):''};
}
function paymentChannels(payments){
 const groups=new Map();for(const p of payments){const c=paymentChannel(p),key=JSON.stringify(c);if(!groups.has(key))groups.set(key,{...c,amount:0});groups.get(key).amount+=amount(p);}return [...groups.values()];
}
function date(value){const m=String(value||'').trim().normalize('NFKC').match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/);if(!m)throw Error('日付は YYYY-MM-DD で指定してください。');const s=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;const parsed=new Date(s+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s)throw Error('日付が不正です。');return s;}
function money(v,signed=false){const n=Number(String(v??'').normalize('NFKC').replace(/[¥￥,\s円]/g,''));if(!Number.isSafeInteger(n)||(!signed&&n<=0))throw Error('金額は整数の円で入力してください。');return n;}
const delta=t=>t.deletedAt?0:t.type==='monthlyInvoice'?-(t.deductionAmount===undefined?amount(t):Number(t.deductionAmount)):amount(t);
function cashRows(rows){let runningBalance=0;return rows.filter(live).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.cashTxnId.localeCompare(b.cashTxnId)).map(r=>({...r,runningBalance:runningBalance+=(r.type==='income'?1:-1)*amount(r)}));}
// Deduplicate stable record IDs only: same-date/same-amount real payments remain distinct.
function unique(rows){const seen=new Set();return rows.filter(r=>{const id=r.id||r.paymentId;if(!id)return true;if(seen.has(id))return false;seen.add(id);return true;});}
function ledger(sales,payments,asOf='9999-12-31'){
 const liveSales=unique(sales.filter(s=>live(s)&&(s.salesDate||s.saleDate)<=asOf));
 const ids=new Set(liveSales.map(s=>s.id));
 const effectivePayments=unique(payments.filter(p=>confirmed(p)&&Number(p.amount)>0&&ids.has(p.saleId)&&(p.paymentDate||p.date)<=asOf));
 const rows=liveSales.map(s=>{const ps=effectivePayments.filter(p=>p.saleId===s.id),paid=sum(ps),outstanding=amount(s)-paid,lastPaymentDate=ps.map(p=>p.paymentDate||p.date).sort().at(-1)||'';
 return {...s,salesDate:s.salesDate||s.saleDate,saleDate:s.salesDate||s.saleDate,paid,outstanding,lastPaymentDate,status:outstanding<0||s.reviewRequired||s.accountingReviewRequired?'要確認':outstanding===0?'入金済':paid>0?'一部入金':'未入金'};});
 return {sales:rows,payments:effectivePayments};
}
// One immutable business row per sale; payment dates never determine revenue membership.
function salesRegister(data,period,asOf,descending=false){
 date(asOf);
 const documents=unique(data.documents||[]).filter(d=>live(d)&&d.confirmed===true);
 return receivables([...(data.sales||[]),...(data.receivables||[])],data.payments||[],asOf)
 .filter(s=>period.includes(s.salesDate))
 .map(s=>{
  const linked=documents.filter(d=>d.saleId===s.id||d.snapshot?.saleId===s.id||d.receivableId===s.id||!!s.documentId&&(d.id===s.documentId||d.documentId===s.documentId));
  const dates=types=>linked.filter(d=>types.includes(d.docType)).map(d=>d.issueDate||d.invoiceDate||d.snapshot?.issueDate||d.snapshot?.invoiceDate||'').filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&v<=asOf).sort();
  const invoiceDates=dates(['invoice','onoda']);
  return {...s,invoiceIssueDate:invoiceDates.at(-1)||s.invoiceDate||'',receiptIssueDate:dates(['receipt']).at(-1)||'',ageDays:s.invoiceDate?s.ageDays:''};
 }).sort((a,b)=>(descending?-1:1)*a.salesDate.localeCompare(b.salesDate)||String(a.id).localeCompare(String(b.id)));
}
function receivables(sales,payments,asOf=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})){
 return ledger(sales,payments,asOf).sales.map(s=>{const ageDays=s.invoiceDate?Math.max(0,Math.floor((Date.parse(asOf)-Date.parse(s.invoiceDate))/86400000)):0;return {...s,ageDays,status:!Number.isFinite(ageDays)?'要確認':s.status};});
}
function supplierBalance(s,txs,asOf='9999-12-31'){return (s.openingDate<=asOf?Number(s.openingBalance)||0:0)+txs.filter(t=>t.supplierId===s.supplierId&&t.date<=asOf).reduce((n,t)=>n+delta(t),0);}
function periodFilter({month,year,start,end}={}){if(year!==undefined){year=Number(year);if(!Number.isInteger(year)||year<2000||year>9998)throw Error('年度が不正です。');start=year+'-10-01';end=(year+1)+'-09-30';}else if(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を指定してください。');start=month+'-01';end=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10);}start=date(start);end=date(end);if(start>end)throw Error('期間の開始・終了を確認してください。');return {start,end,includes:value=>typeof value==='string'&&value>=start&&value<=end};}
function aggregate(data,p){const all=ledger(data.sales||[],data.payments||[]),within=(rs,k)=>unique(rs.filter(r=>live(r)&&p.includes(r[k]))),ps=within(unique((data.payments||[]).filter(confirmed)).map(r=>({...r,paymentDate:r.paymentDate||r.date})),'paymentDate'),expenses=within(expenseRegister(data.expenses||[]),'expenseDate'),cash=cashRows(data.cashLedger||[]),supplierTx=within(data.supplierTransactions||[],'date'),categories=Object.fromEntries(CATEGORIES.map(c=>[c,0]));for(const e of expenses)categories[e.category]=(categories[e.category]||0)+amount(e);
 const otherIncome=sum(within(data.bankTransactions||[],'bankTransactionDate').filter(b=>b.status==='照合済'&&b.matchType==='bankIncome'&&['受取利息','雑収入'].includes(b.category)));
 const bankIncome=sum(ps.filter(p=>p.confirmation==='bank-confirmed')),cashIncome=sum(ps.filter(p=>p.confirmation==='cash-received')),expenseTotal=sum(expenses),rs=receivables(data.sales||[],data.payments||[],p.end),unpaid=rs.filter(s=>s.outstanding!==0),unmatched=within(data.bankTransactions||[],'bankTransactionDate').filter(b=>!['照合済','除外'].includes(b.status)),abnormal=expenses.filter(e=>!e.category||!Number.isSafeInteger(Number(e.amount))||e.amount<=0),reviewRows=ledgerRows(data,p).filter(r=>/要確認|入金確認待ち/.test(r.status)),attentionIds=new Set([...unpaid.map(s=>'sale:'+s.id),...reviewRows.map(r=>r.id)]);
 return {sales:sum(within(all.sales.filter(s=>!s.receivableOnly),'salesDate')),bankIncome,cashIncome,otherIncome,income:bankIncome+cashIncome+otherIncome,incomeChannels:paymentChannels(ps),receivables:rs.reduce((n,s)=>n+s.outstanding,0),expenseTotal,categories,cashReceipts:sum(within(cash,'date').filter(x=>x.type==='income')),cashExpenses:sum(within(cash,'date').filter(x=>x.type==='expense')),cashBalance:cash.filter(x=>x.date<=p.end).at(-1)?.runningBalance||0,supplierPrepayment:sum(supplierTx.filter(t=>t.type==='prepayment')),supplierInvoice:sum(supplierTx.filter(t=>t.type==='monthlyInvoice')),supplierPayment:sum(supplierTx.filter(t=>t.type==='payment')),suppliers:(data.suppliers||[]).filter(live).map(s=>({...s,currentBalance:supplierBalance(s,data.supplierTransactions||[],p.end)})),cashFlowDifference:bankIncome+cashIncome+otherIncome-expenseTotal,attention:attentionIds.size+unmatched.length+abnormal.length,reminders:[...unpaid.map(s=>'未入金 / '+(s.customer||'')+' / '+s.outstanding),...reviewRows.filter(r=>!unpaid.some(s=>'sale:'+s.id===r.id)).map(r=>r.status+' / '+(r.customer||'')),...unmatched.map(b=>'銀行未照合 / '+b.description),...abnormal.map(e=>'支出要確認 / '+(e.vendor||''))].slice(0,5)};}
function monthly(data,month){return {month,...aggregate(data,periodFilter({month}))};}
// Payment and bank evidence are separate from the business row and payment status.
function expenseStatus(e){
 if(e.paymentMethod==='現金')return '支払済';
 // There is no audited reimbursement record model yet; a memo/flag is not proof.
 if(/代表者立替/.test(e.paymentMethod||''))return '立替未精算';
 if(e.bankTxnId)return '支払済 / 照合済';
 if(creditExpense(e))return 'カード決済済 / 引落照合待ち';
 if(e.paymentMethod==='法人カード決済')return '要確認 / カード種別未設定';
 return bankExpense(e)?'支払済 / 銀行未照合':e.paymentMethod==='月締'?'支払待ち':'支払済';
}
// Reuse the same live/stable-ID semantics as HOME; never deduplicate by amount.
function expenseRegister(rows,month=''){
 const period=month?periodFilter({month}):null;
 return unique(rows.filter(live)).filter(e=>!period||period.includes(e.expenseDate)).slice()
 .sort((a,b)=>String(a.expenseDate||'').localeCompare(String(b.expenseDate||''))||String(a.id||a.expenseId||'').localeCompare(String(b.id||b.expenseId||'')));
}
function expenseExport(rows,month){return [['支出日','科目','取引先','内容','支払方法','金額','状態','領収書参照'],...expenseRegister(rows,month).map(e=>[e.expenseDate,e.category,e.vendor,e.description,e.paymentMethod,amount(e),expenseStatus(e),e.receiptAttachmentRef||''])];}
const LEDGER_HEADERS=['売上日・支出日','区分','取引先','内容','入金・支払方法','売上（期間内）','入金済額（期間末）','入金（期間内）','出金','状態','入金日'];
function ledgerCells(r){return [r.date,r.type,r.customer,r.description,r.method,r.sales,r.paid,r.incoming,r.outgoing,r.status,r.paymentDates];}
function ledgerRows(data,p){
 const rows=[],all=ledger(data.sales||[],data.payments||[],p.end),payments=unique((data.payments||[]).filter(v=>live(v)&&(v.paymentDate||v.date)<=p.end)),saleMap=new Map(all.sales.map(s=>[s.id,s]));
 for(const s of all.sales){
  const ps=payments.filter(v=>v.saleId===s.id),collected=ps.filter(confirmed),inPeriod=ps.filter(v=>p.includes(v.paymentDate||v.date));
  if(!p.includes(s.salesDate)&&!inPeriod.length)continue;
  const pending=ps.some(v=>!confirmed(v)),possibleDuplicate=all.sales.some(v=>v.id!==s.id&&v.salesDate===s.salesDate&&v.customer===s.customer&&amount(v)===amount(s));
  rows.push({id:'sale:'+s.id,date:s.salesDate,type:s.receivableOnly?'繰越未収':p.includes(s.salesDate)?'売上':'過月売上の入金',customer:s.customer,description:s.content,method:[...new Set(ps.map(v=>v.method).filter(Boolean))].join(' / ')||s.paymentMethod||'',sales:!s.receivableOnly&&p.includes(s.salesDate)?amount(s):0,paid:s.paid,incoming:sum(inPeriod.filter(confirmed)),outgoing:0,homeStatus:s.status+(s.outstanding>0&&pending?' / 入金確認待ち':'')+(possibleDuplicate?' / 重複候補・要確認':''),status:s.status+(collected.some(v=>paymentChannel(v).channel==='銀行振込'&&!bankEvidence(v,data))?' / 銀行未照合':'')+(pending?' / 入金確認待ち':'')+(possibleDuplicate?' / 重複候補・要確認':''),paymentDates:collected.map(v=>(v.paymentDate||v.date)+' / '+amount(v)+'円'+(bankEvidence(v,data)?' / 銀行 '+v.bankTransactionDate:'')).join('、')});
 }
 // Unlinked/premature payments remain visible for review; never invent a sale.
 for(const v of payments)if(!saleMap.has(v.saleId)&&p.includes(v.paymentDate||v.date))rows.push({id:'payment:'+(v.id||v.paymentId),date:v.paymentDate||v.date,type:'未関連入金',customer:v.customer||'',description:v.memo||'',method:v.method,sales:0,paid:confirmed(v)?amount(v):0,incoming:confirmed(v)?amount(v):0,outgoing:0,status:'要確認 / 売上リンクなし',paymentDates:v.paymentDate||v.date});
 for(const e of expenseRegister(data.expenses||[]).filter(e=>p.includes(e.expenseDate)))rows.push({id:'expense:'+(e.id||e.expenseId),date:e.expenseDate,type:'支出',customer:e.vendor,description:e.description||e.category,method:e.paymentMethod,sales:0,paid:0,incoming:0,outgoing:amount(e),status:expenseStatus(e),paymentDates:''});
 for(const b of (data.bankTransactions||[]).filter(b=>live(b)&&b.status==='照合済'&&b.matchType==='bankIncome'&&p.includes(b.bankTransactionDate)))rows.push({id:'interest:'+b.bankTxnId,date:b.bankTransactionDate,type:'営業外収益',customer:b.bankAccount,description:b.category,method:'銀行振込',sales:0,paid:b.incoming,incoming:b.incoming,outgoing:0,status:b.category==='受取利息'?'照合済':'照合済 / 税務要確認',paymentDates:b.bankTransactionDate});
 for(const c of (data.cashLedger||[]).filter(c=>live(c)&&p.includes(c.date)))if(!c.linkedPaymentId&&!c.linkedExpenseId&&!c.linkedSupplierTransactionId)rows.push({id:'cash:'+c.cashTxnId,date:c.date,type:'現金調整',customer:'',description:c.description,method:'現金',sales:0,paid:0,incoming:c.type==='income'?amount(c):0,outgoing:c.type==='expense'?amount(c):0,status:'確認済',paymentDates:''});
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
function settlementExport(data,p){const m=aggregate(data,p);return [['対象期間',p.start,p.end],['集計','金額'],...Object.entries({売上:m.sales,入金:m.income,営業外収益:m.otherIncome,支出:m.expenseTotal,未収金:m.receivables,収支差額:m.cashFlowDifference,...m.categories}).map(([k,v])=>[k,v]),...m.incomeChannels.map(c=>['入金経路 / '+c.channel+(c.platformName?' / '+c.platformName:''),c.amount]),[],LEDGER_HEADERS,...ledgerRows(data,p).map(ledgerCells)];}
function parseCSV(text){const out=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){field+='"';i++;}else if(quote||!field)quote=!quote;else throw Error('CSVの引用符が不正です。');}else if(c===','&&!quote){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))out.push(row);row=[];field='';}else field+=c;}if(quote)throw Error('CSVの引用符が閉じていません。');row.push(field);if(row.some(x=>x.trim()))out.push(row);return out;}
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
async function parseBank(text,account,digest){if(!account.trim())throw Error('銀行口座名を入力してください。同じ口座は同じ名前を使用します。');const table=parseCSV(text.replace(/^\uFEFF/,''));const headerIndex=table.findIndex(r=>r.some(c=>/^(取引日|取引年月日|日付|年月日|お取引日|date)$/i.test(normalize(c))));if(headerIndex<0)throw Error('日付ヘッダーを認識できません。');const headers=table[headerIndex].map(normalize),find=names=>headers.findIndex(h=>names.includes(h));const ix={date:find(['日付','取引日','取引年月日','年月日','お取引日','date']),description:find(['摘要','内容','取引内容','お取引内容','お取引内容(摘要)','相手','description']),incoming:find(['入金金額','入金','入金額','お預り金額','お預り金額(円)','お預り','お預かり金額','入金額(円)','お預入れ金額','deposit']),outgoing:find(['出金金額','出金','出金額','お支払金額','お支払金額(円)','お支払','出金額(円)','お引出し金額','withdrawal']),memo:find(['メモ','memo']),id:find(['取引id','取引番号','明細番号','transactionid']),balance:find(['残高','残高(円)','お取引後残高','balance'])};if(ix.incoming<0||ix.outgoing<0||ix.description<0)throw Error('摘要・入金・出金ヘッダーが必要です。対応列名を確認してください。');const counts=new Map(),result=[];
 for(const [i,r] of table.slice(headerIndex+1).entries()){if(r.length!==headers.length)throw Error(`CSV ${i+headerIndex+2}行の列数が一致しません。`);try{const bankTransactionDate=date(r[ix.date]),incoming=r[ix.incoming].trim()?money(r[ix.incoming],true):0,outgoing=r[ix.outgoing].trim()?money(r[ix.outgoing],true):0;if(incoming<0||outgoing<0||(incoming>0)===(outgoing>0))throw Error('入金/出金の一方に正の金額が必要です。');const description=r[ix.description],externalId=ix.id>=0?r[ix.id].trim():'',balance=ix.balance>=0&&r[ix.balance].trim()?money(r[ix.balance],true):'',signature=JSON.stringify([normalize(account),bankTransactionDate,normalize(description),incoming,outgoing,balance]),occurrence=(counts.get(signature)||0)+1;counts.set(signature,occurrence);const key=externalId?JSON.stringify([normalize(account),'external',externalId]):signature+'#'+occurrence,hash=await digest(key);result.push({bankTxnId:'bank_'+hash.slice(0,48),bankAccount:account.trim(),bankTransactionDate,description,incoming,outgoing,amount:incoming||outgoing,balance,memo:ix.memo>=0?r[ix.memo]:'',externalId,hash,occurrence,status:'未照合',deletedAt:null});}catch(e){throw Error(`CSV ${i+headerIndex+2}行: ${e.message}`);}}
 if(!result.length)throw Error('取引明細がありません。');return result;
}
function expenseInput(e){
 const paymentMethod=String(e.paymentMethod||'').trim();if(![...METHODS,'GMO銀行','クレジットカード','月締'].includes(paymentMethod))throw Error('支払方法を確認してください。');
 if(!CATEGORIES.includes(e.category))throw Error('科目を確認してください。');
 if(creditExpense({paymentMethod})&&!String(e.bankAccount||'').trim())throw Error('信用カードの識別名を銀行口座欄に入力してください。');
 return {...e,expenseDate:date(e.expenseDate),amount:money(e.amount),paymentMethod,vendor:String(e.vendor||'').trim(),description:String(e.description||'').trim()};
}
function expenseKey(e){const p=expenseInput({...e,expenseDate:e.expenseDate||e.date,paymentMethod:e.paymentMethod||e.method,description:e.description??e.memo});return JSON.stringify([p.expenseDate,p.category,p.amount,p.vendor,p.paymentMethod,p.description,...(creditExpense(p)||p.paymentMethod==='法人銀行デビット'?[classificationKey(p.bankAccount)]:[])]);}
function expensePreview(text,existing=[],rules=[]){
 const rows=parseCSV(text.replace(/^\uFEFF/,'')),headers=rows.shift()||[],required=['日付','科目','支払方法','金額','取引先','内容・備考'];
 if(required.some(h=>!headers.includes(h)))throw Error('CSV列: '+required.join(', '));
 const seen=new Set();for(const e of existing.filter(live)){try{seen.add(expenseKey(e));}catch(_){/* Unsupported legacy rows remain readable. */}}
 const records=[],errors=[];let duplicates=0,total=0;
 rows.forEach((r,i)=>{try{if(r.length!==headers.length)throw Error('列数が一致しません。');const v=Object.fromEntries(headers.map((h,j)=>[h,r[j]])),classification=classifyExpense(v['取引先'],v['科目'],rules),expense=expenseInput({expenseDate:v['日付'],category:classification.category||'その他',paymentMethod:v['支払方法'],amount:v['金額'],vendor:v['取引先'],description:v['内容・備考'],bankAccount:v['カード識別名']||v['銀行口座']||''}),key=expenseKey(expense),duplicate=seen.has(key);seen.add(key);if(duplicate)duplicates++;else total+=expense.amount;records.push({expense,key,duplicate,classification,line:i+2});}catch(e){errors.push((i+2)+'行: '+e.message);}});
 if(!rows.length)errors.push('支出明細がありません。');return {records,errors,duplicates,total,count:rows.length};
}
const creditExpense=e=>['法人信用カード','クレジットカード'].includes(e.paymentMethod);
const bankExpense=e=>['銀行振込','口座振替','GMO銀行','法人銀行デビット'].includes(e.paymentMethod);
function cardExpenses(bank,data){return unique(data.expenses||[]).filter(e=>live(e)&&creditExpense(e)&&!e.bankTxnId&&e.bankAccount&&e.expenseDate<=bank.bankTransactionDate);}
const cardSettlement=b=>!!b.outgoing&&!/デビット|debit/i.test(String(b.description||'').normalize('NFKC'))&&/カード|ｶｰﾄﾞ|card|visa|master|jcb|amex|アメックス|クレジット/i.test(String(b.description||'').normalize('NFKC'));
function expenseBankEligible(bank,e){
 return bankExpense(e)||(/デビット|debit/i.test(String(bank.description||'').normalize('NFKC'))&&e.paymentMethod==='法人カード決済'&&Math.abs(Date.parse(bank.bankTransactionDate)-Date.parse(e.expenseDate))/86400000<=7);
}
function expenseMatch(bank,data){
 if(bank.status==='照合済')return {status:'照合済',candidates:[]};
 if(cardSettlement(bank))return {status:'未一致',candidates:[],card:true};
 const candidates=unique(data.expenses||[]).filter(e=>live(e)&&expenseBankEligible(bank,e)&&!e.bankTxnId).flatMap(e=>{const score=bankMatchScore(bank,e.amount,e.expenseDate,e.vendor);if(!score)return [];if(nameMatch(bank.description,e.description)&&score.score<100){score.score=100;score.reasons.push('内容一致');}return [{kind:'expense',id:e.expenseId||e.id,paymentId:'',...score}];});
 const certain=candidates.length===1&&candidates[0].score===100;
 return {status:certain?'要確認':candidates.length?'候補':'未一致',candidates};
}
// Names used for fuzzy recommendations only; learning uses stricter exact keys.
function partyName(v){return normalize(v).replace(/株式会社|有限会社|合同会社|[（(](?:カ|ド|ユ)[）)]?|(?:カ|ド|ユ)[）)]/g,'').replace(/[\s()（）・.,、]/g,'').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));}
function nameMatch(a,b){a=partyName(a);b=partyName(b);return a.length>=2&&b.length>=2&&(a.includes(b)||b.includes(a));}
function bankMatchScore(bank,targetAmount,targetDate,name){const days=Math.abs(Date.parse(bank.bankTransactionDate)-Date.parse(targetDate))/86400000;if(targetAmount!==(bank.incoming||bank.outgoing)||!(days<=7))return null;const named=nameMatch(bank.description,name);return {score:named?100:70,reasons:['金額一致','日付7日以内',...(named?['名称一致']:[])]};}
function incomingScore(bank,value,dates,name){
 if(Number(value)!==bank.incoming)return null;
 const near=dates.some(d=>Math.abs(Date.parse(bank.bankTransactionDate)-Date.parse(d))/86400000<=7);
 const within=dates.some(d=>{const days=(Date.parse(bank.bankTransactionDate)-Date.parse(d))/86400000;return days>=-7&&days<=120;});
 if(!near&&!within)return null;
 const named=nameMatch(bank.description,name);
 return {score:near?(named?100:70):(named?90:50),reasons:['金額一致',near?'日付・支払期限7日以内':'請求・期限から120日以内',...(named?['名称一致']:['名称要確認'])]};
}
function suggestions(bank,data){
 if(['照合済','除外'].includes(bank.status)||platformBank(bank))return [];if(!bank.incoming)return expenseMatch(bank,data).candidates;
 const out=[],sales=unique([...(data.sales||[]),...(data.receivables||[])]).filter(live),payments=unique(data.payments||[]).filter(live),docs=(data.documents||[]).filter(d=>live(d)&&d.confirmed===true&&['invoice','onoda','receipt'].includes(d.docType));
 for(const s of sales){
  if(s.paymentMethod==='現金'||['calendar-cash','receipt-cash'].includes(s.sourceType)||/代表者立替/.test(s.paymentMethod||''))continue;
  const linked=docs.filter(d=>[d.saleId,d.receivableId,d.snapshot?.saleId].includes(s.id)||d.id===s.documentId);
  const dates=[s.dueDate,s.invoiceDate,s.salesDate,s.saleDate,...linked.flatMap(d=>[d.dueDate,d.invoiceDate,d.snapshot?.dueDate,d.snapshot?.invoiceDate])].filter(Boolean);
  const paid=payments.filter(p=>p.saleId===s.id&&confirmed(p)).reduce((n,p)=>n+Number(p.amount),0),outstanding=Number(s.amount)-paid;
  const eligible=payments.filter(p=>p.saleId===s.id&&!p.bankTxnId&&!p.bankId&&p.amount===bank.incoming&&['pending-bank','bank-confirmed'].includes(p.confirmation)&&paymentChannel(p).channel!=='現金');
  const base={kind:'sale',id:s.id,customer:s.customer,invoiceNo:s.invoiceNo||linked.find(d=>d.docType!=='receipt')?.snapshot?.invoiceNo||linked[0]?.invoiceNo||'',outstanding};
  for(const p of eligible){if(p.confirmation!=='bank-confirmed'&&p.amount>outstanding)continue;const score=incomingScore(bank,p.amount,[p.paymentDate||p.date,...dates],s.customer);if(score)out.push({...base,paymentId:p.id||p.paymentId,...score});}
  if(!eligible.length&&outstanding>0){const score=incomingScore(bank,outstanding,dates,s.customer);if(score)out.push({...base,paymentId:'',...score});}
 }
 // A document without a live anchor is visible for diagnosis, never creates a sale.
 for(const d of docs.filter(d=>d.docType!=='receipt'&&!sales.some(s=>[d.saleId,d.receivableId,d.snapshot?.saleId].includes(s.id)||s.documentId===d.id))){const score=incomingScore(bank,d.amount||d.invoiceAmount||d.snapshot?.invoiceAmount,[d.dueDate,d.invoiceDate,d.snapshot?.dueDate,d.snapshot?.invoiceDate],d.customerName||d.snapshot?.customerName);if(score)out.push({kind:'document',id:d.id,paymentId:'',invoiceNo:d.invoiceNo||d.snapshot?.invoiceNo||'',customer:d.customerName||d.snapshot?.customerName,blocked:true,...score,reasons:[...score.reasons,'売上・未収リンク要確認']});}
 return out.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)||a.paymentId.localeCompare(b.paymentId));
}
// Preserve punctuation, legal forms and digits: no substring learning or transliteration.
function classificationKey(v){return String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function classifyExpense(vendor,category,rules=[]){
 if(category)return {category,source:'CSV',review:!CATEGORIES.includes(category)};
 const key=classificationKey(vendor),matches=rules.filter(r=>r.type==='expenseCategoryRule'&&!r.deletedAt&&r.enabled!==false&&r.key===key&&CATEGORIES.includes(r.category));
 if(key.length>=2&&matches.length===1)return {category:matches[0].category,source:'学習ルール',review:['給与','外注費'].includes(matches[0].category)};
 return {category:'',source:'要確認',review:true};
}
// Identity is explicit and audited; two accounts at the same bank are distinct.
function bankAccountKey(account,rules=[]){const key=classificationKey(account),rs=rules.filter(r=>r.type==='bankAccountAlias'&&r.key===key&&r.enabled!==false&&live(r));return rs.length===1?rs[0].canonical:key;}
function bankIdentity(b,rules=[]){
 const account=bankAccountKey(b.bankAccount,rules);
 if(b.externalId)return JSON.stringify([account,'external',b.externalId]);
 if(b.balance===''||b.balance==null||!Number.isSafeInteger(Number(b.balance)))return '';
 return JSON.stringify([account,b.bankTransactionDate,normalize(b.description),b.incoming,b.outgoing,Number(b.balance),b.occurrence||1]);
}
// Conservative review: no reference is reassigned or removed.
function bankCancellationReview(b,k,data){
 const reasons=[],refs=[];
 if(!b||!k||b.id===k.id)return {reasons:['別々の記録を選択してください。'],refs};
 if(!live(b)||!live(k))reasons.push('有効な銀行明細を選択してください。');
 if(classificationKey(b.bankAccount)!=='メイン口座'||classificationKey(k.bankAccount).replace(/ /g,'')!=='gmoあおぞら')reasons.push('メイン口座を取消、GMO あおぞらを保留してください。');
 if(!(data.settings||[]).some(r=>r.type==='bankAccountAlias'&&r.key===classificationKey(b.bankAccount)&&r.reviewedBy&&r.enabled!==false&&live(r)&&r.canonical===bankAccountKey(k.bankAccount,data.settings)))reasons.push('管理者が確認した同一実口座の別名ルールが必要です。');
 const key=bankIdentity(b,data.settings);
 if(!key||key!==bankIdentity(k,data.settings)||!bankAccountKey(b.bankAccount,data.settings))reasons.push('確認済み同一口座・取引番号または残高の強い証拠が必要です。');
 if(['bankTransactionDate','incoming','outgoing','amount'].some(f=>b[f]!==k[f])||classificationKey(b.description)!==classificationKey(k.description))reasons.push('取引内容が一致しません。');
 if((b.occurrence||1)!==(k.occurrence||1)||(b.balance!==''&&b.balance!=null&&k.balance!==''&&k.balance!=null&&Number(b.balance)!==Number(k.balance)))reasons.push('残高・出現番号が一致しません。');
 if((b.incoming>0)===(b.outgoing>0)||!Number.isSafeInteger(b.incoming||b.outgoing))reasons.push('入出金が不正です。');
 if(b.status==='照合済'||['matchId','matchType','paymentId','saleId','expenseId','supplierTransactionId'].some(f=>b[f])||(b.expenseIds||[]).length)reasons.push('取消対象に確認済み関連があります。');
 const contains=v=>v===b.id||Array.isArray(v)&&v.some(contains)||v&&typeof v==='object'&&Object.values(v).some(contains);
 for(const [n,rows] of Object.entries(data))if(!['settings','auditLogs','migrations'].includes(n))for(const r of rows)if(!(n==='bankTransactions'&&r.id===b.id)&&contains(r))refs.push(n+'/'+r.id);
 if(refs.length)reasons.push('取消対象への参照があります。');
 return {reasons,refs,evidence:key};
}
function bankDuplicate(b,rows,rules=[]){const key=bankIdentity(b,rules);return key?rows.filter(r=>live(r)&&(r.bankTxnId||r.id)!==(b.bankTxnId||b.id)&&bankIdentity(r,rules)===key):[];}
function platformBank(b){return !!b.incoming&&/stripe|ストライプ|(?:くらし|暮らし)のマーケット/i.test(String(b.description||'').normalize('NFKC'));}
function bankCashback(b){return !!b.incoming&&/(?:visa|デビット).*キャッシュバック/i.test(String(b.description||'').normalize('NFKC'));}
function platformPayments(b,data){return unique(data.payments||[]).filter(p=>live(p)&&!p.bankTxnId&&!p.bankId&&['pending-bank','bank-confirmed'].includes(p.confirmation)&&paymentChannel(p).channel==='プラットフォーム経由'&&paymentChannel(p).platformName==='くらしのマーケット'&&(p.paymentDate||p.date)<=b.bankTransactionDate);}
function bankSpecial(b){const text=normalize(b.description);if(b.incoming&&!b.outgoing&&/^(受取利息|普通預金利息|預金利息|利息)$/.test(text))return '受取利息';if(b.outgoing&&!b.incoming&&/^(振込手数料|振替手数料|銀行手数料)$/.test(text))return '支払手数料';return '';}
function autoBankTarget(bank,data){
 if(!bankIdentity(bank,data.settings)||!bank.incoming||['照合済','除外'].includes(bank.status)||bankDuplicate(bank,data.bankTransactions||[],data.settings).length)return null;
 const candidates=suggestions(bank,data);if(candidates.length!==1||candidates[0].blocked)return null;
 const c=candidates[0],s=[...(data.sales||[]),...(data.receivables||[])].find(s=>s.id===c.id);
 if(!s||Number(s.amount)!==bank.incoming||s.accountingReviewRequired||s.reviewRequired)return null;
 if((data.documents||[]).some(d=>d.id===s.documentId&&!live(d)))return null;
 const ps=(data.payments||[]).filter(p=>live(p)&&p.saleId===s.id);
 if(ps.length>1||ps.some(p=>paymentChannel(p).channel!=='銀行振込'||p.bankTxnId||p.bankId||!['pending-bank','bank-confirmed'].includes(p.confirmation)))return null;
 if(ps.length&&(!c.paymentId||ps[0].amount!==bank.incoming))return null;
 const trusted=(data.settings||[]).filter(r=>r.type==='bankPartyAlias'&&live(r)&&r.enabled!==false&&r.key===classificationKey(bank.description));
 if(trusted.length!==1||trusted[0].customerKey!==classificationKey(s.customer))return null;
 return {targetType:'sale',targetId:s.id,paymentId:c.paymentId};
}
function bankEvidence(p,data){return (data.bankTransactions||[]).some(b=>live(b)&&b.status==='照合済'&&(b.id||b.bankTxnId)===p.bankTxnId&&(b.paymentId===(p.id||p.paymentId)&&b.incoming===p.amount||b.matchType==='platformSettlement'&&(b.platformPayments||[]).some(v=>v.id===(p.id||p.paymentId)&&v.amount===p.amount)));}
const knownSupplierAdvance=b=>b?.bankTransactionDate==='2026-10-13'&&b.outgoing===1000000&&/東鵬/.test(b.description||'');
function bankMatch(bank,data){if(!live(bank))return {status:'取消済',candidates:[]};if(['照合済','除外'].includes(bank.status))return {status:bank.status,candidates:[]};if(bank.outgoing)return expenseMatch(bank,data);const candidates=suggestions(bank,data);return {status:candidates.length?'要確認':'未一致',candidates};}
function csv(rows){const cell=v=>'"'+(typeof v==='number'?String(v):String(v??'').replace(/^[\s]*[=+@-]/,"'$&")).replace(/"/g,'""')+'"';return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
return {expenseRegister,expenseExport,salesRegister,platformBank,bankCashback,platformPayments,knownSupplierAdvance,expenseBankEligible,bankCancellationReview,creditExpense,cardExpenses,bankAccountKey,bankIdentity,bankDuplicate,bankSpecial,autoBankTarget,bankEvidence,expenseStatus,LEDGER_HEADERS,ledgerCells,classificationKey,classifyExpense,incomingScore,periodFilter,aggregate,ledgerRows,settlementExport,bankMatch,bankMatchScore,nameMatch,METHODS,expenseInput,expenseKey,expensePreview,bankExpense,cardSettlement,expenseMatch,COLLECTIONS,CATEGORIES,paymentChannel,paymentChannels,live,confirmed,unique,ledger,date,money,delta,cashRows,receivables,supplierBalance,monthly,parseCSV,parseBank,suggestions,csv};
});
