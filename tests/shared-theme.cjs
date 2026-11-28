const assert=require('node:assert/strict');
// Compare against the live 見積履歴 styles instead of freezing another theme.
module.exports=async function assertSharedTheme(page,pageId){
 await page.evaluate(()=>scrollTo(0,0));
 const styles=await page.evaluate(id=>{
  const properties={page:['fontFamily','color','maxWidth','padding'],title:['fontFamily','fontSize','fontWeight','letterSpacing'],section:['backgroundColor','borderColor','borderWidth','borderRadius','padding'],heading:['fontSize','fontWeight'],th:['fontFamily','fontSize','fontWeight','backgroundColor','padding'],table:['fontFamily','fontSize'],button:['fontFamily','fontSize','fontWeight','backgroundColor','borderColor','borderRadius','padding']};
  const read=(root,selectors)=>Object.fromEntries(Object.entries(selectors).map(([key,selector])=>{const el=selector?root.querySelector(selector):root;const css=getComputedStyle(el);return[key,Object.fromEntries(properties[key].map(p=>[p,css[p]]))];}));
  // Desktop list pages (見積履歴/保存帳票) are design month panels: the panel surface is the filter head, the outer section is a transparent stack.
  const desktopLists=matchMedia('(min-width:801px)').matches&&document.body.classList.contains('dd');
  const selectors={page:null,title:'.biz-title h1',section:desktopLists?':is(.biz-section:not(.dd-list),.dd-list>.biz-section-head)':'.biz-section',heading:'.biz-section h2',th:'.biz-table th',table:'.biz-table'};
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
  const side=document.querySelector('.biz-nav').getBoundingClientRect(),navInSidebar=[...document.querySelectorAll('.biz-nav button')].filter(e=>e.getBoundingClientRect().height).every(e=>{const r=e.getBoundingClientRect();return r.left>=side.left&&r.right<=side.right&&r.top>=side.top&&r.bottom<=innerHeight;});
  const nav=getComputedStyle(document.querySelector('.biz-topbar')),selected=getComputedStyle(document.querySelector('.biz-nav .active'));
  if(before!==null&&JSON.stringify([...testRecords])!==before)throw Error('Theme inspection must not write records');
  return{navFits,navInSidebar,sideRight:side.right,titleClear:target.querySelector('.biz-title').getBoundingClientRect().top>=bar.bottom,targetStyles,referenceStyles,targetButton,baselineButton,background:getComputedStyle(document.body).backgroundColor,nav:nav.backgroundColor,selected:selected.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
 },pageId);
 const desktop=page.viewportSize().width>800;// chiori desktop design (>=801px): sidebar shell and theme tokens instead of the black top bar.
 for(const key of ['page','title','th','table']){assert.equal(styles.targetStyles[key].fontFamily,styles.referenceStyles[key].fontFamily);}
 // History needs a wider desktop container for its intact action group.
 assert.equal(styles.referenceStyles.page.maxWidth,desktop?'1650px':'1440px');
 assert.equal(styles.targetStyles.page.maxWidth,desktop?'1650px':pageId==='pageEstimates'?'1440px':'1180px');
 delete styles.targetStyles.page.maxWidth;delete styles.referenceStyles.page.maxWidth;
 assert.deepEqual(styles.targetStyles,styles.referenceStyles,pageId+' must share 見積履歴 typography and containers');
 for(const button of [...styles.targetButton,...styles.baselineButton])delete button.fontFamily;
 assert.deepEqual(styles.targetButton,styles.baselineButton,pageId+' ordinary and gold primary buttons');
 assert.equal(styles.titleClear,true,'title stays below navigation');assert.equal(styles.overflow,false);
 if(desktop){assert.equal(styles.navInSidebar,true,'desktop menus stay inside the sidebar');assert.equal(styles.sideRight,205);const t=await page.evaluate(()=>{const v=n=>getComputedStyle(document.body).getPropertyValue(n).trim(),rgb=c=>{const e=document.createElement('i');e.style.color=c;document.body.append(e);const r=getComputedStyle(e).color;e.remove();return r;};return {bg:rgb(v('--dd-bg')),panel:rgb(v('--dd-panel')),active:rgb(v('--dd-side-active'))};});assert.equal(styles.background,t.bg);assert.equal(styles.nav,t.panel);assert.equal(styles.selected,t.active);}
 else{assert.equal(styles.navFits,true,'mobile menus stay inside the black navigation bar');assert.equal(styles.background,'rgb(240, 242, 245)');assert.equal(styles.nav,'rgb(20, 20, 20)');assert.equal(styles.selected,'rgb(43, 43, 43)');}
};
