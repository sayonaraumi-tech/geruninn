const assert=require('node:assert/strict');
module.exports=async(page)=>{
 const viewport=page.viewportSize();
 const original=await page.evaluate(()=>{window.historyLayoutOriginal=bizState.estimates;window.historyLayoutSearch=document.getElementById('estimateSearch').value;return JSON.stringify(bizState.estimates)});
 for(const width of [1280,1920,390]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>{
   bizSwitchPage('estimates');bizEstimateDateDescending=true;document.getElementById('estimateSearch').value='';
   bizState.estimates=['2026-10-26','2026-10-14','2026-11-03','2026-10-09','2026-10-06','2026-10-03'].map((date,i)=>({id:'fixture'+i,date,customer:'株式会社テスト',amount:123456,status:i%2?'受注・日程未定':'見積済',content:'クロス張替と補修の内容摘要',createdAt:'2026-11-03T01:00:00Z'}));
   bizState.estimates.push({...bizState.estimates[2],id:'newer',displayCreatedAt:{seconds:1793674800,nanoseconds:2}}, {...bizState.estimates[2],id:'older',displayCreatedAt:{seconds:1793674800,nanoseconds:1}});
   renderEstimates();
  });
  const dates=()=>page.locator('#estimateRows tr td:first-child').allTextContents();
  assert.deepEqual(await dates(),['2026-11-03','2026-11-03','2026-11-03','2026-10-26','2026-10-14','2026-10-09','2026-10-06','2026-10-03']);
  assert.match(await page.locator('#estimateRows tr').first().innerHTML(),/newer/);
  assert.match(await page.locator('#estimateRows tr').nth(1).innerHTML(),/older/);
  const metrics=await page.locator('#estimateRows tr').evaluateAll(rows=>rows.map(row=>{
   const cells=[...row.cells],buttons=[...row.querySelectorAll('button')],tops=buttons.map(b=>b.getBoundingClientRect().top);
   return {tops,buttons:buttons.length,nowrap:[0,3,4,5,6].every(i=>getComputedStyle(cells[i]).whiteSpace==='nowrap'),font:getComputedStyle(cells[0]).fontSize,fit:buttons.every(b=>b.scrollWidth<=b.clientWidth),height:row.getBoundingClientRect().height};
  }));
  for(const m of metrics){assert.equal(m.buttons,3);assert.equal(new Set(m.tops).size,1);assert(m.nowrap);assert(m.fit);assert.equal(m.font,'13px');assert(m.height<90);}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===1920)assert(await page.locator('#pageEstimates .biz-table-wrap').evaluate(e=>e.scrollWidth<=e.clientWidth));
  if(width===390)assert(await page.locator('#pageEstimates .biz-table-wrap').evaluate(e=>e.scrollWidth>e.clientWidth));
  await page.locator('#estimateSearch').fill('株式会社');assert.equal((await dates())[0],'2026-11-03');assert.match(await page.locator('#estimateRows tr').first().innerHTML(),/newer/);
  await page.getByRole('button',{name:'見積日'}).click();assert.equal((await dates())[0],'2026-10-03');assert.equal(await page.locator('#estimateDateHeader').getAttribute('aria-sort'),'ascending');
  await page.getByRole('button',{name:'見積日'}).click();assert.equal((await dates())[0],'2026-11-03');
  if(process.env.PREVIEW_DIR)await page.screenshot({path:require('node:path').join(process.env.PREVIEW_DIR,'estimate-history-'+width+'.png'),fullPage:true});
  console.log('PASS estimate history '+width+': single-line metadata/actions, scroll containment, newest/date ties/search/toggle');
 }
 await page.evaluate(()=>{bizState.estimates=window.historyLayoutOriginal;document.getElementById('estimateSearch').value=window.historyLayoutSearch;bizEstimateDateDescending=true;renderEstimates()});
 assert.equal(await page.evaluate(()=>JSON.stringify(bizState.estimates)),original);
 await page.setViewportSize(viewport);await page.evaluate(()=>bizSwitchPage('sales'));
};
