// Real navigation clicks, including a late Google script that must not reset the page.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const oldCache='tsukinowa-pwa-monthly-calendar-20260930-1';
let serveOldWorker=false;
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname,file=path.join(root,name==='/'?'index.html':name);
 if(name==='/sw.js'&&serveOldWorker){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(file,'utf8').replace(/const CACHE='[^']+';/,`const CACHE='${oldCache}';`));}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
const routes={calendar:'pageCalendar',estimates:'pageEstimates',projects:'pageProjects',chohyo:'pageChohyo',savedDocs:'pageSavedDocs',sales:'pageSales',expenses:'pageExpenses',bank:'pageBank',suppliers:'pageSuppliers',monthly:'pageMonthly',settings:'pageSettings'};
const mobileRoutes=['calendar','estimates','chohyo','savedDocs'];
const fakeDriver=`window.createTsukinowaFirebaseDriver=async()=>{let cb;return {initialize:async()=>{},observeAuth:f=>{cb=f;f(null);return()=>{};},claims:async u=>u.claims,signIn:async email=>cb({uid:'navigation-test',email,claims:{role:email.startsWith('admin')?'admin':'staff',companyId:'tsukinowa'}}),signOut:async()=>cb(null),listen:(p,m,next)=>{next([],{fromCache:false});return()=>{};}}};`;
async function checkPage(page,route){
 assert.deepEqual(await page.locator('.app-page.active').evaluateAll(xs=>xs.map(x=>x.id)),[routes[route]]);
 assert.deepEqual(await page.locator('#bizNav button.active').evaluateAll(xs=>xs.map(x=>x.dataset.page)),[route]);
 assert(await page.locator('#'+routes[route]).isVisible());
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
 try{
  for(const width of [1440,390])for(const role of ['admin','staff']){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('https://**/*',r=>r.fulfill({body:''}));
   await context.route('**/js/firebase-driver.js',r=>r.fulfill({contentType:'text/javascript',body:fakeDriver}));
   await context.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:true,companyId:'tsukinowa',firebase:{apiKey:'test',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test'}}}));
   await page.goto(base);
   await page.locator('#cloudStatus').filter({hasText:'未ログイン'}).waitFor({state:'attached'});
   await page.locator('#bizCloudAccountButton').click();
   await page.locator('#cloudEmail').fill(role+'@example.com');await page.locator('#cloudPassword').fill('test');await page.locator('#cloudLogin').click();
   await page.locator('#coreSyncStatus').filter({hasText:'クラウド同期済'}).waitFor({state:'attached'});
   await page.locator('#cloudDialog').press('Escape');
   const allowed=width===390||role==='staff'?mobileRoutes:Object.keys(routes);
   const before=await page.evaluate(()=>JSON.stringify({business:bizState,history:loadConfirmedHistory()}));
   for(const route of allowed){
    const button=page.locator(`#bizNav button[data-page="${route}"]`);
    await button.click();await checkPage(page,route);
    // Go back to the calendar between routes, exercising the reported transition.
    await page.locator('#bizNav [data-page="calendar"]').click();await checkPage(page,'calendar');
   }
   await page.locator('#bizNav [data-page="estimates"]').focus();await page.keyboard.press('Enter');await checkPage(page,'estimates');
   if(width===390||role==='staff')for(const route of Object.keys(routes).filter(r=>!mobileRoutes.includes(r)))assert.equal(await page.locator(`#bizNav [data-page="${route}"]`).isVisible(),false);
   assert.equal(await page.evaluate(()=>JSON.stringify({business:bizState,history:loadConfirmedHistory()})),before);
   assert.deepEqual(errors,[]);console.log(`PASS ${width}px ${role}: navigation clicks, active page/state, keyboard, existing visibility and unchanged business data`);
   await context.close();
  }
  for(const width of [1440,390])for(const query of ['', '?page=estimates']){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});
   await context.route('https://**/*',r=>r.fulfill({body:''}));
   let release;const gate=new Promise(r=>release=r);
   await context.route('https://accounts.google.com/gsi/client',async r=>{await gate;await r.fulfill({body:''});});
   await context.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
   const page=await context.newPage();await page.goto(base+query,{waitUntil:'domcontentloaded'});
   if(query){await page.locator('#pageEstimates').waitFor({state:'visible'});}else{
    await page.locator('#bizNav [data-page="estimates"]').click();
   }
   await checkPage(page,'estimates');
   release();await page.waitForLoadState('load');await page.waitForTimeout(400);
   await checkPage(page,'estimates');
   console.log(`PASS ${width}px delayed Google load preserves ${query?'deep link':'clicked navigation'}`);
   await context.close();
  }
  // Exercise an installed PWA's real worker upgrade and subsequent offline navigation.
  serveOldWorker=true;
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('https://**/*',r=>r.fulfill({body:''}));
  await context.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
  const page=await context.newPage();await page.goto(base);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert((await page.evaluate(()=>caches.keys())).includes(oldCache));
  await page.evaluate(()=>localStorage.setItem('tsukinowa_navigation_preserved','keep'));
  await page.reload();
  serveOldWorker=false;
  const reload=page.waitForEvent('load');
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await reload;
  const newCache=fs.readFileSync(path.join(root,'sw.js'),'utf8').match(/const CACHE='([^']+)'/)[1];
  await page.waitForFunction(async key=>(await caches.keys()).includes(key),newCache);
  assert.equal((await page.evaluate(()=>caches.keys())).includes(oldCache),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('tsukinowa_navigation_preserved')),'keep');
  assert.equal(await page.evaluate(async key=>{const c=await caches.open(key);return (await c.match(new URL('./index.html',location.href).href)).text();},newCache),fs.readFileSync(path.join(root,'index.html'),'utf8'));
  await context.setOffline(true);await page.reload();
  for(const route of mobileRoutes){await page.locator(`#bizNav [data-page="${route}"]`).click();await checkPage(page,route);}
  assert.equal(await page.evaluate(()=>localStorage.getItem('tsukinowa_navigation_preserved')),'keep');
  console.log('PASS installed PWA worker upgrade, old cache cleanup, current cached HTML, offline navigation and storage preservation');
  await context.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
