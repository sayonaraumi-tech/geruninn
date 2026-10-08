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
 for(const width of [390,1280]){
 await env.clearFirestore();const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());await page.route('https://**/*',r=>r.fulfill({body:''}));await page.goto(base);await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');
 await page.locator('#bizCloudAccountButton').click();await page.locator('#cloudEmail').fill('admin@example.com');await page.locator('#cloudPassword').fill('password');await page.locator('#cloudLogin').click();await page.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.evaluate(async()=>{
  const service=TsukinowaBusinessUI.getSync().service,execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()}),snapshot=id=>({documentId:id,docType:'invoice',customerName:'顧客,"CSV"',invoiceDate:'2026-10-01',salesDate:'2026-10-01',items:[{content:'工事',qty:1,price:1000}],paymentMethod:'銀行振込'});
  await execute({type:'saveDocument',snapshot:snapshot('active'),expectedRevision:0});
  await execute({type:'saveDocument',snapshot:snapshot('old'),expectedRevision:0});
  await execute({type:'saveDocument',snapshot:snapshot('replacement'),revisedFromDocumentId:'old',expectedParentRevision:1,reason:'訂正',expectedRevision:0});
  for(const state of ['void','duplicate','cancelled']){await execute({type:'saveDocument',snapshot:snapshot(state),expectedRevision:0});await execute({type:'documentStatus',documentId:state,status:state,reason:'不要',duplicateOfDocumentId:'active',expectedRevision:1});}
  await execute({type:'saveDocument',snapshot:{...snapshot('september'),salesDate:'2026-09-20',invoiceDate:'2026-09-20'},expectedRevision:0});
  bizSwitchPage('sales');document.getElementById('salesMonth').value='2026-10';document.getElementById('receivableAsOf').value='2026-10-08';renderSales();
 });
 await page.waitForFunction(()=>bizState.sales.length===3);
 assert.equal(await page.locator('#accountingPayments').count(),0);assert(!await page.locator('#pageSales').textContent().then(t=>t.includes('入金確認・訂正')));
 // Use the real payment form twice; same date and amount represent two real confirmed receipts.
 for(let n=1;n<=2;n++){
  await page.evaluate(()=>selectSaleForPayment('sale_active'));await page.locator('#paymentDate').fill('2026-10-02');await page.locator('#paymentAmount').fill('200');await page.locator('#paymentType').selectOption('銀行振込');await page.locator('#paymentSubmit').click();await page.waitForFunction(n=>bizState.payments.length===n,n);
 }
 const {doc,getDoc,setDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async c=>{
  for(const [id,extra] of [['pending',{confirmation:'pending-bank'}],['cancel',{deletedAt:'2026-10-03'}],['duplicate',{status:'duplicate'}],['orphan',{saleId:'sale_void'}]])await setDoc(doc(c.firestore(),'companies/tsukinowa/payments/'+id),{schemaVersion:2,companyId:'tsukinowa',revision:1,payload:{id,paymentId:id,saleId:'sale_active',amount:200,paymentDate:'2026-10-02',confirmation:'bank-confirmed',...extra}});
 });
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().payments.length===6);
 const result=await page.evaluate(()=>{
  renderSales();renderDashboard();renderAllSavedDocs();
  const csv=kind=>TsukinowaAccounting.parseCSV(TsukinowaAccounting.csv(TsukinowaAccountingUI.exportRows(kind)).replace(/^\uFEFF/,''));
  const rs=csv('receivables'),ss=csv('sales'),unmoney=s=>String(Number(s.replace(/[¥￥,\s]/g,''))),table=id=>[...document.querySelectorAll('#'+id+(id==='salesRows'?' tr':' tbody tr'))].map(r=>[...r.cells].map(c=>c.textContent));
  const receivablePage=table('receivableRows').map(r=>r.map((c,i)=>[3,4,5].includes(i)?unmoney(c):c));
  const salesPage=table('salesRows').map(r=>r.slice(0,8).map((c,i)=>[3,5,6].includes(i)?unmoney(c):c));
  return {rs,ss,receivablePage,salesPage,balance:TsukinowaBusinessUI.invoiceBalance('active'),home:document.getElementById('kpiReceivable').textContent};
 });
 for(const [kind,label,expected] of [['receivables','未収金CSV',result.rs],['sales','売上・入金CSV',result.ss]]){const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:label,exact:true}).click()]);const file=path.join(root,'../'+kind+'-'+width+'.csv');await download.saveAs(file);const parsed=require('../js/accounting').parseCSV(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));assert.deepEqual(parsed,expected);}
 assert.deepEqual(result.rs.slice(1).map(r=>r.slice(1)),result.receivablePage);
 assert.deepEqual(result.ss.slice(1).map(r=>r.slice(1,9)),result.salesPage);
 assert.equal(result.ss.length,3);assert.equal(result.rs.length,4);
 assert.equal(result.balance.paidAmount,400);assert.equal(result.balance.outstandingAmount,700);
 assert.equal(result.home,'¥2,900');assert.equal(result.rs.find(r=>r[0]==='sale_active')[5],'400');
 // Date and month filters must carry through to exports.
 await page.evaluate(()=>{document.getElementById('salesMonth').value='2026-09';document.getElementById('receivableAsOf').value='2026-10-01';renderSales();});
 assert.equal(await page.locator('#salesRows tr').count(),1);assert.equal(await page.evaluate(()=>TsukinowaAccountingUI.exportRows('sales')[1][0]),'sale_september');assert.equal(await page.evaluate(()=>TsukinowaAccountingUI.exportRows('receivables').find(r=>r[0]==='sale_active')[5]),0);
 await page.evaluate(()=>bizSwitchPage('savedDocs'));
 for(const id of ['active','replacement','september'])assert.equal(await page.locator(`#allSavedDocsList [data-document-id="${id}"]`).getByRole('button',{name:'履歴から削除',exact:true}).count(),0);
 await page.screenshot({path:path.join(root,'../cleanup-before-'+width+'.png')});
 const before=await env.withSecurityRulesDisabled(async c=>{const {getDocs,collection}=require('firebase/firestore');const out={};for(const n of ['sales','payments','bankTransactions','calendarLinks'])out[n]=(await getDocs(collection(c.firestore(),'companies/tsukinowa/'+n))).docs.map(d=>({id:d.id,...d.data()}));return out;});
 for(const id of ['old','void','duplicate','cancelled']){
  await page.locator(`#allSavedDocsList [data-document-id="${id}"]`).getByRole('button',{name:'履歴から削除',exact:true}).click();await page.waitForFunction(id=>!loadConfirmedHistory().some(d=>d.documentId===id),id);
  assert.equal(await page.locator(`#allSavedDocsList [data-document-id="${id}"]`).count(),0);
 }
 await page.evaluate(()=>{setDocType('invoice');renderConfirmedHistory();});assert.equal(await page.locator('#confirmedHistoryList').getByRole('button',{name:'履歴から削除',exact:true}).count(),0);
 const after=await env.withSecurityRulesDisabled(async c=>{const {getDocs,collection}=require('firebase/firestore');const out={};for(const n of ['sales','payments','bankTransactions','calendarLinks'])out[n]=(await getDocs(collection(c.firestore(),'companies/tsukinowa/'+n))).docs.map(d=>({id:d.id,...d.data()}));const audits=(await getDocs(collection(c.firestore(),'companies/tsukinowa/auditLogs'))).docs.map(d=>d.data());assert.equal(audits.filter(a=>a.after?.deleteReason==='履歴から削除').length,4);return out;});assert.deepEqual(after,before);
 await page.screenshot({path:path.join(root,'../cleanup-'+width+'.png')});await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS cleanup real Firestore 390/1280: real manual bank receipts, pending/cancelled/duplicate/orphan exclusion, parsed CSV row parity, filters, all four archives, active protected, both histories, audit and related records retained');
 }finally{await browser.close();await env.cleanup();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
