const assert=require('node:assert/strict');
// Compare against the live 見積履歴 styles instead of freezing another theme.
module.exports=async function assertSharedTheme(page,pageId){
 await page.evaluate(()=>scrollTo(0,0));
 const styles=await page.evaluate(id=>{
  const properties={page:['fontFamily','color','maxWidth','padding'],title:['fontFamily','fontSize','fontWeight','letterSpacing'],section:['backgroundColor','borderColor','borderWidth','borderRadius','padding'],heading:['fontSize','fontWeight'],th:['fontFamily','fontSize','fontWeight','backgroundColor','padding'],table:['fontFamily','fontSize'],button:['fontFamily','fontSize','fontWeight','color','backgroundColor','backgroundImage','borderColor','borderRadius','padding']};
  const read=(root,selectors)=>Object.fromEntries(Object.entries(selectors).map(([key,selector])=>{const el=selector?root.querySelector(selector):root;const css=getComputedStyle(el);return[key,Object.fromEntries(properties[key].map(p=>[p,css[p]]))];}));
  const selectors={page:null,title:'.biz-title h1',section:'.biz-section',heading:'.biz-section h2',th:'.biz-table th',table:'.biz-table'};
  const before=window.testRecords?JSON.stringify([...testRecords]):null;
  const target=document.getElementById(id),reference=document.getElementById('pageEstimates');
  const targetStyles=read(target,selectors);
  target.classList.remove('active');reference.classList.add('active');
  const referenceStyles=read(reference,selectors);
  reference.classList.remove('active');target.classList.add('active');
  const buttons=root=>['biz-btn','biz-btn primary'].map(className=>{
   const probe=document.createElement('button');probe.className=className;probe.dataset.themeProbe='';root.append(probe);
   const result=read(root,{button:'[data-theme-probe]'}).button;probe.remove();return result;
  });
  const baselineButton=buttons(reference),targetButton=buttons(target);
  const bar=document.querySelector('.biz-topbar').getBoundingClientRect();
  const navFits=[...document.querySelectorAll('.biz-nav button')].filter(e=>e.getBoundingClientRect().height).every(e=>e.getBoundingClientRect().bottom<=bar.bottom);
  const nav=getComputedStyle(document.querySelector('.biz-topbar')),selected=getComputedStyle(document.querySelector('.biz-nav .active'));
  if(before!==null&&JSON.stringify([...testRecords])!==before)throw Error('Theme inspection must not write records');
  const title=target.querySelector('.biz-title').getBoundingClientRect();
  return{navFits,titleClear:title.top>=bar.bottom,titleBeside:title.left>=bar.right-1,targetStyles,referenceStyles,targetButton,baselineButton,background:getComputedStyle(document.body).backgroundColor,nav:nav.backgroundColor,selected:selected.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
 },pageId);
 for(const key of ['page','title','th','table']){assert.equal(styles.targetStyles[key].fontFamily,styles.referenceStyles[key].fontFamily);}
 const desktop=page.viewportSize().width>=801;
 if(desktop){
  assert.equal(styles.referenceStyles.page.maxWidth,'none');
  assert.equal(styles.targetStyles.page.maxWidth,'none');
 }else{
  assert.equal(styles.referenceStyles.page.maxWidth,'1440px');
  assert.equal(styles.targetStyles.page.maxWidth,pageId==='pageEstimates'?'1440px':'1180px');
 }
 delete styles.targetStyles.page.maxWidth;delete styles.referenceStyles.page.maxWidth;
 assert.deepEqual(styles.targetStyles,styles.referenceStyles,pageId+' must share 見積履歴 typography and containers');
 for(const button of [...styles.targetButton,...styles.baselineButton])delete button.fontFamily;
 assert.deepEqual(styles.targetButton,styles.baselineButton,pageId+' ordinary and primary buttons');
 assert.equal(styles.navFits,true,'navigation buttons stay inside the navigation shell');
 if(desktop)assert.equal(styles.titleBeside,true,'title sits to the right of the sidebar');
 else assert.equal(styles.titleClear,true,'title stays below navigation');
 if(desktop){
  assert.equal(styles.background,'rgb(232, 238, 243)');
  assert.equal(styles.nav,'rgb(22, 50, 79)');
  assert.equal(styles.selected,'rgb(244, 247, 251)');
  assert.equal(styles.targetButton[1].backgroundColor,'rgb(15, 110, 130)');
  assert.equal(styles.targetButton[1].backgroundImage,'none');
  assert.equal(styles.targetButton[1].color,'rgb(255, 255, 255)');
 }else{
  assert.equal(styles.background,'rgb(240, 242, 245)');
  assert.equal(styles.nav,'rgb(20, 20, 20)');
  assert.equal(styles.selected,'rgb(43, 43, 43)');
  assert.match(styles.targetButton[1].backgroundImage,/212,\s*181,\s*116/);
 }
 assert.equal(styles.overflow,false);
};
