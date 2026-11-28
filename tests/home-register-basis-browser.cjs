// ホーム vs 売上・入金CSV: same month, different definitions; the CSV basis is shown read-only on desktop.
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
 // 2) Home KPIs keep their existing definitions (unchanged numbers).
 const kpi=await page.evaluate(()=>Object.fromEntries(['kpiSales','kpiPayments','kpiReceivable'].map(id=>[id,document.getElementById(id).textContent])));
 assert.deepEqual([num(kpi.kpiSales),num(kpi.kpiPayments),num(kpi.kpiReceivable)],[220000,57000,250000],width+': home KPIs unchanged');
 // 3) The read-only CSV-basis accessor matches the CSV and explains the difference.
 const basis=await page.evaluate(()=>TsukinowaAccountingUI.registerBasis(TsukinowaAccounting.periodFilter({month:'2026-11'}),'2026-12-05'));
 assert.deepEqual(basis,{count:3,sales:220000,paid:100000,outstanding:120000,laterPaid:100000,otherPeriodPaid:57000});
 assert.equal(basis.paid-basis.laterPaid+basis.otherPeriodPaid,57000,'CSV 入金済 − 期間後入金 + 他期間入金 = home 入金');
 // 4) Desktop shows the CSV basis on ホーム; mobile is unchanged.
 const panel=page.locator('#ddHomeRegister');assert.equal(await panel.isVisible(),width>800,width+': CSV basis panel desktop-only');
 if(width>800){const v=await page.$$eval('#ddHomeRegister [data-dd-metric]',es=>Object.fromEntries(es.map(e=>[e.dataset.ddMetric,e.textContent])));
  assert.deepEqual([num(v['reg-sales']),num(v['reg-paid']),num(v['reg-outstanding'])],[220000,100000,120000]);
  assert.match(await page.locator('[data-dd-reg-note]').innerText(),/＋100,000.*−57,000/);}
 assert.equal(await page.evaluate(()=>JSON.stringify(TsukinowaAccountingUI.getData())),before,width+': display only, no data change');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('home register basis browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
