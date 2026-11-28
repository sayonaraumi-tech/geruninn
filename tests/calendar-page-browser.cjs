// 日程 page after the 2026-11-28 live fixes (local mode, synthetic data):
// month grid + day list only (no 同期済み日程 table, no 日程の保存先 panel), small toolbar (要確認 toggle, 小野田, Google),
// empty day → 本地予定を登録 for that date, ＋ on a day with events, 設定「Googleカレンダー連携を使う」,
// origin labels 帳票・受注／請求書／領収書, issued-document event detail (開く only), 小野田 import from plain schedules.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
const ev=(id,date,title,extra={})=>({id,date,start:date,end:date,title,originalTitle:title,source:'google',googleEventId:'g'+id,googleCalendarId:'primary',...extra});
const history=[
 {historyId:'h_r1',documentId:'h_r1',docType:'receipt',customerName:'上',invoiceNo:'20261117-0900-01',invoiceDate:'2026-11-17',documentStatus:'active',items:[{content:'クロス補修',qty:1,price:23000}],receiptTotal:23000},
 {historyId:'h_i1',documentId:'h_i1',docType:'invoice',customerName:'株式会社WOOC',invoiceNo:'20261120-0900-01',invoiceDate:'2026-11-20',documentStatus:'active',items:[{content:'カーペット張替\n2F 会議室',qty:1,price:56000}]}];
const business={estimates:[],projects:[],audit:[],expenses:[],bank:[],payments:[],sales:[],calendar:[
 ev('a1','2026-11-17','上｜クロス補修｜¥23,000｜領収済',{linkedReceiptId:'h_r1',documentId:'h_r1',status:'領収済'}),
 ev('a2','2026-11-20','株式会社WOOC｜カーペット張替｜¥61,600｜請求済',{linkedInvoiceId:'h_i1',documentId:'h_i1',status:'請求済'}),
 ev('a3','2026-11-24','琢居株式会社｜クロス張替｜¥88,000｜請求済',{linkedEstimateId:'est1',estimateId:'est1',projectId:'p1',linkedInvoiceId:'h_i2',status:'請求済'}),
 ev('a4','2026-11-12','Google 打合せ'),
 ev('a5','2026-11-13','取消された予定',{googleStatus:'cancelled'})]};
