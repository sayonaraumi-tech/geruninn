const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../js/accounting');
const expense=(id,date,over={})=>({id,expenseDate:date,category:'消耗品費',vendor:'取引先,"引用"',description:'内容\n二行',paymentMethod:'法人銀行デビット',amount:1200,...over});
test('expense register matches HOME, excludes cancellations, preserves distinct purchases and sorts without mutation',()=>{
 const a=expense('a','2026-10-02'),rows=[expense('z','2026-11-01'),expense('b','2026-10-02'),a,{...a},expense('c','2026-10-01'),expense('d','2026-10-03',{deletedAt:'cancelled'})],before=JSON.stringify(rows);
 const selected=A.expenseRegister(rows,'2026-10');
 assert.deepEqual(selected.map(r=>r.id),['c','a','b']);
 assert.equal(selected.reduce((n,r)=>n+r.amount,0),A.monthly({expenses:rows},'2026-10').expenseTotal);
 assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(A.expenseRegister(rows,'2026-09'),[]);
 assert.throws(()=>A.expenseRegister(rows,'2026-13'));
});
test('expense export uses visible rows, Japanese columns, numeric yen, no technical IDs and Excel safe text',()=>{
 const rows=[expense('internal-secret','2026-10-02',{vendor:'=1+1',amount:6060,receiptAttachmentRef:'領収書.pdf'})];
 const exported=A.expenseExport(rows,'2026-10'),text=A.csv(exported);
 assert.deepEqual(exported[0],['支出日','科目','取引先','内容','支払方法','金額','状態','領収書参照']);
 assert.equal(exported[1][5],6060);assert(!text.includes('internal-secret'));
 assert(text.startsWith('\ufeff'));assert(text.includes('\r\n'));assert(text.includes("'=1+1"));
 assert.deepEqual(A.parseCSV(text.slice(1))[1].slice(3,6),['内容\n二行','法人銀行デビット','6060']);
 assert.equal(A.expenseExport(rows,'2026-11').length,1);
});
