const CACHE='tsukinowa-pwa-navigation-20260930-1';
const APP_SHELL=['./index.html','./manifest.webmanifest','./js/cloud-core.js','./js/firebase-driver.js','./js/cloud-ui.js','./js/business-domain.js','./js/business-sync.js','./js/business-ui.js','./js/accounting.js','./js/accounting-domain.js','./js/accounting-ui.js','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(APP_SHELL.map(path=>new Request(path,{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('tsukinowa-pwa-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // OAuth, Google API and third-party responses never enter the application cache.
  if(request.method!=='GET'||url.origin!==self.location.origin||request.headers.has('Authorization'))return;
  const root=new URL('./',self.registration.scope);
  const shell=APP_SHELL.some(path=>new URL(path,root).pathname===url.pathname)||url.pathname===root.pathname;
  if(!shell)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const key=request.mode==='navigate'?new URL('./index.html',root).href:new URL(url.pathname,url.origin).href;
    try{
      const response=await fetch(request,{cache:'no-cache'});
      if(response.ok)await cache.put(key,response.clone());
      return response;
    }catch(err){const cached=await cache.match(key);if(cached)return cached;throw err;}
  })());
});
