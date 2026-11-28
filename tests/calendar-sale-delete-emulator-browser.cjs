// 本地予定 → 日程売上（現金）→ 取消 → 予定削除, real browser UI + real Firestore emulator + repo firestore.rules (admin, cloud).
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
 async function device(role,width){const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept(answers.shift()??''):d.type()==='confirm'?d.accept():d.dismiss());await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill(role+'@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await p.getByRole('button',{name:'閉じる',exact:true}).click();return p;}
 const p=await device('admin',1280);const queue=()=>p.evaluate(()=>TsukinowaBusinessUI.getSync().getQueue().map(x=>({type:x.command.type,error:x.error||''})));
 await p.evaluate(()=>bizSwitchPage('calendar'));
 await p.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();
 await p.fill('#ddLeDate','2026-11-28');await p.fill('#ddLeStart','12:30');await p.fill('#ddLeTitle','試験 取消後削除');await p.locator('#ddLeSaleOn').check();
 await p.fill('#ddLsCustomer','試験客');await p.selectOption('#ddLsMethod','現金');await p.fill('#ddLsAmount','5000');
 await p.locator('#ddLeSave').click();
 await p.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:15000}).catch(async()=>{throw Error('register: '+await p.locator('#ddLeError').textContent()+' '+JSON.stringify(await queue()));});
 await p.waitForFunction(()=>bizState.sales.some(s=>!s.deletedAt),null,{timeout:10000});
 const id=await p.evaluate(()=>bizState.calendar.find(e=>e.title==='試験 取消後削除').id);
 const edit=p.locator('#ddCalendar [data-dd-edit="'+id+'"]');
 await edit.click();assert.match(await p.locator('#ddLeSaleStatus').textContent(),/登録済：5,000円/);
 answers.push('取消試験');await p.locator('#ddLsVoid').click();
 await p.waitForFunction(()=>/取消済み/.test(document.getElementById('ddLeSaleStatus').textContent)||document.getElementById('ddLeError').textContent,null,{timeout:15000});
 assert.equal(await p.locator('#ddLeError').textContent(),'','cancel error: '+JSON.stringify(await queue()));
 assert.deepEqual(await queue(),[]);
 // A repeated cancel (double click / retried outbox entry) is answered as already cancelled and never blocks the outbox.
 await p.evaluate(id=>TsukinowaBusinessUI.enqueue({type:'calendarSaleChange',id,action:'cancel',reason:'二重クリック'}),id);
 await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0,null,{timeout:10000});
 // A refused command for this event (editing the cancelled sale) holds only this event's later commands.
 await p.evaluate(id=>TsukinowaBusinessUI.enqueue({type:'calendarSaleChange',id,action:'edit',reason:'試験',sale:{salesDate:'2026-11-28',customer:'試験客',content:'試験作業',amount:5000,paymentMethod:'現金'}}),id);
 await p.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue()[0]?.blocked,null,{timeout:10000});
 await p.locator('#ddLeCancel').click();
 // A plain 本地予定 (月結 customer, no sale) on another day saves and appears at once while that command is refused.
 await p.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();
 await p.fill('#ddLeDate','2026-11-10');await p.fill('#ddLeTitle','小野田, maxiv, 横浜阪東橋due1103, 54.9米');await p.locator('#ddLeSave').click();
 await p.waitForFunction(()=>!document.getElementById('ddLocalEvent').open||document.getElementById('ddLeError').textContent,null,{timeout:15000});
 assert.equal(await p.locator('#ddLeError').textContent(),'','plain schedule: '+JSON.stringify(await queue()));
 // appears as soon as the listener delivers it (no reload, within 3 s)
 await p.waitForFunction(()=>bizState.calendar.some(e=>e.title.startsWith('小野田, maxiv')&&e.date==='2026-11-10'&&!e.deletedAt),null,{timeout:3000});
 assert.equal(await p.evaluate(()=>bizState.sales.length),0,'a schedule creates no sale');
 // An event with a 銀行振込 sale on another day also syncs while that command is refused: 売上日 = event date, 売上 only (未収).
 await p.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();
 await p.fill('#ddLeDate','2026-10-30');await p.fill('#ddLeTitle','試験様・中野・クロス張替・¥70000');await p.locator('#ddLeSaleOn').check();await p.fill('#ddLeDate','2026-11-27');
 await p.fill('#ddLsCustomer','試験様');await p.fill('#ddLsAmount','70000');await p.selectOption('#ddLsMethod','銀行振込');await p.locator('#ddLeSave').click();
 await p.waitForFunction(()=>!document.getElementById('ddLocalEvent').open||document.getElementById('ddLeError').textContent,null,{timeout:15000});
 assert.equal(await p.locator('#ddLeError').textContent(),'','bank-transfer sale: '+JSON.stringify(await queue()));
 await p.waitForFunction(()=>bizState.sales.some(s=>s.amount===70000&&!s.deletedAt),null,{timeout:10000});
 {const r=await p.evaluate(async()=>{const c=TsukinowaBusinessUI.getClient();const sales=(await c.listRecords('sales')).filter(x=>!x.payload.deletedAt&&x.payload.amount===70000);const pays=(await c.listRecords('payments')).filter(x=>!x.payload.deletedAt&&x.payload.saleId===sales[0]?.id);return {n:sales.length,date:sales[0]?.payload.saleDate||sales[0]?.payload.salesDate,method:sales[0]?.payload.paymentMethod,pays:pays.length};});
  assert.deepEqual(r,{n:1,date:'2026-11-27',method:'銀行振込',pays:0});}
 // Deleting the event with the refused command names that command instead of a bare 未同期.
 await p.locator('#ddCalendar [data-dd-day="2026-11-28"]').click();await edit.click();await p.locator('#ddLeDelete').click();
 await p.waitForFunction(()=>document.getElementById('ddLeError').textContent,null,{timeout:15000});
 const held=await p.locator('#ddLeError').textContent();
 assert.match(held,/先に送信した別の操作（日程売上の修正・取消）が同期に失敗/,held);assert.match(held,/見つかりません/,held);assert.match(held,/競合を保管して次の同期へ/,held);
 // Cleanup path (クラウド画面「競合を保管して次の同期へ」): the refused command is kept on the device as JSON, then the held delete is sent.
 await p.evaluate(async()=>{const s=TsukinowaBusinessUI.getSync();s.archiveBlocked();await s.flush();});
 assert.deepEqual(await queue(),[]);
 assert.equal(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.includes('_conflicts_'))),true,'refused command kept on the device');
 await p.locator('#ddLeCancel').click();
 // A second event: register → cancel → delete; the dialog shows 取消済み as soon as the server answers.
 await p.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();
 await p.fill('#ddLeDate','2026-11-28');await p.fill('#ddLeTitle','試験 二件目');await p.locator('#ddLeSaleOn').check();await p.fill('#ddLsAmount','3000');await p.locator('#ddLeSave').click();
 await p.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:15000});
 const id2=await p.evaluate(()=>bizState.calendar.find(e=>e.title==='試験 二件目'&&!e.deletedAt).id);
 await p.waitForFunction(id=>bizState.sales.some(s=>s.calendarEventId===id&&!s.deletedAt),id2,{timeout:10000});
 await p.locator('#ddCalendar [data-dd-edit="'+id2+'"]').click();answers.push('取消試験');await p.locator('#ddLsVoid').click();
 await p.waitForFunction(()=>/取消済み/.test(document.getElementById('ddLeSaleStatus').textContent)||document.getElementById('ddLeError').textContent,null,{timeout:15000});
 assert.equal(await p.locator('#ddLeError').textContent(),'');
 await p.locator('#ddLeDelete').click();
 await p.waitForFunction(()=>!document.getElementById('ddLocalEvent').open||document.getElementById('ddLeError').textContent,null,{timeout:15000});
 assert.equal(await p.locator('#ddLeError').textContent(),'','delete error: '+JSON.stringify(await queue()));
 assert.deepEqual(await queue(),[]);
 await p.waitForFunction(id=>!bizState.calendar.some(e=>e.id===id&&!e.deletedAt),id2,{timeout:10000});
 await p.waitForFunction(id=>!bizState.calendar.some(e=>e.id===id&&!e.deletedAt),id,{timeout:10000});
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const x of [id,id2]){const l=(await db.doc('companies/tsukinowa/calendarLinks/'+x).get()).data();assert.ok(l.payload.deletedAt,'deleted '+x);}const link=(await db.doc('companies/tsukinowa/calendarLinks/'+id).get()).data();assert.ok(link.payload.deletedAt,'event deleted');const sale=(await db.doc('companies/tsukinowa/sales/calendar_cash_'+id).get()).data();assert.equal(sale.payload.documentStatus,'cancelled');assert.ok(sale.payload.deletedAt);});
 assert.deepEqual(errors,[]);console.log('calendar sale cancel→delete emulator browser test passed');
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);process.exit(1);});
