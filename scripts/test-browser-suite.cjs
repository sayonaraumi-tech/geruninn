// Sequential isolation: each emulator suite resets its own demo database.
const {spawnSync}=require('node:child_process');
const group=process.argv[2];
const files=group==='emulator'?["business-browser","outstanding-browser","historical-import-browser","document-numbering-browser","expense-bank-browser","accounting-events-browser","ledger-cleanup-browser","payment-paths-browser"]:group==='local'?["sales-period-browser","onoda-browser","navigation","calendar-sync","cloud-browser","receipt-calendar-browser","business-workflow-browser","estimate-calendar-browser","home-ledger-browser","bank-evidence-browser","supplier-prepayment-browser","integrated-bank-browser","auth-persistence"]:null;
if(!files)throw Error('Expected local or emulator');
for(const file of files){
 console.log('RUN '+file);
 const r=spawnSync(process.execPath,['tests/'+file+'.cjs'],{stdio:'inherit',env:{...process.env,FIREBASE_SDK_DIR:process.env.FIREBASE_SDK_DIR||'node_modules/firebase'},timeout:180000});
 if(r.error)console.error(r.error);
 if(r.status!==0)process.exit(r.status||1);
}
