// 保存帳票 → 入金登録 / 領収書: 売上・入金 and ホーム update at once (no reload, no second reconciliation) and no duplicate payment. Real Firestore emulator; only Authentication is a test adapter.
const openSavedActions=require('./saved-actions.cjs');
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
 for(const width of [1280,390]){
 await env.clearFirestore();const page=await device('admin',width);
 await page.clock.setFixedTime(new Date('2026-11-28T10:00:00+09:00'));
 const state=()=>page.evaluate(()=>({sales:kpiSales.textContent,payments:kpiPayments.textContent,receivable:kpiReceivable.textContent,difference:kpiDifference.textContent,register:[...document.querySelectorAll('#salesRows tr')].map(r=>[...r.cells].map(c=>c.textContent.trim()).join('|')),balance:document.querySelector('#ddHomeAnalytics [data-dd-balance="difference"]')?.textContent||null,income:document.querySelector('#ddHomeAnalytics [data-dd-balance="income"]')?.textContent||null,paid:document.querySelector('#ddSalesMetrics [data-dd-metric="paid"]')?.textContent||null}));
 const invoice=(name,price)=>page.evaluate(async({name,price})=>{bizSwitchPage('chohyo');setDocType('invoice');customerName.value=name;invoiceDate.value='2026-11-20';salesDate.value='2026-11-20';items=[{content:'クロス張替',qty:1,unit:'式',price}];recalc();saveConfirmedHistory();await TsukinowaBusinessUI.getSync().flush();},{name,price});
 await invoice('入金反映テスト',100000);await page.waitForFunction(()=>bizState.sales.length===1);
 await page.evaluate(()=>{bizSwitchPage('dashboard');homePeriodMode.value='month';homeMonth.value='2026-11';renderDashboard();bizSwitchPage('savedDocs');});
 const before=await state();assert.equal(before.payments,'0');assert.equal(before.receivable,'110,000');
 // 1) The 入金登録 button on a saved invoice reuses the existing payment form and registerPayment(); a double click registers once.
 await openSavedActions(page.locator('#allSavedDocsList'));await page.locator('#allSavedDocsList').getByRole('button',{name:'入金登録',exact:true}).click();
 await page.locator('#paymentDate').fill('2026-11-28');await page.locator('#paymentAmount').fill('40000');await page.locator('#paymentType').selectOption('銀行振込');
 await page.locator('#paymentSubmit').dblclick();
 await page.waitForFunction(()=>kpiPayments.textContent==='40,000');
 const afterPayment=await state();
 assert.equal(afterPayment.payments,'40,000','ホーム 入金 updates without reload');assert.equal(afterPayment.receivable,'70,000');assert.equal(afterPayment.difference,'40,000');
 assert.match(afterPayment.register.join('\n'),/入金反映テスト\|.*\|110,000\|40,000\|70,000\|2026-11-28\|.*一部入金/,'売上・入金 register updates without reload');
 if(width>800){assert.equal(afterPayment.balance,'40,000 円','月次収支比較 primary follows the same 収支差額');assert.equal(afterPayment.income,'40,000 円');assert.equal(afterPayment.paid,'40,000');}
 await page.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);
 assert.equal((await page.evaluate(()=>TsukinowaBusinessUI.getClient().listRecords('payments'))).filter(r=>!r.payload.deletedAt&&r.payload.amount>0).length,1,'one payment record, no duplicate');
 assert.equal(await page.evaluate(()=>bizState.sales.length),1,'no extra sale');
 await page.locator('#balanceClose').click();
 // 2) A receipt linked to a saved invoice (入金日 on the document) goes through the existing receipt path and is reflected at once.
 await invoice('領収反映テスト',50000);await page.waitForFunction(()=>bizState.sales.length===2);
 await page.evaluate(()=>{bizSwitchPage('chohyo');setDocType('receipt');receiptSale.value=bizState.sales.find(s=>s.customer==='領収反映テスト').id;customerName.value='領収反映テスト';invoiceDate.value='2026-11-28';paymentMethod.value='銀行振込';receiptTotal.value=30000;tadashi.value='クロス張替';recalc();saveConfirmedHistory();});
 await page.waitForFunction(()=>kpiPayments.textContent==='70,000');await page.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);
 const afterReceipt=await state();assert.equal(afterReceipt.receivable,'95,000');assert.match(afterReceipt.register.join('\n'),/領収反映テスト\|.*\|55,000\|30,000\|25,000\|2026-11-28\|/);
 if(width>800)assert.equal(afterReceipt.balance,'70,000 円');
 const payments=(await page.evaluate(()=>TsukinowaBusinessUI.getClient().listRecords('payments'))).filter(r=>!r.payload.deletedAt&&r.payload.amount>0);
 assert.equal(payments.length,2,'one payment per registration');assert.equal(new Set(payments.map(r=>r.payload.saleId)).size,2);
 assert.equal(await page.evaluate(()=>bizState.sales.length),2,'the receipt does not create a second sale');
 assert.equal(await page.evaluate(()=>location.href.includes('reload')),false);
 await page.context().close();console.log('PASS '+width+'px: 保存帳票 入金登録 and linked 領収書 update 売上・入金 and ホーム immediately, one payment each, no duplicate sale');
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await env.cleanup();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
