/* One-time, exact-ID cleanup. Tombstones retain the audit trail and reference targets. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaTestCleanup=api;})(globalThis,function(){
'use strict';
const REASON='開発テストデータ清理（2026-09-30）';
const SEEDS=['doc_6a12223b-ff37-42c9-b061-5150f3b44c1b','doc_0bd7aedd-1a70-4302-bfb1-f08f4d80959d'];
const COLLECTIONS=['documents','estimates','projects','sales','payments','calendarLinks','cashLedger','bankTransactions'];
const test=s=>String(s||'').trim().toLowerCase()==='test';
function removed(p){return p?.status==='void'&&p.reason===REASON||p?.deleteReason===REASON;}
function plan(records){
 const selected=new Map(),docIds=new Set(),saleIds=new Set(),estimateIds=new Set(),projectIds=new Set(),eventIds=new Set(),paymentIds=new Set();
 const rows=n=>records[n]||[];
 const add=(n,r)=>{const key=n+'/'+r.id;if(selected.has(key))return false;selected.set(key,{collection:n,id:r.id,revision:r.revision,payload:r.payload});return true;};
 for(const id of SEEDS){const r=rows('documents').find(r=>r.id===id);if(!r||removed(r.payload))continue;if(!test(r.payload.customerName)||Number(r.payload.amount)!==0||r.payload.docType==='onoda')throw Error('テスト帳票の内容が変更されています：'+id);add('documents',r);docIds.add(id);}
 if(!docIds.size)return [];
 let changed=true;
 while(changed){changed=false;
  for(const r of rows('sales'))if(docIds.has(r.payload.documentId||r.payload.sourceId)){if(!test(r.payload.customer)||Number(r.payload.amount)!==0)throw Error('正式売上が関連しています。清理を停止しました。');changed=add('sales',r)||changed;saleIds.add(r.id);}
  for(const r of rows('estimates'))if(docIds.has(r.payload.documentId||r.payload.historyId)){if(!test(r.payload.customer))throw Error('正式見積が関連しています。');changed=add('estimates',r)||changed;estimateIds.add(r.id);}
  for(const r of rows('projects'))if(docIds.has(r.payload.documentId)||estimateIds.has(r.payload.estimateId)){if(!test(r.payload.customer))throw Error('正式案件が関連しています。');changed=add('projects',r)||changed;projectIds.add(r.id);}
  for(const r of rows('payments'))if(saleIds.has(r.payload.saleId)||docIds.has(r.payload.documentId)){if(!r.payload.deletedAt||!test(r.payload.deleteReason))throw Error('テスト取消が確認できない入金があります。');changed=add('payments',r)||changed;paymentIds.add(r.id);}
  for(const r of rows('documents'))if(saleIds.has(r.payload.saleId||r.payload.snapshot?.saleId)||paymentIds.has(r.payload.paymentId)){
   const own=rows('payments').filter(p=>p.payload.documentId===r.id||p.id===r.payload.paymentId);
   if(r.payload.docType!=='receipt'||!test(r.payload.snapshot?.remarks)||!own.length||own.some(p=>!p.payload.deletedAt||!test(p.payload.deleteReason)))throw Error('正式領収書の可能性があります。清理を停止しました：'+r.id);
   changed=add('documents',r)||changed;docIds.add(r.id);
  }
  for(const r of rows('calendarLinks'))if(docIds.has(r.payload.documentId)||docIds.has(r.payload.linkedInvoiceId)||docIds.has(r.payload.linkedReceiptId)||estimateIds.has(r.payload.linkedEstimateId)||projectIds.has(r.payload.projectId)){
   if(!test(r.payload.customerName)||Number(r.payload.officialAmount)!==0||/小野田/.test(r.payload.title||''))throw Error('正式日程の可能性があります。清理を停止しました。');
   changed=add('calendarLinks',r)||changed;eventIds.add(r.id);
  }
 }
 for(const r of rows('documents'))if(!docIds.has(r.id)&&(eventIds.has(r.payload.calendarEventId)||projectIds.has(r.payload.projectId)||estimateIds.has(r.payload.estimateId)))throw Error('未確認の帳票が関連しています。');
 for(const r of rows('cashLedger'))if(paymentIds.has(r.payload.linkedPaymentId)){if(!r.payload.deletedAt)throw Error('有効な現金記録が関連しています。');add('cashLedger',r);}
 for(const r of rows('bankTransactions'))if(saleIds.has(r.payload.saleId)||paymentIds.has(r.payload.paymentId)||paymentIds.has(r.payload.confirmedPaymentId))throw Error('銀行照合済データが関連しています。');
 return Array.from(selected.values());
}
return {REASON,SEEDS,COLLECTIONS,plan,removed};
});
