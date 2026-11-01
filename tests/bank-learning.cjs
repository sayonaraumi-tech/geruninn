const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../js/cloud-core'),B=require('../js/business-domain');
async function harness(){
 const rows=new Map();let cb,retries=0;
 const driver={initialize:async()=>{},observeAuth:f=>(cb=f,()=>{}),claims:async u=>u.claims,digest:async s=>crypto.createHash('sha256').update(s).digest('hex'),timestamp:()=>123,list:async p=>[...rows].filter(([k])=>k.startsWith(p+'/')).map(([k,v])=>({id:k.split('/').at(-1),...v})),transaction:async f=>{for(;;){const reads=new Map(),writes=[];const result=await f({get:async p=>{const r=rows.get(p)||null;reads.set(p,r);return r;},set:(p,v)=>writes.push([p,v])});if([...reads].some(([p,v])=>(rows.get(p)||null)!==v)){retries++;continue;}for(const [p,v]of writes)rows.set(p,v);return result;}}};
 const client=C.createClient(driver);await client.start({enabled:true,companyId:'tsukinowa',firebase:{apiKey:'x',authDomain:'x',projectId:'demo',appId:'x'}});await cb({uid:'admin',claims:{role:'admin',companyId:'tsukinowa'}});
 const service=B.createService(client),list=n=>[...rows].filter(([p])=>p.includes('/'+n+'/')).map(([p,r])=>({id:p.split('/').at(-1),...r}));
 const execute=cmd=>service.execute({...cmd,operationId:crypto.randomUUID()});return {client,rows,service,list,execute,retries:()=>retries};
}


