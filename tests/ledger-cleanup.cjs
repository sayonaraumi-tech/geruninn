const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../js/accounting');
test('one live sale and distinct confirmed payments; state tombstones/pending/orphan excluded',()=>{
 const s={id:'sale',salesDate:'2026-10-01',invoiceDate:'2026-10-01',amount:1000,customer:'顧客'},payment={id:'p',saleId:'sale',amount:200,paymentDate:'2026-10-02',confirmation:'bank-confirmed'};
 const sales=[s,s,...['void','duplicate','revised','cancelled'].map(status=>({...s,id:status,documentStatus:'active',status})),{...s,id:'deleted',deletedAt:'2026-10-01'}];
 const payments=[payment,payment,{...payment,id:'second'},...['void','duplicate','revised','cancelled'].map(status=>({...payment,id:status,documentStatus:'active',status})),{...payment,id:'pending',confirmation:'pending-bank'},{...payment,id:'cancel',deletedAt:'2026-10-03'},{...payment,id:'orphan',saleId:'void'}];
 assert.equal(A.ledger(sales,payments).payments.length,2);
 const rows=A.receivables(sales,payments,'2026-10-08');assert.equal(rows.length,1);assert.deepEqual([rows[0].paid,rows[0].outstanding,rows[0].lastPaymentDate,rows[0].status],[400,600,'2026-10-02','一部入金']);
 assert.equal(A.salesRows(sales,payments,'2026-10')[0].paid,400);assert.equal(A.salesRows(sales,payments,'2026-09').length,0);
 assert.equal(A.receivables(sales,payments,'2026-10-01')[0].paid,0);
});
