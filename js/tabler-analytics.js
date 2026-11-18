/* Read-only comparisons use the same effective data and aggregation as HOME/CSV. */
(function(root){
'use strict';
const A=root.TsukinowaAccounting,el=id=>document.getElementById(id);
function render(){
 const host=el('tablerAnalytics');if(!host)return;
 const ui=root.TsukinowaAccountingUI,client=root.TsukinowaBusinessUI.getClient();
 if(!root.TsukinowaBusinessUI.isEnabled()||client?.getState().role!=='admin'){host.hidden=true;host.replaceChildren();return;}
 host.hidden=false;
 let period;try{period=ui.homePeriod();}catch(_){return;}
 const data=ui.homeData(),year=Number(period.start.slice(0,4))-(Number(period.start.slice(5,7))<10?1:0);
 if(year<2001||year>9998){host.textContent='年度比較は2001〜9998年度でご利用ください。';return;}
 const current=root.TsukinowaYearEnd.annual(data,year),prior=root.TsukinowaYearEnd.annual(data,year-1);
 host.replaceChildren();
 const chart=document.createElement('div');chart.className='biz-section';const heading=document.createElement('h2');heading.textContent=`年度売上比較（${year}年10月〜${year+1}年9月）`;chart.append(heading);
 const note=document.createElement('p');note.className='biz-muted';note.textContent='当年度 / 前年度。売上日で集計し、入金額とは区別します。';chart.append(note);
 const max=Math.max(1,...current.months.map(m=>Math.abs(m.sales)),...prior.months.map(m=>Math.abs(m.sales)));
 for(let i=0;i<12;i++){
  const row=document.createElement('div');row.className='tabler-comparison-row';
  const label=document.createElement('span');label.textContent=current.months[i].month.slice(5)+'月';row.append(label);
  const tracks=document.createElement('div');
  for(const [which,m] of [['当年度',current.months[i]],['前年度',prior.months[i]]]){
   const track=document.createElement('div');track.className='tabler-comparison-track';
   const bar=document.createElement('i');bar.style.width=(Math.abs(m.sales)/max*100)+'%';bar.className=which==='当年度'?'current':'prior';
   track.title=`${which} ${m.month}: ${bizMoney(m.sales)}円`;track.setAttribute('aria-label',track.title);track.append(bar);tracks.append(track);
  }
  row.append(tracks);const amount=document.createElement('span');amount.className='biz-money';amount.textContent=`${bizMoney(current.months[i].sales)} / ${bizMoney(prior.months[i].sales)}`;row.append(amount);chart.append(row);
 }
 const summary=document.createElement('div');summary.className='biz-section';const title=document.createElement('h2');title.textContent='選択期間の収支';summary.append(title);
 const selected=A.aggregate(data,period);const table=document.createElement('table');table.className='biz-table';
 for(const [label,key] of [['確認済み入金','income'],['支出','expenseTotal'],['収支差額','cashFlowDifference']]){
  const row=table.insertRow();row.insertCell().textContent=label;const value=row.insertCell();value.className='biz-money';value.textContent=bizMoney(selected[key])+' 円';
 }
 summary.append(table);const help=document.createElement('p');help.className='biz-muted';help.textContent='収支差額＝確認済み入金−支出。未収金は含みません。';summary.append(help);host.append(chart,summary);
}
document.addEventListener('DOMContentLoaded',()=>{
 const host=document.createElement('section');host.id='tablerAnalytics';host.className='tabler-analytics';host.setAttribute('aria-label','年度比較と収支');
 document.querySelector('#pageDashboard .home-secondary').after(host);
 const previous=root.renderDashboard;root.renderDashboard=function(...args){const result=previous.apply(this,args);render();return result;};render();
});
})(window);
