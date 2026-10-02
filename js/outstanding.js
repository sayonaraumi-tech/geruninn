/* Read-only invoice balance projection. payments is the sole payment source. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaOutstanding=api;})(globalThis,function(){
'use strict';
const active=r=>!!r&&!r.deletedAt&&!['void','cancelled','duplicate','revised'].includes(r.documentStatus||r.status);
function view(document,sale,paymentRows=[]){
 const d=document.payload||document,s=d.snapshot||d,id=d.documentId||s.documentId||s.historyId;
 const saleId=d.saleId||d.receivableId||sale?.id||s.saleId||'sale_'+id;
 const invoiceAmount=Number(d.amount??sale?.amount??0);
 const payments=paymentRows.map(r=>r.payload?{...r.payload,id:r.id}:r).filter(p=>active(p)&&p.confirmation!=='bank-marker'&&Number(p.amount)>0&&(p.saleId===saleId||(!p.saleId&&p.documentId===id)))
 .map(p=>({...p,date:p.paymentDate||p.date||'',amount:Number(p.amount),method:p.method||'',note:p.memo||p.note||''})).sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
 const paidAmount=payments.reduce((n,p)=>n+p.amount,0),outstandingAmount=invoiceAmount-paidAmount;
 const text=[s.billingPeriod,s.bizJobMemo,s.remarks,...(s.items||[]).map(i=>i.content)].join(' '),match=text.match(/(20\d{2})年\s*(\d{1,2})月/);
 const month=s.billingMonth||s.targetMonth||(match?match[1]+'-'+match[2].padStart(2,'0'):(sale?.salesDate||sale?.saleDate||s.invoiceDate||'').slice(0,7));
 if(!Number.isSafeInteger(invoiceAmount)||invoiceAmount<0)throw Error('原請求額を確認してください。');
 return {documentId:id,saleId,invoiceNo:s.invoiceNo||sale?.invoiceNo||'',customerName:s.customerName||sale?.customer||'',month,invoiceAmount,payments,paidAmount,outstandingAmount,paymentStatus:outstandingAmount<=0?'入金済':paidAmount>0?'一部入金':'未入金',active:active(d)&&(!sale||active(sale)),snapshot:s};
}
function notice(v,issueDate){
 if(!v.active||v.outstandingAmount<=0)throw Error('有効な未入金残高がありません。');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month))throw Error('原請求書の対象月を確認してください。');
 const period=Number(v.month.slice(0,4))+'年'+Number(v.month.slice(5))+'月分',yen=n=>n.toLocaleString('ja-JP')+'円';
 return {...v,issueDate,period,target:period+'請求書',filename:(period.replace('分','')+'_'+v.customerName+'_未入金残高請求書_'+v.outstandingAmount+'円.pdf').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_'),note:`${period}請求書（No.${v.invoiceNo}）につきまして、請求額${yen(v.invoiceAmount)}に対し、${yen(v.paidAmount)}のご入金を確認しております。差額${yen(v.outstandingAmount)}が未入金となっておりますため、ご請求申し上げます。※新規工事分ではなく、前回請求分の未入金残高です。`};
}
return {view,notice};
});
