/* Independent balance notices never call saveDocument, saveConfirmedHistory or accounting writes. */
(function(root){
'use strict';
const el=id=>document.getElementById(id),O=root.TsukinowaOutstanding;
let target='',account='',busy=false,dialog,formHome,formAnchor;
function restorePaymentForm(){if(formHome){formHome.insertBefore(el('paymentRegistrationForm'),formAnchor);el('paymentSale').disabled=false;}}

function current(){if(account!==root.TsukinowaBusinessUI.getClient()?.getState().user?.uid)throw Error('アカウントが変更されました。');return root.TsukinowaBusinessUI.invoiceBalance(target);}
function text(parent,tag,value){const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
function refresh(){
 const v=current(),box=el('balanceSummary');box.replaceChildren();
 text(box,'p',`請求額 ${bizMoney(v.invoiceAmount)} ｜ 累計入金額 ${bizMoney(v.paidAmount)} ｜ 未入金残高 ${bizMoney(v.outstandingAmount)} ｜ 入金状態 ${v.paymentStatus}`);
 const table=document.createElement('table');table.className='biz-table';const head=table.createTHead().insertRow();for(const t of ['入金日','入金額','方法','備考','照合状態'])text(head,'th',t);
 const body=table.createTBody();for(const p of v.payments){const row=body.insertRow();for(const t of [p.date,bizMoney(p.amount),p.method,p.note,p.confirmation==='pending-bank'?'銀行照合待ち':p.confirmation==='bank-confirmed'?'銀行確認済':'登録済'])text(row,'td',t);}
 box.append(table);if(!v.payments.length)text(box,'p','入金履歴はありません。');
 text(box,'p','実際の入金を確認してから登録してください。銀行振込は銀行確認済として記帳します。');
 el('balancePDF').hidden=!v.active||v.outstandingAmount<=0;el('balancePaymentHost').hidden=!v.active||v.outstandingAmount<=0; if(v.outstandingAmount<=0)restorePaymentForm();
 return v;
}
root.openInvoiceBalance=function(id,action='history'){
 try{restorePaymentForm();target=id;account=root.TsukinowaBusinessUI.getClient()?.getState().user?.uid;const v=refresh();el('balanceHeading').textContent=`${v.customerName} / No.${v.invoiceNo}`;el('balanceMonth').value=v.month;el('balanceSaveStatus').textContent='';dialog.showModal();if(action==='payment'&&v.active&&v.outstandingAmount>0){el('balancePaymentHost').append(el('paymentRegistrationForm'));const select=el('paymentSale');if(![...select.options].some(o=>o.value===v.saleId))select.add(new Option(v.customerName,v.saleId));select.value=v.saleId;select.disabled=true;el('paymentAmount').value=v.outstandingAmount;el('paymentDate').value=todayISO();el('paymentType').value='銀行振込';el('paymentMemo').value='';el('paymentAmount').focus();}if(action==='pdf')return exportPDF();}catch(e){alert(e.message);}
};
function createSheet(n){
 const source=document.querySelector('.invoice'),sheet=document.createElement('div');sheet.className='invoice outstanding-notice';sheet.style.cssText='width:210mm;min-height:297mm;height:auto;box-sizing:border-box;background:white;--dens:1';
 for(const selector of ['.hdr-classic','.customer-block','.greeting-info-block'])sheet.append(source.querySelector(selector).cloneNode(true));
 const set=(id,t)=>sheet.querySelector('#'+id).textContent=t;
 set('titleClassic','請 求 書');set('dCustomer',n.customerName);set('dNo',n.invoiceNo+'（残高通知）');set('dDate',n.issueDate.replace(/^(\d+)-(\d+)-(\d+)$/,(m,y,mo,d)=>`${y}年${Number(mo)}月${Number(d)}日`));set('greetingText','下記の通りご請求申し上げます');sheet.querySelector('#greetingText').style.display='';set('amountLabelClassic','ご請求金額');set('dTotalHero',fmtNum(n.outstandingAmount));
 sheet.querySelector('#topExpiryLine').remove();const reg=sheet.querySelector('#registrationLine');reg.style.display=n.issueDate>='2026-10-01'?'':'none';set('dRegNo',COMPANY_INVOICE_REG_NO);
 text(sheet.querySelector('.greeting-left'),'p','未入金残高のご請求').style.cssText='font-weight:bold;font-size:18px';sheet.querySelector('#sealMid').style.display='';
 const table=document.createElement('table');table.className='items-classic';table.style.cssText='margin:16px 0;width:100%';const body=table.createTBody();
 for(const [label,value] of [['原請求書No.',n.invoiceNo],['対象',n.target],['原請求額',fmtNum(n.invoiceAmount)+'円'],['累計入金額',fmtNum(n.paidAmount)+'円'],['未入金残高',fmtNum(n.outstandingAmount)+'円'], [n.period+'請求額',fmtNum(n.invoiceAmount)+'円'],['ご入金額','▲'+fmtNum(n.paidAmount)+'円'],['未入金残高',fmtNum(n.outstandingAmount)+'円']]){const row=body.insertRow();text(row,'th',label);text(row,'td',value).style.textAlign='right';}
 sheet.append(table);
 const cards=document.createElement('div');cards.className='bottom-cards';const bank=document.createElement('div');bank.className='bank-card-classic';text(bank,'div','お振込先').className='bank-header';for(const [k,v] of DOC_CONFIGS.invoice.leftCard.rows){const line=text(bank,'div',k+'：'+v);line.className='bank-row';}cards.append(bank);
 const notes=document.createElement('div');notes.className='remarks-card-classic';text(notes,'div','備考').className='remarks-label';text(notes,'div',n.note).className='remarks-text';cards.append(notes);sheet.append(cards);
 // Detached IDs must never interfere with the main document editor.
 for(const node of sheet.querySelectorAll('[id]'))node.removeAttribute('id');
 return sheet;
}
async function exportPDF(){
 if(busy)return;busy=true;el('balancePDF').disabled=true;let host;
 try{
 const sync=root.TsukinowaBusinessUI.getSync();await sync.flush();if(sync.getQueue().length)throw Error('同期完了後に出力してください。');
 const v=current(),n=O.notice({...v,month:el('balanceMonth').value},todayISO()),sheet=createSheet(n);
 host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;background:white;width:210mm;pointer-events:none';host.append(sheet);document.body.append(host);
 await Promise.all([...sheet.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})));await document.fonts.ready;
 const worker=html2pdf().set({margin:0,filename:n.filename,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:'#fff',scrollX:0,scrollY:0,x:0,y:0,windowWidth:794,onclone:doc=>{
 for(const selector of ['.html2pdf__container','.html2pdf__overlay']){const box=doc.querySelector(selector);if(box)Object.assign(box.style,{position:'absolute',left:'0',right:'auto',top:'0',bottom:'auto',margin:'0',width:'210mm',overflow:'visible'});}
 const clone=doc.querySelector('.html2pdf__container .outstanding-notice');if(clone)Object.assign(clone.style,{width:'210mm',margin:'0',padding:'14mm 16mm 12mm',boxShadow:'none',transform:'none',height:'auto',minHeight:'297mm',maxHeight:'none',overflow:'visible'});
 Object.assign(doc.body.style,{margin:'0',padding:'0',width:'210mm'});
 }},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}}).from(sheet);
 await worker.toCanvas();const canvas=await worker.get('canvas');await worker.toPdf();const pdf=await worker.get('pdf');
 for(let p=pdf.internal.getNumberOfPages();p>=1;p--)pdf.deletePage(p);pdf.addPage('a4','portrait');
 const height=210*canvas.height/canvas.width;if(height>298)throw Error('帳票が1ページを超えています。対象・備考を確認してください。');
 pdf.addImage(canvas.toDataURL('image/jpeg',.98),'JPEG',0,0,210,Math.min(height,297));pdf.save(n.filename);
 }catch(e){alert('未入金残高PDF：'+e.message);}finally{host?.remove();busy=false;el('balancePDF').disabled=false;}
}
root.TsukinowaBalanceUI={paymentContext:()=>dialog?.open&&el('balancePaymentHost').contains(el('paymentRegistrationForm'))?{documentId:current().documentId}:{},paymentSaved:()=>{if(dialog?.open)el('balanceSaveStatus').textContent='入金を保存しました。';},refresh:()=>{if(dialog?.open){try{refresh();}catch{dialog.close();}}},close:()=>dialog?.close(),createSheet};
document.addEventListener('DOMContentLoaded',()=>{
 dialog=document.createElement('dialog');dialog.id='invoiceBalanceDialog';dialog.style.cssText='max-width:880px;width:calc(100% - 32px);max-height:90vh;overflow:auto';dialog.innerHTML='<h2 id="balanceHeading"></h2><div id="balanceSummary"></div><div id="balancePaymentHost"></div><p id="balanceSaveStatus" role="status"></p><label>原請求書の対象月<input id="balanceMonth" type="month"></label><button id="balancePDF" class="biz-btn" type="button">未入金残高請求書</button><button id="balanceClose" class="biz-btn" type="button">閉じる</button>';document.body.append(dialog);
 const style=document.createElement('style');style.textContent='#invoiceBalanceDialog{border:1px solid #ddd;border-radius:14px;padding:20px;color:#222}#invoiceBalanceDialog::backdrop{background:#0006}#invoiceBalanceDialog h2{font-size:20px;margin-bottom:14px}#balancePaymentHost .biz-section{margin:16px 0;padding:12px}#balanceSaveStatus{grid-column:1/-1}#invoiceBalanceDialog label{display:block;font-size:13px}#invoiceBalanceDialog input,#invoiceBalanceDialog select{display:block;box-sizing:border-box;width:100%;padding:9px;border:1px solid #ccc;border-radius:6px;margin-top:5px}#balanceMonth{max-width:220px}#balanceSummary{overflow-x:auto}';document.head.append(style);
 el('balanceClose').onclick=()=>dialog.close();el('balancePDF').onclick=exportPDF;
 formHome=el('paymentRegistrationForm').parentNode;formAnchor=document.createComment('payment form');formHome.insertBefore(formAnchor,el('paymentRegistrationForm').nextSibling);dialog.addEventListener('close',restorePaymentForm);
});
})(window);
