// Values that come from imported data (ICS UID, CSV/backup IDs, historical line items) are rendered as data, never as markup or script.
// Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
const evil=`x');window.__xss=1;//"><img src=x onerror="window.__xss=2">`;
const business={estimates:[{id:evil,date:'2026-12-01',customer:'試験客',content:'試験',amount:1000,status:'受注',snapshot:{docType:'estimate',items:[]}}],projects:[],
 calendar:[{id:evil,source:'ics',date:'2026-12-03',start:'2026-12-03',end:'2026-12-04',title:'取込 試験'}],audit:[],expenses:[{id:evil,date:'2026-12-02',category:'消耗品',method:'現金',amount:500,memo:'試験'}],bank:[],payments:[],
 sales:[{id:evil,customer:'試験客',saleDate:'2026-12-01',invoiceDate:'2026-12-01',content:'試験',amount:1000,paymentMethod:'銀行振込'}]};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
  await page.clock.setFixedTime(new Date('2026-12-05T01:00:00Z'));
  await page.addInitScript(b=>{if(!localStorage.getItem('tsukinowa_business_v1'))localStorage.setItem('tsukinowa_business_v1',b);},JSON.stringify(business));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const calls=await page.evaluate(()=>{const seen=[];for(const n of ['openEventModal','deleteExpense','bizEstimateFromHistory','bizAcceptEstimate','requestEstimateInvoice'])window[n]=(...a)=>seen.push([n,a[0]]);window.__seen=seen;
   bizSwitchPage('calendar');renderCalendarEvents();bizSwitchPage('expenses');renderExpenses();bizSwitchPage('estimates');renderEstimates();renderPaymentSaleOptions();
   const handlers=[...document.querySelectorAll('#calendarRows [onclick],#expenseRows [onclick],#estimateList [onclick]')].filter(b=>/openEventModal|deleteExpense|bizEstimateFromHistory|bizAcceptEstimate|requestEstimateInvoice/.test(b.getAttribute('onclick')));
   handlers.forEach(b=>b.click());return {n:handlers.length,seen,option:[...document.querySelectorAll('#paymentSale option')].map(o=>o.value)};});
  assert.ok(calls.n>=4,'handlers rendered: '+calls.n);
  for(const [name,arg] of calls.seen)assert.equal(arg,evil,name+' receives the original ID as data');
  assert.ok(calls.option.includes(evil),'option value keeps the ID');
  // historical/imported line items: quantity and price are escaped in the editor and the preview
  const items=await page.evaluate(()=>{bizSwitchPage('chohyo');setDocType('invoice');items=[{content:'試験',qty:'1"><img src=x onerror="window.__xss=3">',unit:'式',price:'2"><img src=x onerror="window.__xss=4">'}];renderItemEditor();recalc();
   return {imgs:document.querySelectorAll('#itemsArea img[src="x"],#docPreview img[src="x"],img[src="x"]').length};});
  assert.equal(items.imgs,0,'no injected elements');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__xss),undefined,'no script ran');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('xss escape browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
