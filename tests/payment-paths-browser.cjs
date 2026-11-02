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
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});await env.clearFirestore();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),errors=[];
 try{
 async function device(role,width){const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('2026-10-01'):d.type()==='confirm'?d.accept():d.dismiss());await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill(role+'@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await p.getByRole('button',{name:'閉じる',exact:true}).click();return p;}

 for(const width of [1280,390]){
 await env.clearFirestore();const page=await device('admin',width);
 await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z'));
 const scenario=require('./payment-path-scenarios.cjs').toString();
 await page.evaluate(async source=>{
  const client=TsukinowaBusinessUI.getClient(),service=TsukinowaBusiness.createService(client);
  window.pathRun=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});
  const assert=Object.assign(value=>{if(!value)throw Error('Assertion failed');},{equal:(a,b)=>{if(a!==b)throw Error('Expected '+b+', got '+a);},rejects:async(p,re)=>{let error;try{await p;}catch(e){error=e;}if(!error||!re.test(error.message))throw Error('Expected rejection '+re+', got '+error);}});
  await eval('('+source+')')({run:pathRun,list:n=>client.listRecords(n),A:TsukinowaAccounting,assert});
 },scenario);

 // Released review UI is read-only on both viewport sizes, with real Rules behind it.
 await page.evaluate(async()=>{
  const client=TsukinowaBusinessUI.getClient();
  const payload={bankTxnId:'review-duplicate',bankAccount:'メイン口座',bankTransactionDate:'2026-10-20',description:'review-only',incoming:123,outgoing:0,amount:123,balance:999,status:'未照合',deletedAt:null};
  await client.put('bankTransactions','review-duplicate',payload,{operationId:crypto.randomUUID()});
  await client.put('bankTransactions','review-keeper',{...payload,bankTxnId:'review-keeper',bankAccount:'GMO あおぞら'},{operationId:crypto.randomUUID()});
  await pathRun({type:'saveBankRule',ruleType:'bankAccountAlias',key:'メイン口座',canonical:'GMO あおぞら'});
  const before=JSON.stringify(await client.listRecords('bankTransactions'));
  for(const type of ['bankCancelDuplicate','bankRestoreDuplicate']){
   let error;try{await pathRun({type,bankTxnId:'review-duplicate'});}catch(e){error=e;}
   if(!error?.message.includes('参照ロック'))throw Error('Historical mutation was not rejected');
  }
  if(JSON.stringify(await client.listRecords('bankTransactions'))!==before)throw Error('Historical mutation changed bank records');
 });
 await page.waitForFunction(()=>document.querySelector('#bankDuplicateReview button')!==null);
 assert.equal(await page.locator('#bankDuplicateReview button').first().isDisabled(),true);
 assert.match(await page.locator('#bankDuplicateReview').innerText(),/review-duplicate.*review-keeper/);
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().expenses.length===13);
 await page.evaluate(()=>{bizSwitchPage('dashboard');homeMonth.value='2026-10';renderDashboard();});
 assert.equal(await page.locator('#kpiSales').innerText(),'110,000');assert.equal(await page.locator('#kpiPayments').innerText(),'110,000');
 const home=await page.locator('#homeLedger').innerText();assert.match(home,/支払済/);assert.match(home,/入金済/);assert.match(home,/立替未精算/);assert(!home.includes('精算済'));
 await page.screenshot({path:path.join(root,'../payment-path-home-'+width+'.png'),fullPage:true});if(width===390){await page.locator('#homeLedger .biz-table-wrap').evaluate(e=>e.scrollLeft=e.scrollWidth);await page.screenshot({path:path.join(root,'../payment-path-status-'+width+'.png'),fullPage:true});}
 await page.evaluate(async()=>{await pathRun({type:'bankUnmatch',bankTxnId:'path-card-bank',reason:'UI replay'});});
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().expenses.find(e=>e.id==='path-credit-a').bankTxnId===undefined);
 await page.evaluate(()=>bizSwitchPage('bank'));
 await page.evaluate(()=>accountingBankView('all'));const row=page.locator('#bankRows tr').filter({hasText:'VISA カード利用代金'}).filter({has:page.locator('input[data-card-bank="path-card-bank"]')});
 await row.locator('summary').click();await row.locator('input[value="path-credit-a"]').check();await row.locator('input[value="path-credit-b"]').check();await row.getByRole('button',{name:'選択支出の引落照合'}).click();
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions.find(b=>b.id==='path-card-bank').status==='照合済');
 assert.match(await page.locator('#bankRows').innerText(),/path-credit-a/);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(root,'../payment-path-bank-'+width+'.png'),fullPage:true});
 const exported=await page.evaluate(()=>TsukinowaAccounting.csv(TsukinowaAccounting.settlementExport(TsukinowaAccountingUI.getData(),TsukinowaAccounting.periodFilter({month:'2026-10'}))));assert.match(exported,/立替未精算/);assert.match(exported,/110000/);fs.writeFileSync(path.join(root,'../payment-path-'+width+'.csv'),exported);
 assert.deepEqual(errors,[]);console.log('PASS four payment paths '+width+'px: real emulator, HOME KPI/status/export, card selection and replay');await page.context().close();
 }
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
