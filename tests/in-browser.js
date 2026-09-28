// Loaded only by the local test runner, never by the production application.
window.testErrors=[];window.addEventListener('error',e=>testErrors.push(e.message));
window.alert=()=>{};
localStorage.setItem('tsukinowa_business_v1',JSON.stringify({calendar:[{id:'kept',title:'有休',date:'2026-09-02',linkedInvoiceId:'formal',officialAmount:123}],sales:[{id:'kept-sale',amount:123}],payments:[],expenses:[],bank:[],audit:[],estimates:[],projects:[]}));
localStorage.setItem('tsukinowa_chohyo_confirmed_history_v1',JSON.stringify([{historyId:'formal',docType:'invoice',customerName:'既存顧客',items:[]}]));
localStorage.setItem('tsukinowa_preserved','yes');
window.google={accounts:{oauth2:{hasGrantedAllScopes:(r,...s)=>s.every(x=>r.scope.split(' ').includes(x)),initTokenClient:config=>{window.oauthConfig=config;return {requestAccessToken(){this.callback({access_token:'test-token',expires_in:3600,scope:config.scope});}};}}}};
let testTitle='株式会社テスト｜壁紙｜12000',testReadonly=false,testConflict=true;
const testPatches=[],testRequests=[];
window.fetch=async(url,options={})=>{
 const u=new URL(url);testRequests.push(u);
 if(u.pathname.endsWith('/calendarList'))return Response.json(u.searchParams.has('pageToken')?{items:[{id:'shared@example.com',summary:'月輪合同会社 業務システム',accessRole:'writer'}]}:{items:[{id:'primary@example.com',primary:true,summary:'個人',accessRole:'owner'},{id:'readonly@example.com',summary:'読取',accessRole:'reader'}],nextPageToken:'next'});
 if(options.method==='PATCH'){
  if(testReadonly)return Response.json({error:{message:'Read only'}},{status:403});
  if(testConflict){testConflict=false;return Response.json({error:{message:'Changed'}},{status:412});}
  testPatches.push({url:u.href,body:JSON.parse(options.body),headers:options.headers});return Response.json({id:'event1'});
 }
 if(/\/events\//.test(u.pathname))return Response.json({id:'event1',etag:'"revision"',description:'Google上の最新メモ'});
 const event=(id,summary)=>({id,iCalUID:'same-recurring-uid',summary,start:{date:'2026-09-10'},end:{date:'2026-09-11'}});
 return Response.json(u.searchParams.has('pageToken')?{items:[event('event2','小野田、genovia浅草1002、68.8米')]}:{items:[event('event1',testTitle),event('off','Off'),event('holiday','敬老の日'),event('desc','現場作業'),{...event('cancelled','取消'),status:'cancelled'}],nextPageToken:'events-next'});
};
window.addEventListener('load',async()=>{
 const results=[],check=(ok,label)=>{if(!ok)throw new Error(label);results.push('PASS '+label);};
 const settle=()=>Promise.all([...bizGooglePatchJobs.values()]);
 try{
  check(localStorage.getItem('tsukinowa_preserved')==='yes'&&loadConfirmedHistory()[0].customerName==='既存顧客','existing data survives startup');
  await bizGoogleConnect();check(bizGoogleCalendarId==='shared@example.com'&&document.getElementById('googleCalendarSelect').options.length===4,'paginated CalendarList and shared calendar preference');
  check(oauthConfig.scope.split(' ').length===2,'both OAuth scopes');
  document.getElementById('calendarMonth').value='2026-09';await bizGoogleSyncMonth();await bizGoogleSyncMonth();
  check(bizState.calendar.length===4,'event pagination, holiday/rest filters, deduplication, no deletion');
  check(testRequests.some(u=>u.searchParams.get('timeMin')==='2026-09-01T00:00:00+09:00'),'Japan month boundaries');
  check(bizState.calendar.filter(e=>e.uid==='same-recurring-uid').length===3,'recurring occurrences not collapsed by iCalUID');
  check(!bizShouldIgnoreCalendarEvent({title:'現場作業',description:'担当は有休'}),'filter uses title, not business notes');
  check(parseOnodaEvent(bizState.calendar.find(e=>e.googleEventId==='event2'))[0].qty===68.8,'Onoda parsing unchanged');
  bizGoogleSelectCalendar('readonly@example.com');await bizGoogleLoadCalendars(true);check(bizGoogleCalendarId==='readonly@example.com','manual calendar choice survives list refresh');
  const e=bizState.calendar.find(e=>e.googleEventId==='event1');bizLoadDocFromEvent(e,'invoice');
  document.getElementById('customerName').value='正式顧客';items=[{content:'工事',qty:1,price:50000,unit:'式',taxable:true}];recalc();saveConfirmedHistory();await settle();
  check(testPatches.length===1,'save sends one successful PATCH after conflict retry');
  const patch=testPatches[0];check(patch.url.includes('shared%40example.com')&&patch.body.summary.includes('正式顧客'),'write to original calendar after manual switch');
  check(patch.body.description.includes('Google上の最新メモ')&&patch.body.description.includes('正式金額:')&&patch.body.description.includes('calendar=shared%40example.com')&&patch.headers['If-Match']==='"revision"','preserve remote notes, amount, deep link and concurrency guard');
  const history=JSON.stringify(loadConfirmedHistory());testTitle='変更顧客｜999999';bizGoogleSelectCalendar('shared@example.com');await bizGoogleSyncMonth();
  check(JSON.stringify(loadConfirmedHistory())===history&&bizState.calendar.find(e=>e.googleEventId==='event1').title.includes('正式顧客'),'Calendar edits cannot replace official documents or title');
  bizClearDocLink();openSavedDoc(0);check(!!bizCurrentCalendarId,'saved document restores event link');setDocType('receipt');check(!bizCurrentCalendarId,'new blank document clears stale link');
  testReadonly=true;await bizGooglePatchEvent(bizState.calendar.find(e=>e.googleEventId==='event1'));check(bizState.calendar.find(e=>e.googleEventId==='event1').googlePatchPending,'read-only failure retains pending write');
  testReadonly=false;await bizGoogleSyncMonth();check(!bizState.calendar.find(e=>e.googleEventId==='event1').googlePatchPending,'resync retries pending write');
  for(const page of ['dashboard','calendar','estimates','projects','chohyo','savedDocs','monthly'])bizSwitchPage(page);
  check(testErrors.length===0,'all page navigation without runtime errors');
  results.push('ALL CHECKS PASSED');
 }catch(e){results.push('FAIL '+e.stack);}
 const report=document.createElement('pre');report.id='test-results';report.style='position:fixed;inset:0;z-index:999999;background:white;color:black;overflow:auto;padding:20px;white-space:pre-wrap';report.textContent=results.join('\n');document.body.append(report);
});
