(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./accounting.js'):root.TsukinowaAccounting);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaHistorical=api;})(globalThis,function(A){
'use strict';
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const payload=r=>r.payload||r;
function validate(d){
 const customerName=String(d.customerName||'').trim(),invoiceNo=String(d.invoiceNo||'').trim();
 if(!customerName||!invoiceNo||invoiceNo.length>160||/[\x00-\x1f]/.test(invoiceNo))throw Error('顧客名・原請求書No.を確認してください。');
 const issueDate=A.date(d.issueDate),dueDate=A.date(d.dueDate),invoiceAmount=A.money(d.invoiceAmount),billingMonth=String(d.billingMonth||'');
 if(billingMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth))throw Error('対象月を確認してください。');
 return {customerName,invoiceNo,issueDate,dueDate,invoiceAmount,billingMonth,remarks:String(d.remarks||'').slice(0,5000),items:Array.isArray(d.items)?d.items:[]};
}
function sameTuple(p,d){return normalize(p.customerName||p.customer)===normalize(d.customerName)&&(p.issueDate||p.invoiceDate||p.snapshot?.invoiceDate)===d.issueDate&&Number(p.amount)===d.invoiceAmount;}
function check(d,documents,sales,hash=''){
 const duplicate=documents.find(r=>{const p=payload(r);return normalize(p.invoiceNo||p.snapshot?.invoiceNo)===normalize(d.invoiceNo)||(hash&&p.sourceHash===hash)||sameTuple(p,d);});
 const matches=sales.filter(r=>{const p=payload(r);return normalize(p.invoiceNo)===normalize(d.invoiceNo)||sameTuple(p,d);});
 return {duplicate:duplicate||null,matches};
}
function parseText(raw){
 const text=String(raw||'').normalize('NFKC'),out={customerName:'',invoiceNo:'',issueDate:'',dueDate:'',invoiceAmount:'',billingMonth:'',remarks:'',items:[]};
 const pick=re=>text.match(re)?.[1]?.trim()||'';
 out.customerName=pick(/(?:顧客名|客户名|宛名)\s*[:：]?\s*([^\n]+)/)||pick(/([^\n]+?)\s*(?:御中|様)(?:\s|$)/);
 out.invoiceNo=pick(/(?:請求書\s*(?:No\.?|番号)|No\.?|請求番号)\s*[:：]?\s*([A-Za-z0-9_-]+)/i);
 const datePattern='(20\\d{2}\\s*[年/.-]\\s*\\d{1,2}\\s*[月/.-]\\s*\\d{1,2}\\s*日?)';
 for(const [k,label] of [['issueDate','発行日|請求日'],['dueDate','支払期限|お支払期限|支払期日']]){const value=pick(new RegExp('(?:'+label+')\\s*[:：]?\\s*'+datePattern));try{if(value)out[k]=A.date(value.replace(/\s/g,''));}catch{}}
 const amount=pick(/(?:ご請求金額|請求額|請求金額|合計金額)\s*[:：]?\s*[¥￥]?\s*([\d,]+)\s*円?/);try{if(amount)out.invoiceAmount=A.money(amount);}catch{}
 const month=text.match(/(20\d{2})年\s*(\d{1,2})月\s*分/);if(month){out.billingMonth=month[1]+'-'+month[2].padStart(2,'0');out.remarks=month[0];}
 // Only an explicitly labelled, unambiguous row is treated as an item; never derive tax or totals.
 for(const line of text.split('\n')){const m=line.match(/^明細[:：]\s*(.+?)\s+数量[:：]\s*(\d+(?:\.\d+)?)\s+単価[:：]\s*([\d,]+)円?$/);if(m)out.items.push({content:m[1],qty:Number(m[2]),price:Number(m[3].replace(/,/g,'')),unit:''});}
 return out;
}
return {normalize,validate,check,sameTuple,parseText};
});