async function open(browser,width,dialogs){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
 const requests=[];await page.route('https://**/*',r=>{requests.push(r.request().url());r.fulfill({body:''});});await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
 await page.clock.setFixedTime(new Date('2026-11-28T03:00:00Z'));
 await page.addInitScript(([b,h])=>{if(!localStorage.getItem('tsukinowa_business_v1')){localStorage.setItem('tsukinowa_business_v1',b);localStorage.setItem('tsukinowa_chohyo_confirmed_history_v1',h);}},[JSON.stringify(business),JSON.stringify(history)]);
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>bizSwitchPage('calendar'));return {page,errors,requests};
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 for(const width of [1280,390]){
  const dialogs=[],{page,errors,requests}=await open(browser,width,dialogs);
  // one calendar view: no duplicate table, no 日程の保存先 panel; toolbar keeps 要確認 toggle, 小野田 import and a small Google button
  assert.equal(await page.locator('#pageCalendar table,#calendarRows').count(),0);assert.equal(await page.locator('#ddCalendarSources,[data-dd-copy-month]').count(),0);
  for(const sel of ['#calendarReview','#pageCalendar .cal-tools button:has-text("小野田明細読込")','#googleCalendarSync'])assert.equal(await page.locator(sel).isVisible(),true,sel);
  const sync=await page.locator('#googleCalendarSync').boundingBox();assert.ok(sync.height<=32&&sync.width<220,'small Google button '+JSON.stringify(sync));
  // labels by origin
  const label=async d=>{await page.locator(`#ddCalendar [data-dd-day="${d}"]`).click();return page.locator('#ddCalendar .dd-day-list .dd-src').first().innerText();};
  assert.equal(await label('2026-11-17'),'領収書');assert.equal(await label('2026-11-20'),'請求書');assert.equal(await label('2026-11-24'),'帳票・受注');assert.equal(await label('2026-11-12'),'Google');
  // 要確認 (cancelled in Google) is reachable through the toggle
  assert.equal(await page.locator('#ddCalendar [data-dd-event="a5"]').count(),0);
  await page.locator('#calendarReview').check();await page.locator('#ddCalendar [data-dd-day="2026-11-13"]').click();assert.equal(await page.locator('#ddCalendar [data-dd-event="a5"]').count(),1);await page.locator('#calendarReview').uncheck();
  // issued 領収書: only 開く; issued 請求書: 開く + 領収書作成; 開く opens the saved document
  const detail=async d=>{await page.locator(`#ddCalendar [data-dd-day="${d}"]`).click();await page.locator('#ddCalendar .dd-day-list [data-dd-open]').first().click();
   return page.$$eval('#bizEventModal .biz-actions button',b=>b.filter(x=>!x.hidden&&x.offsetParent).map(x=>x.textContent.trim()));};
  assert.deepEqual(await detail('2026-11-17'),['開く']);assert.doesNotMatch(await page.locator('#eventModalBody').innerText(),/Google Calendar API連動中/);assert.match(await page.locator('#eventModalBody').innerText(),/訂正版を作成/);
  await page.evaluate(()=>closeEventModal());
  assert.deepEqual(await detail('2026-11-20'),['開く','領収書作成']);
  await page.locator('#eventOpenDocument').click();assert.equal(await page.evaluate(()=>document.getElementById('pageChohyo').classList.contains('active')),true);assert.equal(await page.inputValue('#customerName'),'株式会社WOOC');
  await page.evaluate(()=>bizSwitchPage('calendar'));
  // empty day opens 本地予定を登録 for that date; a day with events shows its list, ＋ adds on that day
  await page.locator('#ddCalendar [data-dd-day="2026-11-10"]').click();assert.equal(await page.locator('#ddLocalEvent').isVisible(),true);assert.equal(await page.inputValue('#ddLeDate'),'2026-11-10');
  // 月結 customer: plain schedule, no sale
  await page.fill('#ddLeTitle','小野田, maxiv, 横浜阪東橋due1103, 54.9米');assert.equal(await page.locator('#ddLeSaleOn').isChecked(),false);await page.locator('#ddLeSave').click();
  await page.waitForFunction(()=>!document.getElementById('ddLocalEvent').open);
  assert.equal(await page.locator('#ddCalendar [data-dd-day="2026-11-10"]').getAttribute('data-dd-count'),'1');
  await page.locator('#ddCalendar [data-dd-day="2026-11-10"]').click();assert.equal(await page.locator('#ddLocalEvent').isVisible(),false,'day with events: list only');
  await page.locator('#ddCalendar [data-dd-new-day]').click();assert.equal(await page.inputValue('#ddLeDate'),'2026-11-10');await page.locator('#ddLeCancel').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tsukinowa_business_v1')).sales.length),0,'schedule creates no sale');
  // month-end 小野田明細読込 → 請求書 finds the plain schedule
  await page.locator('#pageCalendar .cal-tools button:has-text("小野田明細読込")').click();
  await page.waitForFunction(()=>typeof items!=='undefined'&&items.some(x=>x.sourceDate==='2026-11-10'));
  assert.ok(await page.evaluate(()=>items.some(x=>/阪東橋/.test(x.content)&&x.sourceDate==='2026-11-10')),'小野田 import uses the 本地 schedule');
  await page.evaluate(()=>bizSwitchPage('calendar'));
  // local mode: 請求書 then 領収書 from a schedule write the formal title 宛名｜施工項目首行｜¥金額｜状態
  const titles=await page.evaluate(()=>{bizState.calendar.push({id:'t1',source:'local',date:'2026-11-26',start:'2026-11-26',end:'2026-11-26',title:'山田 網戸'});bizCurrentCalendarId='t1';
   const st={calendarEventId:'t1',historyId:'h_t1',documentId:'h_t1',invoiceNo:'20261126-0900-01',customerName:'山田',invoiceDate:'2026-11-26',paymentMethod:'銀行振込',items:[{content:'網戸張替\n2枚',qty:1,price:10000}]};
   bizOnDocumentConfirmed({...st,docType:'invoice'});const a=bizState.calendar.find(e=>e.id==='t1').title;
   bizCurrentCalendarId='t1';bizOnDocumentConfirmed({...st,docType:'receipt',historyId:'h_t1r',documentId:'h_t1r',receiptTotal:11000,saleId:bizState.sales.find(x=>x.sourceId==='h_t1').id});const e=bizState.calendar.find(e=>e.id==='t1');return [a,e.title,bizCalendarSourceLabel(e)];});
  assert.match(titles[0],/^山田｜網戸張替｜¥[\d,]+｜請求済$/);assert.match(titles[1],/^山田｜網戸張替｜¥[\d,]+｜領収済$/);assert.equal(titles[2],'本地','a schedule the user made keeps its 本地 label');
  // 設定: Googleカレンダー連携を使う (default on). Off hides sync / per-event Google checkbox, stops pushes, keeps Google events read-only with コピー.
  assert.equal(await page.evaluate(()=>bizGoogleEnabled()),true);
  await page.evaluate(()=>{bizSwitchPage('settings');});await page.locator('#googleCalendarEnabled').uncheck();
  await page.evaluate(()=>bizSwitchPage('calendar'));assert.equal(await page.locator('#googleCalendarSync').isVisible(),false);
  await page.locator('#ddCalendar [data-dd-day="2026-11-12"]').click();assert.equal(await page.locator('#ddCalendar [data-dd-copy="a4"]').isVisible(),true,'Google event can still be copied');
  await page.locator('#ddCalendar [data-dd-new-day]').click();assert.equal(await page.locator('#ddLePush').isVisible(),false);await page.locator('#ddLeCancel').click();
  const before=requests.length;await page.evaluate(async()=>{bizGoogleAccessToken='t';bizGoogleTokenExpiresAt=Date.now()+3600e3;await bizGoogleSyncMonth();await bizGooglePatchNow('a2');});
  assert.equal(requests.filter(u=>u.includes('googleapis')).length-requests.slice(0,before).filter(u=>u.includes('googleapis')).length,0,'no Google calls when off');
  await page.reload();await page.evaluate(()=>bizSwitchPage('calendar'));assert.equal(await page.locator('#googleCalendarSync').isVisible(),false,'setting kept on this device');
  await page.evaluate(()=>bizGoogleSetEnabled(true));assert.equal(await page.locator('#googleCalendarSync').isVisible(),true);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+'px 日程 page');
 }
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
