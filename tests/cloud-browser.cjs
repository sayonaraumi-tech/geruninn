const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(root,pathname==='/'?'index.html':pathname);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
const fakeDriver=`window.createTsukinowaFirebaseDriver=async()=>{let cb;return {initialize:async()=>{},observeAuth:f=>{cb=f;f(null);return()=>{};},claims:async u=>u.claims,signIn:async(email,password)=>{if(password==='wrong')throw Error('no');await cb({uid:'test',email,claims:{role:email.startsWith('admin')?'admin':'staff',companyId:'tsukinowa'}});},signOut:async()=>cb(null),listen:(p,m,next)=>{next([],{fromCache:false});return()=>{};}}};`;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({headless:true});
 try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];let sdkCalls=0;
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>{sdkCalls++;return r.fulfill({body:''});});
  await page.addInitScript(()=>{localStorage.setItem('tsukinowa_business_v1',JSON.stringify({sales:[{id:'old',amount:100}],payments:[],expenses:[],bank:[],calendar:[],audit:[],estimates:[],projects:[]}));});
  await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false,companyId:'tsukinowa',firebase:{}}}));
  await page.goto(base);await page.locator('#cloudStatus').filter({hasText:'クラウド未設定'}).waitFor({state:'attached'});
  const backup=await page.evaluate(()=>localStorage.getItem('tsukinowa_business_v1'));
  await page.locator('#bizCloudAccountButton').click();assert(await page.locator('#cloudDialog').isVisible());assert(await page.locator('#cloudLogin').isDisabled());
  const bounds=await page.locator('#bizCloudAccountButton').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=104);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'端末内データをバックアップ（JSON）'}).click();const download=await downloadPromise;const json=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(json.business.sales[0].id,'old');
  await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:true,companyId:'tsukinowa',firebase:{apiKey:'public-test',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test'}}}));
  await page.route('**/js/firebase-driver.js',r=>r.fulfill({contentType:'text/javascript',body:fakeDriver}));
  await page.reload();await page.locator('#cloudStatus').filter({hasText:'未ログイン'}).waitFor({state:'attached'});await page.locator('#bizCloudAccountButton').click();
  await page.locator('#cloudEmail').fill('admin@example.com');await page.locator('#cloudPassword').fill('wrong');await page.locator('#cloudLogin').click();await page.locator('#cloudError').filter({hasText:'ログインできませんでした'}).waitFor({state:'attached'});assert.equal(await page.locator('#cloudPassword').inputValue(),'');
  await page.locator('#cloudPassword').fill('good');await page.locator('#cloudLogin').click();await page.locator('#cloudAccount').filter({hasText:'管理者'}).waitFor({state:'attached'});await page.locator('#coreSyncStatus').filter({hasText:'クラウド同期済'}).waitFor({state:'attached'});
  assert.equal(await page.evaluate(()=>localStorage.getItem('tsukinowa_business_v1')),backup);assert.equal(await page.evaluate(()=>bizCloudReady),false);
  await page.locator('#cloudLogout').click();await page.locator('#cloudAccount').filter({hasText:/^$/}).waitFor({state:'attached'});
  await page.locator('#cloudEmail').fill('staff@example.com');await page.locator('#cloudPassword').fill('good');await page.locator('#cloudLogin').click();await page.locator('#cloudAccount').filter({hasText:'スタッフ'}).waitFor({state:'attached'});
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,'../cloud-'+width+'.png')});
  console.log('PASS cloud dialog, disabled configuration, backup, login errors, admin/staff login, realtime probe, logout and local data preservation at',width+'px');await context.close();
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
