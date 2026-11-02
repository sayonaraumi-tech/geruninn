const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../js/accounting');
const period=month=>A.periodFilter({month});
const sale=(id='tsukai',over={})=>({id,salesDate:'2026-09-30',customer:'塚居株式会社',content:'施工',amount:112376,...over});
const pay=(id,amount,date,over={})=>({id,saleId:'tsukai',amount,paymentDate:date,method:'銀行振込',confirmation:'bank-confirmed',...over});
test('Tsukai 112376: one linked business row; pending record is visible without phantom unpaid row',()=>{
 const d={sales:[sale()],payments:[pay('one',112376,'2026-10-20'),pay('pending',112376,'2026-10-20',{confirmation:'pending'})]};
 const rows=A.ledgerRows(d,period('2026-10'));assert.equal(rows.length,1);assert.equal(rows[0].sales,0);assert.equal(rows[0].paid,112376);assert.equal(rows[0].incoming,112376);assert.match(rows[0].status,/入金済.*入金確認待ち/);assert.match(rows[0].paymentDates,/2026-10-20/);assert.equal(A.monthly(d,'2026-10').sales,0);assert.equal(A.monthly(d,'2026-10').attention,1);
});
test('installments obey month/year/custom cutoffs and export shares the exact row fields',()=>{
 const d={sales:[sale()],payments:[pay('one',50000,'2026-10-20'),pay('two',62376,'2026-11-10')]};
 let r=A.ledgerRows(d,period('2026-10'))[0];assert.equal(r.paid,50000);assert.equal(r.incoming,50000);assert.equal(r.status,'一部入金 / 銀行未照合');assert(!r.paymentDates.includes('2026-11'));
 r=A.ledgerRows(d,period('2026-11'))[0];assert.equal(r.sales,0);assert.equal(r.paid,112376);assert.equal(r.incoming,62376);assert.equal(r.status,'入金済 / 銀行未照合');
 for(const p of [A.periodFilter({year:2026}),A.periodFilter({start:'2026-10-20',end:'2026-11-10'})]){const rows=A.ledgerRows(d,p);assert.equal(rows.length,1);assert.equal(rows[0].incoming,112376);assert.equal(rows[0].sales,0);assert.deepEqual(A.settlementExport(d,p).at(-1),A.ledgerCells(rows[0]));}
});
test('genuine distinct duplicate sale and unlinked payments are retained, no name/amount dedup',()=>{
 const d={sales:[sale('tsukai',{salesDate:'2026-10-20'}),sale('other',{salesDate:'2026-10-20'})],payments:[pay('one',112376,'2026-10-20'),pay('orphan',100,'2026-10-21',{saleId:'missing'})]};
 const rows=A.ledgerRows(d,period('2026-10'));assert.equal(rows.length,3);assert(rows.some(r=>r.id==='sale:other'&&/未入金.*重複候補/.test(r.status)));assert(rows.some(r=>r.type==='未関連入金'&&r.incoming===100));assert.equal(A.monthly(d,'2026-10').income,112476);assert.equal(A.monthly(d,'2026-10').attention,3);
});
test('cash/advance/card payment status is independent of bank matching; flags are not settlement proof',()=>{
 const expenses=['現金','代表者立替（交通系IC）','法人カード決済','銀行振込'].map((paymentMethod,i)=>({id:String(i),expenseDate:'2026-10-20',category:'通信費',amount:100,paymentMethod,settled:true,reimbursed:true,bankTxnId:i===1?'not-proof':''}));
 const d={expenses},rows=A.ledgerRows(d,period('2026-10'));assert.equal(rows[0].status,'支払済');assert.equal(rows[1].status,'立替未精算');assert.equal(rows[2].status,'要確認 / カード種別未設定');assert.equal(A.monthly(d,'2026-10').attention,1);assert.equal(A.monthly(d,'2026-10').cashExpenses,0);
});

test('HOME paid status does not assert bank evidence or retain stale pending warning',()=>{
 const d={sales:[sale('tsukai',{salesDate:'2026-10-07'})],payments:[pay('one',112376,'2026-10-08'),pay('pending',112376,'2026-10-08',{confirmation:'pending-bank'})]};
 const before=JSON.stringify(d),p=period('2026-10'),r=A.ledgerRows(d,p)[0];
 assert.equal(r.homeStatus,'入金済');assert.equal(A.receivables(d.sales,d.payments,p.end)[0].outstanding,0);
 assert.equal(A.bankEvidence(d.payments[0],d),false);assert.match(r.status,/銀行未照合/);
 assert.equal(A.ledgerCells(r).length,11);assert.equal(JSON.stringify(d),before);
 for(const method of ['現金','銀行振込']){
  const partial={sales:[sale()],payments:[pay('one',50000,'2026-10-20',{method,confirmation:method==='現金'?'cash-received':'bank-confirmed'}),pay('two',62376,'2026-11-10')]};
  assert.equal(A.ledgerRows(partial,p)[0].homeStatus,'一部入金');
  assert.equal(A.ledgerRows(partial,period('2026-11'))[0].homeStatus,'入金済');
 }
});
