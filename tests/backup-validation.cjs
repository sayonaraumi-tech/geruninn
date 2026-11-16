'use strict';const test=require('node:test'),assert=require('node:assert/strict'),B=require('../js/backup-validation.js');
test('round-trip safely preserves known business arrays',()=>{
 const original={sales:[{id:'s1',customer:'テスト',amount:12345}],payments:[],expenses:[{id:'e1',amount:100}],bank:[],calendar:[],audit:[],estimates:[],projects:[]};
 assert.deepEqual(B.parse(JSON.stringify({version:2,mode:'production',state:original})),original);
});
test('legacy export with missing optional arrays is accepted without destructive mutation',()=>{
 const state={sales:[{id:'s1'}],payments:[]};const copy=JSON.stringify(state);
 const data=B.parse(JSON.stringify({state}));assert.equal(data.sales.length,1);assert.deepEqual(data.projects,[]);assert.equal(JSON.stringify(state),copy);
});
test('reject malformed or hostile objects',()=>{
 for(const obj of [null,[],{}, {state:{sales:{}}},{state:{sales:[null]}},{state:{sales:[{id:'s',constructor:{x:1}}]}},{version:999,state:{sales:[]}}]){
  assert.throws(()=>B.parse(JSON.stringify(obj)));
 }
 assert.throws(()=>B.parse(' '.repeat(20000001)));
});
