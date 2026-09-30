const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const ctx=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function onodaShortDate('),html.indexOf('let onodaGenerating=')),ctx);
const parse=(title,description='')=>ctx.parseOnodaEvent({id:'sep30',date:'2026-09-30',title,description});
test('production September 30 event with TimeTree HTML description parses 51.6 metres',()=>{
 const title='小野田，マキシヴ川崎サウスdue201，51.6米',description='<p>TimeTree转录：截图未显示具体时间</p>';
 const old=html.slice(html.indexOf('function onodaShortDate('),html.indexOf('let onodaGenerating=')).replace("ev.title+','+(ev.description||'').replace(/<[^>]*>/g,' ')","ev.title+' '+(ev.description||'')");
 const before=vm.createContext({});vm.runInContext(old,before);assert.equal(before.parseOnodaEvent({id:'sep30',date:'2026-09-30',title,description}).length,0);
 const rows=parse(title,description);assert.equal(rows.length,1);assert.equal(rows[0].content,'9/30マキシヴ川崎サウスdue201');assert.equal(rows[0].qty,51.6);assert.equal(rows[0].price,1000);
});
test('last quantity, room shorthand and existing Yokohama/toll parsing retained',()=>{
 assert.deepEqual(Array.from(parse('小野田、genovia浅草4 スカイガーデン1002、68.8米、mvimp常盤台403、37米','<p>TimeTree</p>'),x=>x.qty),[68.8,37]);
 const rows=parse('小野田、genovia世田谷桜丘 401、37.8米、204、45.7米','<p>TimeTree</p>');assert.equal(rows[1].content,'9/30genovia世田谷桜丘 204');
 assert.equal(parse('小野田、maxiv新川崎205、316、49米、52米').length,2);
 assert.equal(parse('小野田、横浜502、51. 6米','高速代3,780')[0].taxable,false);
});
