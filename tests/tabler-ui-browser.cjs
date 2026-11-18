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
 const file=path.join(root,pathname==='/'?'index.html':pathname);res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end();}});
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});await env.clearFirestore();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),errors=[];
 const output=process.env.PREVIEW_DIR; if(output)fs.mkdirSync(output,{recursive:true});
 try {
  for(const width of [1280,390]){
   await env.clearFirestore();
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>cloudStatus.textContent==='未ログイン');
   await p.evaluate(()=>bizSwitchPage('calendar'));await p.getByRole('button',{name:'＋ 予定登録',exact:true}).click();assert(await p.locator('#cloudDialog').isVisible());
   await p.locator('#cloudEmail').fill('admin@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>coreSyncStatus.textContent==='クラウド同期済');await p.locator('#cloudDialog').press('Escape');
   await p.locator('#calendarMonth').fill('2028-02');await p.locator('#calendarMonth').dispatchEvent('change');assert.equal(await p.locator('.tabler-day').count(),42);assert.equal(await p.locator('.tabler-day:not(.outside)').count(),29);
   const target='2028-02-29';await p.getByRole('button',{name:target+' に予定を登録',exact:true}).click();
   const form=p.locator('.tabler-schedule-dialog');await form.locator('[name=title]').fill('検証用 現金 12000 <img src=x onerror=alert(1)> '+width);await form.locator('[name=memo]').fill('合成日程。現金という文字は受領証拠ではありません。');await form.getByRole('button',{name:'予定を登録',exact:true}).click();
   await p.waitForFunction(w=>bizState.calendar.some(e=>e.title.endsWith(String(w))),width);assert.equal(await p.evaluate(()=>bizState.sales.length),0);assert.equal(await p.evaluate(()=>bizState.payments.length),0);assert.equal(await p.locator('#tablerMonthGrid img').count(),0);
   const event=p.locator('.tabler-event').filter({hasText:String(width)});await event.click();assert(await p.locator('#bizEventModal').isVisible());await p.evaluate(()=>closeEventModal());
   await p.getByRole('button',{name:'翌月',exact:true}).click();assert.equal(await p.locator('#calendarMonth').inputValue(),'2028-03');await p.getByRole('button',{name:'前月',exact:true}).click();assert.equal(await p.locator('#calendarMonth').inputValue(),'2028-02');
   // Save a real estimate and invoice through the original authority, then an expense.
   await p.evaluate(w=>{bizSwitchPage('chohyo');setDocType('invoice');customerName.value='検証用取引先 '+w;invoiceDate.value='2028-02-29';salesDate.value='2028-02-29';items=[{content:'クロス張替',qty:10,price:1000,unit:'m',taxable:true}];recalc();saveConfirmedHistory();},width);
   await p.waitForFunction(w=>bizState.sales.some(s=>s.customer.endsWith(String(w))),width);
   await p.evaluate(()=>{bizSwitchPage('expenses');expDate.value='2028-02-29';expCategory.value='消耗品費';expMethod.value='現金';expAmount.value='500';expVendor.value='検証用店舗';expMemo.value='UI検証';return addExpense();});
   await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);
   await p.evaluate(()=>{homeMonth.value='2028-02';salesMonth.value='2028-02';receivableAsOf.value='2028-02-29';expenseMonth.value='2028-02';bizSwitchPage('dashboard');});
   const baseline=await p.evaluate(()=>JSON.stringify(TsukinowaBusinessUI.getSync().getRows()));const inventory={};
   for(const route of ['dashboard','calendar','estimates','chohyo','savedDocs','sales','expenses','bank','settings']){
    await p.locator('#bizNav button[data-page="'+route+'"]').click();assert.equal(await p.locator('#tablerCrumb').textContent(),await p.locator('#bizNav button.active').textContent());
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    inventory[route]=await p.locator('.app-page.active button,.app-page.active input,.app-page.active select,.app-page.active summary').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,label:e.textContent.trim().slice(0,100),type:e.type||'',disabled:e.disabled||false,hidden:!e.getClientRects().length,handler:e.getAttribute('onclick')||e.getAttribute('onchange')||''})));
    await p.evaluate(()=>scrollTo(0,0));if(output)await p.screenshot({path:path.join(output,route+'-emulator-'+width+'.png'),fullPage:true});
   }
   await p.evaluate(()=>bizSwitchPage('sales'));await p.getByRole('button',{name:'請求書で売上登録',exact:true}).click();assert.equal(await p.locator('.app-page.active').getAttribute('id'),'pageChohyo');
   for(const name of ['gold','green','purple','dark','blue']){await p.locator('[data-tabler-theme='+name+']').click();assert.equal(await p.locator('[data-tabler-theme='+name+']').getAttribute('aria-pressed'),'true');}
   assert.equal(await p.evaluate(()=>JSON.stringify(TsukinowaBusinessUI.getSync().getRows())),baseline,'navigation and themes cannot write financial records');
   if(output)fs.writeFileSync(path.join(output,'control-inventory-'+width+'.json'),JSON.stringify(inventory,null,2));
   await context.close();console.log('PASS v13 '+width+': real emulator calendar creation, leap day, cash text non-posting, XSS, detail, month controls, nine routes, five themes, no financial mutation, screenshots and control inventory');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
