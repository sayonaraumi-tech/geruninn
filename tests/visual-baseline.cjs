// Run from sales-period-browser after its realistic in-memory financial fixtures.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
module.exports=async(page,width)=>{
 const before=await page.evaluate(()=>JSON.stringify([...testRecords]));
 const pages={dashboard:'pageDashboard',calendar:'pageCalendar',estimates:'pageEstimates',chohyo:'pageChohyo',savedDocs:'pageSavedDocs',sales:'pageSales',expenses:'pageExpenses',bank:'pageBank',settings:'pageSettings'};
 const report={};
 const properties=['fontFamily','fontSize','fontWeight','lineHeight','padding','borderRadius'];
 const read=async selector=>page.locator(selector).first().evaluate((e,ps)=>Object.fromEntries(ps.map(p=>[p,getComputedStyle(e)[p]])),properties);
 await page.evaluate(()=>bizSwitchPage('estimates'));
 const reference={table:await read('#pageEstimates .biz-table'),th:await read('#pageEstimates th')};
 for(const [route,id] of Object.entries(pages)){
  await page.evaluate(r=>bizSwitchPage(r),route);await page.evaluate(()=>scrollTo(0,0));
  assert(await page.locator('#'+id).isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' page overflow');
  const bar=await page.locator('.biz-topbar').boundingBox(),box=await page.locator('#'+id).boundingBox();assert(box.y>=bar.y+bar.height,route+' clears navigation');
  if(route!=='chohyo'&&await page.locator('#'+id+' .biz-table').count()){
   const table=await read('#'+id+' .biz-table');assert.equal(table.fontFamily,reference.table.fontFamily);assert.equal(table.fontSize,reference.table.fontSize);
   if(await page.locator('#'+id+' th').count()){const th=await read('#'+id+' th');for(const p of ['fontSize','fontWeight','lineHeight','padding'])assert.equal(th[p],reference.th[p],route+' header '+p);}
  }
  const control=await page.locator('#'+id+' input:not([type=checkbox]):not([type=radio]),#'+id+' select').first();
  if(await control.count()){const style=await control.evaluate(e=>({fontFamily:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize}));assert.equal(style.fontFamily,reference.table.fontFamily);assert(['13px','14px','16px'].includes(style.fontSize),route+' control font-size outside compact/iOS specification: '+style.fontSize);}
  report[route]={table:await page.locator('#'+id+' .biz-table').count()?await read('#'+id+' .biz-table'):null};
  if(process.env.PREVIEW_DIR)await page.screenshot({path:path.join(process.env.PREVIEW_DIR,route+'-'+width+'.png'),fullPage:true});
 }
 await page.evaluate(()=>bizOpenCloudAccount());assert(await page.locator('#cloudDialog').isVisible());
 if(process.env.PREVIEW_DIR)await page.screenshot({path:path.join(process.env.PREVIEW_DIR,'cloud-dialog-'+width+'.png'),fullPage:true});
 await page.evaluate(()=>document.getElementById('cloudDialog').close());
 await page.evaluate(()=>bizSwitchPage('sales'));
 const cells=await page.locator('#salesRegisterTable tbody tr').first().locator('td').first().evaluate(e=>({fontSize:getComputedStyle(e).fontSize,padding:getComputedStyle(e).padding,rowHeight:e.parentElement.getBoundingClientRect().height}));
 assert.equal(cells.fontSize,'13px');assert.equal(cells.padding,'10px 9px');
 assert.equal(await page.evaluate(()=>JSON.stringify([...testRecords])),before,'visual navigation must not modify records');
 if(process.env.PREVIEW_DIR)fs.writeFileSync(path.join(process.env.PREVIEW_DIR,'visual-metrics-'+width+'.json'),JSON.stringify({reference,pages:report,salesCell:cells},null,2));
 console.log('PASS all nine pages / shared type and controls / header density / dialog / no overflow / unchanged records / '+width);
};
