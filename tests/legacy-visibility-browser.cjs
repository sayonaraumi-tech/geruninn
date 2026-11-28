// Old records the CSV exports list but the totals do not count are shown read-only in 売上; totals unchanged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{for(const width of [390,1280]){const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];await page.clock.setFixedTime(new Date('2026-11-28T01:00:00Z'));page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));await page.goto('http://127.0.0.1:'+server.address().port);

 await page.evaluate(async()=>{
  const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
  const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role:'admin',companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);
  
  const doc=(id,customer,price,extra={})=>({historyId:id,docType:'invoice',customerName:customer,invoiceDate:'2026-08-10',salesDate:'2026-08-05',items:[{content:'施工',qty:1,price}],travelFee:0,paymentMethod:'銀行振込',...extra});
  const sale=(id,h,customer,amount)=>({id,sourceId:h,customer,amount,saleDate:'2026-08-05',invoiceDate:'2026-08-10'});
  const legacy={documents:[doc('h1','旧A 振込',100000),doc('h2','旧B 現金',50000,{paymentMethod:'現金'}),doc('h3','旧C 銀行照合済',30000),doc('h4','旧D 帳票だけ入金日',20000,{paymentDate:'2026-08-20'}),doc('h5','旧E 売上行なし',40000)],
   business:{sales:[sale('s1','h1','旧A 振込',110000),sale('s2','h2','旧B 現金',55000),sale('s3','h3','旧C 銀行照合済',33000),sale('s4','h4','旧D 帳票だけ入金日',22000)],
    payments:[{id:'p1',saleId:'s1',sourceId:'h1',amount:110000,date:'2026-08-25',method:'銀行振込',memo:'領収書から登録'},{id:'p2',saleId:'s2',sourceId:'h2',amount:55000,date:'2026-08-12',method:'現金'},{id:'p3',saleId:'s3',sourceId:'h3',amount:33000,date:'2026-08-28',method:'銀行振込',bankId:'b9'}],estimates:[],projects:[],calendar:[],audit:[],expenses:[],bank:[]}};
  const m=new Map([[TsukinowaCloudCore.LOCAL_KEYS.business,JSON.stringify(legacy.business)],[TsukinowaCloudCore.LOCAL_KEYS.documents,JSON.stringify(legacy.documents)]]);
  const storage={get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
  await TsukinowaSync.migrateLegacy({client,storage});
  window.testRecords=records;
 });
 await page.waitForFunction(()=>(TsukinowaAccountingUI.getData().documents||[]).length===5&&(TsukinowaAccountingUI.getData().payments||[]).length===3);
 const before=JSON.stringify([...await page.evaluate(()=>[...window.testRecords])]);
 await page.evaluate(()=>{bizSwitchPage('sales');for(const [id,v] of [['salesPeriodMode','month'],['salesMonth','2026-08'],['receivableAsOf','2026-11-28']]){const e=document.getElementById(id);e.value=v;}renderSales();const h=document.getElementById('homeMonth');h.value='2026-08';renderDashboard();});
 const rows=await page.$$eval('#salesRows tr',rs=>Object.fromEntries(rs.map(r=>[[...r.cells][1].textContent,{status:[...r.cells][10].textContent,paid:[...r.cells][6].textContent,notes:[...r.querySelectorAll('[data-legacy-note]')].map(n=>n.textContent)}])));
 assert.deepEqual(Object.keys(rows).sort(),['旧A 振込','旧B 現金','旧C 銀行照合済','旧D 帳票だけ入金日'].sort(),width+': register rows unchanged');
 assert.equal(rows['旧A 振込'].status,'未入金');assert.equal(rows['旧A 振込'].paid.replace(/[^\d]/g,''),'0');
 assert.equal(rows['旧A 振込'].notes.length,1);assert.match(rows['旧A 振込'].notes[0],/^入金確認待ち .*110,000.*2026-08-25.*未計上/);
 assert.deepEqual(rows['旧D 帳票だけ入金日'].notes,['帳票の入金日 2026-08-20（入金記録なし・未計上）']);
 assert.deepEqual([rows['旧B 現金'].notes,rows['旧C 銀行照合済'].notes],[[],[]]);
 assert.equal(await page.locator('#salesRows [data-legacy-note]').first().isVisible(),width>800,width+': notes are desktop-only (mobile layout unchanged)');assert.equal(await page.locator('#salesUnlinkedDocs').isVisible(),width>800);
 const unlinked=await page.$$eval('#salesUnlinkedDocs tbody tr',rs=>rs.map(r=>[...r.cells].map(c=>c.textContent)));
 assert.equal(unlinked.length,1);assert.equal(unlinked[0][3],'旧E 売上行なし');assert.match(unlinked[0][4],/44,000/);
 // Totals are exactly what was shown before this change.
 const kpi=await page.evaluate(()=>Object.fromEntries(['kpiSales','kpiPayments','kpiReceivable','kpiDifference'].map(id=>[id,document.getElementById(id).textContent.replace(/[^\d-]/g,'')])));
 assert.deepEqual(kpi,{kpiSales:'220000',kpiPayments:'88000',kpiReceivable:'132000',kpiDifference:'88000'},width+': home totals unchanged');
 const csvRows=await page.evaluate(()=>TsukinowaAccountingUI.salesRegister?TsukinowaAccountingUI.salesRegister(TsukinowaAccounting.periodFilter({month:'2026-08'}),'2026-11-28').map(s=>s.status):null);
 if(csvRows)assert.deepEqual(csvRows.slice().sort(),['入金済','入金済','未入金','未入金']);
 // Display only: no record was written.
 assert.equal(JSON.stringify([...await page.evaluate(()=>[...window.testRecords])]),before,width+': no writes');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('legacy visibility browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
