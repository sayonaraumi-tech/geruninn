(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaAccounting=api;})(globalThis,function(){
'use strict';
const COLLECTIONS=['expenses','cashLedger','suppliers','supplierTransactions','bankTransactions'];
const CATEGORIES=['材料費','給与','家賃','交通費','車両費','通信費','消耗品費','外注費','その他'];
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
function monthly(data,month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を指定してください。');const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10),inMonth=(rs,k)=>rs.filter(r=>live(r)&&String(r[k]).slice(0,7)===month),ps=inMonth(ledger(data.sales||[],data.payments||[]).payments,'paymentDate'),expenses=inMonth(data.expenses||[],'expenseDate'),cash=cashRows(data.cashLedger||[]),supplierTx=inMonth(data.supplierTransactions||[],'date'),categories=Object.fromEntries(CATEGORIES.map(c=>[c,0]));for(const e of expenses)categories[e.category]=(categories[e.category]||0)+amount(e);
 const bankIncome=sum(ps.filter(p=>p.confirmation==='bank-confirmed')),cashIncome=sum(ps.filter(p=>p.confirmation==='cash-received')),expenseTotal=sum(expenses);
 return {month,sales:sum(inMonth((data.sales||[]).filter(s=>!s.receivableOnly),'salesDate')),bankIncome,cashIncome,income:bankIncome+cashIncome,incomeChannels:paymentChannels(ps),receivables:receivables(data.sales||[],data.payments||[],end).reduce((n,s)=>n+s.outstanding,0),expenseTotal,categories,cashReceipts:sum(inMonth(cash,'date').filter(x=>x.type==='income')),cashExpenses:sum(inMonth(cash,'date').filter(x=>x.type==='expense')),cashBalance:cash.filter(x=>x.date<=end).at(-1)?.runningBalance||0,supplierPrepayment:sum(supplierTx.filter(t=>t.type==='prepayment')),supplierInvoice:sum(supplierTx.filter(t=>t.type==='monthlyInvoice')),supplierPayment:sum(supplierTx.filter(t=>t.type==='payment')),suppliers:(data.suppliers||[]).filter(live).map(s=>({...s,currentBalance:supplierBalance(s,data.supplierTransactions||[],end)})),cashFlowDifference:bankIncome+cashIncome-expenseTotal};
}
function parseCSV(text){const out=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){field+='"';i++;}else if(quote||!field)quote=!quote;else throw Error('CSVの引用符が不正です。');}else if(c===','&&!quote){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))out.push(row);row=[];field='';}else field+=c;}if(quote)throw Error('CSVの引用符が閉じていません。');row.push(field);if(row.some(x=>x.trim()))out.push(row);return out;}
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
async function parseBank(text,account,digest){if(!account.trim())throw Error('銀行口座名を入力してください。同じ口座は同じ名前を使用します。');const table=parseCSV(text.replace(/^\uFEFF/,''));const headerIndex=table.findIndex(r=>r.some(c=>/^(取引日|取引年月日|日付|年月日|お取引日|date)$/i.test(normalize(c))));if(headerIndex<0)throw Error('日付ヘッダーを認識できません。');const headers=table[headerIndex].map(normalize),find=names=>headers.findIndex(h=>names.includes(h));const ix={date:find(['日付','取引日','取引年月日','年月日','お取引日','date']),description:find(['摘要','内容','取引内容','お取引内容','お取引内容(摘要)','相手','description']),incoming:find(['入金','入金額','お預り金額','お預り金額(円)','お預り','お預かり金額','入金額(円)','お預入れ金額','deposit']),outgoing:find(['出金','出金額','お支払金額','お支払金額(円)','お支払','出金額(円)','お引出し金額','withdrawal']),id:find(['取引id','取引番号','明細番号','transactionid']),balance:find(['残高','残高(円)','お取引後残高','balance'])};if(ix.incoming<0||ix.outgoing<0||ix.description<0)throw Error('摘要・入金・出金ヘッダーが必要です。対応列名を確認してください。');const counts=new Map(),result=[];
 for(const [i,r] of table.slice(headerIndex+1).entries()){if(r.length!==headers.length)throw Error(`CSV ${i+headerIndex+2}行の列数が一致しません。`);try{const bankTransactionDate=date(r[ix.date]),incoming=r[ix.incoming].trim()?money(r[ix.incoming],true):0,outgoing=r[ix.outgoing].trim()?money(r[ix.outgoing],true):0;if(incoming<0||outgoing<0||(incoming>0)===(outgoing>0))throw Error('入金/出金の一方に正の金額が必要です。');const description=r[ix.description].trim(),externalId=ix.id>=0?r[ix.id].trim():'',balance=ix.balance>=0&&r[ix.balance].trim()?money(r[ix.balance],true):'',signature=JSON.stringify([normalize(account),bankTransactionDate,normalize(description),incoming,outgoing,balance]),occurrence=(counts.get(signature)||0)+1;counts.set(signature,occurrence);const key=externalId?JSON.stringify([normalize(account),'external',externalId]):signature+'#'+occurrence,hash=await digest(key);result.push({bankTxnId:'bank_'+hash.slice(0,48),bankAccount:account.trim(),bankTransactionDate,description,incoming,outgoing,amount:incoming||outgoing,externalId,hash,occurrence,status:'未照合',deletedAt:null});}catch(e){throw Error(`CSV ${i+headerIndex+2}行: ${e.message}`);}}
 if(!result.length)throw Error('取引明細がありません。');return result;
}
function suggestions(bank,data){if(['照合済','除外'].includes(bank.status))return [];const results=[];const add=(kind,id,targetAmount,targetDate,name,paymentId='')=>{let score=0;const reasons=[];if(targetAmount===bank.amount){score+=50;reasons.push('金額一致');}const days=Math.abs(Date.parse(bank.bankTransactionDate)-Date.parse(targetDate))/86400000;if(days<=7){score+=20;reasons.push('日付7日以内');}const a=normalize(name),b=normalize(bank.description);if(a.length>=2&&(b.includes(a)||a.includes(b)&&b.length>=2)){score+=30;reasons.push('名称一致');}if(score>=30)results.push({kind,id,paymentId,score,reasons});};
 if(bank.incoming){for(const s of receivables(data.sales||[],data.payments||[],'9999-12-31'))if(s.outstanding>0)add('sale',s.id,s.outstanding,s.invoiceDate,s.customer);for(const p of data.payments||[])if(live(p)&&p.confirmation==='pending-bank'){const s=(data.sales||[]).find(s=>s.id===p.saleId);if(s&&live(s))add('sale',s.id,p.amount,p.paymentDate,s.customer,p.id);}}
 else{for(const e of data.expenses||[])if(live(e)&&e.paymentMethod!=='現金'&&e.paymentMethod!=='月締'&&!e.bankTxnId)add('expense',e.expenseId,e.amount,e.expenseDate,e.vendor);for(const t of data.supplierTransactions||[])if(live(t)&&['prepayment','payment'].includes(t.type)&&t.paymentMethod!=='現金'&&!t.bankTxnId)add('supplier',t.transactionId,t.amount,t.date,(data.suppliers||[]).find(s=>s.supplierId===t.supplierId)?.supplierName);}
 return results.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
function csv(rows){const cell=v=>'"'+(typeof v==='number'?String(v):String(v??'').replace(/^[\s]*[=+@-]/,"'$&")).replace(/"/g,'""')+'"';return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
return {COLLECTIONS,CATEGORIES,paymentChannel,paymentChannels,live,confirmed,unique,ledger,salesRows,date,money,delta,cashRows,receivables,supplierBalance,monthly,parseCSV,parseBank,suggestions,csv};
});
