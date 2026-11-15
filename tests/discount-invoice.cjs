const assert=require('node:assert/strict'),{test}=require('node:test');
const {total}=require('../js/business-domain.js');
test('invoice discount reduces pre-tax subtotal and tax',()=>{
  const base={docType:'invoice',items:[{qty:1,price:10000}],travelFee:0};
  assert.equal(total(base),11000);
  const withDiscount={...base,discountAmount:10000};
  assert.equal(total(withDiscount),0);
  const partial={...base,discountAmount:4000};
  assert.equal(total(partial),6600); // (10000-4000)*1.1
});
test('zero or missing discount has no effect; other types ignore it',()=>{
  const inv={docType:'invoice',items:[{qty:2,price:5000}],travelFee:0,discountAmount:0};
  assert.equal(total(inv),11000);
  const receipt={docType:'receipt',receiptTotal:11000,discountAmount:999};
  assert.equal(total(receipt),11000);
  const onoda={docType:'onoda',items:[{qty:1,price:1000,taxable:true}],discountAmount:500};
  // onoda uses onodaTotals; discount field ignored
  assert.equal(total(onoda),1100);
});
