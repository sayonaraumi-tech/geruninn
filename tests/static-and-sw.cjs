const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
assert(!html.includes('clean_reset_done'));assert(!html.includes('rows.slice(0, 500)'));assert(!html.includes('bizEscape('));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest')));for(const icon of manifest.icons)assert(fs.existsSync(path.join(root,icon.src)));
const handlers={},deleted=[],added=[],writes=[],data=new Map();let skipped=false,claimed=false;
const cache={addAll:async r=>added.push(...r),put:async(k,v)=>{writes.push(k);data.set(k,v);},match:async k=>data.get(k)};
const scope='https://example.com/geruninn/';let online=true;
const ctx=vm.createContext({URL,Request:class{constructor(url,options){this.url=url;Object.assign(this,options);}},caches:{open:async()=>cache,keys:async()=>['tsukinowa-pwa-trial-v5.2','unrelated-cache','tsukinowa-pwa-cloud-foundation-20260929-1'],delete:async k=>deleted.push(k)},fetch:async()=>{if(!online)throw Error('offline');return new Response('shell');},self:{location:{origin:'https://example.com'},registration:{scope},skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}},addEventListener:(k,f)=>handlers[k]=f}});
vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),ctx);
(async()=>{
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;assert(skipped);assert.equal(added.length,8);assert(added.every(r=>r.cache==='reload'));
 handlers.activate({waitUntil:p=>pending=p});await pending;assert(claimed);assert.deepEqual(deleted,['tsukinowa-pwa-trial-v5.2']);
 for(const url of ['https://www.googleapis.com/calendar/v3/events','https://accounts.google.com/gsi/client','https://example.com/other-app/','https://example.com/geruninn/firebase-config.json']){let intercepted=false;handlers.fetch({request:{method:'GET',url,headers:new Headers()},respondWith:()=>intercepted=true});assert(!intercepted);}
 const request={method:'GET',url:scope+'?event=123',mode:'navigate',headers:new Headers()};handlers.fetch({request,respondWith:p=>pending=p});assert.equal(await (await pending).text(),'shell');assert.equal(writes[0],scope+'index.html');
 online=false;handlers.fetch({request,respondWith:p=>pending=p});assert.equal(await (await pending).text(),'shell');
 console.log('PASS all inline JS syntax, preserved storage, PWA assets, installation, old app cache cleanup, external API bypass and offline shell fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
