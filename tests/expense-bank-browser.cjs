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

 const desktop=await device('admin',1280);
 const idle=async()=>{try{await desktop.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0&&document.getElementById('coreSyncStatus').textContent==='クラウド同期済');}catch(e){console.error(await desktop.evaluate(()=>({queue:TsukinowaBusinessUI.getSync().getQueue(),status:document.getElementById('coreSyncStatus').textContent,message:document.getElementById('accountingMessage').textContent})));throw e;}};
 const snapshot=()=>desktop.evaluate(()=>({expenses:TsukinowaAccountingUI.getData().expenses,cash:TsukinowaAccountingUI.getData().cashLedger,bank:TsukinowaAccountingUI.getData().bankTransactions}));
 await desktop.evaluate(()=>{bizSwitchPage('expenses');expDate.value='2026-10-02';expCategory.value='旅費交通費';expMethod.value='現金';expAmount.value=100;expVendor.value='手工';expMemo.value='現金';return addExpense();});await idle();
 assert.equal((await snapshot()).cash.length,1);
 const csv='日付,科目,支払方法,金額,取引先,内容・備考\n2026-10-02,旅費交通費,現金,100,手工,現金\n2026-10-02,消耗品費,法人銀行デビット,6060,ビックカメラ,備品\n2026-10-02,交通費,代表者立替（交通系IC）,200,駅,電車\n2026-10-02,通信費,銀行振込,1000,電話会社,10月\n2026-10-02,地代家賃,口座振替,2000,家主,家賃\n2026-10-02,その他,銀行振込,3000,候補店,候補';
 await desktop.locator('#expenseFile').setInputFiles({name:'expenses.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await desktop.evaluate(()=>accountingPreviewExpenses());assert.match(await desktop.locator('#expenseImportPreview').innerText(),/6件.*12,260.*重複候補 1件.*エラー 0件/);
 await desktop.locator('#expenseImportCommit').click();await desktop.waitForFunction(()=>document.getElementById('expenseImportPreview').textContent==='5件を同期キューに保存しました。重複はスキップします。');await idle();await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().expenses.length===6);assert.equal((await snapshot()).expenses.length,6);assert.equal((await snapshot()).cash.length,1);
 await desktop.evaluate(()=>accountingPreviewExpenses());assert.match(await desktop.locator('#expenseImportPreview').innerText(),/重複候補 6件/);assert(await desktop.locator('#expenseImportCommit').isDisabled());
 assert.equal(await desktop.locator('#pageExpenses > .biz-section').count(),5);assert.equal(await desktop.locator('#accountingMigrateButton').count(),0);
 await desktop.evaluate(()=>bizSwitchPage('bank'));
 const bankCsv='日付,摘要,入金,出金,取引ID\n2026-10-04,電話会社,,1000,high\n2026-10-04,不明摘要,,3000,candidate\n2026-10-04,未登録,,4000,unmatched\n2026-10-04,VISA カード利用代金,,6060,card';
 await desktop.locator('#bankFile').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from(bankCsv)});await desktop.evaluate(()=>importBankCsv());await idle();
 assert.equal((await snapshot()).expenses.length,6);assert.match(await desktop.locator('#bankRows').innerText(),/要確認/);assert.match(await desktop.locator('#bankRows').innerText(),/候補/);assert.match(await desktop.locator('#bankRows').innerText(),/未一致/);
 await desktop.evaluate(()=>{accountingBankView('all');document.querySelectorAll('#bankRows details').forEach(e=>e.open=true);});
 const high=desktop.locator('#bankRows tr').filter({hasText:'電話会社'});await high.locator('select').selectOption({index:1});await high.getByRole('button',{name:'照合確定'}).click();await idle();assert.match(await high.innerText(),/照合済/);assert.equal((await snapshot()).expenses.length,6);
 const candidate=desktop.locator('#bankRows tr').filter({hasText:'不明摘要'});const candidateId=(await snapshot()).bank.find(b=>b.externalId==='candidate').id;assert.equal((await snapshot()).bank.find(b=>b.id===candidateId).status,'未照合');
 await candidate.locator('select').selectOption({index:1});
 desktop.removeAllListeners('dialog');desktop.on('dialog',d=>d.dismiss());await candidate.getByRole('button',{name:'照合確定'}).click();await idle();assert.equal((await snapshot()).bank.find(b=>b.id===candidateId).status,'未照合');
 desktop.removeAllListeners('dialog');desktop.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());await candidate.getByRole('button',{name:'照合確定'}).click();await idle();assert.equal((await snapshot()).bank.find(b=>b.id===candidateId).status,'照合済');assert.equal((await snapshot()).expenses.length,6);
 const card=desktop.locator('#bankRows tr').filter({hasText:'VISA カード利用代金'});assert.match(await card.innerText(),/カード識別名・明細を確認/);assert.equal(await card.locator('select').count(),0);assert.equal(await card.getByRole('button',{name:'選択支出の引落照合'}).count(),1);
 const unmatched=desktop.locator('#bankRows tr').filter({hasText:'未登録'});await unmatched.getByRole('button',{name:'この銀行明細から支出登録'}).click();assert(await desktop.locator('#pageBank').isVisible());assert(await desktop.locator('#bankExpenseDialog').isVisible());assert.equal((await snapshot()).expenses.length,6);assert.equal(await desktop.locator('#bankExpenseForm [name=amount]').inputValue(),'4000');await desktop.locator('#bankExpenseForm [name=vendor]').fill('試験店舗');await desktop.getByRole('button',{name:'支出登録・照合確認',exact:true}).click();await idle();assert.equal((await snapshot()).bank.find(b=>b.description==='未登録').status,'照合済');assert.equal((await snapshot()).expenses.length,7);assert.equal((await snapshot()).cash.length,1);
 await desktop.evaluate(()=>bizSwitchPage('expenses'));
 // Invalid preview disables commit and cannot enqueue a partial batch.
 await desktop.locator('#expenseFile').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('日付,科目,支払方法,金額,取引先,内容・備考\n2026-02-30,その他,現金,1,A,B')});await desktop.evaluate(()=>accountingPreviewExpenses());assert(await desktop.locator('#expenseImportCommit').isDisabled());assert.match(await desktop.locator('#expenseImportPreview').innerText(),/エラー 1件/);
 // Explicit learning uses the same authenticated expense transaction and syncs settings.
 await desktop.evaluate(()=>{expDate.value='2026-10-10';expCategory.value='通信費';expMethod.value='銀行振込';expAmount.value=123;expVendor.value='ＡＢＣ 店';expMemo.value='学習確認';expenseLearnCategory.checked=false;expCategory.dispatchEvent(new Event('change'));if(!expenseLearnCategory.checked)throw Error('manual category confirmation must enable learning');return addExpense();});await idle();
 await desktop.waitForFunction(()=>document.getElementById('expenseCategoryRules').textContent.includes('ＡＢＣ 店'));
 await desktop.locator('#expVendor').fill('abc   店');await desktop.locator('#expVendor').dispatchEvent('change');assert.equal(await desktop.locator('#expCategory').inputValue(),'通信費');assert.match(await desktop.locator('#expenseClassificationStatus').innerText(),/学習ルール/);
 const history=JSON.stringify((await snapshot()).expenses);
 let rule=desktop.locator('#expenseCategoryRules tr').filter({hasText:'ＡＢＣ 店'});await rule.getByRole('button',{name:'有効・停止'}).click();await idle();await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().settings.some(r=>r.vendor==='ＡＢＣ 店'&&r.enabled===false&&!r.deletedAt));assert.equal(await rule.locator('td').nth(2).innerText(),'停止');
 await desktop.locator('#expVendor').dispatchEvent('change');assert.match(await desktop.locator('#expenseClassificationStatus').innerText(),/要確認/);assert.equal(await desktop.locator('#expenseLearnCategory').isChecked(),false);
 desktop.removeAllListeners('dialog');desktop.on('dialog',d=>d.type()==='prompt'?d.accept('材料費'):d.type()==='confirm'?d.accept():d.dismiss());
 await rule.getByRole('button',{name:'変更',exact:true}).click();await idle();await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().settings.some(r=>r.vendor==='ＡＢＣ 店'&&r.category==='材料費'));assert.equal(await rule.locator('td').nth(1).innerText(),'材料費');await rule.getByRole('button',{name:'削除',exact:true}).click();await idle();await rule.waitFor({state:'detached'});assert.equal(await rule.count(),0);assert.equal(JSON.stringify((await snapshot()).expenses),history);

 // Real downloads must match the current visible month on desktop and phone.
 const phone=await device('admin',390);
 async function verifyCsv(page,month){
  await page.evaluate(month=>{bizSwitchPage('expenses');expenseMonth.value=month;renderExpenses();},month);
  const visible=await page.locator('#expenseRows tr').evaluateAll(rs=>rs.map(r=>[...r.cells].slice(0,6).map(c=>c.textContent)));
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#expenseCsvExport').click()]);
  const bytes=fs.readFileSync(await download.path()),rows=require('../js/accounting').parseCSV(bytes.toString('utf8').slice(1));
  assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert.equal(download.suggestedFilename(),'expenses_'+month+'.csv');
  assert.deepEqual(rows[0],['支出日','科目','取引先','内容','支払方法','金額','状態','領収書参照']);
  assert.deepEqual(rows.slice(1).map(r=>r.slice(0,6)),visible.map(r=>[...r.slice(0,4),r[4].split(' / ')[0],r[5].replaceAll(',','')]));
  const summary=await page.evaluate(month=>TsukinowaAccounting.monthly(TsukinowaAccountingUI.homeData(),month).expenseTotal,month);
  assert.equal(rows.slice(1).reduce((n,r)=>n+Number(r[5]),0),summary);
  assert(await page.locator('#expenseFile').count());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.PREVIEW_DIR&&month==='2026-10')await page.screenshot({path:path.join(process.env.PREVIEW_DIR,'expense-ledger-'+page.viewportSize().width+'.png'),fullPage:true});
 }
 for(const page of [desktop,phone]){await verifyCsv(page,'2026-10');await verifyCsv(page,'2026-09');}
 // Two independent browser contexts queue the same purchase offline. A reload must
 // preserve its operation identity, then reconnect produces one expense/cash row.
 const command={type:'saveExpense',operationId:'offline-ui-expense',skipDuplicate:true,expectedRevision:0,expense:{expenseDate:'2026-10-05',category:'消耗品費',vendor:'断網試験',description:'備品',paymentMethod:'現金',amount:4321}};
 await desktop.context().setOffline(true);await phone.context().setOffline(true);
 await desktop.evaluate(c=>TsukinowaBusinessUI.enqueue(c),command);
 await phone.evaluate(c=>TsukinowaBusinessUI.enqueue({...c,operationId:'offline-ui-expense-phone'}),command);
 const pending=await desktop.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue());
 assert.equal(pending.length,1);
 // Stop the old tab before reconnecting so the persisted outbox is restored
 // by a fresh login, rather than being drained by the old tab's online event.
 await desktop.evaluate(()=>TsukinowaBusinessUI.getSync().stop());
 await desktop.context().setOffline(false);await desktop.reload();
 await desktop.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');
 await desktop.locator('#bizCloudAccountButton').click();await desktop.locator('#cloudEmail').fill('admin@example.com');await desktop.locator('#cloudPassword').fill('password');
 await phone.context().setOffline(false);
 await desktop.locator('#cloudLogin').click();await idle();await desktop.getByRole('button',{name:'閉じる',exact:true}).click();
 await phone.evaluate(()=>TsukinowaBusinessUI.getSync().flush());await phone.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);
 await desktop.waitForFunction(()=>TsukinowaAccountingUI.getData().expenses.some(e=>e.vendor==='断網試験'));
 const once=await snapshot();assert.equal(once.expenses.filter(e=>e.vendor==='断網試験').length,1);const purchase=once.expenses.find(e=>e.vendor==='断網試験');assert.equal(once.cash.filter(c=>c.linkedExpenseId===purchase.id).length,1);
 // Replaying the original persisted operation also handles a lost acknowledgement.
 await desktop.evaluate(c=>TsukinowaBusinessUI.enqueue(c),pending[0].command);await idle();
 assert.equal((await snapshot()).expenses.filter(e=>e.vendor==='断網試験').length,1);
 await desktop.evaluate(()=>{expenseMonth.value='';renderExpenses();});
 assert.equal(await desktop.locator('#expenseMonth').inputValue(),await desktop.evaluate(()=>bizNowMonth()));
 console.log('PASS desktop/phone current-month CSV downloads match HOME and visible rows; two offline devices and reload/replay keep one expense/cash entry');

 // Render the reported production shape; preview/dropdown must never write anything.
 const beforePreview=await desktop.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue().length);
 await desktop.evaluate(()=>{
  const row=(id,payload)=>({id,payload,revision:1}),s={id:'dynast-sale',salesDate:'2026-09-30',invoiceDate:'2026-09-30',amount:1594900,customer:'dynast合同会社',documentId:'dynast-doc'};
  TsukinowaAccountingUI.hydrate({sales:[row(s.id,s)],documents:[row('dynast-doc',{docType:'invoice',confirmed:true,saleId:s.id,amount:s.amount,snapshot:{invoiceNo:'20260930-001',invoiceDate:'2026-09-30',dueDate:'2026-10-30'}})],bankTransactions:[row('dynast-bank',{bankTxnId:'dynast-bank',bankTransactionDate:'2026-10-31',description:'ダイナスト（ド',incoming:1594900,outgoing:0,amount:1594900,status:'未照合',bankAccount:'試験'})]});bizSwitchPage('bank');renderBank();
 });
 await desktop.locator('#bankRows details summary').click();const dynast=desktop.locator('#bankTarget_dynast-bank');assert.match(await dynast.innerText(),/20260930-001/);assert.match(await dynast.innerText(),/dynast合同会社/);assert.equal(await dynast.inputValue(),'');assert.equal(await desktop.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue().length),beforePreview);
 assert.deepEqual(errors,[]);console.log('PASS expense/bank UI + real unchanged Firestore rules: manual/CSV, duplicate skip, cash isolation, high confidence, candidate confirm/cancel, unmatched explicit entry, card settlement blocked and simplified page');
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
