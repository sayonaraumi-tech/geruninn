// Real browser UI and real Firestore emulator. Only Authentication and PDF rendering are test adapters.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const root=path.join(__dirname,'..');
const driver=`window.createTsukinowaFirebaseDriver=async()=>{
 const a=await import('/sdk/firebase-app.js'),f=await import('/sdk/firebase-firestore.js');let db,cb;
 return {initialize:async()=>{},observeAuth:next=>{cb=next;next(null);return()=>{}},claims:async u=>u.claims,
 signIn:async email=>{const role=email.startsWith('admin')?'admin':'staff';db=f.getFirestore(a.initializeApp({projectId:'demo-tsukinowa'},crypto.randomUUID()));f.connectFirestoreEmulator(db,'127.0.0.1',8080,{mockUserToken:{sub:'ui-'+role,role,companyId:'tsukinowa'}});await cb({uid:'ui-'+role,email,claims:{role,companyId:'tsukinowa'}})},signOut:async()=>cb(null),
 listen:(p,m,next,error)=>f.onSnapshot(m?f.collection(db,p):f.doc(db,p),{includeMetadataChanges:true},s=>next(m?s.docs.map(d=>({id:d.id,...d.data()})):s.exists()?{id:s.id,...s.data()}:null,{fromCache:s.metadata.fromCache}),error),
 list:async p=>(await f.getDocsFromServer(f.collection(db,p))).docs.map(d=>({id:d.id,...d.data()})),
 transaction:fn=>f.runTransaction(db,tx=>fn({get:async p=>{const s=await tx.get(f.doc(db,p));return s.exists()?s.data():null},set:(p,v)=>tx.set(f.doc(db,p),v)})),timestamp:f.serverTimestamp,
 digest:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')};};`;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;try{
 if(pathname==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'test',projectId:'demo-tsukinowa',authDomain:'test',appId:'test'}}));}
 if(pathname==='/js/firebase-driver.js'){res.setHeader('Content-Type','text/javascript');return res.end(driver);}
 if(pathname.startsWith('/sdk/')){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'node_modules/firebase',path.basename(pathname)),'utf8').replaceAll('https://www.gstatic.com/firebasejs/12.19.0/','/sdk/'));}
 const file=path.join(root,pathname==='/'?'index.html':pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end();}});
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});await env.clearFirestore();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),errors=[];
 try{
 async function device(role,width){const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('2026-10-01'):d.type()==='confirm'?d.accept():d.dismiss());await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill(role+'@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await p.getByRole('button',{name:'閉じる',exact:true}).click();return p;}
 const phone=await device('staff',390),desktop=await device('admin',1280);
 await phone.evaluate(()=>{bizSwitchPage('chohyo');setDocType('estimate');document.getElementById('customerName').value='スマホ見積';document.getElementById('invoiceDate').value='2026-09-20';items=[{content:'施工',qty:1,unit:'式',price:90909.09,taxable:true}];recalc();saveConfirmedHistory();});
 await desktop.waitForFunction(()=>bizState.estimates.length===1);assert.equal(await desktop.evaluate(()=>bizState.sales.length),0);
 const estimateId=await desktop.evaluate(()=>bizState.estimates[0].id);await desktop.evaluate(id=>bizAcceptEstimate(id,false),estimateId);await phone.waitForFunction(()=>bizState.estimates[0]?.status==='受注');
 await desktop.evaluate(id=>bizConvertEstimateRecordToInvoice(id),estimateId);await desktop.evaluate(()=>saveConfirmedHistory());await phone.waitForFunction(()=>bizState.sales.length===1);
 const invoiceId=await phone.evaluate(()=>bizState.sales[0].documentId);
 await desktop.evaluate(()=>{window.pdfSaves=0;window.html2pdf=()=>{const canvas=document.createElement('canvas');canvas.width=210;canvas.height=297;const pdf={internal:{getNumberOfPages:()=>1},deletePage(){},addPage(){},addImage(){},save(){window.pdfSaves++}};const worker={set(){return worker},from(){return worker},toCanvas(){return worker},toPdf(){return worker},get:key=>Promise.resolve(key==='canvas'?canvas:pdf)};return worker;};});
 for(let i=0;i<3;i++){await desktop.evaluate(id=>redownloadSavedDoc(loadConfirmedHistory().findIndex(s=>s.documentId===id)),invoiceId);await desktop.waitForFunction(n=>window.pdfSaves===n,i+1);await desktop.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);}
 assert.equal(await desktop.evaluate(()=>bizState.sales.length),1);
 for(const amount of [50000,20000]){await phone.evaluate(amount=>{selectSaleForPayment(bizState.sales[0].id);document.getElementById('receiptPaymentDate').value='2026-09-22';document.getElementById('receiptTotal').value=amount;recalc();saveConfirmedHistory();},amount);await phone.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);}
 await desktop.waitForFunction(()=>bizState.payments.length===2);assert.deepEqual(await desktop.evaluate(()=>[bizState.sales[0].amount,bizPaid(bizState.sales[0]),bizOutstanding(bizState.sales[0])]),[100000,70000,30000]);
 await phone.context().setOffline(true);await phone.evaluate(()=>{selectSaleForPayment(bizState.sales[0].id);document.getElementById('receiptPaymentDate').value='2026-09-22';document.getElementById('receiptTotal').value=1000;saveConfirmedHistory();});assert.equal(await phone.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue().length),1);await phone.context().setOffline(false);await desktop.waitForFunction(()=>bizState.payments.length===3);
 // Formal originals cannot be overwritten; admin creates a revision through the saved-doc UI.
 await desktop.evaluate(()=>bizSwitchPage('savedDocs'));
 await desktop.locator('#allSavedDocsList').getByRole('button',{name:'訂正版を作成',exact:true}).first().waitFor();
 await desktop.evaluate(id=>manageFormalDocument(loadConfirmedHistory().findIndex(x=>x.documentId===id),'revision'),invoiceId);
 await desktop.locator('#customerName').fill('管理者訂正');await desktop.evaluate(()=>{document.getElementById('customerCompany').value='法人テスト';document.getElementById('customerAddress').value='東京都';});
 await desktop.getByRole('button',{name:'正式保存',exact:true}).click();
 await phone.waitForFunction(id=>loadConfirmedHistory().some(d=>d.documentId===id&&d.documentStatus==='revised'),invoiceId);
 assert.equal(await desktop.evaluate(()=>bizState.sales.length),1);assert.equal(await desktop.evaluate(()=>bizState.sales[0].customer),'管理者訂正');
 assert.equal(await desktop.evaluate(()=>bizOutstanding(bizState.sales[0])),29000);
 await phone.evaluate(()=>bizSwitchPage('savedDocs'));assert.equal(await phone.getByRole('button',{name:'訂正版を作成',exact:true}).count(),0);assert((await phone.locator('#allSavedDocsList').innerText()).includes('訂正済'));
 await phone.evaluate(id=>{applyFormState(loadConfirmedHistory().find(s=>s.documentId===id));document.getElementById('customerName').value='古い編集';saveConfirmedHistory();},invoiceId);
 assert.equal(await phone.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue().length),0);

 // Phase three: actual accounting controls and all six export paths.
 await desktop.evaluate(()=>{bizSwitchPage('expenses');document.getElementById('expDate').value='2026-10-02';document.getElementById('expCategory').value='交通費';document.getElementById('expMethod').value='現金';document.getElementById('expAmount').value='10000';document.getElementById('expVendor').value='交通テスト';return addExpense();});
 await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().expenses.length===1);assert.equal(await desktop.evaluate(()=>TsukinowaAccountingUI.getData().cashLedger.filter(x=>x.linkedExpenseId).length),1);
 await desktop.evaluate(()=>{bizSwitchPage('suppliers');document.getElementById('supplierName').value='材料商';document.getElementById('supplierOpeningDate').value='2026-10-01';document.getElementById('supplierOpening').value='0';return accountingSaveSupplier();});
 await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().suppliers.length===1);
 for(const [date,type,amount] of [['2026-10-05','prepayment',1000000],['2026-10-20','prepayment',1000000],['2026-10-31','monthlyInvoice',1438620]]){await desktop.evaluate(({date,type,amount})=>{document.getElementById('supplierSelect').value=TsukinowaAccountingUI.getData().suppliers[0].id;document.getElementById('supplierTxnDate').value=date;document.getElementById('supplierTxnType').value=type;document.getElementById('supplierAmount').value=amount;document.getElementById('supplierDescription').value='材料仕入';document.getElementById('supplierInvoiceMonth').value='2026-10';return accountingSaveSupplierTransaction();},{date,type,amount});await desktop.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);}
 await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().suppliers[0].currentBalance===561380);assert((await desktop.locator('#supplierRows').innerText()).includes('561,380'));
 await desktop.screenshot({path:path.join(root,'../accounting-suppliers.png')});
 await desktop.evaluate(()=>bizSwitchPage('bank'));await desktop.locator('#bankFile').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from('日付,摘要,入金,出金,取引ID\n2026/10/06,管理者訂正,5000,,ui-bank-1\n')});
 for(let i=0;i<2;i++){await desktop.evaluate(()=>importBankCsv());await desktop.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);}
 assert.equal(await desktop.evaluate(()=>TsukinowaAccountingUI.getData().bankTransactions.length),1);
 await desktop.evaluate(()=>{const b=TsukinowaAccountingUI.getData().bankTransactions[0];accountingConfirmBank(b.id,{targetType:'sale',targetId:bizState.sales[0].id,paymentId:''});});
 await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions[0].status==='照合済');assert.equal(await desktop.evaluate(()=>bizOutstanding(bizState.sales[0])),24000);
 await desktop.evaluate(()=>{document.getElementById('monthlyMonth').value='2026-10';bizSwitchPage('monthly');});assert.equal(await desktop.locator('#mPayments').textContent(),'¥5,000');assert.equal(await desktop.locator('#mExpenses').textContent(),'¥1,448,620');
 for(const kind of ['monthly','expenses','sales','receivables','suppliers','bank']){const pending=desktop.waitForEvent('download');await desktop.evaluate(k=>accountingExport(k),kind);const download=await pending,bytes=fs.readFileSync(await download.path());assert.equal(bytes.subarray(0,3).toString('hex'),'efbbbf');}
 const backupDownload=desktop.waitForEvent('download');await desktop.evaluate(()=>exportBackup());const accountingBackup=JSON.parse(fs.readFileSync(await (await backupDownload).path(),'utf8'));assert(accountingBackup.records.suppliers.length===1);assert(accountingBackup.records.cashLedger.length>0);
 await phone.evaluate(()=>bizSwitchPage('bank'));assert(!(await phone.locator('#pageBank').isVisible()));await phone.evaluate(()=>bizSwitchPage('suppliers'));assert(!(await phone.locator('#pageSuppliers').isVisible()));
 await desktop.screenshot({path:path.join(root,'../accounting-monthly.png')});
 console.log('PASS accounting UI: expense + cash, supplier 561380 balance, duplicate CSV, bank match, monthly date totals, staff navigation guards and 6 UTF-8 BOM exports');
 assert.deepEqual(errors,[]);await phone.screenshot({path:path.join(root,'../business-mobile.png')});await desktop.screenshot({path:path.join(root,'../business-desktop.png')});console.log('PASS actual 390px/1280px UI: realtime estimate/acceptance, invoice, 3 PDF downloads, 2 partial receipts, offline queue recovery, conflict preservation');
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
