// chiori desktop design: desktop shell/themes/views work, mobile (<=800px) keeps the previous UI, and nothing writes business data.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
const routes=['dashboard','calendar','estimates','chohyo','savedDocs','sales','expenses','bank','settings'];
const seed=()=>{localStorage.setItem('tsukinowa_business_v1',JSON.stringify({calendar:[{id:'c1',date:'2026-11-12',title:'山田様 クロス張替え',start:{date:'2026-11-12'},googleEventId:'c1'}],sales:[{id:'s1',saleDate:'2026-11-12',salesDate:'2026-11-12',amount:54800,customer:'山田様'}],payments:[],expenses:[{id:'x1',expenseDate:'2026-11-10',date:'2026-11-10',amount:24200,category:'材料仕入'}],bank:[{id:'b1',key:'b1',date:'2026-11-05',desc:'ヤマダ サマ',incoming:54800,outgoing:0,matched:false},{id:'b2',key:'b2',date:'2026-10-30',desc:'カード引落',incoming:0,outgoing:24200,matched:true}],audit:[],estimates:[{id:'e1',date:'2026-11-03',customer:'田中様',amount:77000,status:'見積済',content:'クロス張替'},{id:'e2',date:'2025-09-20',customer:'佐藤様',amount:10000,status:'受注',content:'穴補修'}],projects:[]}));
 localStorage.setItem('tsukinowa_chohyo_confirmed_history_v1',JSON.stringify([{historyId:'h1',docType:'invoice',customerName:'山田様',invoiceNo:'20261112-001',invoiceDate:'2026-11-12',items:[{content:'クロス張替',qty:1,price:49818}],travelFee:0,savedAt:'2026-11-12T03:00:00.000Z'},{historyId:'h2',docType:'receipt',customerName:'佐藤様',invoiceNo:'R-1',invoiceDate:'2025-10-01',receiptTotal:11000,savedAt:'2025-10-01T03:00:00.000Z'}]));localStorage.setItem('tsukinowa_preserved','yes');};
