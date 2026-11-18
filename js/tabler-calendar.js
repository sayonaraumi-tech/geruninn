(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaTablerCalendar=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function cells(month){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を確認してください。');
    const [year,m]=month.split('-').map(Number),first=new Date(year,m-1,1),start=new Date(year,m-1,1-first.getDay());
    return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');return {date,day:d.getDate(),inMonth:date.startsWith(month),weekday:d.getDay()};});
  }
  function shift(month,delta){const [y,m]=month.split('-').map(Number),d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  return {cells,shift};
});
