// Loopback-only acceptance app. Test authentication; never production.
// Real browser UI and real Firestore emulator. Only Authentication and PDF rendering are test adapters.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('Start only with the local demo-tsukinowa emulator.');
const root=path.join(__dirname,'..');
const driver=`window.createTsukinowaFirebaseDriver=async()=>{
 const a=await import('/sdk/firebase-app.js'),f=await import('/sdk/firebase-firestore.js');let db,cb;
 return {initialize:async()=>{},observeAuth:next=>{cb=next;next(null);return()=>{}},claims:async u=>u.claims,
 signIn:async email=>{const role=email.startsWith('admin')?'admin':'staff';db=f.getFirestore(a.initializeApp({projectId:'demo-tsukinowa'},crypto.randomUUID()));f.connectFirestoreEmulator(db,'127.0.0.1',8080,{mockUserToken:{sub:'ui-'+role,role,companyId:'tsukinowa'}});await cb({uid:'ui-'+role,email,claims:{role,companyId:'tsukinowa'}})},signOut:async()=>cb(null),
 listen:(p,m,next,error)=>f.onSnapshot(m?f.collection(db,p):f.doc(db,p),{includeMetadataChanges:true},s=>next(m?s.docs.map(d=>({id:d.id,...d.data()})):s.exists()?{id:s.id,...s.data()}:null,{fromCache:s.metadata.fromCache}),error),
 list:async p=>(await f.getDocsFromServer(f.collection(db,p))).docs.map(d=>({id:d.id,...d.data()})),
 transaction:fn=>f.runTransaction(db,tx=>fn({get:async p=>{const s=await tx.get(f.doc(db,p));return s.exists()?s.data():null},set:(p,v)=>tx.set(f.doc(db,p),v),delete:p=>tx.delete(f.doc(db,p))})),timestamp:f.serverTimestamp,
 digest:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')};};`;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;try{
 if(pathname==='/empty.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
 if(pathname==='/preview-html2pdf.js'&&process.env.HTML2PDF_BUNDLE){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(process.env.HTML2PDF_BUNDLE));}
 if(pathname==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'test',projectId:'demo-tsukinowa',authDomain:'test',appId:'test'}}));}
 if(pathname==='/js/firebase-driver.js'){res.setHeader('Content-Type','text/javascript');return res.end(driver);}
 if(pathname.startsWith('/sdk/')){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'node_modules/firebase',path.basename(pathname)),'utf8').replaceAll('https://www.gstatic.com/firebasejs/12.19.0/','/sdk/'));}
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();if(pathname==='/'||pathname==='/index.html'){res.setHeader('Content-Type','text/html');return res.end(fs.readFileSync(file,'utf8').replace(/https:\/\/cdnjs.cloudflare.com[^\"]+/g,'/preview-html2pdf.js').replace(/https:\/\/accounts.google.com\/gsi\/client/g,'/empty.js').replace('<body>','<body><div role=\"status\" style=\"position:fixed;bottom:8px;left:8px;z-index:99999;background:#fff3cd;border:1px solid #9c7511;padding:6px 10px;border-radius:5px;font:12px system-ui;pointer-events:none\">隔離検証（合成データ・正式利用不可）</div>').replace('<body>','<body><div style=\"position:fixed;right:12px;bottom:12px;z-index:99999;background:#fff1de;color:#855f20;padding:8px;border:1px solid #d5b978;border-radius:5px;font:12px system-ui\">隔離検証・合成データのみ</div>'));}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end();}});
server.listen(48854,'127.0.0.1',()=>console.log('ISOLATED_ACCEPTANCE_URL=http://127.0.0.1:48854/'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
