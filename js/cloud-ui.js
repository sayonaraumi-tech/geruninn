(function(root){
  'use strict';
  let client=null,initializing=null;
  const el=id=>document.getElementById(id);
  const labels={unconfigured:'クラウド未設定',initializing:'接続準備中', 'signed-out':'未ログイン',authorizing:'権限確認中',ready:'ログイン済',denied:'利用権限未設定',error:'接続エラー'};
  function render(state){
    el('cloudStatus').textContent=labels[state.phase]||state.phase;
    el('cloudAccount').textContent=state.user?`${state.user.email} / ${state.role==='admin'?'管理者':state.role==='staff'?'スタッフ':'権限確認中'}`:'';
    el('cloudError').textContent=state.error||'';
    el('cloudLogin').disabled=!client||!['signed-out','denied','error'].includes(state.phase)||!!state.user;
    el('cloudLogout').hidden=!state.user;
    el('cloudAuthFields').hidden=!!state.user;
    el('cloudConfigRetry').hidden=state.phase!=='error';
    el('bizUserLabel').textContent=state.role?(state.role==='admin'?'管理者':'スタッフ'):'未ログイン';
    el('cloudRealtime').textContent='';
    root.TsukinowaBusinessUI?.auth(state,client);
  }
  async function initialize(){
    if(initializing)return initializing;
    initializing=(async()=>{
      let cachedConfig=null;try{cachedConfig=JSON.parse(localStorage.getItem('tsukinowa_cloud_config_v2')||'null');}catch(_){}
      if(cachedConfig?.enabled)root.TsukinowaBusinessUI?.configure(true);
      render({phase:'initializing'});
      try{
        let config;
        try{const response=await fetch('./firebase-config.json',{cache:'no-store'});if(!response.ok)throw Error('設定読込失敗');config=await response.json();}
        catch(e){if(!cachedConfig)throw e;config=cachedConfig;}
        root.TsukinowaBusinessUI?.configure(config.enabled===true);
        const validated=root.TsukinowaCloudCore.validateConfig(config);
        localStorage.setItem('tsukinowa_cloud_config_v2',JSON.stringify(config));
        if(!validated){render({phase:'unconfigured'});return;}
        const driver=await root.createTsukinowaFirebaseDriver();
        client=root.TsukinowaCloudCore.createClient(driver,render);
        await client.start(config);
      }catch(e){if(client)client.dispose();client=null;render({phase:'error',error:'クラウドに接続できません。設定または通信状態を確認してください。端末内データは保持されています。'});}
    })().finally(()=>{initializing=null;});return initializing;
  }
  root.bizOpenCloudAccount=function(){el('cloudDialog').showModal();};
  root.bizCloseCloudAccount=function(){el('cloudDialog').close();};
  root.bizCloudLogout=async function(){if(!client)return;try{await client.signOut();}catch(_){el('cloudError').textContent='ログアウトできませんでした。再試行してください。';}};
  root.bizCloudBackup=function(){
    try{
      const backup=root.TsukinowaCloudCore.backupLegacy(localStorage);
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=`tsukinowa-before-cloud-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(_){el('cloudError').textContent='バックアップを作成できませんでした。元データは変更していません。';}
  };
  // Explicit repository access for later phases. Login alone never enables bulk business writes.
  root.TsukinowaCloud={getClient:()=>client,readLegacy:()=>root.TsukinowaCloudCore.readLegacy(localStorage)};
  document.addEventListener('DOMContentLoaded',()=>{
    el('cloudLoginForm').addEventListener('submit',async event=>{
      event.preventDefault();if(!client)return;
      el('cloudError').textContent='';el('cloudLogin').disabled=true;
      try{await client.signIn(el('cloudEmail').value,el('cloudPassword').value);}
      catch(_){el('cloudError').textContent='ログインできませんでした。メール、パスワード、通信状態を確認してください。';el('cloudLogin').disabled=false;}
      finally{el('cloudPassword').value='';}
    });
    el('cloudConfigRetry').addEventListener('click',initialize);
    initialize();
  });
})(window);
