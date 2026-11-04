const assert=require('node:assert/strict');
module.exports=async(page)=>{
 const id=await page.evaluate(()=>bizCurrentEstimateId);
 await page.evaluate(()=>saveConfirmedHistory());
 await page.waitForFunction(id=>bizEstimateInvoices(id).length===1,id);
 const before=await page.evaluate(()=>JSON.stringify([...testRecords]));
 await page.evaluate(()=>{bizSwitchPage('estimates');renderEstimates();});
 const customer=await page.evaluate(id=>bizState.estimates.find(e=>e.id===id).customer,id);
 assert.equal(await page.locator('#estimateRows').getByText(customer,{exact:true}).count(),0);
 await page.locator('#estimateShowIssued').check();
 const row=page.locator('#estimateRows tr').filter({hasText:customer});
 assert.match(await row.innerText(),/請求書発行済/);
 assert.equal(await row.getByRole('button',{name:'請求書へ',exact:true}).count(),0);
 assert.equal(await row.getByRole('button',{name:'入金',exact:true}).count(),0);
 await row.getByRole('button',{name:'開く',exact:true}).click();
 assert.equal(await page.locator('#customerName').isDisabled(),true);
 await page.evaluate(async id=>{
  bizConvertEstimateRecordToInvoice(id);bizRegisterEstimatePayment(id);await bizAcceptEstimate(id);
  await TsukinowaBusinessUI.getSync().reload();
 },id);
 await page.evaluate(()=>{bizSwitchPage('estimates');document.getElementById('estimateShowIssued').checked=false;renderEstimates();});
 assert.equal(await page.locator('#estimateRows').getByText(customer,{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>JSON.stringify([...testRecords])),before,'history browsing, hydration and stale commands cannot mutate accounting');
 for(const stage of ['partial','paid']){
  await page.evaluate(async({id,stage})=>{
   const sale=bizState.sales.find(s=>s.estimateId===id),amount=stage==='partial'?500:bizOutstanding(sale);
   await testService.execute({type:'payment',operationId:crypto.randomUUID(),paymentId:crypto.randomUUID(),saleId:sale.id,amount,paymentDate:'2026-10-21',method:'銀行振込',manualConfirmed:true});
   await TsukinowaBusinessUI.getSync().reload();renderEstimates();
  },{id,stage});
  assert.equal(await page.locator('#estimateRows').getByText(customer,{exact:true}).count(),0,stage);
 }
 // Same customer/amount/calendar with missing or different estimate identity
 // must stay visible even while the original is paid in full.
 await page.evaluate(async id=>{
  const original=testRecords.get('companies/tsukinowa/estimates/'+id);
  for(const suffix of ['legacy','other-job']){
   const clone=JSON.parse(JSON.stringify(original));clone.payload.id=id+'-'+suffix;
   testRecords.set('companies/tsukinowa/estimates/'+clone.payload.id,clone);
  }
  await TsukinowaBusinessUI.getSync().reload();renderEstimates();
 },id);
 assert.equal(await page.locator('#estimateRows').getByText(customer,{exact:true}).count(),2);
 await page.locator('#estimateShowIssued').check();
 assert.equal(await page.locator('#estimateRows').getByText(customer,{exact:true}).count(),3);
 await page.locator('#estimateShowIssued').uncheck();
 await page.evaluate(async id=>{
  const sale=bizState.sales.find(s=>s.estimateId===id);
  const doc=testRecords.get('companies/tsukinowa/documents/'+sale.documentId).payload;
  // Legacy cancelled invoice: only its exact sale carries estimate identity.
  delete doc.estimateId;delete doc.snapshot.estimateId;doc.status='void';
  testRecords.get('companies/tsukinowa/sales/'+sale.id).payload.documentStatus='void';
  await TsukinowaBusinessUI.getSync().reload();renderEstimates();
 },id);
 assert.equal(await page.evaluate(id=>bizState.sales.some(s=>s.estimateId===id),id),false);
 assert.equal(await page.evaluate(id=>bizEstimateInvoices(id).length,id),1);
 assert.equal(await page.locator('#estimateRows').getByText(customer,{exact:true}).count(),2);
 console.log('PASS issued estimate history: unpaid/partial/paid, equal-amount jobs, missing references, original read-only, stale actions, reload and cancelled legacy sale identity');
};
