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

 await phone.clock.setFixedTime(new Date('2026-10-02T03:59:00Z'));await desktop.clock.setFixedTime(new Date('2026-10-02T03:59:00Z'));
 async function save(p,type,extra={}){return p.evaluate(async({type,extra})=>{bizSwitchPage('chohyo');while(onodaGenerating)await new Promise(r=>setTimeout(r,10));setDocType(type);if(type==='onoda')while(onodaGenerating)await new Promise(r=>setTimeout(r,10));document.getElementById('customerName').value=type==='onoda'?'dynast合同会社':'帳票番号検証';document.getElementById('invoiceDate').value='2026-10-02';items=[{content:'課税施工',qty:1,unit:'式',price:1000,taxable:true},{content:'非課税',qty:1,unit:'式',price:500,taxable:false}];if(type==='onoda')items.forEach(item=>applyOnodaFixedPricing(item));if(type==='receipt'){document.getElementById('receiptSale').value=extra.saleId;document.getElementById('receiptPaymentDate').value='2026-10-02';document.getElementById('receiptTotal').value='100';}recalc();const draft=collectFormState();if(draft.invoiceNo)throw Error('draft number locked');saveConfirmedHistory();await TsukinowaBusinessUI.getSync().flush();const current=collectFormState(),stored=(await TsukinowaBusinessUI.getClient().listRecords('documents')).find(r=>r.id===current.documentId)?.payload.snapshot;if(TsukinowaCloudCore.canonical(stored)!==TsukinowaCloudCore.canonical(TsukinowaBusiness.cleanSnapshot(current)))throw Error('Form must match the formal snapshot immediately after saving: '+JSON.stringify({current:TsukinowaBusiness.cleanSnapshot(current),stored}));return current;},{type,extra});}
 const estimate=await save(phone,'estimate');assert.equal(estimate.invoiceNo,'20261002-1259-01');
 await desktop.waitForFunction(id=>loadConfirmedHistory().some(h=>h.documentId===id),estimate.documentId);
 await desktop.clock.setFixedTime(new Date('2026-10-02T04:06:00Z'));await phone.clock.setFixedTime(new Date('2026-10-02T04:06:00Z'));
 const invoice=await save(desktop,'invoice');assert.equal(invoice.invoiceNo,'20261002-1306-01');
 await phone.waitForFunction(id=>bizState.sales.some(s=>s.documentId===id),invoice.documentId);
 const receipt=await save(phone,'receipt',{saleId:'sale_'+invoice.documentId});assert.equal(receipt.invoiceNo,'20261002-1306-02');
 const onoda=await save(desktop,'onoda');assert.equal(onoda.invoiceNo,'20261002-1306-03');
 await phone.waitForFunction(()=>loadConfirmedHistory().length===4);await desktop.waitForFunction(()=>loadConfirmedHistory().length===4);
 const capture=async(p,id)=>p.evaluate(async id=>{applyFormState(loadConfirmedHistory().find(h=>h.documentId===id));bizSwitchPage('chohyo');document.getElementById('previewArea').classList.add('show');window.pdfSaves=0;window.html2pdf=()=>{const canvas=document.createElement('canvas');canvas.width=794;canvas.height=1123;const pdf={internal:{getNumberOfPages:()=>1},deletePage(){},addPage(){},addImage(){},save(){window.pdfSaves++}};const worker={set(opt){window.capturedPDFOptions=opt;return worker},from(el){window.capturedNo=el.querySelector('#dNo').textContent;return worker},toCanvas(){return worker},toPdf(){return worker},get:key=>Promise.resolve(key==='canvas'?canvas:pdf)};return worker};await doPrint();await new Promise(r=>setTimeout(r,500));const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};return {no:document.getElementById('dNo').textContent,capturedNo,pdfSaves,reg:document.getElementById('dRegNo').textContent,regRect:rect('dRegNo'),expiryRect:rect('dExpiryTop'),expiryLabel:document.querySelector('#topExpiryLine .expiry-label').textContent,expiryDate:document.getElementById('dExpiryTop').textContent,registrationInputType:document.getElementById('invoiceRegNo').type,registrationCount:document.querySelector('.invoice').textContent.split('T7040003023888').length-1,dateRect:rect('dDate'),sealRect:rect('sealMid'),expiry:getComputedStyle(document.getElementById('topExpiryLine')).display,stored:loadConfirmedHistory().find(h=>h.documentId===id).invoiceNo};},id);
 for(const state of [estimate,invoice,receipt,onoda]){
  const results=[];for(const p of [phone,desktop]){const r=await capture(p,state.documentId);assert.equal(r.pdfSaves,1);assert.equal(r.no,state.invoiceNo);assert.equal(r.capturedNo,state.invoiceNo);assert.equal(r.stored,state.invoiceNo);assert.equal(r.reg,state.docType==='estimate'?'':'T7040003023888');if(state.docType!=='estimate'){assert(r.regRect.y>=r.dateRect.bottom);assert(r.regRect.bottom<=r.sealRect.y||r.regRect.right<=r.sealRect.x);}assert.equal(r.expiry==='none',state.docType==='receipt');assert.equal(r.registrationInputType,'hidden');assert.equal(r.registrationCount,state.docType==='estimate'?0:1);if(state.docType!=='receipt'){assert.equal(r.expiryLabel,state.docType==='estimate'?'有効期限':'支払期限');assert.equal(r.expiryDate,state.docType==='estimate'?'2026年11月1日':'2026年11月2日');assert(r.expiryRect.y>=r.dateRect.bottom);if(state.docType!=='estimate')assert(r.regRect.y>=r.expiryRect.bottom);}results.push(r);await p.evaluate(()=>{const frame=document.createElement('iframe');frame.id='pdfLayout';frame.style.cssText='position:fixed;top:0;left:0;width:794px;height:1123px;z-index:99999;border:0;background:white';document.body.append(frame);frame.contentDocument.open();frame.contentDocument.write('<html><head>'+Array.from(document.querySelectorAll('style')).map(s=>s.outerHTML).join('')+'</head><body>'+document.querySelector('.invoice').outerHTML+'</body></html>');frame.contentDocument.close();capturedPDFOptions.html2canvas.onclone(frame.contentDocument);});await p.frameLocator('#pdfLayout').locator('.invoice').screenshot({path:path.join(root,'../numbering-'+state.docType+'-'+(p===phone?'phone':'desktop')+'.png')});await p.evaluate(()=>document.getElementById('pdfLayout').remove());}assert.equal(results[0].no,results[1].no);
 }
 // Native printing uses the same deadline/registration lines for every document type.
 for(const state of [estimate,invoice,receipt,onoda]){
  await desktop.evaluate(state=>{applyFormState(loadConfirmedHistory().find(h=>h.documentId===state.documentId));window.printedMeta=null;window.print=()=>{printedMeta={no:document.getElementById('dNo').textContent,expiry:getComputedStyle(document.getElementById('topExpiryLine')).display,reg:document.getElementById('dRegNo').textContent};};systemPrint();},state);
  await desktop.waitForFunction(()=>window.printedMeta);
  const printed=await desktop.evaluate(()=>printedMeta);assert.equal(printed.no,state.invoiceNo);assert.equal(printed.expiry==='none',state.docType==='receipt');assert.equal(printed.reg,state.docType==='estimate'?'':'T7040003023888');
 }
 if(process.env.HTML2PDF_BUNDLE){
  // Exercise the production renderer as well as the captured output HTML.
  for(const state of [estimate,invoice,receipt,onoda]){
   await desktop.addScriptTag({path:process.env.HTML2PDF_BUNDLE});
   await desktop.evaluate(state=>{applyFormState(loadConfirmedHistory().find(h=>h.documentId===state.documentId));bizSwitchPage('chohyo');},state);
   const [download]=await Promise.all([desktop.waitForEvent('download'),desktop.evaluate(()=>doPrint())]);
   const target=path.join(root,'../real-'+state.docType+'.pdf');await download.saveAs(target);
   const pdf=fs.readFileSync(target);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert(pdf.length>10000);
   assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
   assert.equal(await desktop.locator('#invoiceNo').inputValue(),state.invoiceNo);
  }
 }
 await desktop.clock.setFixedTime(new Date('2026-10-02T04:07:00Z'));await desktop.evaluate(id=>manageFormalDocument(loadConfirmedHistory().findIndex(h=>h.documentId===id),'revision'),invoice.documentId);
 assert.equal(await desktop.locator('#invoiceNo').inputValue(),'');await desktop.evaluate(async()=>{saveConfirmedHistory();await TsukinowaBusinessUI.getSync().flush();});
 const revised=await desktop.evaluate(()=>collectFormState());assert.equal(revised.invoiceNo,'20261002-1307-01');
 await phone.waitForFunction(id=>loadConfirmedHistory().some(h=>h.documentId===id),revised.documentId);
 const original=await phone.evaluate(id=>loadConfirmedHistory().find(h=>h.documentId===id),invoice.documentId);assert.equal(original.invoiceNo,invoice.invoiceNo);assert.equal(original.documentStatus,'revised');
 const relationship=await phone.evaluate(id=>loadConfirmedHistory().find(h=>h.documentId===id).revisedFromDocumentId,revised.documentId);assert.equal(relationship,invoice.documentId);
 await desktop.reload();await desktop.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='未ログイン');await desktop.evaluate(()=>{bizSwitchPage('chohyo');});await desktop.locator('#bizCloudAccountButton').click();await desktop.locator('#cloudEmail').fill('admin@example.com');await desktop.locator('#cloudPassword').fill('password');await desktop.locator('#cloudLogin').click();await desktop.waitForFunction(()=>document.getElementById('coreSyncStatus').textContent==='クラウド同期済');await desktop.getByRole('button',{name:'閉じる',exact:true}).click();
 await desktop.clock.setFixedTime(new Date('2026-11-03T04:07:00Z'));
 assert.equal((await capture(desktop,invoice.documentId)).no,invoice.invoiceNo);
 await desktop.evaluate(async()=>{window.printedNo='';window.print=()=>{printedNo=document.getElementById('dNo').textContent;};await systemPrint();});
 await desktop.waitForFunction(()=>window.printedNo);
 assert.equal(await desktop.evaluate(()=>printedNo),invoice.invoiceNo);
 assert.equal(await desktop.locator('#dRegNo').count(),1);
 const accounting=await desktop.evaluate(()=>({sales:bizState.sales.length,payments:bizState.payments.length}));
 assert.deepEqual(accounting,{sales:2,payments:1});
 // Separate phone/desktop browser contexts formally save in the same minute.
 await phone.clock.setFixedTime(new Date('2026-11-03T04:07:00Z'));
 const concurrent=await Promise.all([save(phone,'estimate'),save(desktop,'estimate')]);
 assert.deepEqual(concurrent.map(s=>s.invoiceNo).sort(),['20261103-1307-01','20261103-1307-02']);
 // Historical formal snapshots retain their original registration values and never get rewritten on reopen/export.
 const {doc,setDoc,getDoc}=require('firebase/firestore');
 const oldSnapshot={...invoice,invoiceDate:'2026-09-30',invoiceNo:'legacy-september',invoiceRegNo:'',documentId:'historical-september'};
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'companies/tsukinowa/documents/historical-september'),{id:'historical-september',revision:1,payload:{status:'active',snapshot:oldSnapshot}});});
 await desktop.waitForFunction(()=>loadConfirmedHistory().some(h=>h.documentId==='historical-september'));
 const before=await env.withSecurityRulesDisabled(async c=>(await getDoc(doc(c.firestore(),'companies/tsukinowa/documents/historical-september'))).data());
 for(const p of [phone,desktop]){
  await p.waitForFunction(()=>loadConfirmedHistory().some(h=>h.documentId==='historical-september'));
  const old=await capture(p,'historical-september');assert.equal(old.reg,'');assert.equal(old.no,'legacy-september');assert.equal(old.expiry,'grid');
  await p.evaluate(()=>{applyFormState({...collectFormState(),historyId:'',cloudRevision:0,invoiceNo:'',invoiceDate:'2026-10-02',invoiceRegNo:''});recalc();});
  assert.equal(await p.locator('#dRegNo').textContent(),'T7040003023888');
  assert.equal(await p.locator('#invoiceRegNo').isVisible(),false);
 }
 const after=await env.withSecurityRulesDisabled(async c=>(await getDoc(doc(c.firestore(),'companies/tsukinowa/documents/historical-september'))).data());assert.deepEqual(after,before);
 assert.deepEqual(errors,[]);console.log('PASS real Firestore + 390/1280px: Japan minute numbering, cross-type sequence, drafts, 9 PDF captures, reopen, original/revision relationship payment/validity deadlines, automatic hidden registration, unchanged September snapshot and no metadata/seal overlap');
 }finally{await browser.close();server.close();await env.cleanup();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
