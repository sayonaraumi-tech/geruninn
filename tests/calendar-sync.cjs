// Run: NODE_PATH=<directory containing playwright> node tests/calendar-sync.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const http=require('node:http');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'));
assert(!html.includes('clean_reset_done'));assert(!html.includes('rows.slice(0, 500)'));assert(!html.includes('bizEscape('));
console.log('PASS static syntax and data preservation checks');
const {chromium}=require('playwright');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const f=path.join(root,name==='/'?'index.html':name);try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':f.endsWith('.webmanifest')?'application/manifest+json':'image/png');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});
 try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],patches=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await context.addInitScript(()=>{
   localStorage.setItem('tsukinowa_business_v1',JSON.stringify({calendar:[{id:'kept',title:'有休',date:'2026-09-02',linkedInvoiceId:'formal',officialAmount:123}],sales:[{id:'kept-sale',amount:123}],payments:[],expenses:[],bank:[],audit:[],estimates:[],projects:[]}));
   localStorage.setItem('tsukinowa_chohyo_confirmed_history_v1',JSON.stringify([{historyId:'formal',docType:'invoice',customerName:'既存顧客',items:[]} ]));
   localStorage.setItem('tsukinowa_unrelated_preserved','yes');
  });
  await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({body:''}));
  await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{hasGrantedAllScopes:(r,...s)=>s.every(x=>r.scope.split(' ').includes(x)),initTokenClient:config=>{window.oauthConfig=config;return {requestAccessToken(){this.callback({access_token:'test-token',expires_in:3600,scope:config.scope})}}}}}};`}));
  let eventTitle='株式会社テスト｜壁紙｜12000';let readonly=false;let conflict=true;
  await page.route('https://www.googleapis.com/**',async route=>{
   const req=route.request(),u=new URL(req.url());requests.push(u);
   if(u.pathname.endsWith('/calendarList'))return route.fulfill({json:u.searchParams.has('pageToken')?{items:[{id:'shared@example.com',summary:'月輪合同会社 業務システム',accessRole:'writer'}]}:{items:[{id:'primary@example.com',primary:true,summary:'個人',accessRole:'owner'},{id:'readonly@example.com',summary:'読取',accessRole:'reader'}],nextPageToken:'next'}});
   if(req.method()==='PATCH'){
    if(readonly)return route.fulfill({status:403,json:{error:{message:'Read only'}}});
    if(conflict){conflict=false;return route.fulfill({status:412,json:{error:{message:'Changed'}}});}
    patches.push({url:u.href,body:req.postDataJSON(),headers:req.headers()});return route.fulfill({json:{id:'event1'}});
   }
   if(/\/events\//.test(u.pathname))return route.fulfill({json:{id:'event1',etag:'"revision"',summary:'変更済み',description:'Google上の最新メモ'}});
   const event=(id,summary,date='2026-09-10')=>({id,iCalUID:'same-recurring-uid',summary,start:{date},end:{date:'2026-09-11'}});
   return route.fulfill({json:u.searchParams.has('pageToken')?{items:[event('event2','小野田、genovia浅草1002、68.8米')]}:{items:[event('event1',eventTitle),event('off','Off'),event('holiday','敬老の日'),event('desc','現場作業'),{...event('cancelled','取消'),status:'cancelled'}],nextPageToken:'events-next'}});
  });
  await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false,companyId:'tsukinowa',firebase:{}}}));
  await page.goto(base);await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>localStorage.getItem('tsukinowa_unrelated_preserved')),'yes');
  assert.equal(await page.evaluate(()=>loadConfirmedHistory()[0].customerName),'既存顧客');
  await page.evaluate(()=>bizGoogleConnect());
  assert.equal(await page.evaluate(()=>bizGoogleCalendarId),'shared@example.com');
  assert.equal(await page.locator('#googleCalendarSelect option').count(),4);
  assert.equal(await page.evaluate(()=>oauthConfig.scope.split(' ').length),2);
  await page.evaluate(()=>{document.getElementById('calendarMonth').value='2026-09';return bizGoogleSyncMonth();});
  await page.evaluate(()=>bizGoogleSyncMonth());
  assert.equal(await page.evaluate(()=>bizState.calendar.length),4); // retained + 3 accepted events
  assert(requests.some(u=>u.searchParams.get('timeMin')==='2026-09-01T00:00:00+09:00'));
  assert.equal(await page.evaluate(()=>bizState.calendar.filter(e=>e.uid==='same-recurring-uid').length),3);
  assert.equal(await page.evaluate(()=>bizShouldIgnoreCalendarEvent({title:'現場作業',description:'担当者は有休ですが施工あり'})),false);
  assert.equal(await page.evaluate(()=>parseOnodaEvent(bizState.calendar.find(e=>e.googleEventId==='event2'))[0].qty),68.8);
  // Manual selection survives refresh, while writeback still uses the event's source calendar.
  await page.evaluate(async()=>{bizGoogleSelectCalendar('readonly@example.com');await bizGoogleLoadCalendars(true);});
  assert.equal(await page.evaluate(()=>bizGoogleCalendarId),'readonly@example.com');
  await page.evaluate(()=>{
   const e=bizState.calendar.find(e=>e.googleEventId==='event1');bizLoadDocFromEvent(e,'invoice');
   document.getElementById('customerName').value='正式顧客';items=[{content:'工事',qty:1,price:50000,unit:'式',taxable:true}];recalc();saveConfirmedHistory();
  });
  await page.waitForFunction(()=>bizGooglePatchJobs.size===0);
  assert.equal(patches.length,1);assert(patches[0].url.includes('shared%40example.com'));assert(patches[0].body.summary.includes('正式顧客'));
  assert(patches[0].body.description.includes('Google上の最新メモ'));assert(patches[0].body.description.includes('正式金額:'));assert(patches[0].body.description.includes('calendar=shared%40example.com'));assert.equal(patches[0].headers['if-match'],'"revision"');
  const snapshot=await page.evaluate(()=>JSON.stringify(loadConfirmedHistory()));
  eventTitle='変更顧客｜999999';
  await page.evaluate(()=>{bizGoogleSelectCalendar('shared@example.com');return bizGoogleSyncMonth();});
  assert.equal(await page.evaluate(()=>JSON.stringify(loadConfirmedHistory())),snapshot);
  assert.equal(await page.evaluate(()=>bizState.calendar.find(e=>e.googleEventId==='event1').customerName),'正式顧客');
  assert(await page.evaluate(()=>bizState.calendar.find(e=>e.googleEventId==='event1').title.includes('正式顧客')));
  await page.evaluate(()=>{bizClearDocLink();openSavedDoc(0);});
  assert(await page.evaluate(()=>!!bizCurrentCalendarId));
  // New blank document must not retain the last invoice's event link.
  await page.evaluate(()=>setDocType('receipt'));assert.equal(await page.evaluate(()=>bizCurrentCalendarId),'');
  readonly=true;
  await page.evaluate(()=>{const e=bizState.calendar.find(e=>e.googleEventId==='event1');return bizGooglePatchEvent(e);});
  assert.equal(await page.evaluate(()=>bizState.calendar.find(e=>e.googleEventId==='event1').googlePatchPending),true);
  readonly=false;await page.evaluate(()=>bizGoogleSyncMonth());
  assert.equal(await page.evaluate(()=>bizState.calendar.find(e=>e.googleEventId==='event1').googlePatchPending),false);
  for(const name of ['dashboard','calendar','estimates','projects','chohyo','savedDocs','monthly'])await page.evaluate(n=>bizSwitchPage(n),name);
  assert.deepEqual(errors,[]);
  console.log('PASS',mobile?'mobile':'desktop','startup preservation, OAuth, paginated shared calendars/events, filters, dedup, save/writeback, ETag retry, official-data protection, saved-doc links, retry and navigation');
  await context.close();
 }
 }finally{await browser.close();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
