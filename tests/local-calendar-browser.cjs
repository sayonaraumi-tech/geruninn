// Desktop 日程: 本地 events can be created, edited and deleted with no Google connection; Google events stay read-only
// and can be copied to 本地 without changing the original; the per-event push uses the existing Google create path.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
const google={id:'g_shared_gev1',googleEventId:'gev1',googleCalendarId:'shared',calendarId:'shared',source:'google',date:'2026-12-05',start:'2026-12-05T13:00:00+09:00',end:'2026-12-05T15:00:00+09:00',title:'Google 打合せ',originalTitle:'Google 打合せ',description:'',location:'',googleStatus:'confirmed'};
const business={estimates:[],projects:[],calendar:[google],audit:[],expenses:[],bank:[],payments:[],sales:[]};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{
 for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://**/*',r=>{const q=r.request();if(q.url().includes('googleapis.com/calendar')){if(q.method()==='POST'){posts.push(q.postDataJSON());return r.fulfill({json:{id:q.postDataJSON().id,htmlLink:'https://calendar.example/e'}});}if(q.method()==='PATCH')return r.fulfill({json:{}});return r.fulfill({json:{id:'x',etag:'"1"',description:''}});}return r.fulfill({body:''});});
 await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
 await page.clock.setFixedTime(new Date('2026-12-01T01:00:00Z'));
 await page.addInitScript(b=>{if(!localStorage.getItem('tsukinowa_business_v1'))localStorage.setItem('tsukinowa_business_v1',b);},JSON.stringify(business));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>bizSwitchPage('calendar'));
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tsukinowa_business_v1')).calendar);
 if(width<=800){
  // Mobile: no new controls; the existing list keeps its five columns.
  assert.equal(await page.locator('#pageCalendar button:has-text("本地予定")').isVisible(),false);
  assert.deepEqual(await page.$$eval('#pageCalendar thead th',t=>t.map(x=>x.textContent)),['日付','タイトル','時刻','状態','']);
  assert.match(await page.locator('#calendarRows').innerText(),/Google 打合せ/);
  assert.deepEqual(errors,[]);await page.close();continue;
 }
 await page.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();
 const dlg=page.locator('#ddLocalEvent');assert.equal(await dlg.isVisible(),true);
 await page.locator('#ddLeSave').click();assert.match(await page.locator('#ddLeError').textContent(),/タイトル|日付/);
 await page.fill('#ddLeDate','2026-12-03');await page.fill('#ddLeStart','10:00');await page.fill('#ddLeEnd','11:30');await page.fill('#ddLeTitle','佐藤様 現地調査');await page.fill('#ddLeLocation','浅草');await page.locator('#ddLeSave').click();
 assert.equal(await dlg.isVisible(),false);
 let local=(await stored()).find(e=>e.source==='local');assert.ok(local,'saved to the existing business storage');
 assert.deepEqual({date:local.date,start:local.start,end:local.end,title:local.title,location:local.location,push:local.pushToGoogle,g:local.googleEventId},{date:'2026-12-03',start:'2026-12-03T10:00:00+09:00',end:'2026-12-03T11:30:00+09:00',title:'佐藤様 現地調査',location:'浅草',push:false,g:''});
 assert.equal(await page.locator('#ddCalendar [data-dd-day="2026-12-03"] .calEvent[data-dd-src="local"]').count(),1);
 const item=page.locator('#ddCalendar [data-dd-event="'+local.id+'"]');assert.match(await item.innerText(),/本地[\s\S]*佐藤様 現地調査/);
 // Edit
 await item.locator('[data-dd-edit]').click();assert.equal(await page.inputValue('#ddLeStart'),'10:00');await page.fill('#ddLeTitle','佐藤様 現地調査（再訪）');await page.locator('#ddLeSave').click();
 local=(await stored()).find(e=>e.id===local.id);assert.equal(local.title,'佐藤様 現地調査（再訪）');assert.equal((await stored()).filter(e=>e.source==='local').length,1);
 // Google event: labelled, read-only, copy keeps the original record unchanged
 await page.locator('#ddCalendar [data-dd-day="2026-12-05"]').click();
 const gItem=page.locator('#ddCalendar [data-dd-event="g_shared_gev1"]');assert.match(await gItem.innerText(),/Google[\s\S]*読み取り専用/);assert.equal(await gItem.locator('[data-dd-edit]').count(),0);
 const original=JSON.stringify((await stored()).find(e=>e.id==='g_shared_gev1'));
 await gItem.locator('[data-dd-copy]').click();
 const all=await stored(),copy=all.find(e=>e.copyOf==='g_shared_gev1');assert.ok(copy);assert.equal(copy.source,'local');assert.equal(copy.start,'2026-12-05T13:00:00+09:00');assert.equal(copy.end,'2026-12-05T15:00:00+09:00');
 assert.equal(JSON.stringify(all.find(e=>e.id==='g_shared_gev1')),original,'the Google record is not modified');
 assert.equal(await page.locator('#ddCalendar [data-dd-event="g_shared_gev1"]').count(),0,'copied Google row is shown once, as 本地');
 assert.equal(await page.locator('#ddCalendar [data-dd-event="'+copy.id+'"]').count(),1);
 // Delete (soft): the record stays in storage
 await page.locator('#ddCalendar [data-dd-day="2026-12-03"]').click();await page.locator('#ddCalendar [data-dd-edit="'+local.id+'"]').click();await page.locator('#ddLeDelete').click();
 local=(await stored()).find(e=>e.id===local.id);assert.ok(local.deletedAt);assert.equal(await page.locator('#ddCalendar [data-dd-event="'+local.id+'"]').count(),0);
 // Push toggle while Google is not connected: saved now, marked for Google, nothing sent
 await page.locator('#pageCalendar .biz-title button:has-text("＋ 本地予定")').click();await page.fill('#ddLeDate','2026-12-10');await page.fill('#ddLeTitle','Google連携テスト');await page.check('#ddLePush');await page.locator('#ddLeSave').click();
 let pushed=(await stored()).find(e=>e.title==='Google連携テスト');assert.equal(pushed.pushToGoogle,true);assert.equal(pushed.googleCreatePending,true);assert.match(pushed.googleEventId,/^[a-v0-9]{5,}$/);assert.equal(posts.length,0);
 // After connecting, the existing create path sends it as an all-day event
 await page.evaluate(()=>{bizGoogleAccessToken='token';bizGoogleTokenExpiresAt=Date.now()+3600000;bizGoogleCalendarId='shared';bizGoogleCalendarsLoaded=true;});
 await page.evaluate(id=>bizGooglePatchNow(id),pushed.id);
 assert.equal(posts.length,1);assert.equal(posts[0].id,pushed.googleEventId);assert.deepEqual([posts[0].summary,posts[0].start,posts[0].end],['Google連携テスト',{date:'2026-12-10'},{date:'2026-12-11'}]);
 pushed=(await stored()).find(e=>e.id===pushed.id);assert.equal(pushed.googleCreatePending,false);assert.equal(pushed.source,'local');
 assert.deepEqual([(await page.evaluate(()=>bizState.sales.length)),(await page.evaluate(()=>bizState.payments.length))],[0,0],'calendar never creates money records');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('local calendar browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