const A=require('../js/accounting'),Y=require('../js/year-end');
const sale=(id='sale',over={})=>({id,salesDate:'2026-10-24',invoiceDate:'2026-10-24',amount:79500,customer:'株式会社テスト',...over});
const bank=(id='bank',over={})=>({bankTxnId:id,bankTransactionDate:'2026-10-25',description:'振込 株式会社テスト',incoming:79500,outgoing:0,amount:79500,bankAccount:'試験口座',...over});
const digest=async s=>crypto.createHash('sha256').update(s).digest('hex');
const expense={expenseDate:'2026-10-25',category:'消耗品費',paymentMethod:'銀行振込',amount:6060,vendor:'試験店',description:'備品確認'};
const data=h=>Object.fromEntries(['sales','payments','expenses','bankTransactions'].map(n=>[n,h.list(n).map(r=>({...r.payload,id:r.id}))]));
async function seed(h,s){await h.execute({type:'migrateRecord',collection:'sales',id:s.id,payload:s});}
test('Dynast September invoice is recommended on October 31 using linked due date without writes',()=>{
 const b=bank('dynast',{bankTransactionDate:'2026-10-31',description:'ダイナスト（ド',incoming:1594900,amount:1594900});
 const d={id:'dynast-doc',docType:'invoice',confirmed:true,status:'active',saleId:'dynast-sale',amount:1594900,snapshot:{invoiceNo:'20260930-001',invoiceDate:'2026-09-30',dueDate:'2026-10-30',customerName:'dynast合同会社'}};
 const s=sale('dynast-sale',{salesDate:'2026-09-30',invoiceDate:'2026-09-30',customer:'dynast合同会社',amount:1594900,documentId:d.id});
 const data={sales:[s],documents:[d],payments:[]},before=JSON.stringify(data),c=A.suggestions(b,data);assert.equal(c.length,1);assert.equal(c[0].id,s.id);assert.equal(c[0].invoiceNo,'20260930-001');assert(c[0].reasons.includes('日付・支払期限7日以内'));assert.equal(JSON.stringify(data),before);
 assert.equal(A.suggestions(b,{...data,sales:[{...s,paymentMethod:'現金',sourceType:'calendar-cash'}]}).length,0);
 assert.equal(A.suggestions(b,{documents:[d]})[0].blocked,true);
 assert.equal(A.suggestions(b,{...data,documents:[{...d,status:'void'}],sales:[{...s,status:'void'}]}).length,0);
 assert(A.nameMatch('ﾀﾞｲﾅｽﾄ(ﾄﾞ','ダイナスト合同会社'));assert(!A.nameMatch('A','A'));
});
test('confirmed receipt payment remains a candidate at zero outstanding and is reused',async()=>{
 const h=await harness();await seed(h,sale());await h.execute({type:'payment',paymentId:'receipt-payment',saleId:'sale',amount:79500,paymentDate:'2026-10-24',method:'銀行振込',manualConfirmed:true});
 const d=data(h),c=A.suggestions(bank(),d);assert.equal(c.length,1);assert.equal(c[0].paymentId,'receipt-payment');assert.equal(c[0].outstanding,0);
 await h.execute({type:'importBank',bank:bank()});const cmd={type:'bankMatch',bankTxnId:'bank',targetType:'sale',targetId:'sale',paymentId:c[0].paymentId,expectedRevision:1};await h.execute(cmd);await h.execute(cmd);assert.equal(h.list('payments').length,1);assert.equal(h.list('sales').length,1);assert.equal(h.list('documents').length,0);
});
test('rules normalize conservatively, CSV wins, conflicts and missing keys require review',()=>{
 const rules=[{type:'expenseCategoryRule',vendor:'ＡＢＣ 店',key:A.classificationKey('ＡＢＣ 店'),category:'通信費',enabled:true}];
 assert.equal(A.classifyExpense('abc   店','',rules).category,'通信費');
 for(const v of ['abc 店支店','abc店','ab',''])assert(A.classifyExpense(v,'',rules).review);
 assert.equal(A.classifyExpense('abc 店','材料費',rules).source,'CSV');assert(A.classifyExpense('abc 店','',rules.concat(rules)).review);
 for(const r of [{...rules[0],enabled:false},{...rules[0],deletedAt:'now'}])assert(A.classifyExpense('abc 店','',[r]).review);
 const p=A.expensePreview('日付,科目,支払方法,金額,取引先,内容・備考\n2026-10-01,,銀行振込,100,abc 店,電話\n2026-10-02,材料費,銀行振込,100,abc 店,優先\n2026-10-03,,銀行振込,100,別会社,要確認',[],rules);assert.equal(p.errors.length,0);assert.equal(p.records[0].expense.category,'通信費');assert.equal(p.records[1].expense.category,'材料費');assert(p.records[2].classification.review);
});
test('explicit learning with expense is atomic, rule edits disable delete never rewrite history',async()=>{
 const h=await harness(),e={...expense,vendor:'ＡＢＣ 店',category:'通信費'};await h.execute({type:'saveExpense',expenseId:'learn',expense:e,expectedRevision:0,learnCategory:true});
 let r=h.list('settings')[0];assert.equal(r.payload.key,'abc 店');assert.equal(r.revision,1);const historical=JSON.stringify(h.list('expenses'));
 await h.execute({type:'saveExpenseCategoryRule',vendor:'abc 店',category:'材料費',enabled:false,expectedRevision:1});r=h.list('settings')[0];assert.equal(r.revision,2);assert.equal(r.payload.enabled,false);
 await assert.rejects(h.execute({type:'saveExpenseCategoryRule',vendor:'abc 店',category:'その他',expectedRevision:1}));
 await h.execute({type:'saveExpenseCategoryRule',vendor:'abc 店',category:'材料費',deleted:true,expectedRevision:2});assert(h.list('settings')[0].payload.deletedAt);assert.equal(JSON.stringify(h.list('expenses')),historical);
 await assert.rejects(h.execute({type:'saveExpense',expenseId:'bad',expense:{...e,amount:0},learnCategory:true}));assert.equal(h.list('expenses').length,1);
});
