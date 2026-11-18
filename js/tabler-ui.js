/* Presentation adapter: authoritative reads and existing commands only. */
(function(root){
'use strict';
const palettes={
 blue:['#2869ad','#f4f6f9','#ffffff','#243348','#647386','#dfe5ed','#ffffff','#e8f0fa','#648d9d','#26384c','#647386','#e8f0fa'],
 gold:['#a77b36','#f5f5f2','#ffffff','#292b2d','#6e7378','#e2e4e1','#22272c','#f2ece1','#837d72','#f5f4f0','#b9c1c5','#393d40'],
 green:['#247b69','#f5f7f6','#ffffff','#273632','#6c7975','#e0e7e3','#ffffff','#e6f1ed','#71898a','#273632','#6c7975','#e6f1ed'],
 purple:['#6d6197','#f6f6f8','#ffffff','#302f3c','#787685','#e5e5ed','#ffffff','#eeeaf5','#8a95aa','#302f3c','#787685','#eeeaf5'],
 dark:['#8baee4','#171b22','#222832','#f0f3f8','#a4b0c0','#37414e','#1c222b','#303b4a','#8eb1ac','#f0f3f8','#a4b0c0','#303b4a']
};
const keys=['--acc','--bg','--panel','--fg','--mut','--line','--side','--selected','--expense','--side-fg','--side-mut','--side-active'];
const routes={dashboard:'ホーム',calendar:'日程',estimates:'見積履歴',chohyo:'帳票',savedDocs:'保存帳票',sales:'売上・入金',expenses:'支出・現金',bank:'銀行照合',settings:'設定'};
const el=id=>document.getElementById(id);
function theme(name){
 if(!palettes[name])name='blue';
 keys.forEach((key,i)=>document.body.style.setProperty(key,palettes[name][i]));
 for(const b of document.querySelectorAll('[data-tabler-theme]'))b.setAttribute('aria-pressed',String(b.dataset.tablerTheme===name));
 try{localStorage.setItem('tsukinowa_ui_theme_v13',name);}catch(_){}
}
function newSchedule(date=todayISO()){
 const business=root.TsukinowaBusinessUI;
 if(!business.isEnabled()||business.getClient()?.getState().phase!=='ready'){root.bizOpenCloudAccount();return;}
 const dialog=document.createElement('dialog');dialog.className='tabler-schedule-dialog';
 dialog.setAttribute('aria-label','予定登録');
 dialog.innerHTML='<h2>予定登録</h2><p>システム内の日程を登録します。Googleへの追加送信や売上・入金の計上は行いません。</p><form><label>日付<input name="date" type="date" required></label><label>件名<input name="title" required maxlength="300"></label><label>備考<textarea name="memo" maxlength="3000"></textarea></label><p role="alert"></p><div class="biz-actions"><button type="button" class="biz-btn" data-cancel>取消</button><button type="submit" class="biz-btn primary">予定を登録</button></div></form>';
 dialog.querySelector('[name=date]').value=date;
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=event=>{
  event.preventDefault();const form=event.currentTarget;const values=Object.fromEntries(new FormData(form));
  try{
   root.TsukinowaAccounting.date(values.date);if(!values.title.trim())throw Error('件名を入力してください。');
   const id=crypto.randomUUID();const accepted=business.enqueue({type:'calendar',event:{id,uid:id,source:'manual',date:values.date,start:values.date,end:values.date,title:values.title.trim(),originalTitle:values.title.trim(),description:values.memo,googleStatus:'confirmed'}});
   if(accepted){el('calendarMonth').value=values.date.slice(0,7);dialog.close();}
  }catch(error){form.querySelector('[role=alert]').textContent=error.message;}
 };
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
function navigation(){
 const active=document.querySelector('#bizNav button.active');
 if(el('tablerCrumb'))el('tablerCrumb').textContent=routes[active?.dataset.page]||'ホーム';
 for(const b of document.querySelectorAll('#bizNav button')){
  if(b===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 }
}
function calendar(){
 const grid=el('tablerMonthGrid');if(!grid)return;
 const month=el('calendarMonth').value||bizNowMonth();
 el('tablerMonthCaption').textContent=month.replace('-','年 ')+'月';
 const review=el('calendarReview').checked,query=el('calendarKeyword').value.toLowerCase(),documents=bizCalendarDocumentStates();
 const events=bizState.calendar.filter(e=>!e.deletedAt&&Boolean(bizCalendarReviewReason(e,documents))===review&&(!query||((e.title||'')+' '+(e.description||'')).toLowerCase().includes(query)));
 grid.replaceChildren();
 for(const label of ['日','月','火','水','木','金','土']){const cell=document.createElement('div');cell.className='tabler-weekday';cell.textContent=label;grid.append(cell);}
 for(const day of root.TsukinowaTablerCalendar.cells(month)){
  const cell=document.createElement('div');cell.className='tabler-day'+(day.inMonth?'':' outside')+(day.date===todayISO()?' today':'');
  const date=document.createElement('time');date.dateTime=day.date;date.textContent=day.day;const add=document.createElement('button');add.type='button';add.className='tabler-date-button';add.setAttribute('aria-label',day.date+' に予定を登録');add.append(date);add.onclick=()=>newSchedule(day.date);cell.append(add);
  for(const event of events.filter(e=>e.date===day.date).sort((a,b)=>String(a.start||a.date).localeCompare(String(b.start||b.date)))){
   const button=document.createElement('button');button.type='button';button.className='tabler-event';button.textContent=(root.TsukinowaBusiness.calendarTime(event.start)||'')+' '+(event.title||'');
   button.title=day.date+' '+(event.title||'');button.setAttribute('aria-label',button.title);button.addEventListener('click',()=>root.openEventModal(event.id));cell.append(button);
  }
  grid.append(cell);
 }
}
document.addEventListener('DOMContentLoaded',()=>{
 const sidebar=document.createElement('aside');sidebar.className='tabler-sidebar';sidebar.setAttribute('aria-label','メインナビゲーション');
 const bar=document.querySelector('.biz-topbar');sidebar.append(document.querySelector('.biz-brand'),el('bizNav'));document.body.prepend(sidebar);
 const crumb=document.createElement('span');crumb.id='tablerCrumb';crumb.className='tabler-crumb';bar.prepend(crumb);
 const themes=document.createElement('div');themes.className='tabler-themes';themes.setAttribute('aria-label','表示テーマ');
 for(const [name,label] of [['blue','雾蓝'],['gold','曜石金'],['green','松绿'],['purple','烟紫'],['dark','深夜']]){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.tablerTheme=name;button.addEventListener('click',()=>theme(name));themes.append(button);
 }
 crumb.after(themes);new ResizeObserver(()=>document.body.style.setProperty('--tabler-header-height',bar.getBoundingClientRect().height+'px')).observe(bar);let selected='blue';try{selected=localStorage.getItem('tsukinowa_ui_theme_v13')||'blue';}catch(_){}theme(selected);
 const editor=el('pageChohyo'),preview=el('previewArea'),form=document.createElement('div');form.className='tabler-document-form';
 for(const child of [...editor.children])if(child!==preview)form.append(child);editor.prepend(form);
 const section=document.createElement('section');section.className='biz-section';section.setAttribute('aria-label','月間日程');
 const toolbar=document.createElement('div');toolbar.className='tabler-calendar-toolbar';
 const caption=document.createElement('span');caption.id='tablerMonthCaption';caption.className='tabler-month-caption';toolbar.append(caption);
 for(const [label,delta] of [['前月',-1],['今月',0],['翌月',1]]){
  const button=document.createElement('button');button.type='button';button.className='biz-btn';button.textContent=label;
  button.addEventListener('click',()=>{el('calendarMonth').value=delta?root.TsukinowaTablerCalendar.shift(el('calendarMonth').value||bizNowMonth(),delta):bizNowMonth();root.renderCalendarEvents();});toolbar.append(button);
 }
 const create=document.createElement('button');create.className='biz-btn primary';create.type='button';create.textContent='＋ 予定登録';create.onclick=()=>newSchedule();toolbar.append(create);
 const grid=document.createElement('div');grid.id='tablerMonthGrid';grid.className='tabler-month-grid';section.append(toolbar,grid);
 el('pageCalendar').children[1].after(section);
 const originalCalendar=root.renderCalendarEvents;root.renderCalendarEvents=function(...args){const result=originalCalendar.apply(this,args);calendar();return result;};
 const originalRoute=root.bizSwitchPage;root.bizSwitchPage=function(...args){const result=originalRoute.apply(this,args);navigation();return result;};
 new MutationObserver(navigation).observe(el('bizNav'),{subtree:true,attributes:true,attributeFilter:['class','hidden']});
 navigation();calendar();
});
})(window);
