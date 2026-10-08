// Real browser UI and real Firestore emulator. Only Authentication and PDF rendering are test adapters.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const root=path.join(__dirname,'..');
const driver=`window.createTsukinowaFirebaseDriver=async()=>{
 const a=await import('/sdk/firebase-app.js'),f=await import('/sdk/firebase-firestore.js');let db,cb;
 return {initialize:async()=>{},observeAuth:next=>{cb=next;next(null);return()=>{}},claims:async u=>u.claims,
 signIn:async email=>{const role=email.startsWith('admin')?'admin':'staff';db=f.getFirestore(a.initializeApp({projectId:'demo-tsukinowa'},crypto.randomUUID()));f.connectFirestoreEmulator(db,'127.0.0.1',8080,{mockUserToken:{sub:'ui-'+role,role,companyId:'tsukinowa'}});await cb({uid:'ui-'+role,email,claims:{role,companyId:'tsukinowa'}})},signOut:async()=>cb(null),
 listen:(p,m,next,error)=>f.onSnapshot(m?f.collection(db,p):f.doc(db,p),{includeMetadataChanges:true},s=>next(m?s.docs.map(d=>({id:d.id,...d.data()})):s.exists()?{id:s.id,...s.data()}:null,{fromCache:s.metadata.fromCache}),error),
 list:async p=>(await f.getDocsFromServer(f.collection(db,p))).docs.map(d=>({id:d.id,...d.data()})),
 transaction:fn=>f.runTransaction(db,tx=>fn({get:async p=>{const s=await tx.get(f.doc(db,p));return s.exists()?s.data():null},set:(p,v)=>tx.set(f.doc(db,p),v)})),timestamp:f.serverTimestamp,
 digest:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')};};`;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;try{
 if(pathname==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'test',projectId:'demo-tsukinowa',authDomain:'test',appId:'test'}}));}
 if(pathname==='/js/firebase-driver.js'){res.setHeader('Content-Type','text/javascript');return res.end(driver);}
 if(pathname.startsWith('/sdk/')){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'node_modules/firebase',path.basename(pathname)),'utf8').replaceAll('https://www.gstatic.com/firebasejs/12.19.0/','/sdk/'));}
 const file=path.join(root,pathname==='/'?'index.html':pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end();}});
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tsukinowa',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});await env.clearFirestore();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),errors=[];
 try{
 async function device(role,width){const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('2026-10-01'):d.type()==='confirm'?d.accept():d.dismiss());await p.route('https://**/*',r=>r.fulfill({body:''}));await p.goto(base);await p.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await p.locator('#bizCloudAccountButton').click();await p.locator('#cloudEmail').fill(role+'@example.com');await p.locator('#cloudPassword').fill('password');await p.locator('#cloudLogin').click();await p.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await p.getByRole('button',{name:'閉じる',exact:true}).click();return p;}
 const phone=await device('staff',390),desktop=await device('admin',1280);

 await desktop.evaluate(async()=>{bizSwitchPage('chohyo');setDocType('invoice');document.getElementById('customerName').value='dynast合同会社';document.getElementById('invoiceDate').value='2026-08-01';document.getElementById('remarks').value='2026年7月分請求書';items=[{content:'7月分工事',qty:1,unit:'式',price:708526.36}];recalc();saveConfirmedHistory();await TsukinowaBusinessUI.getSync().flush();});
 await phone.waitForFunction(()=>bizState.sales.length===1);
 const id=await phone.evaluate(()=>bizState.sales[0].documentId);
 // Preserve a representative old formal invoice number without running a destructive migration.
 const {doc,getDoc,setDoc}=require('firebase/firestore');
 await env.withSecurityRulesDisabled(async c=>{const ref=doc(c.firestore(),'companies/tsukinowa/documents/'+id),row=(await getDoc(ref)).data();row.payload.snapshot.invoiceNo='20260801-001';await setDoc(ref,row);});
 await phone.waitForFunction(id=>loadConfirmedHistory().find(h=>h.documentId===id)?.invoiceNo==='20260801-001',id);
 const before=await env.withSecurityRulesDisabled(async c=>(await getDoc(doc(c.firestore(),'companies/tsukinowa/documents/'+id))).data());
 const salesBefore=await phone.evaluate(()=>bizState.sales.map(s=>({id:s.id,amount:s.amount})));
 for(const p of [phone,desktop])await p.evaluate(()=>bizSwitchPage('savedDocs'));assert.equal(await phone.locator('#allSavedDocsList').getByRole('button',{name:'入金登録',exact:true}).count(),0);
 await desktop.locator('#allSavedDocsList').getByRole('button',{name:'入金登録',exact:true}).click();
 await desktop.locator('#paymentDate').fill('2026-08-25');await desktop.locator('#paymentAmount').fill('770379');await desktop.locator('#paymentType').selectOption('銀行振込');await desktop.locator('#paymentSubmit').click();
 await desktop.waitForFunction(id=>TsukinowaBusinessUI.invoiceBalance(id).outstandingAmount===9000,id);
 assert.deepEqual(await desktop.evaluate(id=>{const v=TsukinowaBusinessUI.invoiceBalance(id);return [v.invoiceAmount,v.paidAmount,v.outstandingAmount,v.paymentStatus];},id),[779379,770379,9000,'一部入金']);
 assert.equal(await desktop.locator('#balanceSummary').getByText('銀行確認済',{exact:true}).count(),1);
 assert.equal(await desktop.evaluate(()=>bizState.payments.length),1);
 await desktop.locator('#balanceClose').click();
 await desktop.locator('#allSavedDocsList').getByRole('button',{name:'入金履歴',exact:true}).click();assert.equal(await desktop.locator('#balanceMonth').inputValue(),'2026-07');
 // Capture the exact standalone PDF DOM and prove no formal save/accounting command is called.
 await desktop.evaluate(()=>{window.noticeSaves=[];window.html2pdf=()=>{const canvas=document.createElement('canvas');canvas.width=794;canvas.height=1123;const pdf={internal:{getNumberOfPages:()=>1},deletePage(){},addPage(){},addImage(){},save(name){noticeSaves.push(name)}};const worker={set(){return worker},from(el){window.noticeText=el.textContent;window.noticeHTML=el.outerHTML;return worker},toCanvas(){return worker},toPdf(){return worker},get:k=>Promise.resolve(k==='canvas'?canvas:pdf)};return worker};});
 for(let i=0;i<2;i++){await desktop.locator('#balancePDF').click();await desktop.waitForFunction(n=>noticeSaves.length===n,i+1);}
 assert.deepEqual(await desktop.evaluate(()=>noticeSaves),Array(2).fill('2026年7月_dynast合同会社_未入金残高請求書_9000円.pdf'));
 const content=await desktop.evaluate(()=>noticeText);for(const value of ['未入金残高のご請求','20260801-001','2026年7月分請求書','779,379','770,379','9,000','▲','※新規工事分ではなく'])assert(content.includes(value));for(const value of ['課税区分','単価','消費税【10%】','数量'])assert(!content.includes(value));
 // Real 0.10.1 renderer, if provided, creates a nonempty one-page PDF from both viewport sizes.
 if(process.env.HTML2PDF_BUNDLE){for(const p of [phone,desktop]){await p.addScriptTag({path:process.env.HTML2PDF_BUNDLE});if(p===phone)await p.evaluate(id=>openInvoiceBalance(id),id);const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#balancePDF').click()]);const file=path.join(root,'../balance-'+(p===phone?'phone':'desktop')+'.pdf');await download.saveAs(file);const bytes=fs.readFileSync(file);assert(bytes.length>10000);assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);if(p===phone)await p.locator('#balanceClose').click();}}
 // Inspect layout at A4 scale independently of the phone/desktop editor viewport.
 await desktop.evaluate(()=>{document.getElementById('invoiceBalanceDialog').close();const host=document.createElement('div');host.id='balanceReview';host.style.cssText='position:fixed;top:0;left:0;width:794px;z-index:99999;background:white';const n=TsukinowaOutstanding.notice({...TsukinowaBusinessUI.invoiceBalance(loadConfirmedHistory()[0].documentId),month:'2026-07'},'2026-10-02');host.append(TsukinowaBalanceUI.createSheet(n));document.body.append(host);});
 await desktop.locator('#balanceReview').screenshot({path:path.join(root,'../balance-layout.png')});await desktop.evaluate(()=>document.getElementById('balanceReview').remove());
 const after=await env.withSecurityRulesDisabled(async c=>(await getDoc(doc(c.firestore(),'companies/tsukinowa/documents/'+id))).data());assert.deepEqual(after,before);assert.deepEqual(await desktop.evaluate(()=>bizState.sales.map(s=>({id:s.id,amount:s.amount}))),salesBefore);
 
 // The existing CSV reconciliation path is exercised by the rules and business browser suites.
 await desktop.locator('#allSavedDocsList').getByRole('button',{name:'入金登録',exact:true}).click();await desktop.locator('#paymentDate').fill('2026-10-02');await desktop.locator('#paymentAmount').fill('9000');await desktop.locator('#paymentType').selectOption('現金');await desktop.locator('#paymentSubmit').click();
 await desktop.waitForFunction(id=>TsukinowaBusinessUI.invoiceBalance(id).outstandingAmount===0,id);await phone.waitForFunction(()=>TsukinowaBusinessUI.getSync().getQueue().length===0);
 assert.deepEqual(await desktop.evaluate(id=>{const v=TsukinowaBusinessUI.invoiceBalance(id);return [v.paidAmount,v.outstandingAmount,v.paymentStatus,v.payments.length];},id),[779379,0,'入金済',2]);
 assert.equal(await desktop.locator('#allSavedDocsList').getByRole('button',{name:'未入金残高請求書',exact:true}).count(),0);await desktop.locator('#balanceClose').click();
 assert.equal(await desktop.evaluate(()=>TsukinowaAccounting.monthly({sales:bizState.sales,payments:bizState.payments},'2026-08').bankIncome),770379);
 assert.equal(await desktop.evaluate(()=>bizState.sales.length),1);
 assert.deepEqual(errors,[]);console.log('PASS outstanding: real Firestore staff/admin, 390/1280px, actual payment form, partial+final payments, confirmed calculation shared across pages, old invoice immutable, read-only PDF and no duplicate sales/tax');
 }finally{await browser.close();await env.cleanup();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
