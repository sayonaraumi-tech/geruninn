'use strict';
// Offline auditor. No mutation API, no inferred deletion permission.
const fs = require('node:fs');
const crypto = require('node:crypto');
const COLLECTIONS = ['bankTransactions','sales','payments','expenses','receivables','documents','cashLedger','supplierTransactions','calendarLinks','settings','auditLogs','operations','migrations','projects','estimates','suppliers'];
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const live = p => !p.deletedAt && !['cancelled','canceled','void'].includes(p.status);
function audit(input) {
  if(input.format !== 'geruninn-readonly-audit-v1' || !input.collections) throw Error('Expected complete audit snapshot');
  for(const c of COLLECTIONS) if(!Array.isArray(input.collections[c])) throw Error('Missing collection '+c);
  const rows = Object.entries(input.collections).flatMap(([collection,rs])=>rs.map(r=>({collection,id:r.id,revision:r.data.revision,p:r.data.payload || {},raw:r.data})));
  const byPath = new Map(rows.map(r=>[r.collection+'/'+r.id,r]));
  const edges=[], dangling=[];
  const fields={saleId:['sales','receivables'],receivableId:['receivables'],paymentId:['payments'],paymentIds:['payments'],expenseId:['expenses'],expenseIds:['expenses'],documentId:['documents'],bankTxnId:['bankTransactions'],bankId:['bankTransactions'],supplierTransactionId:['supplierTransactions'],calendarEventId:['calendarLinks'],projectId:['projects'],estimateId:['estimates'],revisedFromDocumentId:['documents'],revisedToDocumentId:['documents'],duplicateOfDocumentId:['documents']};
  for(const r of rows) for(const [scope,p] of [['payload',r.p],['snapshot',r.p.snapshot||{}]]) for(const [k,cs] of Object.entries(fields)) {
    for(const id of (Array.isArray(p[k])?p[k]:[p[k]]).filter(x=>typeof x==='string'&&x)) {
      const targets=cs.map(c=>c+'/'+id).filter(path=>byPath.has(path));
      const edge={from:r.collection+'/'+r.id,field:scope+'.'+k,id,targets};edges.push(edge);if(targets.length!==1)dangling.push(edge);
    }
  }
  for(const r of rows.filter(r=>r.collection==='bankTransactions'&&r.p.matchId)) {
    const c={sale:r.p.matchId.startsWith('receivable_')?'receivables':'sales',expense:'expenses',supplier:'supplierTransactions',cardSettlement:'bankTransactions',bankIncome:'bankTransactions'}[r.p.matchType];
    const targets=c&&byPath.has(c+'/'+r.p.matchId)?[c+'/'+r.p.matchId]:[];
    const edge={from:'bankTransactions/'+r.id,field:'payload.matchId',id:r.p.matchId,targets};edges.push(edge);if(!targets.length)dangling.push(edge);
  }
  const findings=[];
  function group(rs,key,kind) {
    const groups=new Map();for(const r of rs){const k=key(r.p);if(k){const list=groups.get(k)||[];list.push(r);groups.set(k,list);}}
    for(const [evidence,rs]of groups)if(rs.length>1){
      const paths=rs.map(r=>r.collection+'/'+r.id);
      findings.push({reviewId:'review_'+sha([kind,paths]).slice(0,16),kind,evidence,records:rs.map(r=>({path:r.collection+'/'+r.id,revision:r.revision,sha256:sha(r.raw),payload:r.p})),references:edges.filter(e=>paths.includes(e.from)||e.targets.some(t=>paths.includes(t))),grossAmounts:rs.map(r=>({path:r.collection+'/'+r.id,amount:r.p.amount,incoming:r.p.incoming,outgoing:r.p.outgoing})),kpiDelta:null,decision:'manual-review-required',proposedAction:null,reason:'Evidence candidate only; no keeper or cancellation selected. Verify original bank source, account identity, references and application KPI.'});
    }
  }
  const banks=rows.filter(r=>r.collection==='bankTransactions'&&live(r.p));
  // Real account identity is deliberately supplied separately by a reviewer, never guessed from display names.
  const accounts=input.reviewedAccountIds||{};
  group(banks,p=>accounts[p.bankAccount]&&p.externalId?JSON.stringify([accounts[p.bankAccount],p.externalId]):'', 'bank-external-id-candidate');
  group(banks,p=>accounts[p.bankAccount]&&p.balance!==''&&p.balance!=null&&p.occurrence!=null?JSON.stringify([accounts[p.bankAccount],p.bankTransactionDate,p.description,p.incoming,p.outgoing,p.balance,p.occurrence]):'', 'bank-balance-occurrence-needs-original-source');
  group(banks,p=>JSON.stringify([p.bankTransactionDate,p.incoming,p.outgoing]),'same-amount-triage-never-delete');
  for(const c of ['payments','sales','expenses','receivables']) {
    const rs=rows.filter(r=>r.collection===c&&live(r.p));
    group(rs,p=>p.bankTxnId?JSON.stringify([p.bankTxnId,p.saleId||'',p.amount,p.confirmation||'']):'',c+'-shared-bank-reference');
    group(rs,p=>p.documentId||p.sourceId?JSON.stringify([p.documentId||'',p.sourceType||'',p.sourceId||'',p.saleId||'',p.amount,p.paymentDate||p.salesDate||p.expenseDate||'']):'',c+'-shared-source-review');
    group(rs,p=>JSON.stringify([p.paymentDate||p.salesDate||p.saleDate||p.expenseDate||p.date||'',p.amount]),c+'-same-amount-triage-never-delete');
  }
  const normalSalePayments=edges.filter(e=>e.from.startsWith('payments/')&&e.field==='payload.saleId'&&e.targets.length===1);
  return {format:'geruninn-audit-report-v1',projectId:input.projectId,companyId:input.companyId,sourceSHA256:sha(input),productionVerified:input.productionVerified===true,counts:Object.fromEntries(Object.entries(input.collections).map(([c,r])=>[c,r.length])),findings,edges,dangling,normalSalePayments,limitations:['Sale/payment links are normal and never cross-collection duplicates.','Matching amount/date is triage only; distinct real transactions must remain.','No original bank CSV/account proof verified by this program.','Cash mirrors, formal documents, revisions, audit and application KPI require review; null KPI is unknown, never zero.','Snapshot is audit evidence, not a tested native Firestore restore backup.'],approvedActions:[]};
}
if(require.main===module){const [src,dest]=process.argv.slice(2);if(!src||!dest)throw Error('Usage: node scripts/historical-duplicate-audit.cjs SNAPSHOT.json NEW_REPORT.json');fs.writeFileSync(dest,JSON.stringify(audit(JSON.parse(fs.readFileSync(src,'utf8'))),null,2),{flag:'wx'});}
module.exports={audit,COLLECTIONS};
