// Real Chromium visual and state regression for the integrated 9-page Tabler shell.
// Uses a clean localhost origin and synthetic data only. No Firebase or Google writes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-artifacts','tabler-desktop');
const routes={dashboard:'pageDashboard',calendar:'pageCalendar',estimates:'pageEstimates',
 chohyo:'pageChohyo',savedDocs:'pageSavedDocs',sales:'pageSales',
 expenses:'pageExpenses',bank:'pageBank',settings:'pageSettings'};
const themes=['blue','obsidian','jade','violet','night'];
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://127.0.0.1').pathname;
 if(name==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({enabled:false}));}
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 try{res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}
 catch{res.statusCode=404;res.end();}
});
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  await context.route('https://**/*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.bizSwitchPage==='function'&&!!document.getElementById('tablerThemePicker'));
  const initial=await page.evaluate(()=>JSON.stringify(bizState));
  for(const theme of themes){
   await page.locator('#tablerThemePicker button[data-theme="'+theme+'"]').click();
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.tablerTheme),theme);
   assert.equal(await page.evaluate(()=>localStorage.getItem('tsukinowa_tabler_theme_v1')),theme);
   assert.equal(await page.locator('#tablerThemePicker button[aria-pressed="true"]').count(),1);
   if(theme==='obsidian')for(const [route,id] of Object.entries(routes)){
    await page.locator('#bizNav [data-page="'+route+'"]').click();
    assert.equal(await page.locator('.app-page.active').getAttribute('id'),id);
    assert.equal(await page.locator('#bizNav button.active').getAttribute('data-page'),route);
    assert(await page.locator('#'+id).isVisible());
    await page.screenshot({path:path.join(output,route+'.png'),fullPage:false});
   }
  }
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.documentElement.dataset.tablerTheme==='night');
  assert.equal(await page.evaluate(()=>JSON.stringify(bizState)),initial);
  assert.deepEqual(errors,[],'no page JavaScript exceptions');
  // Actual isolated legacy backup import: bad input never replaces data; a valid
  // restore leaves a pre-restore recovery copy. No cloud or user data is involved.
  await page.evaluate(()=>{bizState.sales=[{id:'before-restore',amount:5000}];bizPersist();});
  const restoreDialogs=[];page.on('dialog',d=>{restoreDialogs.push(d.message());return d.accept();});
  await page.locator('#backupFile').setInputFiles({name:'broken.json',mimeType:'application/json',
    buffer:Buffer.from('{"state":{"sales":{},"expenses":[]}}')});
  await page.evaluate(()=>window.importBackup());
  assert.equal(await page.evaluate(()=>bizState.sales[0].id),'before-restore');
  const valid={version:2,mode:'production',state:{sales:[{id:'after-restore',amount:8000}],
    payments:[],expenses:[],bank:[],calendar:[],audit:[],estimates:[],projects:[]}};
  await page.locator('#backupFile').setInputFiles({name:'safe.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(valid))});
  await page.evaluate(()=>window.importBackup());
  assert.equal(await page.evaluate(()=>bizState.sales[0].id),'after-restore',JSON.stringify(restoreDialogs));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tsukinowa_business_v1')).sales[0].id),'after-restore');
  const recovered=await page.evaluate(()=>Object.keys(localStorage).find(k=>k.startsWith('tsukinowa_pre_restore_')));
  assert(recovered,'a recovery key is retained before applying the replacement');
  assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).sales[0].id,recovered),'before-restore');
  await context.close();
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await mobile.route('https://**/*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
  const phone=await mobile.newPage();await phone.goto(base,{waitUntil:'domcontentloaded'});
  await phone.waitForFunction(()=>!!document.getElementById('tablerThemePicker'));
  assert.equal(await phone.locator('#tablerThemePicker').isVisible(),false);
  assert(await phone.locator('#bizNav [data-page="calendar"]').isVisible());
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mobile.close();
  console.log('PASS: 9 real desktop views, 5 theme choices, persistence, original business data unchanged, mobile untouched.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
