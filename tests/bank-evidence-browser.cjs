const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],remote=new Map(),posts=[],patches=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false,companyId:'tsukinowa',firebase:{}}}));await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({body:''}));await page.route('https://accounts.google.com/**',r=>r.fulfill({body:''}));
 await page.route('https://www.googleapis.com/**',async r=>{const req=r.request(),url=new URL(req.url()),id=url.pathname.split('/').at(-1);if(req.method()==='POST'){const body=req.postDataJSON();posts.push(body);if(remote.has(body.id))return r.fulfill({status:409,json:{error:{message:'duplicate'}}});remote.set(body.id,{...body,etag:'"1"'});return r.fulfill({json:remote.get(body.id)});}if(req.method()==='PATCH'){const body=req.postDataJSON();patches.push(body);remote.set(id,{...remote.get(id),...body});return r.fulfill({json:remote.get(id)});}return r.fulfill({json:remote.get(id)||{error:{message:'missing'}}});});
 // Keep the October fixture in its intended dashboard month, independent of today's date.
 await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z'));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForTimeout(300);
 await page.evaluate(async()=>{
  const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
  const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role:'admin',companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);
  window.testRecords=records;window.testClient=client;window.testService=TsukinowaBusiness.createService(client);bizGoogleAccessToken='';bizGoogleTokenExpiresAt=0;bizGoogleGrantedScopes=TSUKINOWA_GOOGLE_SCOPE;bizGoogleCalendarId='shared';bizGoogleCalendarsLoaded=true;
 });
 page.on('dialog',d=>d.accept());
 await page.evaluate(async()=>{
  const run=cmd=>testService.execute({...cmd,operationId:crypto.randomUUID()});
  await run({type:'migrateRecord',collection:'sales',id:'dynast',payload:{id:'dynast',salesDate:'2026-09-30',invoiceDate:'2026-09-30',dueDate:'2026-10-30',amount:1594900,customer:'dynast合同会社',content:'施工'}});
  await run({type:'saveBankRule',ruleType:'bankPartyAlias',key:'振込 ダイナスト（ド',customer:'dynast合同会社'});
  await run({type:'saveBankRule',ruleType:'bankAccountAlias',key:'メイン口座',canonical:'GMOあおぞら'});
 });
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().settings.length===2);
 await page.evaluate(()=>bizSwitchPage('bank'));
 const csv='取引日,摘要,入金,出金,残高\n2026-10-31,振込 ダイナスト（ド,1594900,,2000000\n2026-10-30,振込手数料,,100,405000\n2026-10-28,Visaデビット利用 AMAZON TID:46301325931956,,1172,612949';
 await page.locator('#bankAccountName').fill('GMOあおぞら');await page.locator('#bankFile').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.evaluate(()=>importBankCsv());
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions.length===3&&TsukinowaAccountingUI.getData().payments.length===1);
 await page.evaluate(()=>accountingBankView('all'));assert.equal(await page.locator('#bankRows tr').count(),3);assert.match(await page.locator('#bankRows').innerText(),/照合済/);assert(!((await page.locator('#bankRows').innerText()).includes('カード決済まとめ候補')));
 await page.locator('#bankAccountName').fill('メイン口座');await page.evaluate(()=>importBankCsv());await page.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);assert.equal(await page.evaluate(()=>TsukinowaAccountingUI.getData().bankTransactions.length),3);
 // Historical duplicate IDs are display-only grouped after reviewed account alias.
 await page.evaluate(async()=>{const b=TsukinowaAccountingUI.getData().bankTransactions.find(b=>b.outgoing===1172);await testService.execute({type:'migrateAccounting',collection:'bankTransactions',id:'legacy-duplicate',payload:{...b,bankTxnId:'legacy-duplicate',bankAccount:'メイン口座'},operationId:crypto.randomUUID()});});
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions.length===4);await page.evaluate(()=>accountingBankView('all'));assert.equal(await page.locator('#bankRows tr').count(),3);assert.match(await page.locator('#bankRows').innerText(),/原記録保持/);
 if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)){console.log(await page.evaluate(()=>[...document.querySelectorAll('#pageBank *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().width]).slice(0,20)));await page.screenshot({path:'../bank-overflow.png',fullPage:true});}assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const heights=await page.locator('#bankRows tr').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height));assert(Math.max(...heights)<350);
 await page.screenshot({path:path.join(root,'../bank-evidence-'+width+'.png'),fullPage:true});
 await page.locator('#bizNav [data-page="dashboard"]').click();await page.evaluate(()=>{document.getElementById('homeMonth').value='2026-10';renderDashboard();});assert.equal(await page.locator('#kpiSales').innerText(),'0');assert.equal(await page.locator('#kpiPayments').innerText(),'1,594,900');assert.equal(await page.locator('#homeLedger tbody tr').count(),1);assert.equal(await page.locator('#homeLedger details').count(),0);assert.match(await page.locator('#homeLedger').innerText(),/2026-09-30/);
 await page.evaluate(()=>bizSwitchPage('expenses'));await page.locator('#expCategory').selectOption('材料費');await page.locator('#expVendor').fill('任意取引先');await page.locator('#expVendor').dispatchEvent('change');assert.equal(await page.locator('#expCategory').inputValue(),'材料費');
 for(const category of ['材料費','消耗品費','給与','外注費','車両費','交通費','支払手数料'])assert.equal(await page.locator('#expCategory option[value="'+category+'"]').count(),1);
 await page.evaluate(async()=>{
  const run=cmd=>testService.execute({...cmd,operationId:crypto.randomUUID()});
  await run({type:'saveExpense',expenseId:'bic-6060',expense:{expenseDate:'2026-10-24',category:'消耗品費',paymentMethod:'法人カード決済',amount:6060,vendor:'BIC CAMERA',description:'備品'},expectedRevision:0});
  await run({type:'importBank',bank:{bankTxnId:'bic-bank',bankTransactionDate:'2026-10-24',incoming:0,outgoing:6060,amount:6060,description:'Visaデビット ビックカメラ池袋西口店',bankAccount:'GMOあおぞら'}});
  await run({type:'importBank',bank:{bankTxnId:'new-bank',bankTransactionDate:'2026-10-24',incoming:0,outgoing:4321,amount:4321,description:'未登録店舗',bankAccount:'GMOあおぞら'}});
 });
 await page.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions.some(b=>b.id==='new-bank'));
 await page.evaluate(()=>bizSwitchPage('bank'));
 const bic=page.locator('#bankRows tr').filter({hasText:'池袋西口店'});await bic.locator('summary').click();assert.match(await bic.innerText(),/BIC CAMERA/);assert.equal(await bic.getByRole('button',{name:'この銀行明細から支出登録'}).count(),0);
 await bic.locator('select').selectOption({index:1});const selected=await bic.locator('select').inputValue();await page.evaluate(()=>accountingBankView('all'));assert.equal(await bic.locator('select').inputValue(),selected);await bic.getByRole('button',{name:'照合確定'}).click();await page.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions.find(b=>b.id==='bic-bank').status==='照合済').catch(async e=>{console.error(await page.evaluate(()=>({queue:TsukinowaBusinessUI.getSync().getQueue(),status:document.getElementById('coreSyncStatus').textContent,banks:TsukinowaAccountingUI.getData().bankTransactions,expenses:TsukinowaAccountingUI.getData().expenses})));throw e;});
 const before=await page.evaluate(()=>TsukinowaAccountingUI.getData().expenses.length);
 const newBank=page.locator('#bankRows tr').filter({hasText:'未登録店舗'});
 await newBank.locator('summary').click();
 assert(await newBank.locator('details').evaluate(e=>e.open),'expense bank details must open by actual user click');
 await newBank.getByRole('button',{name:'この銀行明細から支出登録'}).click();
 assert(await page.locator('#pageBank').isVisible());assert(await page.locator('#bankExpenseDialog').isVisible());
 await page.locator('#bankExpenseForm [name=vendor]').fill('株式会社新店舗');await page.locator('#bankExpenseForm [name=category]').selectOption('消耗品費');
 await page.locator('#bankExpenseClose').click();assert(await page.locator('#pageBank').isVisible());assert.equal(await page.evaluate(()=>TsukinowaAccountingUI.getData().expenses.length),before);
 if(!await newBank.locator('details').evaluate(e=>e.open))await newBank.locator('summary').click();
 await newBank.getByRole('button',{name:'この銀行明細から支出登録'}).click();
 await page.locator('#bankExpenseForm [name=vendor]').fill('株式会社新店舗');await page.locator('#bankExpenseForm [name=category]').selectOption('消耗品費');
 await page.getByRole('button',{name:'支出登録・照合確認'}).click();await page.waitForFunction(()=>TsukinowaAccountingUI.getData().bankTransactions.find(b=>b.id==='new-bank').status==='照合済');
 assert(await page.locator('#pageBank').isVisible());assert.equal(await page.evaluate(()=>TsukinowaAccountingUI.getData().expenses.length),before+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS '+width+'px: CSV UI auto receipt, alias reimport, historical display grouping, compact bank rows, HOME periods, full categories and manual selection preserved');await page.close();
 }}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});


