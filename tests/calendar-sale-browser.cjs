// 日程（本地予定）から売上・入金を登録（請求書・領収書なし）. Local mode (1280/390) writes the same records as the cloud command;
// cloud mode goes through registerCalendarSale / calendarSaleChange (admin only). Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{try{const f=path.join(root,new URL(req.url,'http://x').pathname.replace(/^\/$/,'/index.html'));res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.statusCode=404;res.end();}});
const business={estimates:[],projects:[],calendar:[],audit:[],expenses:[],bank:[],payments:[],sales:[]};
async function open(browser,width,answers){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept(d.type()==='prompt'?answers.shift()??'':undefined));
 await page.route('https://**/*',r=>r.fulfill({body:''}));await page.route('**/firebase-config.json',r=>r.fulfill({json:{enabled:false}}));
 await page.clock.setFixedTime(new Date('2026-12-05T01:00:00Z'));
 await page.addInitScript(b=>{if(!localStorage.getItem('tsukinowa_business_v1'))localStorage.setItem('tsukinowa_business_v1',b);},JSON.stringify(business));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>bizSwitchPage('calendar'));return {page,errors};
}
const newButton=width=>width<=800?'#ddCalendar [data-dd-new]':'#pageCalendar .biz-title button:has-text("＋ 本地予定")';
async function create(page,width,{date,title,amount,method,customer}){
 await page.locator(newButton(width)).click();
 assert.equal(await page.locator('#ddLeSale').isVisible(),true);assert.equal(await page.locator('#ddLeSaleFields').isVisible(),false,'sale fields closed by default');
 await page.fill('#ddLeDate',date);await page.fill('#ddLeTitle',title);await page.locator('#ddLeSaleOn').check();
 assert.equal(await page.inputValue('#ddLsContent'),title);assert.equal(await page.inputValue('#ddLsDate'),date);assert.equal(await page.inputValue('#ddLsMethod'),'現金');
 if(customer)await page.fill('#ddLsCustomer',customer);await page.fill('#ddLsContent','網戸張替え');await page.selectOption('#ddLsMethod',method);
 await page.locator('#ddLeSave').click();assert.match(await page.locator('#ddLeError').textContent(),/金額/,'amount required');
 await page.fill('#ddLsAmount',String(amount));await page.locator('#ddLeSave').click();
 await page.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:5000}).catch(async e=>{throw Error('dialog stayed open: '+await page.locator('#ddLeError').textContent());});
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});try{
 for(const width of [1280,390]){
  const answers=[],{page,errors}=await open(browser,width,answers),stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tsukinowa_business_v1')));
  await create(page,width,{date:'2026-12-01',title:'試験客 網戸',amount:11000,method:'現金',customer:'試験客'});
  let s=await stored();const ev=s.calendar.find(e=>e.title==='試験客 網戸'),id='calendar_cash_'+ev.id;
  assert.deepEqual(s.sales.map(x=>[x.id,x.sourceType,x.customer,x.amount,x.saleDate,x.paymentMethod]),[[id,'calendar-cash','試験客',11000,'2026-12-01','現金']]);
  assert.deepEqual(s.payments.map(p=>[p.id,p.saleId,p.amount,p.date,p.confirmation]),[['pay_'+id,id,11000,'2026-12-01','cash-received']]);
  assert.equal(ev.saleId,id);
  assert.equal(await page.evaluate(()=>document.getElementById('kpiPayments').textContent),'11,000','home 入金 includes the cash sale');
  assert.equal(await page.evaluate(()=>document.getElementById('kpiReceivable').textContent),'0');
  // reopen: registered; delete blocked while the sale exists
  const edit=page.locator('#ddCalendar [data-dd-edit="'+ev.id+'"]');await edit.click();
  assert.match(await page.locator('#ddLeSaleStatus').textContent(),/登録済：11,000円（税込）／試験客／現金／入金済/);assert.equal(await page.locator('#ddLeSaleToggle').isVisible(),false);assert.equal(await page.locator('#ddLeSaleAdmin').isVisible(),true);
  await page.locator('#ddLeDelete').click();assert.match(await page.locator('#ddLeError').textContent(),/先に売上を取消/);
  // edit amount: one sale, one payment, reason required
  await page.locator('#ddLsEdit').click();assert.equal(await page.inputValue('#ddLsAmount'),'11000');await page.fill('#ddLsAmount','13200');
  answers.push('');await page.locator('#ddLeSave').click();assert.match(await page.locator('#ddLeError').textContent(),/理由/);assert.equal((await stored()).sales[0].amount,11000);
  answers.push('金額訂正');await page.locator('#ddLeSave').click();await page.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:5000});
  s=await stored();assert.deepEqual([s.sales.length,s.sales[0].amount,s.sales[0].editReason,s.payments.length,s.payments[0].amount],[1,13200,'金額訂正',1,13200]);
  // 現金 → 銀行振込: sale stays, own cash payment voided, now 未収
  await edit.click();await page.locator('#ddLsEdit').click();await page.selectOption('#ddLsMethod','銀行振込');answers.push('振込に訂正');await page.locator('#ddLeSave').click();await page.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:5000});
  s=await stored();assert.equal(s.sales[0].sourceType,'calendar-manual');assert.ok(s.payments[0].deletedAt);
  assert.equal(await page.evaluate(()=>document.getElementById('kpiPayments').textContent),'0');assert.equal(await page.evaluate(()=>document.getElementById('kpiReceivable').textContent),'13,200');
  await edit.click();assert.match(await page.locator('#ddLeSaleStatus').textContent(),/銀行振込／未収 13,200円/);
  // cancel: kept as voided, no totals, no re-registration from this event; the event can then be deleted
  answers.push('二重登録');await page.locator('#ddLsVoid').click();await page.waitForFunction(()=>/取消済み/.test(document.getElementById('ddLeSaleStatus').textContent),null,{timeout:5000});
  s=await stored();assert.ok(s.sales[0].deletedAt);assert.equal(s.sales[0].documentStatus,'cancelled');assert.equal(await page.locator('#ddLeSaleToggle').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.getElementById('kpiReceivable').textContent),'0');assert.equal(await page.evaluate(()=>document.getElementById('kpiSales').textContent),'0');
  await page.locator('#ddLeCancel').click();
  // 銀行振込 from the start: 売上 only
  await create(page,width,{date:'2026-12-02',title:'試験 振込',amount:22000,method:'銀行振込'});
  s=await stored();const b=s.sales.find(x=>!x.deletedAt);assert.deepEqual([b.customer,b.amount,b.paymentMethod,s.payments.filter(p=>!p.deletedAt).length],['現金客',22000,'銀行振込',0]);
  assert.equal(await page.evaluate(()=>document.getElementById('kpiReceivable').textContent),'22,000');
  // 売上日 = the event's date: follows date changes made after the sale section is open, and a stale field value is never sent
  await page.locator(newButton(width)).click();await page.fill('#ddLeDate','2026-10-30');await page.fill('#ddLeTitle','試験様・中野・クロス張替・¥70000');await page.locator('#ddLeSaleOn').check();
  assert.equal(await page.inputValue('#ddLsDate'),'2026-10-30');await page.fill('#ddLeDate','2026-11-27');assert.equal(await page.inputValue('#ddLsDate'),'2026-11-27','follows the event date');
  await page.evaluate(()=>{document.getElementById('ddLsDate').value='2026-10-30';});// stale value without a user edit
  await page.fill('#ddLsCustomer','試験様');await page.fill('#ddLsAmount','70000');await page.selectOption('#ddLsMethod','銀行振込');
  assert.match(await page.locator('#ddLsHint').textContent(),/売上のみ登録します（未収）/);await page.locator('#ddLeSave').click();await page.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:5000});
  s=await stored();{const x=s.sales.find(v=>v.customer==='試験様'&&!v.deletedAt);assert.deepEqual([x.saleDate,x.amount,x.paymentMethod],['2026-11-27',70000,'銀行振込']);assert.equal(s.payments.filter(p=>p.saleId===x.id&&!p.deletedAt).length,0,'bank transfer: 売上 only (未収), no 入金');}
  // a 売上日 the user set stays when the event date changes
  await page.locator(newButton(width)).click();await page.fill('#ddLeDate','2026-11-20');await page.fill('#ddLeTitle','試験 手入力');await page.locator('#ddLeSaleOn').check();await page.fill('#ddLsDate','2026-11-25');await page.fill('#ddLeDate','2026-11-21');
  assert.equal(await page.inputValue('#ddLsDate'),'2026-11-25');await page.locator('#ddLeCancel').click();
  // a plain 本地予定 without the checkbox creates no sale
  await page.locator(newButton(width)).click();await page.fill('#ddLeDate','2026-12-03');await page.fill('#ddLeTitle','打合せのみ');await page.locator('#ddLeSave').click();
  assert.equal((await stored()).sales.length,3);
  if(width===390)assert.ok(await page.evaluate(()=>{const d=document.getElementById('ddLocalEvent');return !d.open||d.scrollWidth<=d.clientWidth;}));
  assert.deepEqual(errors,[]);await page.close();
 }
 // Cloud: same dialog drives the existing commands; staff cannot register or change.
 for(const role of ['admin','staff']){
  const answers=[],{page,errors}=await open(browser,1280,answers);
  await page.evaluate(async role=>{
   const records=new Map(),listeners=[];let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,timestamp:()=>({seconds:1}),digest:async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''),list:async p=>[...records].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),listen:(p,many,next)=>{const l={p,next};listeners.push(l);setTimeout(async()=>next(await driver.list(p),{fromCache:false}),0);return()=>listeners.splice(listeners.indexOf(l),1);},transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const old=records.get(p)||null;reads.set(p,old);return old;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(records.get(p)||null)!==v))continue;for(const [p,v]of writes)records.set(p,v);for(const l of listeners)setTimeout(async()=>l.next(await driver.list(l.p),{fromCache:false}),0);return result;}}};
   const client=TsukinowaCloudCore.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'test',appId:'x'}});await cb({uid:'test',claims:{role,companyId:'tsukinowa'}});TsukinowaBusinessUI.configure(true);TsukinowaBusinessUI.auth(client.getState(),client);window.testRecords=records;
  },role);
  await page.evaluate(()=>bizSwitchPage('calendar'));
  const live=name=>page.evaluate(name=>[...window.testRecords].filter(([k,v])=>k.includes('/'+name+'/')&&!v.payload.deletedAt).map(([k,v])=>({id:k.split('/').at(-1),...v.payload})),name);
  if(role==='staff'){
   await page.locator(newButton(1280)).click();assert.equal(await page.locator('#ddLeSaleToggle').isVisible(),false);assert.match(await page.locator('#ddLeSaleStatus').textContent(),/管理者のみ/);
   await assert.rejects(page.evaluate(()=>TsukinowaBusinessUI.calendarSale.register('x',{salesDate:'2026-12-01',content:'a',amount:1,paymentMethod:'現金'})),/日程が見つかりません|管理者/);
   assert.deepEqual(errors,[]);await page.close();continue;
  }
  await create(page,1280,{date:'2026-12-01',title:'クラウド 現金',amount:11000,method:'現金',customer:'試験客'});
  await page.waitForFunction(()=>bizState.sales.length===1,null,{timeout:5000});
  const ev=(await live('calendarLinks'))[0];assert.equal(ev.saleId,'calendar_cash_'+ev.id);
  assert.deepEqual((await live('sales')).map(s=>[s.sourceType,s.amount]),[['calendar-cash',11000]]);assert.deepEqual((await live('payments')).map(p=>p.confirmation),['cash-received']);assert.equal((await live('cashLedger')).length,1);
  const edit=page.locator('#ddCalendar [data-dd-edit="'+ev.id+'"]');await edit.click();assert.match(await page.locator('#ddLeSaleStatus').textContent(),/入金済/);
  await page.locator('#ddLsEdit').click();await page.fill('#ddLsAmount','13200');answers.push('金額訂正');await page.locator('#ddLeSave').click();await page.waitForFunction(()=>!document.getElementById('ddLocalEvent').open,null,{timeout:5000});
  assert.deepEqual([(await live('sales'))[0].amount,(await live('payments'))[0].amount,(await live('cashLedger'))[0].amount],[13200,13200,13200]);
  await edit.click();answers.push('取消試験');await page.locator('#ddLsVoid').click();await page.waitForFunction(()=>/取消済み/.test(document.getElementById('ddLeSaleStatus').textContent),null,{timeout:5000});
  assert.deepEqual([(await live('sales')).length,(await live('payments')).length,(await live('cashLedger')).length],[0,0,0]);
  await page.locator('#ddLeCancel').click();
  // 「＋ 売上登録」 in cloud: no free-standing sale; choose 請求書／領収書 (帳票) or 帳票なしで入金登録 (today's 本地予定 with 売上・入金 open)
  const chooser=async()=>{await page.evaluate(()=>bizSwitchPage('sales'));await page.locator('#pageSales .biz-title button:visible:has-text("売上登録")').first().click();
   assert.equal(await page.locator('#saleEntryChooser').isVisible(),true);return page.$$eval('#saleEntryChooser [data-sale-entry]',b=>b.map(x=>x.textContent));};
  assert.deepEqual(await chooser(),['請求書を作成','領収書を作成','帳票なしで入金登録','閉じる']);
  await page.locator('[data-sale-entry="invoice"]').click();assert.equal(await page.evaluate(()=>[document.getElementById('pageChohyo').classList.contains('active'),docType]).then(String),'true,invoice');
  await chooser();await page.locator('[data-sale-entry="receipt"]').click();assert.equal(await page.evaluate(()=>[document.getElementById('pageChohyo').classList.contains('active'),docType]).then(String),'true,receipt');
  await chooser();await page.locator('[data-sale-entry="event"]').click();
  assert.equal(await page.locator('#ddLocalEvent').isVisible(),true);assert.equal(await page.inputValue('#ddLeDate'),'2026-12-05');assert.equal(await page.locator('#ddLeSaleOn').isChecked(),true);assert.equal(await page.locator('#ddLeSaleFields').isVisible(),true);
  await page.locator('#ddLeCancel').click();assert.equal((await live('sales')).length,0,'the chooser itself writes nothing');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('calendar sale browser tests passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
