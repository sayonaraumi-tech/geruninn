// 入金基準日 / 対象月 follow the current date on every render unless the user chose a value,
// so a payment registered after the date changes appears without reloading the page.
// The device clock is Japan time (the app uses the device's local date), also on UTC CI runners.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
const business={estimates:[],projects:[],calendar:[],audit:[],expenses:[],bank:[],payments:[],sales:[{id:'fresh_sale',customer:'鮮度テスト',content:'施工',amount:11000,saleDate:'2026-11-20',invoiceDate:'2026-11-20',paymentMethod:'銀行振込'}]};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',timezoneId:'Asia/Tokyo'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
 await page.clock.install({time:new Date('2026-11-30T14:58:00Z')});// 2026-11-30 23:58 JST
 await page.addInitScript(b=>{if(!localStorage.getItem('tsukinowa_business_v1'))localStorage.setItem('tsukinowa_business_v1',b);},JSON.stringify(business));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>bizSwitchPage('sales'));
 const values=()=>page.evaluate(()=>Object.fromEntries(['receivableAsOf','salesMonth','homeMonth','expenseMonth','paymentDate'].map(id=>[id,document.getElementById(id).value])));
 assert.deepEqual(await values(),{receivableAsOf:'2026-11-30',salesMonth:'2026-11',homeMonth:'2026-11',expenseMonth:'2026-11',paymentDate:'2026-11-30'},width+': defaults');
 // A value the user picked is never replaced.
 await page.evaluate(()=>{const e=document.getElementById('expenseMonth');e.value='2026-10';e.dispatchEvent(new Event('change'));});
 // Midnight passes while the app stays open; showing the window again re-renders.
 await page.clock.setSystemTime(new Date('2026-11-30T15:01:00Z'));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 assert.deepEqual(await values(),{receivableAsOf:'2026-12-01',salesMonth:'2026-12',homeMonth:'2026-12',expenseMonth:'2026-10',paymentDate:'2026-12-01'},width+': follows the new day, keeps the manual month');
 // Register today's payment through the existing form; it shows immediately, no reload.
 await page.evaluate(()=>{const e=document.getElementById('salesMonth');e.value='2026-11';e.dispatchEvent(new Event('change'));renderSales();});
 await page.evaluate(()=>{document.getElementById('paymentSale').value='fresh_sale';document.getElementById('paymentAmount').value='11000';});
 await page.evaluate(()=>addPayment());
 await page.waitForFunction(()=>document.querySelector('#salesRows tr[data-sale-id="fresh_sale"]')?.textContent.includes('入金済'));
 const row=await page.$eval('#salesRows tr[data-sale-id="fresh_sale"]',r=>[...r.cells].map(c=>c.textContent.trim()));
 assert.equal(row[6].replace(/[^\d]/g,''),'11000',width+': paid');assert.equal(row[8],'2026-12-01',width+': last payment date');
 assert.equal(await page.$eval('#receivableAsOf',e=>e.value),'2026-12-01');
 const home=await page.evaluate(()=>TsukinowaAccounting.aggregate({sales:bizState.sales.map(s=>({...s,salesDate:s.saleDate})),payments:bizState.payments.map(p=>({...p,paymentDate:p.paymentDate||p.date}))},TsukinowaAccounting.periodFilter({month:document.getElementById('homeMonth').value})).income);
 assert.equal(home,11000,width+': ホーム month follows the day and counts the payment');
 assert.match(await page.$eval('#kpiPayments',e=>e.textContent),/11,000/,width+': ホーム shows the payment');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('view freshness browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
