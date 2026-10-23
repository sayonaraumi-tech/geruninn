const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{for(const width of [390,1280])for(const mode of ['new','legacy']){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],remote=new Map(),posts=[],patches=[];let failCreate=false;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false,companyId:'tsukinowa',firebase:{}}}));await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({body:''}));await page.route('https://accounts.google.com/**',r=>r.fulfill({body:''}));
 await page.route('https://www.googleapis.com/**',async r=>{const req=r.request(),url=new URL(req.url()),id=url.pathname.split('/').at(-1);if(req.method()==='POST'){if(failCreate){failCreate=false;return r.fulfill({status:503,json:{error:{message:'test unavailable'}}});}const body=req.postDataJSON();posts.push(body);if(remote.has(body.id))return r.fulfill({status:409,json:{error:{message:'duplicate'}}});remote.set(body.id,{...body,etag:'"1"'});return r.fulfill({json:remote.get(body.id)});}if(req.method()==='PATCH'){const body=req.postDataJSON();patches.push(body);remote.set(id,{...remote.get(id),...body});return r.fulfill({json:remote.get(id)});}return r.fulfill({json:remote.get(id)||{error:{message:'missing'}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForTimeout(300);
 await page.evaluate(async(mode)=>{
  const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
  if(mode==='legacy'){
   const snapshot={documentId:'receipt',docType:'receipt',customerName:'（株）益田工房東京',invoiceDate:'2026-10-23',invoiceNo:'20261023-1200-01',receiptTotal:12000,paymentMethod:'銀行振込',tadashi:'クロス張替'};
   records.set('companies/tsukinowa/documents/receipt',{revision:1,payload:{documentId:'receipt',docType:'receipt',status:'active',confirmed:true,amount:12000,customerName:snapshot.customerName,invoiceDate:snapshot.invoiceDate,snapshot}});
  }
  const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role:'admin',companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);
  window.testRecords=records;window.testClient=client;window.testService=TsukinowaBusiness.createService(client);bizGoogleAccessToken='';bizGoogleTokenExpiresAt=0;bizGoogleGrantedScopes=TSUKINOWA_GOOGLE_SCOPE;bizGoogleCalendarId='shared';bizGoogleCalendarsLoaded=true;
 },mode);
 page.on('dialog',d=>d.dismiss());
 await page.evaluate(async(mode)=>{
  bizGoogleAccessToken='';bizGoogleTokenExpiresAt=0;
  window.receipt={documentId:'receipt',docType:'receipt',customerName:'（株）益田工房東京',invoiceDate:'2026-10-23',receiptTotal:12000,paymentMethod:'銀行振込',tadashi:'クロス張替'};
  window.savedReceipt=mode==='legacy'?{snapshot:testRecords.get('companies/tsukinowa/documents/receipt').payload.snapshot}:await testService.execute({type:'saveDocument',operationId:'save',expectedRevision:0,snapshot:receipt});
 },mode);
 await page.waitForFunction(()=>bizState.calendar.length===1&&bizState.sales.length===1&&bizState.payments.length===1);
 await page.evaluate(()=>{document.getElementById('calendarMonth').value='2026-10';bizSwitchPage('calendar');TsukinowaBusinessUI.patchPending();});
 assert.match(await page.locator('#calendarRows').innerText(),/領収済/);assert.equal(posts.length,0);assert.equal(patches.length,0);
 assert(await page.evaluate(()=>bizState.calendar[0].googleCreatePending));assert.equal(await page.evaluate(()=>bizOutstanding(bizState.sales[0])),0);
 await page.evaluate(()=>openEventModal(bizState.calendar[0].id));assert.match(await page.locator('#bizEventModal').innerText(),/領収済/);
 assert.match(await page.locator('#eventSaleStatus').innerText(),/入金済/);
 if(process.env.PREVIEW_DIR)await page.screenshot({path:path.join(process.env.PREVIEW_DIR,'receipt-calendar-'+width+'.png')});
 const beforeOpen=await page.evaluate(()=>JSON.stringify([...testRecords]));await page.evaluate(()=>bizCreateDocFromCurrentEvent('receipt'));assert.equal(await page.evaluate(()=>collectFormState().documentId),'receipt');assert.equal(await page.locator('#receiptTotal').inputValue(),'12000');assert.equal(await page.evaluate(()=>JSON.stringify([...testRecords])),beforeOpen);
 failCreate=true;await page.evaluate(async()=>{bizGoogleAccessToken='test';bizGoogleTokenExpiresAt=Date.now()+3600000;await bizGooglePatchEvent(bizState.calendar[0]);});
 assert.equal(posts.length,0);assert(await page.evaluate(()=>bizState.calendar[0].googleCreatePending));assert.equal(await page.evaluate(()=>bizOutstanding(bizState.sales[0])),0);assert.equal(await page.evaluate(()=>bizState.payments.length),1);
 await page.evaluate(()=>TsukinowaBusinessUI.patchPending());
 await page.waitForFunction(()=>bizState.calendar[0].googleCreatePending===false&&bizState.calendar[0].googlePatchPending===false);
 assert.equal(posts.length,1);assert.equal(remote.size,1);assert.equal(posts[0].summary,'（株）益田工房東京｜クロス張替｜¥12,000｜領収済');assert.equal(posts[0].start.date,'2026-10-23');assert.equal(posts[0].end.date,'2026-10-24');assert.match(posts[0].description,/月輪システムで開く/);
 await page.evaluate(async()=>{for(let i=0;i<3;i++)await testService.execute({type:'saveDocument',operationId:'again'+i,expectedRevision:1,snapshot:savedReceipt.snapshot});TsukinowaBusinessUI.patchPending();});
 assert.equal(posts.length,1);assert.equal(await page.evaluate(()=>bizState.sales.length),1);assert.equal(await page.evaluate(()=>bizState.payments.length),1);
 // Rebuild the sync bridge from the persisted cloud/cache, as on a fresh login.
 const frozen=await page.evaluate(()=>JSON.stringify([...testRecords]));
 await page.evaluate(()=>{TsukinowaBusinessUI.auth({phase:'signed-out'},testClient);TsukinowaBusinessUI.auth(testClient.getState(),testClient);});
 await page.waitForFunction(()=>bizState.sales.length===1&&TsukinowaBusinessUI.getSync().isReady());
 assert.equal(await page.evaluate(()=>JSON.stringify([...testRecords])),frozen);assert.equal(posts.length,1);
 // Existing Google event must be patched, preserving the user's description and calendar.
 remote.set('existing',{id:'existing',description:'現場メモ',etag:'"1"'});
 await page.evaluate(async()=>{
  const e=await testService.execute({type:'calendar',operationId:'import',event:{googleEventId:'existing',googleCalendarId:'shared',date:'2026-10-24',start:'2026-10-24',end:'2026-10-25',title:'別顧客｜クロス張替｜12000',description:'現場メモ'}});
  await testService.execute({type:'saveDocument',operationId:'existing-receipt',expectedRevision:0,snapshot:{...receipt,documentId:'existing-receipt',customerName:'別顧客',invoiceDate:'2026-10-24',calendarEventId:e.id}});
 });
 await page.waitForFunction(()=>bizState.calendar.length===2&&bizState.calendar.every(e=>!e.googlePatchPending));
 assert.equal(posts.length,1);assert.equal(remote.size,2);assert.match(remote.get('existing').summary,/別顧客.*領収済/);assert.match(remote.get('existing').description,/現場メモ/);assert.match(remote.get('existing').description,/月輪システム/);
 // Exercise the visible retry control against fourteen persisted commands.
 await page.evaluate(async()=>{
  const sync=TsukinowaBusinessUI.getSync(),execute=sync.service.execute;let allowed=false;window.queueAttempts=[];
  sync.service.execute=async cmd=>{if(!cmd.operationId.startsWith('retry-test-'))return execute(cmd);queueAttempts.push(cmd.operationId);if(!allowed)throw Object.assign(Error('rules denied'),{code:'permission-denied'});return {ok:true};};
  for(let i=0;i<14;i++)sync.enqueue({type:'test',operationId:'retry-test-'+i});
  await sync.flush();window.queueBefore=sync.getQueue();await sync.flush();if(queueAttempts.length!==1)throw Error('ordinary flush retried blocked entry');
  window.allowQueue=()=>allowed=true;
 });
 assert.equal(await page.evaluate(()=>queueBefore.length),14);assert(await page.evaluate(()=>queueBefore[0].blocked));
 await page.evaluate(()=>{allowQueue();document.getElementById('bizEventModal').style.display='none';bizOpenCloudAccount();});await page.locator('#cloudRetryQueue').click();
 await page.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);
 assert.deepEqual(await page.evaluate(()=>queueAttempts),['retry-test-0',...Array.from({length:14},(_,i)=>'retry-test-'+i)]);
 assert.deepEqual(errors,[]);console.log('PASS '+mode+' receipt '+width+'px: offline save, reconnect POST, existing PATCH, repeat login, deduplication and detail UI');await page.close();
 }}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
