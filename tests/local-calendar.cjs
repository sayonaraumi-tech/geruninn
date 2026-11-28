// 本地日程: system-only events live in calendarLinks, never touch sales/payments, and Google events stay read-only.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(role='admin'){
 const rows=new Map();let cb;const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,
  list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{const w=[];const r=await f({get:async p=>rows.get(p)||null,set:(p,v)=>w.push([p,v])});for(const [p,v] of w)rows.set(p,v);return r;}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:role,claims:{role,companyId:'tsukinowa'}});
 const service=B.createService(client),exec=cmd=>service.execute({operationId:crypto.randomUUID(),...cmd}),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r.payload}));
 return {exec,list,rows};
}
const event={id:'cal_local_a',date:'2026-12-03',start:'2026-12-03T10:00:00+09:00',end:'2026-12-03T11:00:00+09:00',title:'佐藤様 現地調査 現金 50000',location:'浅草',description:'メモ'};
for(const role of ['admin','staff'])test(role+': create, edit and delete a 本地 event without any accounting record',async()=>{
 const {exec,list}=await harness(role);
 const created=await exec({type:'calendarLocal',action:'save',event});assert.equal(created.id,'cal_local_a');
 let [row]=list('calendarLinks');assert.equal(row.source,'local');assert.equal(row.title,event.title);assert.equal(row.googleEventId,'');assert.equal(row.pushToGoogle,false);assert.equal(row.googleCreatePending,undefined);
 await exec({type:'calendarLocal',action:'save',event:{...event,title:'佐藤様 現地調査（変更）',date:'2026-12-04',start:'2026-12-04'}});
 [row]=list('calendarLinks');assert.equal(row.title,'佐藤様 現地調査（変更）');assert.equal(row.date,'2026-12-04');assert.equal(list('calendarLinks').length,1);
 await exec({type:'calendarLocal',action:'delete',event:{id:'cal_local_a'}});
 [row]=list('calendarLinks');assert.ok(row.deletedAt);assert.equal(row.title,'佐藤様 現地調査（変更）','soft delete keeps the record');
 await assert.rejects(exec({type:'calendarLocal',action:'save',event}),/削除済み/);
 assert.deepEqual([list('sales').length,list('payments').length,list('receivables').length],[0,0,0],'a title with 現金 and an amount never creates money records');
});
test('Google and ICS events cannot be edited or deleted as 本地; a copy is a new record and the original is unchanged',async()=>{
 const {exec,list}=await harness();
 const g=await exec({type:'calendar',event:{googleEventId:'gev1',googleCalendarId:'shared',date:'2026-12-05',start:'2026-12-05',end:'2026-12-06',title:'Google予定'}});
 const before=JSON.stringify(list('calendarLinks'));
 await assert.rejects(exec({type:'calendarLocal',action:'save',event:{...event,id:g.id}}),/編集できません/);
 await assert.rejects(exec({type:'calendarLocal',action:'delete',event:{id:g.id}}),/編集できません/);
 assert.equal(JSON.stringify(list('calendarLinks')),before);
 await exec({type:'calendarLocal',action:'save',event:{id:'cal_local_copy',date:'2026-12-05',start:'2026-12-05',end:'2026-12-06',title:'Google予定',copyOf:g.id}});
 assert.equal(JSON.stringify(list('calendarLinks').filter(r=>r.id===g.id)),JSON.stringify(JSON.parse(before)));
 assert.equal(list('calendarLinks').find(r=>r.id==='cal_local_copy').copyOf,g.id);
});
test('push toggle marks a Google create; a later Google sync keeps the event 本地',async()=>{
 const {exec,list}=await harness();
 await exec({type:'calendarLocal',action:'save',event:{...event,pushToGoogle:true},googleEventId:'tlabc123def456'});
 let row=list('calendarLinks')[0];assert.equal(row.googleEventId,'tlabc123def456');assert.equal(row.googleCreatePending,true);
 await exec({type:'calendarLocal',action:'save',event:{...event,pushToGoogle:true},googleEventId:'INVALID ID'});
 row=list('calendarLinks')[0];assert.equal(row.googleEventId,'tlabc123def456','an assigned Google ID never changes');
 await exec({type:'calendarCreated',id:'cal_local_a',googleEventId:'tlabc123def456',calendarId:''});
 await exec({type:'calendar',event:{googleEventId:'tlabc123def456',googleCalendarId:'shared',date:'2026-12-03',start:event.start,end:event.end,title:'Google側で変更'}});
 row=list('calendarLinks')[0];assert.equal(list('calendarLinks').length,1);assert.equal(row.source,'local');assert.equal(row.title,'Google側で変更');
 const fresh=await harness();await fresh.exec({type:'calendarLocal',action:'save',event:{...event,pushToGoogle:true},googleEventId:'bad id!'});assert.equal(fresh.list('calendarLinks')[0].googleCreatePending,undefined);
});
test('invalid input is rejected before any write',async()=>{
 const {exec,list}=await harness();
 await assert.rejects(exec({type:'calendarLocal',action:'save',event:{...event,title:'  '}}),/タイトル/);
 await assert.rejects(exec({type:'calendarLocal',action:'save',event:{...event,date:'2026-13-40'}}));
 await assert.rejects(exec({type:'calendarLocal',action:'delete',event:{id:'missing'}}),/見つかりません/);
 assert.equal(list('calendarLinks').length,0);
});
