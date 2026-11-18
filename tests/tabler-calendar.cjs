const {test}=require('node:test'),assert=require('node:assert/strict'),calendar=require('../js/tabler-calendar');
test('month grid preserves leap day, sixth week, exact dates and year transitions',()=>{
 const leap=calendar.cells('2028-02');assert.equal(leap.length,42);assert.equal(leap.filter(d=>d.inMonth).length,29);assert.equal(leap.find(d=>d.date==='2028-02-29').weekday,2);
 const six=calendar.cells('2026-08');assert.equal(six[0].date,'2026-07-26');assert.equal(six[41].date,'2026-09-05');assert.equal(six.filter(d=>d.inMonth).length,31);assert.equal(new Set(six.map(d=>d.date)).size,42);
 assert.equal(calendar.shift('2026-12',1),'2027-01');assert.equal(calendar.shift('2027-01',-1),'2026-12');assert.throws(()=>calendar.cells('2026-13'));assert.throws(()=>calendar.cells('2026-2'));
});
