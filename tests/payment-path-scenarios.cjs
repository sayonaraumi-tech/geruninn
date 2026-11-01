// One contract exercised by the in-memory transaction driver and the real Firestore emulator.
module.exports=async function paymentPaths({run,list,A,assert}){
 // Transaction commits precede Web SDK collection-listener visibility. Wait for
 // the expected committed state, while keeping every original accounting assertion.
 const data=async(visible=()=>true)=>{
  let d;for(let attempt=0;attempt<100;attempt++){
   d=Object.fromEntries(await Promise.all(['sales','payments','expenses','cashLedger','bankTransactions'].map(async n=>[n,(await list(n)).map(r=>({...r.payload,id:r.id}))])));
   if(visible(d))return d;await new Promise(r=>setTimeout(r,50));
  }throw Error('Committed state not visible: '+JSON.stringify(d));
 };
 const expense=(paymentMethod,amount=600,bankAccount='')=>({expenseDate:'2026-10-01',category:'旅費交通費',paymentMethod,amount,bankAccount,vendor:'path-store',description:paymentMethod});
 const bank=(id,outgoing,description='path-store')=>({bankTxnId:id,bankTransactionDate:'2026-10-03',incoming:0,outgoing,amount:outgoing,bankAccount:'company-bank',description});
 const save=async(id,method,amount,card)=>run({type:'saveExpense',expenseId:id,expense:expense(method,amount,card),expectedRevision:0});
 await save('path-cash','現金');await save('path-rep','代表者立替',200);await save('path-ic','代表者立替（交通系IC）',300);
 let d=await data(d=>d.expenses.length===3&&d.cashLedger.length===1);assert.equal(d.cashLedger.length,1);assert.equal(A.aggregate(d,A.periodFilter({month:'2026-10'})).cashBalance,-600);
 for(const id of ['path-rep','path-ic'])if(!d.expenses.find(e=>e.id===id))throw Error('Missing '+id+': '+JSON.stringify(d));
 for(const id of ['path-rep','path-ic'])assert.equal(A.expenseStatus(d.expenses.find(e=>e.id===id)),'立替未精算');
 assert.equal(A.expenseStatus({...d.expenses[1],reimbursed:true,settled:true}),'立替未精算');
 const calendar=await run({type:'calendar',event:{id:'path-work',date:'2026-10-02',title:'path-customer｜施工｜110000'}});
 const saleCmd={type:'registerCalendarSale',id:calendar.id,sale:{salesDate:'2026-10-02',customer:'path-customer',content:'施工',amount:110000,paymentMethod:'現金'}};
 await run(saleCmd);await run(saleCmd);d=await data(d=>d.sales.length===1&&d.payments.length===1&&d.cashLedger.length===2);assert.equal(d.sales.length,1);assert.equal(d.payments.length,1);assert.equal(d.payments[0].saleId,d.sales[0].id);assert.equal(d.cashLedger.length,2);
 const month=A.aggregate(d,A.periodFilter({month:'2026-10'}));assert.equal(month.sales,110000);assert.equal(month.income,110000);assert.equal(month.cashBalance,109400);assert.equal(month.attention,0);
 const rows=A.ledgerRows(d,A.periodFilter({month:'2026-10'}));assert.equal(rows.find(r=>r.type==='売上').status,'入金済');assert.equal(rows.find(r=>r.id==='expense:path-cash').status,'支払済');assert(!A.csv(A.settlementExport(d,A.periodFilter({month:'2026-10'}))).includes('銀行未照合'));
 await run({type:'importBank',bank:{...bank('path-in',0),incoming:110000,amount:110000}});
 assert.equal(A.suggestions((await data(d=>d.bankTransactions.some(b=>b.id==='path-in'))).bankTransactions[0],await data()).length,0);
 await assert.rejects(run({type:'bankMatch',bankTxnId:'path-in',targetType:'sale',targetId:d.sales[0].id}),/対象外/);
 await run({type:'importBank',bank:bank('path-out',600)});
 for(const id of ['path-cash','path-rep','path-ic'])await assert.rejects(run({type:'bankMatch',bankTxnId:'path-out',targetType:'expense',targetId:id}),/一致/);
 await save('path-debit','法人銀行デビット',6060);await save('path-credit-a','法人信用カード',1000,'VISA-1234');await save('path-credit-b','法人信用カード',2000,'VISA-1234');await save('path-other-card','法人信用カード',3000,'JCB-5678');await save('path-legacy','法人カード決済',6060);
 await run({type:'importBank',bank:bank('path-debit-bank',6060,'Visaデビット path-store')});
 d=await data(d=>d.bankTransactions.some(b=>b.id==='path-debit-bank')&&d.expenses.length===8);assert.equal(A.expenseMatch(d.bankTransactions.find(b=>b.id==='path-debit-bank'),d).candidates.length,2);
 await run({type:'bankMatch',bankTxnId:'path-debit-bank',targetType:'expense',targetId:'path-debit'});
 await run({type:'importBank',bank:bank('path-legacy-bank',6060,'Visaデビット ビックカメラ池袋西口店')});
 await run({type:'bankMatch',bankTxnId:'path-legacy-bank',targetType:'expense',targetId:'path-legacy',expectedRevision:1});
 const oldQueued={type:'expenseFromBank',bankTxnId:'path-legacy-bank',expense:{...expense('法人銀行デビット',6060),expenseDate:'2026-10-03'}};
 assert.equal((await run(oldQueued)).unchanged,true);assert.equal((await run(oldQueued)).unchanged,true);
 await run({type:'importBank',bank:bank('path-credit-generic',1000)});
 await assert.rejects(run({type:'bankMatch',bankTxnId:'path-credit-generic',targetType:'expense',targetId:'path-credit-a'}),/一致/);
 await assert.rejects(run({type:'expenseFromBank',bankTxnId:'path-credit-generic',expense:{...expense('銀行振込',1000),expenseDate:'2026-10-03'}}),/既存/);
 await run({type:'importBank',bank:bank('path-card-bank',3000,'VISA カード利用代金')});
 const match={type:'bankMatch',bankTxnId:'path-card-bank',targetType:'cardSettlement',targetId:'path-card-bank',expenseIds:['path-credit-b','path-credit-a'],cardAccount:'VISA-1234'};
 await assert.rejects(run({...match,expenseIds:['path-credit-a']}),/合計/);await assert.rejects(run({...match,expenseIds:['path-other-card']}),/カード/);await assert.rejects(run({...match,expenseIds:['path-credit-a','path-credit-a','path-credit-a']}),/選択/);
 await run(match);await run(match);d=await data(d=>d.expenses.filter(e=>e.bankTxnId==='path-card-bank').length===2);assert.equal(d.expenses.length,8);assert.equal(d.cashLedger.length,2);assert.equal(d.expenses.filter(e=>e.bankTxnId==='path-card-bank').length,2);assert.equal(A.expenseStatus(d.expenses.find(e=>e.id==='path-credit-a')),'支払済 / 照合済');
 await assert.rejects(run({...match,expenseIds:['path-other-card']}),/別の/);
 await run({type:'bankUnmatch',bankTxnId:'path-card-bank',reason:'test'});d=await data(d=>d.expenses.filter(e=>e.bankTxnId==='path-card-bank').length===0);assert.equal(d.expenses.filter(e=>e.bankTxnId==='path-card-bank').length,0);await run(match);
 await run({type:'importBank',bank:bank('path-card-race',3000,'VISA カード利用代金')});await assert.rejects(run({...match,bankTxnId:'path-card-race',targetId:'path-card-race'}),/状態/);
 d=await data(d=>d.bankTransactions.some(b=>b.id==='path-card-race'));assert.equal(A.aggregate(d,A.periodFilter({month:'2026-10'})).expenseTotal,19220);assert.equal(A.aggregate(d,A.periodFilter({month:'2026-10'})).cashBalance,109400);
 // Competing monthly bank evidence must never consume the same fees twice.
 await run({type:'bankUnmatch',bankTxnId:'path-card-bank',reason:'race'});
 const race=await Promise.allSettled([run(match),run({...match,bankTxnId:'path-card-race',targetId:'path-card-race'})]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);if((await data(d=>d.bankTransactions.filter(b=>['path-card-bank','path-card-race'].includes(b.id)&&b.status==='照合済').length===1)).bankTransactions.find(b=>b.id==='path-card-race').status==='照合済'){await run({type:'bankUnmatch',bankTxnId:'path-card-race',reason:'restore fixture'});await run(match);}
 // Verify the maximum selectable group against real Rules access limits.
 for(let i=0;i<5;i++)await save('path-five-'+i,'法人信用カード',1,'five-card');
 await run({type:'importBank',bank:bank('path-five-bank',5,'JCB カード利用代金')});
 await run({type:'bankMatch',bankTxnId:'path-five-bank',targetId:'path-five-bank',targetType:'cardSettlement',cardAccount:'five-card',expenseIds:Array.from({length:5},(_,i)=>'path-five-'+i)});
 const five=await data(d=>d.expenses.filter(e=>e.bankTxnId==='path-five-bank').length===5);if(five.expenses.filter(e=>e.bankTxnId==='path-five-bank').length!==5)throw Error('Five group: '+JSON.stringify(five));
 assert.equal(A.expenseKey(expense('法人信用カード',1,'A'))===A.expenseKey(expense('法人信用カード',1,'B')),false);

};
