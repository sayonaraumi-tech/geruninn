const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSync}=require('../js/business-sync');
function harness(){
 const values=new Map(),attempts=[],committed=new Set();let allowed=false,online=false;
 const client={getState:()=>({role:'admin',projectId:'demo',companyId:'test',user:{uid:'test'}}),listRecords:async()=>[],transact:async(id,cmd)=>{attempts.push(id);if(!allowed)throw Object.assign(Error('rules denied'),{code:'permission-denied'});committed.add(id);return {id};}};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const sync=createSync({client,storage,online:()=>online});
 for(let i=0;i<14;i++)sync.enqueue({type:'test',operationId:'op'+i});
 return {sync,values,attempts,committed,allow:()=>allowed=true,connect:()=>online=true,disconnect:()=>online=false};
}
test('explicit retry preserves all 14 operations and resumes in order after permission repair',async()=>{
 const h=harness();h.connect();await h.sync.flush();assert(h.sync.getQueue()[0].blocked);assert.equal(h.sync.getQueue().length,14);
 const original=h.sync.getQueue()[0];await h.sync.flush();assert.deepEqual(h.attempts,['op0']);h.allow();await h.sync.flush();assert.deepEqual(h.attempts,['op0']);
 await h.sync.retryBlocked();assert.equal(h.sync.getQueue().length,0);assert.deepEqual(h.attempts,['op0',...Array.from({length:14},(_,i)=>'op'+i)]);assert.equal(h.committed.size,14);
 assert.equal(original.command.operationId,'op0');assert(original.createdAt);
 await h.sync.retryBlocked();assert.equal(h.attempts.length,15);
});
test('failed explicit retry retains command identity and timestamp; archive retains the original entry',async()=>{
 const h=harness();h.connect();await h.sync.flush();const before=h.sync.getQueue();await h.sync.retryBlocked();assert.deepEqual(h.sync.getQueue(),before);
 const key=h.sync.archiveBlocked();assert.deepEqual(JSON.parse(h.values.get(key)),before[0]);assert.deepEqual(h.sync.getQueue(),before.slice(1));
});

