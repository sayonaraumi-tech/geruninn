const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(){
 const rows=new Map();let cb,retries=0;
 const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const r=rows.get(p)||null;reads.set(p,r);return r;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(rows.get(p)||null)!==v)){retries++;continue;}for(const [p,v]of writes)rows.set(p,v);return result;}}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 const execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});return {client,rows,service,list,execute,retries:()=>retries};
}

const A=require('../js/accounting');

const customer='（株）益田工房東京',amount=79500,date='2026-10-23';
const data=h=>Object.fromEntries(['sales','receivables','payments','cashLedger','bankTransactions','documents'].map(n=>[n,h.list(n).map(r=>({...r.payload,id:r.id}))]));
const invoice=(id,over={})=>({documentId:id,docType:'invoice',customerName:customer,invoiceDate:date,items:[{content:'クロス張替',qty:1,price:amount/1.1}],...over});
const receipt=(id,over={})=>({documentId:id,docType:'receipt',customerName:customer,invoiceDate:date,paymentDate:date,paymentMethod:'銀行振込',receiptTotal:amount,tadashi:'クロス張替',...over});
const save=(h,snapshot)=>h.execute({type:'saveDocument',expectedRevision:0,snapshot});
const bank=(id,day=date)=>({bankTxnId:id,bankTransactionDate:day,bankAccount:'隔離試験',description:customer,incoming:amount,outgoing:0,amount});
for(const method of ['現金','銀行振込'])test('Masuda 79500 schedule -> receipt -> replay -> invoice has one sale/payment: '+method,async()=>{
 const h=await harness(),e=await h.execute({type:'calendar',event:{id:'masuda',date,title:customer+'｜クロス張替｜79500'}});
 const s=await h.execute({type:'registerCalendarSale',id:e.id,sale:{salesDate:date,customer,content:'クロス張替',amount,paymentMethod:method}});
 if(method!=='現金')await h.execute({type:'payment',paymentId:'paid',manualConfirmed:true,saleId:s.saleId,amount,paymentDate:date,method});
 const cmd={type:'saveDocument',expectedRevision:0,operationId:'receipt-save',snapshot:receipt('r',{paymentMethod:method,calendarEventId:e.id})};
 const r=await h.service.execute(cmd);assert.deepEqual(await h.service.execute(cmd),r);
 await h.execute({type:'saveDocument',expectedRevision:r.revision,snapshot:r.snapshot});
 await h.execute({type:'registerCalendarSale',id:e.id,sale:{}});
 await save(h,invoice('i',{calendarEventId:e.id,invoiceDate:'2026-11-01'}));
 assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);assert.equal(h.list('cashLedger').length,method==='現金'?1:0);
 const d=data(h),m=A.monthly(d,'2026-10');assert.equal(m.sales,amount);assert.equal(m.income,amount);assert.equal(m.receivables,0);assert.equal(A.monthly(d,'2026-11').sales,0);
 const rows=A.ledgerRows(d,A.periodFilter({month:'2026-10'}));assert.deepEqual(rows.map(r=>r.type).sort(),['売上']);assert.equal(rows.reduce((n,r)=>n+r.incoming,0),amount);
});
test('confirmed September receipt keeps period/identity through October bank evidence and unmatch/rematch',async()=>{
 const h=await harness(),i=await save(h,invoice('i',{invoiceDate:'2026-09-01'}));
 const r=await save(h,receipt('r',{saleId:i.saleId,invoiceDate:'2026-09-30',paymentDate:'2026-09-30'}));
 await h.execute({type:'importBank',bank:bank('b','2026-10-01')});
 for(let n=0;n<2;n++){
  await h.execute({type:'bankMatch',bankTxnId:'b',targetType:'sale',targetId:i.saleId,paymentId:r.paymentId,expectedRevision:n?3:1});
  assert.equal(h.list('payments').length,1);assert.equal(h.list('documents').length,2);
  const p=h.list('payments')[0].payload;assert.equal(p.paymentDate,'2026-09-30');assert.equal(p.bankTransactionDate,'2026-10-01');assert.equal(p.documentId,'r');assert.equal(p.memo,'領収書から登録');
  assert.equal(A.monthly(data(h),'2026-09').income,amount);assert.equal(A.monthly(data(h),'2026-10').income,0);
  if(!n)await h.execute({type:'bankUnmatch',bankTxnId:'b',expectedRevision:2,reason:'試験'});
 }
 const before=JSON.stringify([...h.rows]);await h.execute({type:'bankMatch',bankTxnId:'b',targetType:'sale',targetId:i.saleId,paymentId:r.paymentId,expectedRevision:4});assert.equal(JSON.stringify([...h.rows]),before);
});
test('September invoice and October bank receipt stay in respective months; bank creates no receipt',async()=>{
 const h=await harness(),i=await save(h,invoice('i',{invoiceDate:'2026-09-30'}));
 await h.execute({type:'importBank',bank:bank('b')});await h.execute({type:'bankMatch',bankTxnId:'b',targetType:'sale',targetId:i.saleId,expectedRevision:1});
 assert.equal(h.list('documents').length,1);assert.equal(h.list('sales').length,1);assert.equal(h.list('payments').length,1);
 assert.equal(A.monthly(data(h),'2026-09').sales,amount);assert.equal(A.monthly(data(h),'2026-09').income,0);assert.equal(A.monthly(data(h),'2026-09').receivables,amount);
 assert.equal(A.monthly(data(h),'2026-10').sales,0);assert.equal(A.monthly(data(h),'2026-10').income,amount);
});
for(const method of ['現金','銀行振込'])test('concurrent distinct payment IDs cannot overpay: '+method,async()=>{
 const h=await harness(),i=await save(h,invoice('i'));const pay=id=>h.execute({type:'payment',paymentId:id,manualConfirmed:true,saleId:i.saleId,amount,paymentDate:date,method});
 const rs=await Promise.allSettled(['a','b'].map(pay));assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.list('payments').length,1);assert(h.retries()>0);
 await assert.rejects(pay('c'),/未収/);assert.equal(A.monthly(data(h),'2026-10').income,amount);
 await assert.rejects(h.execute({type:'confirmBank',bankId:'legacy',saleId:i.saleId,amount,paymentDate:date}),/未収|確認済み/);
});
test('historical import default is receivable only; bank receipt and formal receipt reuse anchor without sales',async()=>{
 const h=await harness(),cmd={type:'historicalPdfImport',documentId:'history',sourceHash:'a'.repeat(64),sourceFileName:'isolated.pdf',linkedSaleId:'',createSale:false,draft:{customerName:customer,invoiceNo:'old',issueDate:'2026-09-30',dueDate:date,invoiceAmount:amount,billingMonth:'2026-09',remarks:'クロス張替',items:[]},operationId:'import'};
 const r=await h.service.execute(cmd);await h.service.execute(cmd);await h.execute({type:'importBank',bank:bank('b')});await h.execute({type:'bankMatch',bankTxnId:'b',targetType:'sale',targetId:r.receivableId,expectedRevision:1});
 await save(h,receipt('r',{saleId:r.receivableId}));assert.equal(h.list('sales').length,0);assert.equal(h.list('receivables').length,1);assert.equal(h.list('payments').length,1);
 const d=data(h);d.sales=d.receivables;assert.equal(A.monthly(d,'2026-10').sales,0);assert.equal(A.monthly(d,'2026-10').income,amount);
});
