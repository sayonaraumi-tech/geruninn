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
 transaction:fn=>f.runTransaction(db,tx=>fn({get:async p=>{const s=await tx.get(f.doc(db,p));return s.exists()?s.data():null},set:(p,v)=>tx.set(f.doc(db,p),v),delete:p=>tx.delete(f.doc(db,p))})),timestamp:f.serverTimestamp,
 digest:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')};};`;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;try{
 if(pathname==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'test',projectId:'demo-tsukinowa',authDomain:'test',appId:'test'}}));}
 if(pathname==='/js/firebase-driver.js'){res.setHeader('Content-Type','text/javascript');return res.end(driver);}
 if(pathname.startsWith('/sdk/')){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'node_modules/firebase',path.basename(pathname)),'utf8').replaceAll('https://www.gstatic.com/firebasejs/12.19.0/','/sdk/'));}
 const file=path.join(root,pathname==='/'?'index.html':pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end();}});
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('isolated localhost emulator required');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});await env.clearFirestore();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),errors=[];
 try{
 async function device(role,width){const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('2026-10-01'):d.type()==='confirm'?d.accept():d.dismiss());await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill(role+'@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await p.getByRole('button',{name:'閉じる',exact:true}).click();return p;}

 for(const width of [390,1280])for(const issued of ['2026-09-30','2026-10-23']){
  await env.clearFirestore();const p=await device('admin',width);
  await p.evaluate(issued=>{bizSwitchPage('chohyo');setDocType('invoice');customerName.value='（株）益田工房東京';invoiceDate.value=issued;salesDate.value=issued;items=[{content:'クロス張替',qty:1,price:79500/1.1,taxable:true}];recalc();saveConfirmedHistory();},issued);
  await p.waitForFunction(()=>bizState.sales.length===1&&TsukinowaBusinessUI.getSync().getQueue().length===0);
  await p.evaluate(async()=>{const sync=TsukinowaBusinessUI.getSync();sync.enqueue({type:'payment',operationId:'confirmed-'+innerWidth,paymentId:'masuda',saleId:bizState.sales[0].id,manualConfirmed:true,amount:79500,paymentDate:'2026-10-23',method:'銀行振込',memo:'領収書から登録'});await sync.flush();});
  await p.waitForFunction(()=>bizState.payments.length===1);
  await p.evaluate(()=>{bizSwitchPage('chohyo');setDocType('receipt');receiptSale.value=bizState.sales[0].id;customerName.value='（株）益田工房東京';invoiceDate.value='2026-10-23';paymentMethod.value='銀行振込';receiptTotal.value=79500;tadashi.value='クロス張替';recalc();saveConfirmedHistory();});
  await p.waitForFunction(()=>loadConfirmedHistory().filter(d=>d.docType==='receipt').length===1&&TsukinowaBusinessUI.getSync().getQueue().length===0);
  assert.equal(await p.evaluate(()=>bizState.sales.length),1);assert.equal(await p.evaluate(()=>bizState.payments.length),1);
  await p.evaluate(()=>bizSwitchPage('bank'));await p.locator('#bankFile').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from('日付,摘要,入金,出金,取引ID\n2026-11-01,益田工房東京,79500,,masuda-bank')});
  for(let i=0;i<2;i++){await p.evaluate(()=>importBankCsv());await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);}
  await p.evaluate(()=>{const b=TsukinowaAccountingUI.getData().bankTransactions[0];accountingConfirmBank(b.id,{targetType:'sale',targetId:bizState.sales[0].id,paymentId:'masuda'});});
  await p.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions[0]?.status==='照合済');
  assert.deepEqual(await p.evaluate(()=>[bizState.sales.length,bizState.payments.length,loadConfirmedHistory().length,bizState.payments[0].paymentDate,bizState.payments[0].bankTransactionDate]),[1,1,2,'2026-10-23','2026-11-01']);
  await p.evaluate(()=>{homePeriodMode.value='month';homeMonth.value='2026-10';bizSwitchPage('dashboard');});
  assert.equal(await p.locator('#kpiSales').innerText(),issued==='2026-09-30'?'¥0':'¥79,500');assert.equal(await p.locator('#kpiPayments').innerText(),'¥79,500');assert.equal(await p.locator('#kpiReceivable').innerText(),'¥0');assert.equal(await p.locator('#homeLedger tbody tr').count(),1);assert.match(await p.locator('#homeLedger').innerText(),/益田工房東京/);
  await p.locator('#homeMonth').fill('2026-09');await p.locator('#homeMonth').dispatchEvent('change');assert.equal(await p.locator('#kpiSales').innerText(),issued==='2026-09-30'?'¥79,500':'¥0');assert.equal(await p.locator('#kpiPayments').innerText(),'¥0');assert.equal(await p.locator('#kpiReceivable').innerText(),issued==='2026-09-30'?'¥79,500':'¥0');
  await p.locator('#homeMonth').fill('2026-11');await p.locator('#homeMonth').dispatchEvent('change');assert.equal(await p.locator('#kpiPayments').innerText(),'¥0');
  const frozen=await p.evaluate(async()=>{const c=TsukinowaBusinessUI.getClient();return JSON.stringify(await Promise.all(['documents','sales','payments','calendarLinks','auditLogs'].map(n=>c.listRecords(n))));});
  await p.reload();await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill('admin@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>TsukinowaBusinessUI.getSync()?.isReady());await p.waitForTimeout(300);
  assert.equal(await p.evaluate(async()=>{const c=TsukinowaBusinessUI.getClient();return JSON.stringify(await Promise.all(['documents','sales','payments','calendarLinks','auditLogs'].map(n=>c.listRecords(n))));}),frozen);
  await p.context().close();console.log('PASS emulator '+width+'px '+issued+': invoice -> confirmed payment -> receipt -> bank CSV replay -> cross-month KPI, history read-only');
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
