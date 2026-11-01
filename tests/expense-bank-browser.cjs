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
 const idle=()=>desktop.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0&&document.getElementById('coreSyncStatus').textContent==='クラウド同期済');
 const snapshot=()=>desktop.evaluate(()=>({expenses:TsukinowaAccountingUI.getData().expenses,cash:TsukinowaAccountingUI.getData().cashLedger,bank:TsukinowaAccountingUI.getData().bankTransactions}));
 await desktop.evaluate(()=>{bizSwitchPage('expenses');expDate.value='2026-10-02';expCategory.value='旅費交通費';expMethod.value='現金';expAmount.value=100;expVendor.value='手工';expMemo.value='現金';return addExpense();});await idle();
 assert.equal((await snapshot()).cash.length,1);
 const csv='日付,科目,支払方法,金額,取引先,内容・備考\n2026-10-02,旅費交通費,現金,100,手工,現金\n2026-10-02,消耗品費,法人カード決済,6060,ビックカメラ,備品\n2026-10-02,交通費,代表者立替（交通系IC）,200,駅,電車\n2026-10-02,通信費,銀行振込,1000,電話会社,10月\n2026-10-02,地代家賃,口座振替,2000,家主,家賃\n2026-10-02,その他,銀行振込,3000,候補店,候補';
 await desktop.locator('#expenseFile').setInputFiles({name:'expenses.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await desktop.evaluate(()=>accountingPreviewExpenses());assert.match(await desktop.locator('#expenseImportPreview').innerText(),/6件.*12,260.*重複候補 1件.*エラー 0件/);
 await desktop.locator('#expenseImportCommit').click();await idle();assert.equal((await snapshot()).expenses.length,6);assert.equal((await snapshot()).cash.length,1);
 await desktop.evaluate(()=>accountingPreviewExpenses());assert.match(await desktop.locator('#expenseImportPreview').innerText(),/重複候補 6件/);assert(await desktop.locator('#expenseImportCommit').isDisabled());
 assert.equal(await desktop.locator('#pageExpenses > .biz-section').count(),4);assert.equal(await desktop.locator('#accountingMigrateButton').count(),0);
 await desktop.evaluate(()=>bizSwitchPage('bank'));
 const bankCsv='日付,摘要,入金,出金,取引ID\n2026-10-04,電話会社,,1000,high\n2026-10-04,不明摘要,,3000,candidate\n2026-10-04,未登録,,4000,unmatched\n2026-10-04,VISA カード利用代金,,6060,card';
 await desktop.locator('#bankFile').setInputFiles({name:'bank.csv',mimeType:'text/csv',buffer:Buffer.from(bankCsv)});await desktop.evaluate(()=>importBankCsv());await idle();
 assert.equal((await snapshot()).expenses.length,6);assert.match(await desktop.locator('#bankRows').innerText(),/自動一致/);assert.match(await desktop.locator('#bankRows').innerText(),/候補/);assert.match(await desktop.locator('#bankRows').innerText(),/未一致/);
 const high=desktop.locator('#bankRows tr').filter({hasText:'電話会社'});await high.locator('select').selectOption({index:1});await high.getByRole('button',{name:'照合確定'}).click();await idle();assert.match(await high.innerText(),/照合済/);assert.equal((await snapshot()).expenses.length,6);
 const candidate=desktop.locator('#bankRows tr').filter({hasText:'不明摘要'});const candidateId=(await snapshot()).bank.find(b=>b.externalId==='candidate').id;assert.equal((await snapshot()).bank.find(b=>b.id===candidateId).status,'未照合');
 await candidate.locator('select').selectOption({index:1});
 desktop.removeAllListeners('dialog');desktop.on('dialog',d=>d.dismiss());await candidate.getByRole('button',{name:'照合確定'}).click();await idle();assert.equal((await snapshot()).bank.find(b=>b.id===candidateId).status,'未照合');
 desktop.removeAllListeners('dialog');desktop.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());await candidate.getByRole('button',{name:'照合確定'}).click();await idle();assert.equal((await snapshot()).bank.find(b=>b.id===candidateId).status,'照合済');assert.equal((await snapshot()).expenses.length,6);
 const card=desktop.locator('#bankRows tr').filter({hasText:'VISA カード利用代金'});assert.match(await card.innerText(),/複数支出との照合対象/);assert.equal(await card.locator('select,button').count(),0);
 const unmatched=desktop.locator('#bankRows tr').filter({hasText:'未登録'});await unmatched.getByRole('button',{name:'この銀行明細から支出登録'}).click();assert(await desktop.locator('#pageExpenses').isVisible());assert.equal((await snapshot()).expenses.length,6);assert.equal(await desktop.locator('#expAmount').inputValue(),'4000');await desktop.getByRole('button',{name:'支出登録',exact:true}).click();await idle();assert.equal((await snapshot()).expenses.length,7);assert.equal((await snapshot()).cash.length,1);
 // Invalid preview disables commit and cannot enqueue a partial batch.
 await desktop.locator('#expenseFile').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('日付,科目,支払方法,金額,取引先,内容・備考\n2026-02-30,その他,現金,1,A,B')});await desktop.evaluate(()=>accountingPreviewExpenses());assert(await desktop.locator('#expenseImportCommit').isDisabled());assert.match(await desktop.locator('#expenseImportPreview').innerText(),/エラー 1件/);
 assert.deepEqual(errors,[]);console.log('PASS expense/bank UI + real unchanged Firestore rules: manual/CSV, duplicate skip, cash isolation, high confidence, candidate confirm/cancel, unmatched explicit entry, card settlement blocked and simplified page');
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
