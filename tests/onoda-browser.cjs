const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.join(__dirname,'..');
const driver=`window.createTsukinowaFirebaseDriver=async()=>{
 let cb;const records=window.testRecords=new Map(),listeners=[];
 const listing=p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,r])=>({id:k.split('/').at(-1),...structuredClone(r)}));
 window.testServerSet=(n,id,payload)=>records.set('companies/tsukinowa/'+n+'/'+id,{revision:1,payload});
 return {initialize:async()=>{},observeAuth:f=>{cb=f;f(null);return()=>{}},claims:async u=>u.claims,signIn:async()=>cb({uid:'test-admin',claims:{companyId:'tsukinowa',role:'admin'}}),signOut:async()=>cb(null),
 listen:(p,m,f)=>{listeners.push([p,f]);f(listing(p),{fromCache:false});return()=>{}},list:async p=>{window.testReads=(window.testReads||0)+1;return listing(p)},timestamp:()=>({seconds:1}),
 transaction:async fn=>{const writes=[];const result=await fn({get:async p=>structuredClone(records.get(p)||null),set:(p,v)=>writes.push([p,v])});for(const [p,v]of writes)records.set(p,v);for(const[p,f]of listeners)f(listing(p),{fromCache:false});return result},
 digest:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')};};`;
const server=http.createServer((req,res)=>{try{const u=new URL(req.url,'http://localhost').pathname;
 if(u==='/js/firebase-driver.js'){res.setHeader('Content-Type','text/javascript');return res.end(driver);}
 if(u==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'test',projectId:'test',authDomain:'test',appId:'test'}}));}
 const f=path.join(root,u==='/'?'index.html':u);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(f));
 }catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto('http://127.0.0.1:'+server.address().port);
 await p.locator('#cloudStatus').filter({hasText:'未ログイン'}).waitFor({state:'attached'});await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill('admin@example.com');await p.locator('#cloudPassword').fill('test');await p.locator('#cloudLogin').click();await p.locator('#coreSyncStatus').filter({hasText:'クラウド同期済'}).waitFor({state:'attached'});await p.locator('#cloudDialog').press('Escape');
 for(const n of [24,25,35]){
 const result=await p.evaluate(async n=>{
  for(const key of [...testRecords.keys()])if(key.includes('/calendarLinks/'))testRecords.delete(key);const ev=(i,extra={})=>({id:'event'+i,googleEventId:'google'+i,date:'2026-09-30',start:'2026-09-30',updated:'2026-09-30T00:00:00Z',title:'小野田、施工'+i+'、1米',googleLatestTitle:i===n-1?'小野田，マキシヴ川崎サウスdue201，51.6米':'小野田、施工'+i+'、1米',googleOriginalDescription:'<p>TimeTree转录：截图未显示具体时间</p>',...extra});
  for(let i=0;i<n;i++)testServerSet('calendarLinks','event'+i,ev(i));
  testServerSet('calendarLinks','duplicate',ev(0,{id:'duplicate',updated:'2026-09-29T00:00:00Z'}));
  testServerSet('calendarLinks','cancelled',ev(99,{googleStatus:'cancelled'}));testServerSet('calendarLinks','deleted',ev(98,{deletedAt:'2026-09-30'}));testServerSet('calendarLinks','outside',ev(97,{date:'2026-10-01'}));
  bizState.calendar=[];document.getElementById('calendarMonth').value='2026-09';await importOnodaFromCalendar();togglePreview();
  return {count:items.length,rows:document.querySelectorAll('#invItems tr:not(.empty)').length,last:items.find(x=>x.sourceEventId==='event'+(n-1)),total:bizCalcDocumentTotal(collectFormState()),multipage:document.querySelector('.invoice').classList.contains('multipage-onoda'),owner:document.getElementById('previewArea').parentElement.id,reads:testReads};
 },n);
 assert.equal(result.count,n);assert.equal(result.rows,n);assert.equal(result.last.qty,51.6);assert.equal(result.total,Math.round((n-1+51.6)*1100));assert(result.multipage);assert.equal(result.owner,'pageChohyo');assert(result.reads>0);
 const pdf=await p.evaluate(async()=>{
  window.testPDF={pages:0};const api={internal:{getNumberOfPages:()=>1},deletePage:()=>{},addPage:()=>testPDF.pages++,addImage:()=>{},save:()=>testPDF.saved=true};
  window.html2pdf=()=>{const worker={set:()=>worker,from:el=>{testPDF.sourceRows=el.querySelectorAll('#invItems tr:not(.empty)').length;const c=document.createElement('canvas');c.width=794;c.height=Math.ceil(el.getBoundingClientRect().height);worker.canvas=c;return worker},toCanvas:()=>worker,toPdf:()=>worker,get:k=>Promise.resolve(k==='canvas'?worker.canvas:api)};return worker};
  doPrint();await new Promise(r=>setTimeout(r,450));await TsukinowaBusinessUI.getSync().flush();const docs=await TsukinowaBusinessUI.getClient().listRecords('documents');return {...testPDF,savedRows:docs.find(r=>r.payload.status==='active')?.payload.snapshot.items.length,savedTotal:docs.find(r=>r.payload.status==='active')?.payload.amount,error:document.getElementById('cloudError').textContent,queue:TsukinowaBusinessUI.getSync().getQueue()};
 });if(!pdf.savedRows)console.log(pdf);assert(pdf.saved);assert.equal(pdf.sourceRows,n);assert.equal(pdf.savedRows,n);assert.equal(pdf.savedTotal,result.total);assert(pdf.pages>=2);
 }
 // A regenerated monthly invoice is a revision of the same sale, using the new server value.
 const changed=await p.evaluate(async()=>{const r=testRecords.get('companies/tsukinowa/calendarLinks/event34');r.payload.googleLatestTitle='小野田，マキシヴ川崎サウスdue201，62.6米';await importOnodaFromCalendar({month:'2026-09'});const s=collectFormState();saveConfirmedHistory(s);await TsukinowaBusinessUI.getSync().flush();return {qty:items.find(x=>x.sourceEventId==='event34').qty,sales:await TsukinowaBusinessUI.getClient().listRecords('sales'),docs:await TsukinowaBusinessUI.getClient().listRecords('documents')};});assert.equal(changed.qty,62.6);assert.equal(changed.sales.length,1);assert.equal(changed.docs.filter(x=>x.payload.status==='active').length,1);
 await p.evaluate(()=>{if(!document.getElementById('previewArea').classList.contains('show'))togglePreview();});assert(await p.locator('#previewArea').isVisible());
 for(const route of ['calendar','projects','estimates','sales','expenses','bank','suppliers','monthly']){
  await p.evaluate(route=>bizSwitchPage(route),route);assert(!(await p.locator('#previewArea').isVisible()));assert.equal(await p.locator('#previewArea').evaluate(x=>x.classList.contains('show')),false);
  await p.evaluate(()=>{bizSwitchPage('chohyo');togglePreview();});assert(await p.locator('#previewArea').isVisible());
 }
 await p.evaluate(()=>bizSwitchPage('calendar'));await p.goBack();assert.equal(await p.locator('.app-page.active').getAttribute('id'),'pageChohyo');assert(!(await p.locator('#previewArea').isVisible()));await p.goForward();assert.equal(await p.locator('.app-page.active').getAttribute('id'),'pageCalendar');assert(!(await p.locator('#previewArea').isVisible()));
 assert.deepEqual(errors,[]);console.log('PASS '+width+'px: 24/25/35 complete rows, latest server data, September 30 HTML, dedup/cancel/delete, all totals, PDF pages/save/revision, route preview and back/forward');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
