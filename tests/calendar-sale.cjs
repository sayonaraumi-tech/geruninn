// 日程から売上・入金を登録 (no 請求書/領収書), cloud commands: registerCalendarSale (existing) + calendarSaleChange (admin edit/cancel).
// 現金 = 売上 + 入金 + 現金出納 at once; 銀行振込 = 売上 only (入金 by 入金登録 or bank matching). Synthetic data only.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain'),A=require('../js/accounting');
async function harness(){
 const rows=new Map(),cbs=[];
 const digest=async s=>crypto.createHash('sha256').update(s).digest('hex'),driver={initialize:async()=>{},observeAuth:f=>(cbs.push(f),()=>{}),claims:async u=>u.claims,digest,timestamp:()=>123,
 list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{const writes=[];const result=await f({get:async p=>rows.get(p)||null,set:(p,v)=>writes.push([p,v])});for(const [p,v]of writes)rows.set(p,v);return result;}};
 const make=async role=>{const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cbs.at(-1)({uid:role,claims:{role,companyId:'tsukinowa'}});const service=B.createService(client);return cmd=>service.execute({operationId:crypto.randomUUID(),...cmd});};
 const exec=await make('admin'),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r.payload}));
 return {exec,make,list};
}
const live=rs=>rs.filter(r=>!r.deletedAt);
const month=(h,m='2026-12')=>{const rs=A.salesRegister({sales:h.list('sales'),payments:h.list('payments')},A.periodFilter({month:m}),'2026-12-31');return {count:rs.length,sales:rs.reduce((n,s)=>n+s.amount,0),paid:rs.reduce((n,s)=>n+s.paid,0),outstanding:rs.reduce((n,s)=>n+s.outstanding,0)};};
async function event(h){return (await h.exec({type:'calendarLocal',event:{date:'2026-12-03',title:'試験 現地作業'}})).id;}
const sale=(o={})=>({salesDate:'2026-12-03',customer:'試験客',content:'穴補修',amount:'11000',paymentMethod:'現金',...o});

test('現金: 売上 + 入金 + 現金出納 at once, idempotent; admin edit keeps one record; cancel voids all',async()=>{
 const h=await harness(),id=await event(h);
 const r=await h.exec({type:'registerCalendarSale',id,sale:sale()});for(let i=0;i<2;i++)assert.equal((await h.exec({type:'registerCalendarSale',id,sale:sale()})).saleId,r.saleId);
 assert.deepEqual(month(h),{count:1,sales:11000,paid:11000,outstanding:0});assert.equal(live(h.list('payments')).length,1);assert.equal(live(h.list('cashLedger')).length,1);assert.equal(h.list('documents').length,0);
 assert.equal(h.list('calendarLinks')[0].saleId,r.saleId);
 // staff cannot edit or cancel
 const staff=await h.make('staff');await assert.rejects(staff({type:'calendarSaleChange',id,action:'cancel',reason:'x'}),/管理者/);
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'edit',sale:sale({amount:'13200'})}),/理由/);
 await h.exec({type:'calendarSaleChange',id,action:'edit',reason:'金額訂正',sale:sale({amount:'13200',customer:'試験客B'})});
 assert.deepEqual(month(h),{count:1,sales:13200,paid:13200,outstanding:0});assert.equal(live(h.list('payments')).length,1);assert.equal(live(h.list('cashLedger')).length,1);assert.equal(live(h.list('cashLedger'))[0].amount,13200);assert.equal(live(h.list('sales'))[0].customer,'試験客B');
 assert((await h.exec({type:'calendarSaleChange',id,action:'edit',reason:'再送',sale:sale({amount:'13200',customer:'試験客B'})})).unchanged);
 await h.exec({type:'calendarSaleChange',id,action:'cancel',reason:'二重登録'});
 assert.deepEqual(month(h),{count:0,sales:0,paid:0,outstanding:0});assert.equal(live(h.list('payments')).length,0);assert.equal(live(h.list('cashLedger')).length,0);assert.equal(h.list('sales').length,1,'kept as a voided record');
 assert.equal(h.list('calendarLinks')[0].saleId,'');assert.equal(h.list('calendarLinks')[0].cancelledSaleId,r.saleId);
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'cancel',reason:'again'}),/見つかりません/);
});
test('銀行振込: 売上 only; 入金 later; method change 現金⇄銀行振込 by admin; attached 入金 blocks edit',async()=>{
 const h=await harness(),id=await event(h);
 const r=await h.exec({type:'registerCalendarSale',id,sale:sale({paymentMethod:'銀行振込'})});
 assert.deepEqual(month(h),{count:1,sales:11000,paid:0,outstanding:11000});assert.equal(h.list('payments').length,0);
 await h.exec({type:'calendarSaleChange',id,action:'edit',reason:'現金で受領',sale:sale()});
 assert.deepEqual(month(h),{count:1,sales:11000,paid:11000,outstanding:0});assert.equal(live(h.list('cashLedger')).length,1);
 await h.exec({type:'calendarSaleChange',id,action:'edit',reason:'振込に訂正',sale:sale({paymentMethod:'銀行振込'})});
 assert.deepEqual(month(h),{count:1,sales:11000,paid:0,outstanding:11000});assert.equal(live(h.list('payments')).length,0);assert.equal(live(h.list('cashLedger')).length,0);
 await h.exec({type:'payment',paymentId:'manual',saleId:r.saleId,amount:11000,paymentDate:'2026-12-10',method:'銀行振込',manualConfirmed:true});
 assert.deepEqual(month(h),{count:1,sales:11000,paid:11000,outstanding:0});
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'cancel',reason:'x'}),/入金/);
});
test('invalid input and formal-document sales are refused',async()=>{
 const h=await harness(),id=await event(h);
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'cancel',reason:'x'}),/見つかりません/);
 await h.exec({type:'registerCalendarSale',id,sale:sale()});
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'edit',reason:'x',sale:sale({amount:'0'})}));
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'edit',reason:'x',sale:sale({paymentMethod:'小切手'})}),/入金経路/);
 await assert.rejects(h.exec({type:'calendarSaleChange',id,action:'remove',reason:'x'}),/操作/);
 assert.deepEqual(month(h),{count:1,sales:11000,paid:11000,outstanding:0});
});