test('offline explicit retry durably clears only head flags, preserving all identities and timestamps',async()=>{
 const h=harness();h.connect();await h.sync.flush();const before=h.sync.getQueue();h.disconnect();await h.sync.retryBlocked();const after=h.sync.getQueue();
 assert.deepEqual(after[0].command,before[0].command);assert.equal(after[0].createdAt,before[0].createdAt);assert.equal(after[0].blocked,false);assert.equal(after[0].error,null);assert.deepEqual(after.slice(1),before.slice(1));
 h.allow();h.connect();await h.sync.flush();assert.equal(h.sync.getQueue().length,0);assert.equal(h.committed.size,14);
});
const A=require('../js/accounting');
test('Bic Camera legacy corporate card is a manual debit candidate; names and dates remain reviewable',()=>{
 const bank={bankTransactionDate:'2026-10-24',outgoing:6060,description:'Visaデビット ビックカメラ池袋西口店',status:'未照合'};
 const legacy={id:'bic',expenseDate:'2026-10-24',amount:6060,paymentMethod:'法人カード決済',vendor:'BIC CAMERA',description:'備品'};
 assert.equal(A.expenseMatch(bank,{expenses:[legacy]}).candidates[0].id,'bic');
 assert.equal(A.expenseMatch(bank,{expenses:[legacy]}).candidates[0].score,70);
 for(const over of [{paymentMethod:'現金'},{paymentMethod:'代表者立替'},{paymentMethod:'法人信用カード'},{expenseDate:'2026-09-24'},{bankTxnId:'other'},{deletedAt:'x'}])assert.equal(A.expenseMatch(bank,{expenses:[{...legacy,...over}]}).candidates.length,0);
 assert.equal(A.expenseMatch({...bank,description:'VISA カード引落'},{expenses:[legacy]}).candidates.length,0);
 assert.equal(A.expenseMatch(bank,{expenses:[legacy,{...legacy,id:'another'}]}).candidates.length,2);
});
test('duplicate bank expense conflict is backed up and retained while independent queue progresses',async()=>{
 const values=new Map(),attempts=[];let allowMatch=false;
 const client={getState:()=>({role:'admin',projectId:'demo',companyId:'test',user:{uid:'test'}}),listRecords:async()=>[],transact:async(id)=>{attempts.push(id);if(id==='conflict')throw Error('既存の支出候補があります。');return {id};}};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 let online=false;const sync=createSync({client,storage,online:()=>online});
 sync.enqueue({type:'expenseFromBank',operationId:'conflict',bankTxnId:'bic',expense:{amount:6060}});
 sync.enqueue({type:'bankUnmatch',operationId:'dependent',bankTxnId:'bic'});
 sync.enqueue({type:'test',operationId:'normal'});
 sync.enqueue({type:'test',operationId:'normal2'});
 const before=sync.getQueue();online=true;await sync.flush();
 assert.deepEqual(attempts,['conflict','normal','normal2']);assert.equal(sync.getQueue().length,2);assert.deepEqual(sync.getQueue()[0].command,before[0].command);assert.equal(sync.getQueue()[0].createdAt,before[0].createdAt);
 const backup=[...values].find(([k])=>k.includes('bank_conflict_backup_'));assert.deepEqual(JSON.parse(backup[1]),before);
 await sync.flush();assert.deepEqual(attempts,['conflict','normal','normal2']);
});
test('stored conflict survives restart, explicit match passes it, and verified linked expense completes original operation',async()=>{
 const prefix='tsukinowa_cloud_v2_demo_test_test_',values=new Map(),attempts=[],listeners=new Map();let linked=false;
 const original={command:{type:'expenseFromBank',operationId:'old',bankTxnId:'bic',expense:{amount:6060}},createdAt:'2026-10-24',blocked:true,error:'既存の支出候補があります。'};
 values.set(prefix+'outbox',JSON.stringify([original]));
 const client={getState:()=>({role:'admin',projectId:'demo',companyId:'test',user:{uid:'test'}}),listRecords:async()=>[],listen:(name,_,next)=>{listeners.set(name,next);next([],{fromCache:false});return()=>{};},transact:async(id)=>{attempts.push(id);if(id==='match'){linked=true;listeners.get('bankTransactions')([{id:'bic',payload:{status:'照合済',matchType:'expense'}}],{fromCache:false});return {id};}if(!linked)throw Error('既存の支出候補があります。');return {unchanged:true};}};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};let online=false;
 const sync=createSync({client,storage,online:()=>online});sync.start();
 assert.deepEqual(JSON.parse(values.get(prefix+'bank_conflict_backup_old')),[original]);
 sync.enqueue({type:'bankMatch',operationId:'match',bankTxnId:'bic',targetType:'expense',targetId:'existing'});online=true;await sync.flush();
 assert.deepEqual(attempts,['match','old']);assert.equal(sync.getQueue().length,0);sync.stop();
});
test('inconsistent reciprocal references remain isolated even when bank snapshot says matched',async()=>{
 const values=new Map(),listeners=new Map(),attempts=[];let online=false;
 const client={getState:()=>({role:'admin',projectId:'demo',companyId:'test',user:{uid:'test'}}),listRecords:async()=>[],listen:(name,_,next)=>{listeners.set(name,next);next(name==='bankTransactions'?[{id:'bic',payload:{status:'照合済',matchType:'expense'}}]:[],{fromCache:false});return()=>{};},transact:async id=>{attempts.push(id);if(id==='bad')throw Error('既存の支出候補があります。参照を確認してください。');return {id};}};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},sync=createSync({client,storage,online:()=>online});sync.start();
 sync.enqueue({type:'expenseFromBank',operationId:'bad',bankTxnId:'bic',expense:{amount:6060}});sync.enqueue({type:'test',operationId:'good'});online=true;await sync.flush();
 assert.deepEqual(attempts,['bad','good']);assert.equal(sync.getQueue().length,1);assert(sync.getQueue()[0].blocked);sync.stop();
});

