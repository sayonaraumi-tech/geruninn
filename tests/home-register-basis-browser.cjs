// ホーム 入金 / 未収金 use the 売上・入金 CSV basis (chiori, 2026-11-28): same month, same numbers as the CSV, desktop and mobile.
// 売上 and 収支差額 keep their definitions; nothing is written.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{for(const width of [390,1280]){const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',timezoneId:'Asia/Tokyo'}),errors=[];await page.clock.setFixedTime(new Date('2026-12-05T01:00:00Z'));page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));await page.goto('http://127.0.0.1:'+server.address().port);

 await page.evaluate(async()=>{
  const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
  const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role:'admin',companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);
  window.testRecords=records;window.testClient=client;window.testService=TsukinowaBusiness.createService(client);bizGoogleAccessToken='';bizGoogleTokenExpiresAt=0;bizGoogleGrantedScopes=TSUKINOWA_GOOGLE_SCOPE;bizGoogleCalendarId='shared';bizGoogleCalendarsLoaded=true;
 });
 // Synthetic patterns that make the 売上・入金 CSV and the home KPIs differ for the same month (no real names).
 await page.waitForTimeout(300);
 await page.evaluate(()=>{const wrap=payload=>({id:payload.id,payload}),sale=(id,salesDate,amount)=>wrap({id,salesDate,invoiceDate:salesDate,amount,customer:'顧客'+id,content:'施工'}),pay=(id,saleId,paymentDate,amount,confirmation='bank-confirmed')=>wrap({id,saleId,paymentDate,amount,confirmation,method:'銀行振込'});
  window.fixture={sales:[sale('A','2026-11-05',100000),sale('B','2026-10-20',50000),sale('C','2026-11-12',80000),sale('D','2026-09-01',30000),sale('E','2026-11-20',40000)],
   payments:[pay('pA','A','2026-12-03',100000),pay('pB','B','2026-11-10',50000),pay('pE','E','2026-11-25',40000,'pending-bank'),pay('pX','','2026-11-15',7000,'cash-received')]};
  TsukinowaAccountingUI.hydrate(window.fixture);bizSwitchPage('sales');for(const [id,v] of [['salesPeriodMode','month'],['salesMonth','2026-11'],['receivableAsOf','2026-12-05']])document.getElementById(id).value=v;renderSales();
  bizSwitchPage('dashboard');document.getElementById('homePeriodMode').value='month';document.getElementById('homeMonth').value='2026-11';renderDashboard();});
 const before=await page.evaluate(()=>JSON.stringify(TsukinowaAccountingUI.getData()));
 const num=t=>Number(String(t).replace(/[^\d-]/g,''));
 // 1) The CSV export rows are exactly the register rows (same function), summed.
 const csv=await page.evaluate(()=>TsukinowaAccountingUI.salesRegisterView().rows.map(r=>r.slice()));
 assert.deepEqual(csv.map(r=>r[1]).sort(),['顧客A','顧客C','顧客E']);
 const csvSum=i=>csv.reduce((n,r)=>n+num(r[i]),0);assert.deepEqual([csvSum(5),csvSum(6),csvSum(7)],[220000,100000,120000],width+': CSV 請求額/入金済/未収');
 // 2) Home 入金 / 未収金 equal the CSV sums; 売上 is the same; 収支差額 stays 確認済み入金 dated in the month − 支出.
 const kpi=await page.evaluate(()=>Object.fromEntries(['kpiSales','kpiPayments','kpiReceivable','kpiDifference'].map(id=>[id,document.getElementById(id).textContent])));
 assert.deepEqual([num(kpi.kpiSales),num(kpi.kpiPayments),num(kpi.kpiReceivable)],[csvSum(5),csvSum(6),csvSum(7)],width+': home = CSV');
 assert.deepEqual([num(kpi.kpiSales),num(kpi.kpiPayments),num(kpi.kpiReceivable),num(kpi.kpiDifference)],[220000,100000,120000,57000],width+': home KPIs on the CSV basis');
 assert.equal(await page.evaluate(()=>TsukinowaAccounting.aggregate(TsukinowaAccountingUI.homeData(),TsukinowaAccounting.periodFilter({month:'2026-11'})).cashFlowDifference),57000,'aggregate unchanged');
 assert.match(await page.$eval('#kpiPayments',e=>e.title),/売上・入金CSVと同じ基準.*2026-12-05/);
 // 3) The basis accessor matches the CSV and explains the difference from the period-dated payments in 収支差額.
 const basis=await page.evaluate(()=>TsukinowaAccountingUI.registerBasis(TsukinowaAccounting.periodFilter({month:'2026-11'}),'2026-12-05'));
 assert.deepEqual(basis,{count:3,sales:220000,paid:100000,outstanding:120000,laterPaid:100000,otherPeriodPaid:57000});
 assert.equal(basis.paid-basis.laterPaid+basis.otherPeriodPaid,57000,'CSV 入金済 − 期間後入金 + 他期間入金 = 収支差額の入金');
 // 4) The home figures follow the 入金基準日 of the 売上・入金 page, like the CSV.
 await page.evaluate(()=>{document.getElementById('receivableAsOf').value='2026-12-01';renderSales();renderDashboard();});
 const csv2=await page.evaluate(()=>TsukinowaAccountingUI.salesRegisterView().rows.map(r=>r.slice()));
 assert.deepEqual(await page.evaluate(()=>['kpiPayments','kpiReceivable'].map(id=>document.getElementById(id).textContent)),['0','220,000'],width+': 入金基準日 before the payment');
 assert.deepEqual([csv2.reduce((n,r)=>n+num(r[6]),0),csv2.reduce((n,r)=>n+num(r[7]),0)],[0,220000],width+': CSV with the same 入金基準日');
 // 5) No duplicate panel: the separate CSV-basis panel is gone on every width.
 assert.equal(await page.locator('#ddHomeRegister,[data-dd-reg-note]').count(),0,width+': no extra panel');
 assert.equal(await page.evaluate(()=>JSON.stringify(TsukinowaAccountingUI.getData())),before,width+': display only, no data change');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('home register basis browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
