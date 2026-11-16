(function(){
'use strict';
const themes=[['blue','藍白'],['obsidian','黒金'],['jade','翡翠緑'],['violet','紫灰'],['night','深色']];
const key='tsukinowa_tabler_theme_v1';
function valid(v){return themes.some(x=>x[0]===v)?v:'blue';}
function setTheme(value){const theme=valid(value);document.documentElement.dataset.tablerTheme=theme;
 try{localStorage.setItem(key,theme);}catch(_){}
 const picker=document.getElementById('tablerThemePicker');
 if(picker)for(const b of picker.querySelectorAll('button[data-theme]'))b.setAttribute('aria-pressed',String(b.dataset.theme===theme));
}
function init(){let stored='blue';try{stored=valid(localStorage.getItem(key));}catch(_){}
 const picker=document.createElement('div');picker.id='tablerThemePicker';picker.setAttribute('role','group');picker.setAttribute('aria-label','画面テーマ');
 for(const [value,label] of themes){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.theme=value;b.addEventListener('click',()=>setTheme(value));picker.append(b);}
 document.body.append(picker);setTheme(stored);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();