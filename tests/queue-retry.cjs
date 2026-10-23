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
