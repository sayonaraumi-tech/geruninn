const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(){
 const rows=new Map();let cb,retries=0;
 const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const r=rows.get(p)||null;reads.set(p,r);return r;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(rows.get(p)||null)!==v)){retries++;continue;}for(const [p,v]of writes)rows.set(p,v);return result;}}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 const execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});return {client,rows,service,list,execute,retries:()=>retries};
}
const snapshot={documentId:'estimate',docType:'estimate',invoiceDate:'2026-10-03',customerName:'琢居株式会社',items:[{content:'クロス張替',qty:1,price:10000},{content:'穴補修',qty:1,price:2000},{content:'クロス張替',qty:1,price:1000}]};
async function saved(){const h=await harness();await h.execute({type:'saveDocument',snapshot,expectedRevision:0});return h;}
test('classification, all requested categories, deduplication, filename and old snapshots',()=>{
 assert.equal(B.projectCategory(snapshot),'クロス張替・穴補修');assert.equal(B.projectCategory({snapshot}),'クロス張替・穴補修');assert.equal(B.projectCategory({content:'クロス張替 / 穴補修'}),'クロス張替・穴補修');
 assert.equal(B.estimateFilename(snapshot),'2026-10-03_琢居株式会社_クロス張替・穴補修_見積書.pdf');assert(!/[\\/:*?"<>|\x00-\x1f]/.test(B.estimateFilename({...snapshot,customerName:'a/b:*?"<>|\x01'})));
 for(const [name]of B.CATEGORY_RULES)assert.equal(B.projectCategory({items:[{content:name}]}),name);assert.equal(B.projectCategory({content:'清掃'}),'その他');
});
test('independent acceptance creates one immediate schedule with metadata; concurrent clients and repeat clicks do not duplicate',async()=>{
 const h=await saved(),cmd={type:'acceptEstimate',estimateId:'est_estimate',workDate:'2026-10-10',expectedRevision:1};
 await Promise.all([h.execute(cmd),B.createService(h.client).execute({...cmd,operationId:crypto.randomUUID()})]);assert(h.retries()>0);
 for(let i=0;i<3;i++)await h.execute(cmd);assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('projects').length,1);
 const e=h.list('calendarLinks')[0].payload;assert.equal(e.title,'琢居株式会社｜クロス張替・穴補修｜¥14,300｜施工予定');assert.equal(e.date,'2026-10-10');assert.equal(e.end,'2026-10-11');assert.equal(e.documentId,'estimate');assert.equal(e.estimateId,'est_estimate');assert(e.projectId);assert(e.googleCreatePending);assert.match(e.googleEventId,/^[0-9a-v]{5,1024}$/);
 for(const n of ['sales','payments','receivables'])assert.equal(h.list(n).length,0);
 // Import from another client before create-completion still addresses the same row.
 await h.execute({type:'calendar',event:{googleEventId:e.googleEventId,googleCalendarId:'shared',date:'2026-10-10',start:'2026-10-10',end:'2026-10-11',title:e.title}});assert.equal(h.list('calendarLinks').length,1);
});
test('undated acceptance, old estimate derivation, later date and existing event reuse',async()=>{
 const h=await saved();let est=h.list('estimates')[0];delete est.payload.projectCategory;delete est.payload.snapshot;est.payload.content='古い摘要';
 await h.execute({type:'acceptEstimate',estimateId:est.id,workDate:''});assert.equal(h.list('estimates')[0].payload.status,'受注・日程未定');assert.equal(h.list('calendarLinks').length,0);
 await h.execute({type:'acceptEstimate',estimateId:est.id,workDate:'2026-10-20'});const e=h.list('calendarLinks')[0];assert.match(e.payload.title,/クロス張替・穴補修/);
 await Promise.all([h.execute({type:'calendarPrepareCreate',id:e.id,calendarId:'shared'}),h.execute({type:'calendarPrepareCreate',id:e.id,calendarId:'other'})]);const target=h.list('calendarLinks')[0].payload.googleCalendarId;assert(['shared','other'].includes(target));
 await h.execute({type:'calendarCreated',id:e.id,googleEventId:e.payload.googleEventId,calendarId:target});
 await h.execute({type:'acceptEstimate',estimateId:est.id,workDate:'2026-10-22'});assert.equal(h.list('calendarLinks').length,1);assert.equal(h.list('calendarLinks')[0].payload.googleCreatePending,false);
 const revision=h.list('calendarLinks')[0].revision;await h.execute({type:'calendarPatched',id:e.id,expectedRevision:revision,at:'now'});
 await h.execute({type:'calendar',event:{googleEventId:e.payload.googleEventId,googleCalendarId:target,date:'2026-10-24',start:'2026-10-24',end:'2026-10-25',title:'remote'}});assert.equal(h.list('projects')[0].payload.workDate,'2026-10-24');assert.equal(h.list('estimates')[0].payload.workDate,'2026-10-24');
});
test('preexisting Google calendar event updates original row without creating Google event',async()=>{
 const h=await harness();h.rows.set('companies/tsukinowa/calendarLinks/existing',{revision:1,payload:{id:'existing',source:'google',googleEventId:'existinggoogle',googleCalendarId:'shared',calendarId:'shared',date:'2026-10-01'}});
 await h.execute({type:'saveDocument',snapshot:{...snapshot,calendarEventId:'existing'},expectedRevision:0});await h.execute({type:'acceptEstimate',estimateId:'est_estimate',workDate:'2026-10-30'});
 const e=h.list('calendarLinks')[0];assert.equal(h.list('calendarLinks').length,1);assert.equal(e.id,'existing');assert.equal(e.payload.googleEventId,'existinggoogle');assert.equal(e.payload.googleCreatePending,false);assert.equal(e.payload.googlePatchPending,true);assert.equal(e.payload.date,'2026-10-30');
});

test('schedule location and notes synchronize both ways without mutating formal estimate, stale imports or acknowledging a newer edit',async()=>{
 const h=await saved();await h.execute({type:'acceptEstimate',estimateId:'est_estimate',workDate:'2026/10/10'});let e=h.list('calendarLinks')[0];assert.equal(e.payload.workDate,'2026-10-10');
 await h.execute({type:'calendarPrepareCreate',id:e.id,calendarId:'shared'});await h.execute({type:'calendarCreated',id:e.id,googleEventId:e.payload.googleEventId,calendarId:'shared'});
 await h.execute({type:'calendarPatched',id:e.id,expectedRevision:h.list('calendarLinks')[0].revision,at:'now'});
 const formal=JSON.stringify(h.list('documents')[0].payload.snapshot);
 await h.execute({type:'updateSchedule',id:e.id,expectedRevision:h.list('calendarLinks')[0].revision,workDate:'2026-10-12',location:'東京',systemNote:'鍵は受付'});e=h.list('calendarLinks')[0];const sent={...e.payload};
 await h.execute({type:'updateSchedule',id:e.id,expectedRevision:e.revision,workDate:'2026-10-13',location:'横浜',systemNote:'新しい備考'});
 await h.execute({type:'calendarPatched',id:e.id,snapshot:sent,at:'old'});assert(h.list('calendarLinks')[0].payload.googlePatchPending);
 await h.execute({type:'calendar',event:{googleEventId:e.payload.googleEventId,googleCalendarId:'shared',date:'2026-10-01',location:'古い住所',description:'古い備考'}});assert.equal(h.list('projects')[0].payload.location,'横浜');
 await h.execute({type:'calendarPatched',id:e.id,snapshot:h.list('calendarLinks')[0].payload,at:'now'});
 const event={googleEventId:e.payload.googleEventId,googleCalendarId:'shared',date:'2026-11-02',start:'2026-11-02T09:00:00+09:00',end:'2026-11-02T10:00:00+09:00',location:'大阪',description:'入口で連絡\n--- 月輪システム ---\n状態: 施工予定\n--- 月輪システム終了 ---',updated:'2026-10-05T10:00:00Z'};
 await h.execute({type:'calendar',event});assert.equal(h.list('projects')[0].payload.location,'大阪');assert.equal(h.list('projects')[0].payload.systemNote,'入口で連絡');assert.equal(h.list('estimates')[0].payload.workDate,'2026-11-02');assert.equal(h.list('calendarLinks')[0].payload.googlePatchPending,false);
 const revision=h.list('projects')[0].revision;await h.execute({type:'calendar',event});assert.equal(h.list('projects')[0].revision,revision);await h.execute({type:'calendar',event:{...event,date:'2026-10-01',updated:'2026-10-04T10:00:00Z'}});assert.equal(h.list('projects')[0].payload.workDate,'2026-11-02');assert.equal(JSON.stringify(h.list('documents')[0].payload.snapshot),formal);
});
test('same Google event ID in another calendar cannot hijack a linked schedule',async()=>{
 const h=await saved();await h.execute({type:'acceptEstimate',estimateId:'est_estimate',workDate:'2026-10-10'});const e=h.list('calendarLinks')[0];await h.execute({type:'calendarPrepareCreate',id:e.id,calendarId:'shared'});
 await h.execute({type:'calendar',event:{googleEventId:e.payload.googleEventId,googleCalendarId:'other',date:'2026-10-15'}});assert.equal(h.list('calendarLinks').length,2);assert.equal(h.list('projects')[0].payload.workDate,'2026-10-10');
});
