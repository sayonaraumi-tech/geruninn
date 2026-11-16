(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaBackup=api;})(globalThis,function(){'use strict';
const fields=['sales','payments','expenses','bank','calendar','audit','estimates','projects'];
function parse(raw){
 if(typeof raw!=='string'||raw.length>20000000)throw Error('バックアップの容量または形式が不正です。');
 const source=JSON.parse(raw);
 if(!source||typeof source!=='object'||Array.isArray(source)||!source.state||typeof source.state!=='object'||Array.isArray(source.state))throw Error('バックアップ形式が不正です。');
 if(source.version!=null&&(!Number.isInteger(source.version)||source.version<1||source.version>2))throw Error('未対応のバックアップバージョンです。');
 if(!Array.isArray(source.state.sales))throw Error('売上データがありません。');
 const clean={};for(const name of fields){
  const arr=source.state[name]??[];
  if(!Array.isArray(arr))throw Error(name+' は配列である必要があります。');
  if(arr.length>100000)throw Error(name+' の件数が上限を超えています。');
  if(arr.some(row=>row===null||typeof row!=='object'||Array.isArray(row)))throw Error(name+' の行形式が不正です。');
  clean[name]=arr;
 }
 function noPollution(v,depth){
  if(depth>30)throw Error('データの入れ子構造が深すぎます。');
  if(v===null||typeof v!=='object')return;
  if(Array.isArray(v)){for(const x of v)noPollution(x,depth+1);return;}
  for(const [k,x] of Object.entries(v)){
   if(['__proto__','prototype','constructor'].includes(k))throw Error('危険なプロパティが含まれています。');
   noPollution(x,depth+1);
  }
 }
 noPollution(clean,0);
 return clean;
}
return {parse,fields};});