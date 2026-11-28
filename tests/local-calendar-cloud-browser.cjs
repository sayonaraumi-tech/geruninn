// Cloud mode: 本地 events go through the outbox into calendarLinks; no accounting records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{for(const width of [1280]){const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('dialog',d=>d.accept());await page.clock.setFixedTime(new Date('2026-12-01T01:00:00Z'));page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));await page.goto('http://127.0.0.1:'+server.address().port);

 await page.evaluate(async()=>{
  const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
  const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role:'admin',companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);
  
  window.testRecords=records;
 });
 await page.evaluate(()=>bizSwitchPage('calendar'));
 await page.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();
 await page.fill('#ddLeDate','2026-12-03');await page.fill('#ddLeTitle','クラウド本地予定 現金 30000');await page.locator('#ddLeSave').click();
 await page.waitForFunction(()=>bizState.calendar.some(e=>e.source==='local'),null,{timeout:5000});
 const rec=await page.evaluate(()=>[...window.testRecords].filter(([k])=>k.includes('/calendarLinks/')).map(([k,v])=>({id:k.split('/').at(-1),...v.payload})));
 assert.equal(rec.length,1);assert.equal(rec[0].source,'local');assert.equal(rec[0].title,'クラウド本地予定 現金 30000');
 assert.equal(await page.evaluate(()=>[...window.testRecords].filter(([k])=>/\/(sales|payments)\//.test(k)).length),0);
 const id=rec[0].id;await page.locator('#ddCalendar [data-dd-edit="'+id+'"]').click();await page.fill('#ddLeTitle','クラウド本地予定（変更）');await page.locator('#ddLeSave').click();
 await page.waitForFunction(id=>bizState.calendar.find(e=>e.id===id)?.title==='クラウド本地予定（変更）',id,{timeout:5000});
 await page.locator('#ddCalendar [data-dd-edit="'+id+'"]').click();await page.locator('#ddLeDelete').click();
 await page.waitForFunction(id=>window.testRecords.get('companies/tsukinowa/calendarLinks/'+id)?.payload.deletedAt,id,{timeout:5000});
 await page.waitForFunction(id=>!document.querySelector('#ddCalendar [data-dd-event="'+id+'"]')&&!bizState.calendar.some(e=>e.id===id),id,{timeout:5000});
 const after=await page.evaluate(id=>window.testRecords.get('companies/tsukinowa/calendarLinks/'+id)?.payload,id);assert.ok(after?.deletedAt);assert.equal(after.title,'クラウド本地予定（変更）');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('local calendar cloud browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
