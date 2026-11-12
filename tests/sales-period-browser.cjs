const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{for(const width of (process.env.UI_SCREENSHOT_ONLY==='1'?[390,1280,1536,1648,1672]:[390,1280])){const page=await browser.newPage({viewport:{width,height:width===1536?864:width===1672?941:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));await page.goto('http://127.0.0.1:'+server.address().port);

 await page.evaluate(async()=>{
  const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
  const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role:'admin',companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);
  window.testRecords=records;window.testClient=client;window.testService=TsukinowaBusiness.createService(client);bizGoogleAccessToken='';bizGoogleTokenExpiresAt=0;bizGoogleGrantedScopes=TSUKINOWA_GOOGLE_SCOPE;bizGoogleCalendarId='shared';bizGoogleCalendarsLoaded=true;
 });

 await page.waitForFunction(()=>document.getElementById('coreSyncStatus')?.textContent==='クラウド同期済');
 await page.evaluate(()=>{const wrap=payload=>({id:payload.id,payload});TsukinowaAccountingUI.hydrate({sales:[wrap({id:'partial',salesDate:'2026-08-01',invoiceDate:'2026-08-01',amount:779379,customer:'顧客,"引用"\n改行'}),wrap({id:'paid',salesDate:'2026-09-20',amount:1000,customer:'入金済顧客'}),wrap({id:'unpaid',salesDate:'2026-10-31',amount:2000,customer:'未入金顧客'}),wrap({id:'future',salesDate:'2026-11-01',amount:500})],payments:[wrap({id:'p',saleId:'partial',paymentDate:'2026-08-25',amount:770379,confirmation:'bank-confirmed'}),wrap({id:'paid-p',saleId:'paid',paymentDate:'2026-10-01',amount:1000,confirmation:'bank-confirmed'}),wrap({id:'final',saleId:'partial',paymentDate:'2026-11-01',amount:9000,confirmation:'bank-confirmed'}),wrap({id:'pending',saleId:'unpaid',paymentDate:'2026-10-31',amount:2000,confirmation:'pending-bank'})]});bizSwitchPage('sales');document.getElementById('homePeriodMode').value='custom';document.getElementById('homeStart').value='';});

 if(process.env.UI_SCREENSHOT_ONLY==='1'){
   const dir=process.env.PREVIEW_DIR||'ui-preview';
   fs.mkdirSync(dir,{recursive:true});
   // Representative in-memory fixtures for visual inspection only. Never use
   // production Firestore, calendar data or sample financial totals.
   await page.evaluate(async()=>{
     // Real domain validation and normal mocked Firestore listeners, but
     // ONLY the in-memory test driver seeded above. No production access.
     const rows=[
       {documentId:'demo-est-001',docType:'estimate',customerName:'株式会社WOOC',invoiceDate:'2026-11-12',invoiceNo:'M-202611-0123',items:[{content:'内装クロス工事',qty:120,unit:'㎡',price:1400,taxable:true}],travelFee:0,remarks:'施工予定の見積り'},
       {documentId:'demo-inv-002',docType:'invoice',customerName:'シンケン株式会社',invoiceDate:'2026-11-08',invoiceNo:'I-202611-0088',items:[{content:'補修工事',qty:1,unit:'式',price:107860,taxable:true}],travelFee:0},
       {documentId:'demo-rec-003',docType:'receipt',customerName:'山与商事',invoiceDate:'2026-11-05',invoiceNo:'R-202611-0066',receiptTotal:112376,paymentMethod:'銀行振込'}
     ];
     for(const snapshot of rows)
       await testService.execute({type:'saveDocument',operationId:crypto.randomUUID(),expectedRevision:0,snapshot});
   });
   await page.waitForFunction(()=>loadConfirmedHistory().length===3,{timeout:10000});
   await page.evaluate(()=>{document.getElementById('homePeriodMode').value='month';document.getElementById('homeMonth').value='2026-11';renderDashboard();});
   const recordsBeforeVisualDraft=await page.evaluate(()=>JSON.stringify([...window.testRecords]));
   const routes={dashboard:'pageDashboard',calendar:'pageCalendar',estimates:'pageEstimates',chohyo:'pageChohyo',savedDocs:'pageSavedDocs',sales:'pageSales',expenses:'pageExpenses',bank:'pageBank',settings:'pageSettings'};
   const meta={width,pages:{},isDemo:true,changesToProduction:false};
   for(const [route,id]of Object.entries(routes)){

     if(route==='expenses'&&width>=801){
       await page.evaluate(()=>{
         const current=TsukinowaAccountingUI.getData(),snapshot={};
         for(const [kind,rows]of Object.entries(current))snapshot[kind]=(rows||[]).map(record=>({id:record.id,payload:{...record}}));
         window.__expenseDemoSnapshot=snapshot;
         const examples=[
           ['11-12','ENEOS 板橋SS','ガソリン','車両費','法人銀行デビット',6430,'card-csv'],
           ['11-10','カインズホーム','資材','材料仕入','クレジットカード',117645,'card-csv'],
           ['11-07','クロス商事','資材','材料仕入','銀行振込',336276,'bank-csv'],
           ['11-05','パーキング南池袋','駐車料金','旅費交通費','現金',1200,'cash-csv'],
           ['11-03','セブンイレブン','消耗品','消耗品費','法人銀行デビット',7980,'card-csv'],
           ['11-02','東京電力','事務所電気代','水道光熱費','銀行振込',18460,'bank-csv'],
           ['11-01','ワタナベ建材','外注費','外注費','クレジットカード',250000,'card-csv'],
           ['11-14','NTT','通信費','通信費','口座振替',14520,'bank-csv'],
           ['11-17','材料購入','領収書','材料仕入','現金',8950,'cash-csv'],
           ['11-20','パーキング','現場駐車場','旅費交通費','現金',2400,'cash-csv']
         ];
         const expenses=Array.from({length:37},(_,i)=>{
           const [d,vendor,description,category,paymentMethod,amount,sourceType]=examples[i%examples.length];
           return {id:'visual-exp-'+i,expenseDate:'2026-11-'+String(i<10?30-i:1+(i-10)%20).padStart(2,'0'),amount:amount+(i>=10?i:0),vendor,description,category,paymentMethod,sourceType,bankAccount:'デモ',createdAt:{seconds:1}};
         });
         snapshot.expenses=expenses.map(e=>({id:e.id,payload:e}));
         TsukinowaAccountingUI.hydrate(snapshot);
         document.getElementById('expenseMonth').value='2026-11';
         renderExpenses();
       });
     }

     await page.evaluate(r=>bizSwitchPage(r),route);
     await page.evaluate(()=>scrollTo(0,0));
     assert(await page.locator('#'+id).isVisible(),'UI page not visible: '+route);
     if(route==='dashboard' && width===1280){
       assert.equal(await page.locator('#pageDashboard .tsuki-home-primary .biz-card').count(),4);
       assert.equal(await page.locator('#tsukiHomeChart .tsuki-chart-month').count(),11);
       assert(await page.locator('#tsukiHomeDonut .tsuki-donut-ring').count()===1);
     }
     if(route==='chohyo' && width===1280){
       const a=await page.locator('#pageChohyo > .editor-card').first().boundingBox();
       const b=await page.locator('#itemsCard').boundingBox();
       const c=await page.locator('#previewArea').boundingBox();
       assert(a&&b&&c&&Math.abs(a.x-b.x)<3&&a.y<b.y&&a.x<c.x&&Math.abs(a.y-c.y)<3,'document must use a left stacked editor/detail column and right A4 preview; '+JSON.stringify({a,b,c,layout:await page.locator('#pageChohyo').evaluate(el=>({display:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns,classes:el.className}))}));
       assert(await page.locator('#previewArea').isVisible(),'actual original A4 preview must be visible');
     }
     if(route==='savedDocs'){
       assert.equal(await page.locator('#allSavedDocsList .biz-actions').count(),3,'all three visual demo documents must be visible');
       await page.locator('#tsukiSavedDocType').selectOption('estimate');
       assert.equal(await page.locator('#allSavedDocsList .biz-actions').count(),1,'saved type filter keeps only estimates');
       await page.locator('#allSavedDocsList button').filter({hasText:'詳細'}).click();
       assert(await page.locator('#tsukiSavedDocDetail').isVisible());
       assert(await page.locator('#tsukiSavedDocDetail').getByText('請求書に変換').count()===1);
       assert(await page.locator('#tsukiSavedDocDetail').getByText('領収書に変換').count()===1);
       await page.locator('#tsukiSavedDocDetail').scrollIntoViewIfNeeded();
       await page.screenshot({path:path.join(dir,'savedDocs-detail-'+width+'.png'),fullPage:width>=801});
       const before=await page.evaluate(()=>JSON.stringify(loadConfirmedHistory()));
       await page.evaluate(()=>{
         window.confirm=()=>true;
         window.alert=()=>{};
         tsukiEstimateReceiptDraft(loadConfirmedHistory().findIndex(d=>d.docType==='estimate'));
       });
       assert.equal(await page.locator('#receiptTotal').inputValue(),String(await page.evaluate(()=>bizCalcDocumentTotal(loadConfirmedHistory().find(d=>d.docType==='estimate')))));
       assert.equal(await page.locator('#paymentMethod').inputValue(),'銀行振込');
       assert.equal(await page.evaluate(()=>JSON.stringify(loadConfirmedHistory())),before,'conversion preview must not change source estimate');
       assert.equal(await page.evaluate(()=>JSON.stringify([...window.testRecords])),recordsBeforeVisualDraft,'draft conversion must not create or update Firestore records');
       await page.evaluate(()=>{document.getElementById('tsukiSavedDocType').value='';renderAllSavedDocs();bizSwitchPage('savedDocs');});
     }
     if(route==='calendar'&&width===1280){
       const month=await page.locator('#pageCalendar>.biz-section:nth-child(2)').boundingBox();
       const schedule=await page.locator('#pageCalendar>.biz-section:nth-child(3)').boundingBox();
       assert(month&&schedule&&month.x<schedule.x&&Math.abs(month.y-schedule.y)<5,'approved desktop calendar must show month and schedule side by side');
     }
     if(route==='calendar'){
       const dayCells=page.locator('#tsukiMonthDays button.tsuki-month-day');
       assert((await dayCells.count())>=28,'month calendar missing day buttons');
       const day=dayCells.first();
       await day.click();
       assert.equal(await day.getAttribute('aria-pressed'),'true');
       assert(await page.locator('#tsukiCalendarListTitle').innerText()!=='同期済み日程');
       await page.locator('#tsukiCalendarShowAll').click();
       assert.equal(await page.locator('#tsukiCalendarListTitle').innerText(),'同期済み日程');
     }
     if(width===1280&&(route==='sales'||route==='expenses')){
       const first=route==='sales'?'#pageSales .sales-register':'#pageExpenses .tsuki-exp-sidebar';
       const second=route==='sales'?'#paymentRegistrationForm':'#pageExpenses .tsuki-exp-main';
       const left=await page.locator(first).boundingBox(),right=await page.locator(second).boundingBox();
       assert(left&&right&&left.x<right.x&&Math.abs(left.y-right.y)<4,route+' desktop working areas must be side by side');
     }
     const box=await page.locator('#'+id).boundingBox();
     const details=await page.locator('#'+id).evaluate(e=>({font:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,background:getComputedStyle(e).backgroundColor}));
     meta.pages[route]={...details,width:box?.width,height:box?.height};
     await page.screenshot({path:path.join(dir,route+'-'+width+'.png'),fullPage:width>=801&&!(width===1536&&(route==='dashboard'||route==='expenses'))&&!(route==='dashboard'&&width===1672)});
     if(route==='bank'&&width===1280){
       const names=['.tsuki-bank-transactions','.tsuki-bank-candidates','.tsuki-bank-operations'];
       const rects=await Promise.all(names.map(n=>page.locator('#pageBank '+n).boundingBox()));
       assert(rects.every(Boolean)&&rects[0].x<rects[1].x&&rects[1].x<rects[2].x,'bank must have three side-by-side work zones');
       await page.evaluate(()=>{
         window.__tsukiBankProbe=0;
         document.getElementById('bankRows').innerHTML='<tr><td>2026-11-12</td><td>テスト取引 / GMO</td><td>+100</td><td></td><td><details data-bank-detail="bank-demo"><summary><span class="bank-candidate">売上候補 1件</span>確認・処理</summary><div class="bank-controls"><select id="bankTarget_demo"><option value="">照合先を選択</option><option value="sale-demo">売上 テスト取引</option></select><button type="button" onclick="window.__tsukiBankProbe++">照合確定</button></div></details></td><td>未照合</td></tr>';
         document.querySelector('#bankRows tr').click();
       });
       await page.waitForFunction(()=>!!document.querySelector('#tsukiBankCandidateMirror select'));
       await page.locator('#tsukiBankCandidateMirror select').selectOption('sale-demo');
       assert.equal(await page.locator('#bankTarget_demo').inputValue(),'sale-demo');
       await page.locator('#tsukiBankOperationMirror button').click();
       assert.equal(await page.evaluate(()=>window.__tsukiBankProbe),1,'mirrored action must call the original bank button exactly once');
       await page.evaluate(()=>document.getElementById('bankRows').replaceChildren());
     }
   }
   fs.writeFileSync(path.join(dir,'ui-meta-'+width+'.json'),JSON.stringify(meta,null,2));
   assert.deepEqual(errors,[],'visual capture page errors');
   console.log('PASS standalone V1.0 visual capture '+width+'px of nine real pages');
   await page.close();
   continue;
 }
 await page.evaluate(()=>{document.getElementById('salesPeriodMode').value='custom';document.getElementById('salesStart').value='2026-08-01';document.getElementById('salesEnd').value='2026-11-30';renderSales();});
 const table=()=>page.locator('#salesRegisterTable table').evaluate(t=>[...t.rows].map(r=>[...r.cells].slice(0,-1).map(c=>c.textContent)));
 assert.equal(await page.getByRole('button',{name:'CSV出力',exact:true}).count(),1);
 assert.equal(await page.locator('#receivableRows').count(),0);
 for(const date of ['2026-10-31','2026-09-30','2026-11-01']){
  await page.locator('#receivableAsOf').fill(date);await page.locator('#receivableAsOf').dispatchEvent('change');
  const expected=await table();assert.deepEqual(expected[0],['売上日','顧客','内容','請求書発行日','領収書発行日','請求額','入金済','未収','最終入金日','経過日数','状態']);
  if(date==='2026-10-31'){assert.equal(expected.length,4);assert.deepEqual(expected.slice(1).map(r=>r[10]),['一部入金','入金済','未入金']);assert.deepEqual(expected[1].slice(5,8),['779,379','770,379','9,000']);assert.equal(expected[1][8],'2026-08-25');assert.equal(expected[1][4],'');}
  await page.locator('#receivableAsOf').evaluate(e=>e.value='2027-01-01');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV出力',exact:true}).click()]);
  const bytes=fs.readFileSync(await download.path());assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert(bytes.toString('utf8').includes('\r\n'));assert.deepEqual(require('../js/accounting').parseCSV(bytes.toString('utf8').slice(1)),expected);assert.equal(download.suggestedFilename(),'salesRegister_'+date+'.csv');assert.deepEqual(await table(),expected);
 }
 await page.locator('#salesSort').selectOption('desc');assert.deepEqual((await table()).slice(1).map(r=>r[0]),['2026-11-01','2026-10-31','2026-09-20','2026-08-01']);
 await page.locator('#salesSort').selectOption('asc');
 await page.locator('#salesPeriodMode').selectOption('month');await page.locator('#salesMonth').fill('2026-10');await page.locator('#salesMonth').dispatchEvent('change');assert.equal((await table()).length,2);assert.equal((await table())[1][0],'2026-10-31');
 await page.locator('#salesPeriodMode').selectOption('year');await page.locator('#salesYear').fill('2026');await page.locator('#salesYear').dispatchEvent('change');assert.equal((await table()).length,3);
 await page.locator('[data-sale-detail="0"]').click();assert(await page.locator('#salesDetails').isVisible());await page.locator('#closeSalesDetails').click();assert(!await page.locator('#salesDetails').isVisible());
 if(process.env.PREVIEW_DIR){await page.evaluate(()=>{document.getElementById('salesPeriodMode').value='custom';document.getElementById('receivableAsOf').value='2026-10-31';renderSales();document.querySelector('#salesRegisterTable .biz-table-wrap').scrollLeft=0;});await page.screenshot({path:path.join(process.env.PREVIEW_DIR,'sales-register-'+width+'.png'),fullPage:true});}
 await require('./visual-baseline.cjs')(page,width);
 if(width===1280)await require('./estimate-history-layout.cjs')(page);
 await page.locator('#receivableAsOf').fill('2026-01-01');await page.locator('#receivableAsOf').dispatchEvent('change');
 const [empty]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV出力',exact:true}).click()]);assert.equal(require('../js/accounting').parseCSV(fs.readFileSync(await empty.path(),'utf8').slice(1)).length,1);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS unified register / cutoff / sort / month fiscal custom / UTF8 BOM CRLF / real CSV download / detail / '+width);await page.close();}}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
