// Real Firebase SDK + real disk-backed Chromium profile. Only Auth HTTP responses
// and business record listeners are fixtures; persistence and token observers are real.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..'),sdkDir=process.env.FIREBASE_SDK_DIR;
const version='12.19.0',sdkBase=`https://www.gstatic.com/firebasejs/${version}/`;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest')));
const sdkFiles=new Map();
function token(role){const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');return `${part({alg:'RS256',typ:'JWT'})}.${part({sub:role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:Math.floor(Date.now()/1000),role,companyId:'tsukinowa'})}.fixture`;}
(async()=>{
 for(const name of ['firebase-app.js','firebase-auth.js','firebase-firestore.js']){
  const source=sdkDir?fs.readFileSync(path.join(sdkDir,name),'utf8'):await (async()=>{const r=await fetch(sdkBase+name);if(!r.ok)throw Error(`SDK download ${r.status}`);return r.text();})();
  sdkFiles.set(name,source.replaceAll(sdkBase,'/test-sdk/'));
 }
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/test-sdk/')){res.setHeader('Content-Type','text/javascript');return res.end(sdkFiles.get(path.basename(pathname)));}
  try{
   const file=path.join(root,pathname==='/'?'index.html':pathname);
   res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')||file.endsWith('.webmanifest')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');
   let source=fs.readFileSync(file);
   if(pathname==='/js/firebase-driver.js')source=source.toString().replace(sdkBase,'/test-sdk/')+`\nconst realDriver=window.createTsukinowaFirebaseDriver; window.createTsukinowaFirebaseDriver=async()=>{const d=await realDriver();d.listen=(p,m,next)=>{next(m?[]:null,{fromCache:false,hasPendingWrites:false});return()=>{};};return d;};`;
   res.end(source);
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,profile=fs.mkdtempSync(path.join(os.tmpdir(),'geruninn-auth-'));
 let context,authRequests=0;const errors=[];
 async function launch(){
  context=await chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:'allow'});
  await context.route('https://identitytoolkit.googleapis.com/**',async route=>{
   const url=route.request().url(),data=route.request().postDataJSON()||{};
   const role=data.email?.startsWith('staff')?'staff':'admin';
   let json;
   if(url.includes('signInWithPassword')){authRequests++;json={localId:role,email:data.email,idToken:token(role),refreshToken:`refresh-${role}`,expiresIn:'3600',registered:true};}
   else if(url.includes('accounts:lookup')){const r=JSON.parse(Buffer.from(data.idToken.split('.')[1],'base64url').toString()).role;json={users:[{localId:r,email:`${r}@example.com`,emailVerified:true,passwordUpdatedAt:1,providerUserInfo:[{providerId:'password',email:`${r}@example.com`,rawId:`${r}@example.com`}]}]};}
   else throw Error('Unexpected auth endpoint: '+url);
   await route.fulfill({json});
  });
  await context.route('https://securetoken.googleapis.com/**',r=>{const role=r.request().postData().includes('staff')?'staff':'admin';return r.fulfill({json:{user_id:role,id_token:token(role),refresh_token:`refresh-${role}`,expires_in:'3600'}});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
 }
 async function ready(page,role){await page.waitForFunction(r=>window.TsukinowaCloud?.getClient()?.getState().phase==='ready'&&window.TsukinowaCloud.getClient().getState().role===r,role);assert.equal(await page.locator('#cloudAuthFields').isVisible(),false);assert.equal(await page.evaluate(()=>TsukinowaCloud.getClient().getState().user.uid),role);if(role==='staff'){assert.equal(await page.locator('#cloudMigration').isVisible(),false);await assert.rejects(page.evaluate(()=>TsukinowaCloud.getClient().listen('bankTransactions',null,()=>{})));}else await page.evaluate(()=>TsukinowaCloud.getClient().listen('bankTransactions',null,()=>{}));}
 async function signedOut(page){await page.waitForFunction(()=>window.TsukinowaCloud?.getClient()?.getState().phase==='signed-out');assert.equal(await page.locator('#cloudAuthFields').getAttribute('hidden'),null);await assert.rejects(page.evaluate(()=>TsukinowaCloud.getClient().listen('sales',null,()=>{})));}
 try{
  for(const role of ['admin','staff']){
   let page=await launch();await page.goto(base);await signedOut(page);
   await page.locator('#bizCloudAccountButton').click();await page.locator('#cloudEmail').fill(`${role}@example.com`);await page.locator('#cloudPassword').fill('fixture-password');await page.locator('#cloudLogin').click();await ready(page,role);
   // Simulate the previous release's session storage and verify migration on reload.
   await page.evaluate(async()=>{const app=await import('/test-sdk/firebase-app.js'),sdk=await import('/test-sdk/firebase-auth.js');await sdk.setPersistence(sdk.getAuth(app.getApp('tsukinowa-cloud')),sdk.browserSessionPersistence);});
   await page.reload();await ready(page,role);console.log(`PASS ${role}: reload restores identity and claims`);
   const before=authRequests;await context.close();page=await launch();await page.goto(base);await ready(page,role);assert.equal(authRequests,before);console.log(`PASS ${role}: browser process restart restores without password login`);
   await context.close();page=await launch();await page.goto(new URL(manifest.start_url,base+'/').href);await ready(page,role);await page.evaluate(()=>navigator.serviceWorker.ready);assert.equal(await page.evaluate(()=>new URL(navigator.serviceWorker.controller?.scriptURL||location.href).origin),base);
   await page.close();page=await context.newPage();await page.goto(new URL(manifest.start_url,base+'/').href);await ready(page,role);console.log(`PASS ${role}: PWA manifest entry with service worker restores after close/reopen`);
   await page.evaluate(()=>bizCloudLogout());await signedOut(page);await page.reload();await signedOut(page);await context.close();page=await launch();await page.goto(new URL(manifest.start_url,base+'/').href);await signedOut(page);assert.equal(authRequests,before);console.log(`PASS ${role}: explicit logout persists across reload and restart`);
   assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('fixture-password'))),false);await context.close();context=null;
  }
  assert.deepEqual(errors,[]);
 }finally{if(context)await context.close();server.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