test('a committed payment remains replayable when the local outbox cannot be updated', async () => {
 const values = new Map(), attempted = [];
 let online = false, failNextRemoval = false;
 const client = {
  getState: () => ({role:'admin',projectId:'demo',companyId:'test',user:{uid:'test'}}),
  listRecords: async () => [],
  transact: async id => { attempted.push(id); return {paymentId:id}; }
 };
 const storage = {
  getItem: key => values.get(key) ?? null,
  setItem(key, value) {
   if (failNextRemoval && key.endsWith('_outbox') && JSON.parse(value).length === 1) {
    failNextRemoval = false;
    throw Error('quota');
   }
   values.set(key, value);
  }
 };
 const sync = createSync({client,storage,online:() => online});
 sync.enqueue({type:'payment',operationId:'cash-collection',paymentId:'p',saleId:'s',method:'現金',amount:2000,paymentDate:'2026-09-22'});
 sync.enqueue({type:'test',operationId:'next'});
 failNextRemoval = true;
 online = true;
 await sync.flush();
 assert.deepEqual(attempted, ['cash-collection']);
 assert.equal(sync.getQueue()[0].blocked, undefined);
 await sync.flush();
 assert.deepEqual(attempted, ['cash-collection','cash-collection','next']);
 assert.equal(sync.getQueue().length, 0);
});

test('enqueue rejects different commands with the same offline operation ID', () => {
 const h = harness();
 assert.equal(h.sync.enqueue({type:'test',operationId:'op0'}), 'op0');
 assert.throws(() => h.sync.enqueue({type:'test',operationId:'op0',amount:2000}), /Operation ID conflict/);
 assert.equal(h.sync.getQueue().length, 14);
});

test('signout snapshot purge removes only confirmed rows, never unsynced financial evidence',()=>{
 const {purgeConfirmedSnapshots}=require('../js/business-sync');
 const prefix='tsukinowa_cloud_v2_demo_test_test_',values=new Map([
  [prefix+'sales','[{"amount":50000}]'],[prefix+'payments','[{"amount":20000}]'],
  [prefix+'outbox','[{"command":{"type":"payment","operationId":"pending"}}]'],
  [prefix+'bank_conflict_backup_pending','evidence'],[prefix+'conflicts_1','evidence'],
  ['tsukinowa_cloud_backup_historical','immutable'],['tsukinowa_business_v1','legacy'],
  ['tsukinowa_cloud_v2_demo_test_other_sales','other-account']
 ]);
 const storage={getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k)};
 assert.equal(purgeConfirmedSnapshots(storage,{projectId:'demo',companyId:'test',user:{uid:'test'}}),2);
 for(const key of ['outbox','bank_conflict_backup_pending','conflicts_1'])assert(values.has(prefix+key));
 assert(values.has('tsukinowa_cloud_backup_historical'));
 assert(values.has('tsukinowa_business_v1'));
 assert(values.has('tsukinowa_cloud_v2_demo_test_other_sales'));
 assert.equal(purgeConfirmedSnapshots(storage,{projectId:'demo',companyId:'test',user:{uid:'test'}}),0);
 assert.equal(purgeConfirmedSnapshots(storage,null),0);
});

test('separate transient snapshot cache never persists server records to outbox storage', async()=>{
 const {createSync}=require('../js/business-sync');
 const local=new Map(),transient=new Map();
 const adapter=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 const client={getState:()=>({role:'admin',projectId:'demo',companyId:'test',user:{uid:'test'}}),listen:(name,id,callback)=>{callback([{id:'record',payload:{amount:25000}}],{fromCache:false});return()=>{}},listRecords:async()=>[],transact:async()=>({ok:true})};
 const sync=createSync({client,storage:adapter(local),snapshotStorage:adapter(transient),online:()=>false});
 sync.start();
 assert([...transient.keys()].some(k=>k.endsWith('_sales')));
 assert(![...local.keys()].some(k=>k.endsWith('_sales')));
 sync.enqueue({type:'test',operationId:'offline-1'});
 assert([...local.keys()].some(k=>k.endsWith('_outbox')));
 sync.stop();
});
