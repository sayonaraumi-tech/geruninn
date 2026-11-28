// 値引き on the invoice form and preview (desktop and mobile): the three agreed cases, and no-discount stays as before.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
 await page.clock.setFixedTime(new Date('2026-11-28T01:00:00Z'));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>{bizSwitchPage('chohyo');setDocType('invoice');items=[{content:'クロス張替え',qty:1,unit:'式',price:50000,taxable:true}];renderItemEditor();document.getElementById('travelFee').value='0';recalc();});
 const read=()=>page.evaluate(()=>({subtotal:document.getElementById('dSubtotal').textContent,tax:document.getElementById('dTax').textContent,total:document.getElementById('dGrandTotal').textContent,lines:[...document.querySelectorAll('#invItems tr')].map(r=>r.textContent),state:collectFormState(),domain:TsukinowaBusiness.total(collectFormState())}));
 // The 値引き control is shown for invoices on desktop and mobile.
 assert.equal(await page.locator('#discountToggle').isVisible(),true,width+': 値引き button visible');
 let r=await read();
 assert.deepEqual([r.subtotal,r.tax,r.total],['50,000 円','5,000 円','55,000 円'],width+': no discount');
 assert.equal('discountAmount' in r.state,false,width+': no-discount snapshot has no discountAmount key');assert.equal(r.domain,55000);
 assert.equal(r.lines.some(l=>l.includes('値引き')),false);assert.equal(await page.locator('#dDiscountRow').isVisible(),false);
 await page.locator('#discountToggle').click();assert.equal(await page.locator('#discountAmount').isVisible(),true,width+': 値引き input visible');
 await page.fill('#discountAmount','10000');r=await read();
 assert.deepEqual([r.subtotal,r.tax,r.total],['40,000 円','4,000 円','44,000 円'],width+': 10,000 off, fee 0');
 assert.equal(r.state.discountAmount,10000);assert.equal(r.domain,44000);assert.equal(r.lines.filter(l=>l.includes('値引き')).length,1);
 await page.fill('#travelFee','4000');r=await read();
 assert.deepEqual([r.subtotal,r.tax,r.total],['44,000 円','4,400 円','48,400 円'],width+': 10,000 off, fee 4,000');assert.equal(r.domain,48400);
 // Clearing the discount returns to exactly the no-discount snapshot.
 await page.fill('#discountAmount','0');await page.fill('#travelFee','0');r=await read();
 assert.deepEqual([r.subtotal,r.tax,r.total],['50,000 円','5,000 円','55,000 円']);assert.equal('discountAmount' in r.state,false);
 // Other document types never show or apply it.
 for(const t of ['estimate','receipt']){await page.evaluate(t=>setDocType(t),t);assert.equal(await page.locator('#discountSection').isVisible(),false,width+': hidden for '+t);}
 assert.deepEqual(errors,[]);await page.close();}
 console.log('discount browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