// The theme key and the editor's existing last-tab/scroll UI keys are not business data.
const businessStorage=page=>page.evaluate(()=>JSON.stringify(Object.keys(localStorage).filter(k=>k!=='tsukinowa_ui_theme'&&!/_v1_(lastTab|scrollY)$/.test(k)).sort().map(k=>[k,localStorage.getItem(k)])));
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,800,1280]){
   const mobile=width<=800,context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});
   await context.route('https://**/*',r=>r.fulfill({body:''}));await context.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
   await context.addInitScript(seed);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.clock.setFixedTime(new Date('2026-11-28T10:00:00+09:00'));
   await page.goto('http://127.0.0.1:'+server.address().port+'/?page=dashboard');
   const before=await businessStorage(page);
   const visibleAdded=()=>page.locator('.dd-only,#ddCrumb,#ddThemes,#ddHomeAnalytics,#ddCalendar,#ddChohyoHead').evaluateAll(xs=>xs.filter(x=>x.getClientRects().length&&getComputedStyle(x).display!=='none').map(x=>x.id||x.textContent));
   if(mobile){
    for(const route of routes){await page.evaluate(r=>bizSwitchPage(r),route);assert.deepEqual(await visibleAdded(),[],width+'px '+route+' shows no desktop-design element');}
    const style=await page.evaluate(()=>({pad:getComputedStyle(document.body).paddingLeft,bar:getComputedStyle(document.querySelector('.biz-topbar')).backgroundColor,nav:getComputedStyle(document.getElementById('bizNav')).position}));
    assert.deepEqual(style,{pad:'0px',bar:'rgb(20, 20, 20)',nav:'static'},width+'px keeps the previous top navigation');
    await page.evaluate(()=>bizSwitchPage('chohyo'));assert.equal(await page.locator('#previewArea').isVisible(),false,'mobile preview stays behind the existing toggle');
    assert.equal(await page.locator('#confirmedHistoryCard').isVisible(),true,'mobile keeps the history card');
    await page.evaluate(()=>bizSwitchPage('dashboard'));assert.equal(await page.locator('#pageDashboard h1').innerText(),'経営ダッシュボード','mobile keeps the previous heading');
    await page.evaluate(()=>bizSwitchPage('settings'));assert.equal(await page.locator('#pageSettings h1').innerText(),'Google Calendar API 接続設定');
    await page.evaluate(()=>bizSwitchPage('sales'));assert(await page.locator('#pageSales .biz-title button',{hasText:'手動売上'}).isVisible(),'mobile keeps its manual-sale button');
   }else{
    const nav=await page.locator('#bizNav').boundingBox(),bar=await page.locator('.biz-topbar').boundingBox();
    assert.equal(nav.x,0);assert.equal(Math.round(nav.width),205);assert.equal(Math.round(bar.x),205,'top header starts after the sidebar');
    for(const route of routes){
     await page.locator(`#bizNav [data-page="${route}"]`).click();
     assert.equal(await page.locator('#ddCrumb').innerText(),await page.locator(`#bizNav [data-page="${route}"]`).innerText(),route+' breadcrumb');
     const box=await page.locator('.app-page.active').boundingBox();assert(box.x>=205&&box.y>=bar.y+bar.height,route+' clears the sidebar and header');
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' has no horizontal overflow');
    }
    // Themes: UI preference only.
    for(const theme of ['gold','green','purple','dark','blue']){await page.locator(`#ddThemes [data-theme="${theme}"]`).click();assert.equal(await page.evaluate(()=>document.body.dataset.ddTheme),theme);assert.equal(await page.evaluate(()=>localStorage.getItem('tsukinowa_ui_theme')),theme);}
    await page.locator('#ddThemes [data-theme="green"]').click();await page.reload();assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--dd-acc').trim()),'#247b69','theme persists');
    // Home analytics use the existing aggregation.
    await page.evaluate(()=>bizSwitchPage('dashboard'));
    assert.equal(await page.locator('#ddHomeAnalytics .compare-slot').count(),12);
    assert.match(await page.locator('#ddHomeAnalytics').innerText(),/54,800/);
    await page.locator('#ddHomeAnalytics select[data-dd="compareMode"]').selectOption('years');assert.equal(await page.locator('#ddHomeAnalytics .compare-slot').count(),3);
    await page.locator('#ddHomeAnalytics select[data-dd="compareMetric"]').selectOption('expenses');assert.match(await page.locator('#ddHomeAnalytics .compare-foot').innerText(),/支出/);
    assert.match(await page.locator('#ddHomeAnalytics .balance-stats').innerText(),/24,200/);
    // 月次収支比較: the primary figure is the existing 収支差額 KPI; 売上 − 支出 is a labelled reference.
    await page.evaluate(()=>{homePeriodMode.value='month';homeMonth.value='2026-11';renderDashboard();});
    assert.equal(await page.locator('#ddHomeAnalytics [data-dd-balance="difference"]').innerText(),(await page.locator('#kpiDifference').innerText())+' 円','primary = 確認済み入金 − 支出');
    assert.equal(await page.locator('#ddHomeAnalytics [data-dd-balance="reference"]').innerText(),'30,600 円');assert.match(await page.locator('#ddHomeAnalytics .balance-primary').innerText(),/参考：売上 − 支出（未回収を含む）/);
    assert.match(await page.locator('#ddRecentSales').innerText(),/山田様[\s\S]*54,800/,'recent sales from the existing register');
    assert.deepEqual(await page.getByRole('heading',{level:1}).evaluateAll(xs=>xs.filter(x=>x.getClientRects().length).map(x=>x.innerText)),['ホーム'],'design page heading in markup');
    // Calendar grid shows the same rows as the list and opens the existing event dialog.
    await page.evaluate(()=>bizSwitchPage('calendar'));
    assert.equal(await page.locator('#ddCalendar [data-dd-day]').count(),30);
    await page.locator('#ddCalendar [data-dd-day="2026-11-12"]').click();
    await page.locator('#ddCalendar [data-dd-open="c1"]').click();assert(await page.locator('#bizEventModal').isVisible(),'existing event dialog opens');
    await page.evaluate(()=>closeEventModal());
    await page.locator('#pageCalendar .biz-title button',{hasText:'翌月'}).click();assert.equal(await page.locator('#calendarMonth').inputValue(),'2026-12');assert.equal(await page.locator('#ddCalendar [data-dd-day]').count(),31);
    // 帳票: live preview beside the form, the document itself keeps its A4 width.
    await page.evaluate(()=>bizSwitchPage('chohyo'));
    assert(await page.locator('#previewArea').isVisible(),'desktop preview is always visible on 帳票');assert.equal(await page.locator('#ddPreviewPlaceholder').isVisible(),false);assert.equal(await page.locator('#pageChohyo .btn-preview').isVisible(),false,'no preview toggle on desktop');
    const form=await page.locator('#pageChohyo .editor-card').first().boundingBox(),preview=await page.locator('#previewArea').boundingBox();assert(preview.x>form.x+form.width,'preview is to the right of the form');
    assert.equal(await page.locator('#previewArea .invoice').evaluate(e=>e.offsetWidth),Math.round(210*96/25.4),'invoice layout width stays 210mm');
    // The PDF export clones .invoice into an off-screen 210mm stage (doPrint); the design CSS must not reach that clone.
    const exportStyle=()=>page.evaluate(()=>{const c=document.querySelector('#previewArea .invoice').cloneNode(true),st=document.createElement('div');st.style.cssText='position:absolute;left:-10000px;top:0;width:210mm;pointer-events:none';c.style.cssText+=';width:210mm;margin:0;box-shadow:none;transform:none';st.append(c);document.body.append(st);fitInvoiceToOnePage(c,docType);const cs=getComputedStyle(c),r={zoom:cs.zoom,width:c.offsetWidth,height:c.scrollHeight,font:cs.fontFamily,color:cs.color,background:cs.backgroundColor,dens:c.style.getPropertyValue('--dens'),cls:c.className};st.remove();return JSON.stringify(r);});
    const withDesign=await exportStyle();await page.evaluate(()=>document.body.classList.remove('dd'));const withoutDesign=await exportStyle();await page.evaluate(()=>document.body.classList.add('dd'));
    assert.equal(withDesign,withoutDesign,'PDF export clone is identical with and without the desktop design');
    await page.locator('#ddChohyoHead button',{hasText:'保存帳票へ'}).click();assert.equal(await page.locator('#bizNav button.active').getAttribute('data-page'),'savedDocs');
    assert.equal(await page.locator('#previewArea').evaluate(x=>x.classList.contains('show')),false,'leaving 帳票 still clears the preview');
    await page.evaluate(()=>{bizSwitchPage('chohyo');const c=document.getElementById('customerName');c.value='再表示テスト';c.dispatchEvent(new Event('input',{bubbles:true}));});
    assert(await page.locator('#previewArea').isVisible());assert.equal(await page.locator('#dCustomer').innerText(),'再表示テスト','re-opened preview shows the current form');
    await page.evaluate(()=>{const c=document.getElementById('customerName');c.value='';c.dispatchEvent(new Event('input',{bubbles:true}));});
    // 見積履歴 filters: client-side over the existing rows.
    await page.evaluate(()=>{bizSwitchPage('estimates');estimateShowIssued.checked=true;renderEstimates();});
    const estRows=()=>page.locator('#estimateRows tr:not([hidden])').count();assert.equal(await estRows(),2);
    await page.locator('#ddEstimateFilters select[data-ddf="fy"]').selectOption('2026');assert.equal(await estRows(),1);assert.match(await page.locator('#ddEstimateFilters').innerText(),/表示 1 件 ／ 見積書 2 件/);
    await page.locator('#ddEstimateFilters select[data-ddf="fy"]').selectOption('all');await page.locator('#ddEstimateFilters select[data-ddf="state"]').selectOption('受注');assert.equal(await estRows(),1);assert.match(await page.locator('#estimateRows tr:not([hidden])').innerText(),/佐藤様/);
    await page.locator('#ddEstimateFilters select[data-ddf="month"]').selectOption('11');assert.equal(await estRows(),0);
    await page.locator('#ddEstimateFilters [data-ddf-reset]').click();assert.equal(await estRows(),2);
    // 保存帳票 filters.
    await page.evaluate(()=>bizSwitchPage('savedDocs'));const savedRows=()=>page.locator('#allSavedDocsList>div:not([hidden])').count();assert.equal(await savedRows(),2);
    await page.locator('#ddSavedFilters select[data-ddf="kind"]').selectOption('receipt');assert.equal(await savedRows(),1);assert.match(await page.locator('#allSavedDocsList>div:not([hidden])').innerText(),/佐藤様/);
    await page.locator('#ddSavedFilters select[data-ddf="kind"]').selectOption('all');await page.locator('#ddSavedFilters select[data-ddf="fy"]').selectOption('2026');assert.equal(await savedRows(),1);
    await page.locator('#ddSavedFilters [data-ddf-reset]').click();assert.equal(await savedRows(),2);
    // 売上・入金: one manual-sale entry point and metric cards from the rendered register.
    await page.evaluate(()=>bizSwitchPage('sales'));
    assert.equal(await page.locator('#pageSales .biz-title button',{hasText:'手動売上'}).isVisible(),false);assert.equal(await page.locator('#pageSales .biz-title button:visible',{hasText:'売上登録'}).count(),1);
    assert.deepEqual(await page.locator('#ddSalesMetrics [data-dd-metric]').allInnerTexts(),['54,800','0','54,800']);
    // 支出・現金: metric cards and the CSV button opens the existing 支出CSV取込 file input.
    await page.evaluate(()=>bizSwitchPage('expenses'));assert.equal(await page.locator('#ddExpenseMetrics [data-dd-metric="total"]').innerText(),'24,200');
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#pageExpenses .biz-title button',{hasText:'CSVインポート'}).click()]);assert.equal(await chooser.element().evaluate(e=>e.id),'expenseFile');
    // 銀行照合: counts and 月別未照合明細 from the existing bank rows.
    await page.evaluate(()=>bizSwitchPage('bank'));assert.deepEqual(await page.locator('#ddBankMetrics [data-dd-metric]').allInnerTexts(),['2 件','1 件','1 件']);
    assert.match(await page.locator('#ddBankMonthly').innerText(),/2026-11　1 件[\s\S]*ヤマダ サマ/);assert.doesNotMatch(await page.locator('#ddBankMonthly').innerText(),/カード引落/);
    await page.locator('#ddBankMonthly [data-dd-bank="b1"]').click();
    // 設定: design heading and read-only company info from the 帳票 template.
    await page.evaluate(()=>bizSwitchPage('settings'));assert.deepEqual(await page.getByRole('heading',{level:1}).evaluateAll(xs=>xs.filter(x=>x.getClientRects().length).map(x=>x.innerText)),['設定']);
    const info=await page.locator('#ddCompanyInfo').innerText();for(const v of ['月輪合同会社','T7040003023888','10月1日〜翌年9月30日','読み取り専用'])assert(info.includes(v),v);assert.equal(await page.locator('#ddCompanyInfo input').count(),0,'company info is not editable');
   }
   assert.equal(await businessStorage(page),before,width+'px leaves business data untouched');
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}px: ${mobile?'previous mobile UI and headings, no desktop-design elements':'design shell, sidebar, themes, home analytics with 収支差額 + 参考, recent sales, calendar grid, always-on 帳票 preview, filters, metric cards, bank monthly panel, read-only company info'}, unchanged business data`);
   await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
