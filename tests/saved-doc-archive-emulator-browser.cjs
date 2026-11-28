// 保存帳票: 無効 → 履歴から削除 (admin, cloud), real browser UI + real Firestore emulator + repo firestore.rules.
// Also counts full re-renders of the saved-document list per operation (metadata-only snapshots must not re-render).
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
 const answers=[];
 async function device(role,width){const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept(answers.shift()??''):d.type()==='confirm'?d.accept():d.dismiss());await p.addInitScript(()=>{window.hydrations=0;document.addEventListener('DOMContentLoaded',()=>{const t=()=>{const ui=window.TsukinowaAccountingUI;if(!ui){setTimeout(t,5);return;}const f=ui.hydrate;ui.hydrate=function(){window.hydrations++;return f.apply(this,arguments);};};t();});});await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill(role+'@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await p.getByRole('button',{name:'閉じる',exact:true}).click();return p;}
 const p=await device('admin',1280);
 // Login used to re-render every view once per collection snapshot and again per metadata-only snapshot (19 times).
 const atLogin=await p.evaluate(()=>window.hydrations);console.log('full data renders at login:',atLogin);assert.ok(atLogin<=8,'full re-renders at login: '+atLogin);const queue=()=>p.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue().map(x=>({type:x.command.type,error:x.error||''})));
 await p.evaluate(()=>{bizSwitchPage('chohyo');setDocType('invoice');document.getElementById('customerName').value='test';document.getElementById('invoiceDate').value='2026-11-28';document.getElementById('salesDate').value='2026-11-28';items=[{content:'試験',qty:1,unit:'式',price:6400,taxable:true}];recalc();saveConfirmedHistory();});
 await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0&&loadConfirmedHistory().length===1,null,{timeout:15000});
 await p.evaluate(()=>bizSwitchPage('savedDocs'));
 const card=()=>p.locator('#allSavedDocsList .biz-card').first();
 answers.push('てst');await card().getByRole('button',{name:'無効にする'}).click();
 await p.waitForFunction(()=>/無効/.test(document.querySelector('#allSavedDocsList .biz-card strong')?.textContent||''),null,{timeout:15000});
 await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0,null,{timeout:15000});
 await p.waitForTimeout(500);
 // A refused 日程 command (as in production) must not hold 履歴から削除.
 await p.evaluate(()=>TsukinowaBusinessUI.enqueue({type:'calendarSaleChange',id:'cal_missing',action:'cancel',reason:'x'}));
 await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue()[0]?.blocked,null,{timeout:10000});
 await p.evaluate(()=>{window.savedRenders=0;const f=window.renderAllSavedDocs;window.renderAllSavedDocs=function(){window.savedRenders++;return f.apply(this,arguments);};});
 await card().getByRole('button',{name:'履歴から削除'}).click();
 await p.waitForFunction(()=>!document.querySelector('#allSavedDocsList .biz-card'),null,{timeout:15000}).catch(async()=>{throw Error('archive held: '+JSON.stringify(await queue()));});
 await p.waitForTimeout(1500);
 const renders=await p.evaluate(()=>window.savedRenders);console.log('saved-doc list renders for one 履歴から削除:',renders);
 assert.ok(renders<=2,'saved-doc list re-rendered '+renders+' times for one operation');
 await env.withSecurityRulesDisabled(async c=>{const docs=(await c.firestore().collection('companies/tsukinowa/documents').get()).docs.map(d=>d.data().payload);assert.equal(docs.length,1);assert.equal(docs[0].status,'void');assert.ok(docs[0].deletedAt,'archived, record kept');});
 assert.deepEqual(errors,[]);console.log('saved doc void → 履歴から削除 emulator browser test passed');
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);process.exit(1);});
