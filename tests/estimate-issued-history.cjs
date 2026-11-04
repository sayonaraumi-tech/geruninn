const {test}=require('node:test'),assert=require('node:assert/strict');
const {estimateInvoices}=require('../js/business-domain');
const estimate='est-original';
const invoice={documentId:'invoice',docType:'invoice',confirmed:true,estimateId:estimate,amount:112376};
test('unwon and accepted estimates remain until a formal invoice exists',()=>{
 for(const status of ['見積済','受注','受注・日程未定']){
  assert.equal(estimateInvoices(estimate,[]).length,0,status);
  for(const d of [{...invoice,confirmed:false},{...invoice,docType:'estimate'},{...invoice,docType:'receipt'}])assert.equal(estimateInvoices(estimate,[d]).length,0);
 }
});
test('issued invoice leaves daily work regardless of unpaid, partial or full payment',()=>{
 for(const paid of [0,1000,112376])assert.equal(estimateInvoices(estimate,[invoice],[{id:'sale',documentId:'invoice',estimateId:estimate,paid}]).length,1);
});
test('legacy exact document-to-sale-to-estimate references work without name/amount heuristics',()=>{
 const doc={...invoice,estimateId:''};
 assert.equal(estimateInvoices(estimate,[doc],[{id:'s',sourceId:'invoice',estimateId:estimate}]).length,1);
 assert.equal(estimateInvoices(estimate,[{...doc,saleId:'s'}],[{id:'s',estimateId:estimate}]).length,1);
 assert.equal(estimateInvoices(estimate,[{...doc,snapshot:{estimateId:estimate}}]).length,1);
 for(const sale of [{id:'s',customer:'琢居株式会社',amount:112376},{id:'s',estimateId:'other',documentId:'invoice'},{id:'s',estimateId:estimate,documentId:'other'}])assert.equal(estimateInvoices(estimate,[doc],[sale]).length,0);
});
test('same amount, shared project/calendar and conflicting references cannot hide another job',()=>{
 assert.equal(estimateInvoices('other',[invoice]).length,0);
 assert.equal(estimateInvoices(estimate,[{...invoice,estimateId:'',calendarEventId:'shared',projectId:'shared'}]).length,0);
 assert.equal(estimateInvoices(estimate,[{...invoice,snapshot:{estimateId:'other'}}]).length,0);
 assert.equal(estimateInvoices(estimate,[invoice],[{documentId:'invoice',estimateId:'other'}]).length,0);
});
test('void/cancelled/revised invoices remain issuance history; revisions preserve identity',()=>{
 for(const status of ['active','void','cancelled','revised','duplicate'])assert.equal(estimateInvoices(estimate,[{...invoice,status}]).length,1);
 assert.equal(estimateInvoices(estimate,[{...invoice,status:'revised'}, {...invoice,documentId:'revision',revisedFromDocumentId:'invoice'}]).length,2);
 const data={documents:[invoice],sales:[{id:'s',documentId:'invoice',estimateId:estimate}],payments:[{saleId:'s',amount:112376}]},before=JSON.stringify(data);
 for(let i=0;i<3;i++)estimateInvoices(estimate,data.documents,data.sales);
 assert.equal(JSON.stringify(data),before);
});
