(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaAccounting=api;})(globalThis,function(){
'use strict';
const COLLECTIONS=['expenses','cashLedger','suppliers','supplierTransactions','bankTransactions'];
const METHODS=['現金','代表者立替（交通系IC）','法人カード決済','銀行振込','口座振替','その他'];
const CATEGORIES=['材料費','材料仕入','旅費交通費','地代家賃','租税公課','給与','家賃','交通費','車両費','通信費','消耗品費','外注費','その他'];
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
const delta=t=>t.deletedAt?0:t.type==='monthlyInvoice'?-amount(t):amount(t);
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
function salesRows(sales,payments,month=''){return ledger(sales,payments).sales.filter(s=>!s.receivableOnly&&(!month||s.salesDate.slice(0,7)===month));}
function receivables(sales,payments,asOf=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})){
 return ledger(sales,payments,asOf).sales.map(s=>{const ageDays=s.invoiceDate?Math.max(0,Math.floor((Date.parse(asOf)-Date.parse(s.invoiceDate))/86400000)):0;return {...s,ageDays,status:!Number.isFinite(ageDays)?'要確認':s.status};});
}
function supplierBalance(s,txs,asOf='9999-12-31'){return (s.openingDate<=asOf?Number(s.openingBalance)||0:0)+txs.filter(t=>t.supplierId===s.supplierId&&t.date<=asOf).reduce((n,t)=>n+delta(t),0);}
function periodFilter({month,year,start,end}={}){if(year!==undefined){year=Number(year);if(!Number.isInteger(year)||year<2000||year>9998)throw Error('年度が不正です。');start=year+'-10-01';end=(year+1)+'-09-30';}else if(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を指定してください。');start=month+'-01';end=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10);}start=date(start);end=date(end);if(start>end)throw Error('期間の開始・終了を確認してください。');return {start,end,includes:value=>typeof value==='string'&&value>=start&&value<=end};}
function aggregate(data,p){const all=ledger(data.sales||[],data.payments||[]),within=(rs,k)=>unique(rs.filter(r=>live(r)&&p.includes(r[k]))),ps=within(all.payments.map(r=>({...r,paymentDate:r.paymentDate||r.date})),'paymentDate'),expenses=within(data.expenses||[],'expenseDate'),cash=cashRows(data.cashLedger||[]),supplierTx=within(data.supplierTransactions||[],'date'),categories=Object.fromEntries(CATEGORIES.map(c=>[c,0]));for(const e of expenses)categories[e.category]=(categories[e.category]||0)+amount(e);
 const bankIncome=sum(ps.filter(p=>p.confirmation==='bank-confirmed')),cashIncome=sum(ps.filter(p=>p.confirmation==='cash-received')),expenseTotal=sum(expenses),rs=receivables(data.sales||[],data.payments||[],p.end),unpaid=rs.filter(s=>s.outstanding!==0),unmatched=within(data.bankTransactions||[],'bankTransactionDate').filter(b=>!['照合済','除外'].includes(b.status)),abnormal=expenses.filter(e=>!e.category||!Number.isSafeInteger(Number(e.amount))||e.amount<=0);
 return {sales:sum(within(all.sales.filter(s=>!s.receivableOnly),'salesDate')),bankIncome,cashIncome,income:bankIncome+cashIncome,incomeChannels:paymentChannels(ps),receivables:rs.reduce((n,s)=>n+s.outstanding,0),expenseTotal,categories,cashReceipts:sum(within(cash,'date').filter(x=>x.type==='income')),cashExpenses:sum(within(cash,'date').filter(x=>x.type==='expense')),cashBalance:cash.filter(x=>x.date<=p.end).at(-1)?.runningBalance||0,supplierPrepayment:sum(supplierTx.filter(t=>t.type==='prepayment')),supplierInvoice:sum(supplierTx.filter(t=>t.type==='monthlyInvoice')),supplierPayment:sum(supplierTx.filter(t=>t.type==='payment')),suppliers:(data.suppliers||[]).filter(live).map(s=>({...s,currentBalance:supplierBalance(s,data.supplierTransactions||[],p.end)})),cashFlowDifference:bankIncome+cashIncome-expenseTotal,attention:unpaid.length+unmatched.length+abnormal.length,reminders:[...unpaid.map(s=>'未入金 / '+(s.customer||'')+' / '+s.outstanding),...unmatched.map(b=>'銀行未照合 / '+b.description),...abnormal.map(e=>'支出要確認 / '+(e.vendor||''))].slice(0,5)};}
function monthly(data,month){return {month,...aggregate(data,periodFilter({month}))};}
function ledgerRows(data,p){const rows=[],all=ledger(data.sales||[],data.payments||[],p.end),saleMap=new Map(all.sales.map(s=>[s.id,s])),banks=data.bankTransactions||[],status=(kind,id,linked)=>{const b=banks.find(b=>live(b)&&(b.bankTxnId===linked||b.id===linked||b.matchType===kind&&b.matchId===id));if(b)return bankMatch(b,data).status;const matches=banks.filter(b=>live(b)).map(b=>bankMatch(b,data)).filter(m=>m.candidates.some(c=>c.kind===kind&&c.id===id));return matches.some(m=>m.status==='自動一致')?'自動一致':matches.length?'候補':'未照合';};
 for(const s of all.sales)if(!s.receivableOnly)rows.push({id:'sale:'+s.id,date:s.salesDate,type:'売上',customer:s.customer,description:s.content,method:s.paymentMethod||'',incoming:0,outgoing:0,status:s.status});
 for(const v of unique((data.payments||[]).filter(live))){const s=saleMap.get(v.saleId);if(!s)continue;rows.push({id:'payment:'+(v.id||v.paymentId),date:v.paymentDate||v.date,type:'入金',customer:s.customer,description:v.memo||s.content,method:v.method,incoming:confirmed(v)?amount(v):0,outgoing:0,status:v.bankTxnId?'照合済 / 入金確認済':confirmed(v)?'入金済':'未入金'});}
 for(const e of unique((data.expenses||[]).filter(live)))rows.push({id:'expense:'+(e.id||e.expenseId),date:e.expenseDate,type:'支出',customer:e.vendor,description:e.description||e.category,method:e.paymentMethod,incoming:0,outgoing:amount(e),status:e.bankTxnId?'照合済 / 支払確認済':bankExpense(e)?status('expense',e.id||e.expenseId):'未照合'});
 for(const c of (data.cashLedger||[]).filter(live))if(!c.linkedPaymentId&&!c.linkedExpenseId&&!c.linkedSupplierTransactionId)rows.push({id:'cash:'+c.cashTxnId,date:c.date,type:'現金調整',customer:'',description:c.description,method:'現金',incoming:c.type==='income'?amount(c):0,outgoing:c.type==='expense'?amount(c):0,status:'確認済'});
 return rows.filter(r=>p.includes(r.date)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));}
function settlementExport(data,p){const m=aggregate(data,p);return [['対象期間',p.start,p.end],['集計','金額'],...Object.entries({売上:m.sales,入金:m.income,支出:m.expenseTotal,未収金:m.receivables,収支差額:m.cashFlowDifference,...m.categories}).map(([k,v])=>[k,v]),...m.incomeChannels.map(c=>['入金経路 / '+c.channel+(c.platformName?' / '+c.platformName:''),c.amount]),[],['日付','区分','取引先','内容','入金・支払方法','入金','出金','状態'],...ledgerRows(data,p).map(r=>[r.date,r.type,r.customer,r.description,r.method,r.incoming,r.outgoing,r.status])];}
function parseCSV(text){const out=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){field+='"';i++;}else if(quote||!field)quote=!quote;else throw Error('CSVの引用符が不正です。');}else if(c===','&&!quote){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))out.push(row);row=[];field='';}else field+=c;}if(quote)throw Error('CSVの引用符が閉じていません。');row.push(field);if(row.some(x=>x.trim()))out.push(row);return out;}
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
async function parseBank(text,account,digest){if(!account.trim())throw Error('銀行口座名を入力してください。同じ口座は同じ名前を使用します。');const table=parseCSV(text.replace(/^\uFEFF/,''));const headerIndex=table.findIndex(r=>r.some(c=>/^(取引日|取引年月日|日付|年月日|お取引日|date)$/i.test(normalize(c))));if(headerIndex<0)throw Error('日付ヘッダーを認識できません。');const headers=table[headerIndex].map(normalize),find=names=>headers.findIndex(h=>names.includes(h));const ix={date:find(['日付','取引日','取引年月日','年月日','お取引日','date']),description:find(['摘要','内容','取引内容','お取引内容','お取引内容(摘要)','相手','description']),incoming:find(['入金金額','入金','入金額','お預り金額','お預り金額(円)','お預り','お預かり金額','入金額(円)','お預入れ金額','deposit']),outgoing:find(['出金金額','出金','出金額','お支払金額','お支払金額(円)','お支払','出金額(円)','お引出し金額','withdrawal']),memo:find(['メモ','memo']),id:find(['取引id','取引番号','明細番号','transactionid']),balance:find(['残高','残高(円)','お取引後残高','balance'])};if(ix.incoming<0||ix.outgoing<0||ix.description<0)throw Error('摘要・入金・出金ヘッダーが必要です。対応列名を確認してください。');const counts=new Map(),result=[];
 for(const [i,r] of table.slice(headerIndex+1).entries()){if(r.length!==headers.length)throw Error(`CSV ${i+headerIndex+2}行の列数が一致しません。`);try{const bankTransactionDate=date(r[ix.date]),incoming=r[ix.incoming].trim()?money(r[ix.incoming],true):0,outgoing=r[ix.outgoing].trim()?money(r[ix.outgoing],true):0;if(incoming<0||outgoing<0||(incoming>0)===(outgoing>0))throw Error('入金/出金の一方に正の金額が必要です。');const description=r[ix.description],externalId=ix.id>=0?r[ix.id].trim():'',balance=ix.balance>=0&&r[ix.balance].trim()?money(r[ix.balance],true):'',signature=JSON.stringify([normalize(account),bankTransactionDate,normalize(description),incoming,outgoing,balance]),occurrence=(counts.get(signature)||0)+1;counts.set(signature,occurrence);const key=externalId?JSON.stringify([normalize(account),'external',externalId]):signature+'#'+occurrence,hash=await digest(key);result.push({bankTxnId:'bank_'+hash.slice(0,48),bankAccount:account.trim(),bankTransactionDate,description,incoming,outgoing,amount:incoming||outgoing,balance,memo:ix.memo>=0?r[ix.memo]:'',externalId,hash,occurrence,status:'未照合',deletedAt:null});}catch(e){throw Error(`CSV ${i+headerIndex+2}行: ${e.message}`);}}
 if(!result.length)throw Error('取引明細がありません。');return result;
}
function expenseInput(e){
 const paymentMethod=String(e.paymentMethod||'').trim();if(![...METHODS,'GMO銀行','クレジットカード','月締'].includes(paymentMethod))throw Error('支払方法を確認してください。');
 if(!CATEGORIES.includes(e.category))throw Error('科目を確認してください。');
 return {...e,expenseDate:date(e.expenseDate),amount:money(e.amount),paymentMethod,vendor:String(e.vendor||'').trim(),description:String(e.description||'').trim()};
}
function expenseKey(e){const p=expenseInput({...e,expenseDate:e.expenseDate||e.date,paymentMethod:e.paymentMethod||e.method,description:e.description??e.memo});return JSON.stringify([p.expenseDate,p.category,p.amount,p.vendor,p.paymentMethod,p.description]);}
function expensePreview(text,existing=[]){
 const rows=parseCSV(text.replace(/^\uFEFF/,'')),headers=rows.shift()||[],required=['日付','科目','支払方法','金額','取引先','内容・備考'];
 if(required.some(h=>!headers.includes(h)))throw Error('CSV列: '+required.join(', '));
 const seen=new Set();for(const e of existing.filter(live)){try{seen.add(expenseKey(e));}catch(_){/* Unsupported legacy rows remain readable. */}}
 const records=[],errors=[];let duplicates=0,total=0;
 rows.forEach((r,i)=>{try{if(r.length!==headers.length)throw Error('列数が一致しません。');const v=Object.fromEntries(headers.map((h,j)=>[h,r[j]])),expense=expenseInput({expenseDate:v['日付'],category:v['科目'],paymentMethod:v['支払方法'],amount:v['金額'],vendor:v['取引先'],description:v['内容・備考']}),key=expenseKey(expense),duplicate=seen.has(key);seen.add(key);if(duplicate)duplicates++;else total+=expense.amount;records.push({expense,key,duplicate,line:i+2});}catch(e){errors.push((i+2)+'行: '+e.message);}});
 if(!rows.length)errors.push('支出明細がありません。');return {records,errors,duplicates,total,count:rows.length};
}
const bankExpense=e=>['銀行振込','口座振替','GMO銀行','法人カード決済','クレジットカード'].includes(e.paymentMethod);
const cardSettlement=b=>!!b.outgoing&&/カード|ｶｰﾄﾞ|card|visa|master|jcb|amex|アメックス|クレジット/i.test(String(b.description||'').normalize('NFKC'));
function expenseMatch(bank,data){
 if(bank.status==='照合済')return {status:'照合済',candidates:[]};
 if(cardSettlement(bank))return {status:'未一致',candidates:[],card:true};
 const candidates=unique(data.expenses||[]).filter(e=>live(e)&&bankExpense(e)&&!e.bankTxnId).flatMap(e=>{const score=bankMatchScore(bank,e.amount,e.expenseDate,e.vendor);if(!score)return [];if(nameMatch(bank.description,e.description)&&score.score<100){score.score=100;score.reasons.push('内容一致');}return [{kind:'expense',id:e.expenseId||e.id,paymentId:'',...score}];});
 const certain=candidates.length===1&&candidates[0].score===100;
 return {status:certain?'自動一致':candidates.length?'候補':'未一致',candidates};
}
function nameMatch(a,b){const clean=v=>normalize(v).replace(/株式会社|有限会社|合同会社|[()（）・.,、]|カ\)|ユ\)/g,'');a=clean(a);b=clean(b);return a.length>=2&&b.length>=2&&(a.includes(b)||b.includes(a));}
function bankMatchScore(bank,targetAmount,targetDate,name){const days=Math.abs(Date.parse(bank.bankTransactionDate)-Date.parse(targetDate))/86400000;if(targetAmount!==(bank.incoming||bank.outgoing)||!(days<=7))return null;const named=nameMatch(bank.description,name);return {score:named?100:70,reasons:['金額一致','日付7日以内',...(named?['名称一致']:[])]};}
function suggestions(bank,data){if(['照合済','除外'].includes(bank.status))return [];if(!bank.incoming)return expenseMatch(bank,data).candidates;const out=[];
 for(const s of receivables(data.sales||[],data.payments||[],'9999-12-31')){if(s.outstanding<=0)continue;const pending=(data.payments||[]).filter(p=>live(p)&&p.saleId===s.id&&p.confirmation==='pending-bank'&&p.amount===bank.incoming);const score=bankMatchScore(bank,s.outstanding,s.invoiceDate||s.salesDate,s.customer)||(pending.length===1&&pending[0].amount<=s.outstanding?bankMatchScore(bank,pending[0].amount,pending[0].paymentDate||pending[0].date,s.customer):null);if(score)out.push({kind:'sale',id:s.id,paymentId:pending.length===1?(pending[0].id||pending[0].paymentId):'',...score});}
 return out.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));}
function bankMatch(bank,data){if(['照合済','除外'].includes(bank.status))return {status:bank.status,candidates:[]};if(bank.outgoing)return expenseMatch(bank,data);const candidates=suggestions(bank,data);return {status:candidates.length===1&&candidates[0].score===100?'自動一致':candidates.length?'候補':'未一致',candidates};}
function csv(rows){const cell=v=>'"'+(typeof v==='number'?String(v):String(v??'').replace(/^[\s]*[=+@-]/,"'$&")).replace(/"/g,'""')+'"';return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
return {periodFilter,aggregate,ledgerRows,settlementExport,bankMatch,bankMatchScore,nameMatch,METHODS,expenseInput,expenseKey,expensePreview,bankExpense,cardSettlement,expenseMatch,COLLECTIONS,CATEGORIES,paymentChannel,paymentChannels,live,confirmed,unique,ledger,salesRows,date,money,delta,cashRows,receivables,supplierBalance,monthly,parseCSV,parseBank,suggestions,csv};
});
