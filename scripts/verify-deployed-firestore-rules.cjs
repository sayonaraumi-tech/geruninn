#!/usr/bin/env node
// Read-only production Firestore rules verification via Firebase Rules API.
// Requires project-level IAM permission to read rules; never writes or deploys them.
// Run with GOOGLE_APPLICATION_CREDENTIALS set in a trusted private environment.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {applicationDefault}=require('firebase-admin/app');
const root=path.resolve(__dirname,'..');
const project=JSON.parse(fs.readFileSync(path.join(root,'firebase-config.json'),'utf8')).firebase.projectId;
if(!/^[a-z0-9-]+$/.test(project))throw Error('Invalid project ID');
function norm(s){return String(s).replace(/\r\n/g,'\n').trim();}
const digest=s=>crypto.createHash('sha256').update(norm(s)).digest('hex');
(async()=>{
 const token=await applicationDefault().getAccessToken();
 if(!token?.access_token)throw Error('Google ADC with Firebase Rules read permission is required.');
 async function get(uri){
  const r=await fetch('https://firebaserules.googleapis.com/v1/'+uri,{headers:{authorization:'Bearer '+token.access_token}});
  if(!r.ok)throw Error('Firebase Rules read failed (HTTP '+r.status+'). No production change was made.');
  return r.json();
 }
 const release=await get('projects/'+project+'/releases/cloud.firestore');
 const name=release.rulesetName;
 if(!/^projects\/[a-z0-9-]+\/rulesets\//.test(name||''))throw Error('No deployed Firestore ruleset found');
 const ruleset=await get(name);
 const files=ruleset.source?.files||[];
 if(files.length!==1)throw Error('Unexpected deployed ruleset file count: '+files.length);
 const deployed=files[0].content,local=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
 const remoteHash=digest(deployed),localHash=digest(local);
 console.log(JSON.stringify({project,release:release.name,ruleset:name,localSha256:localHash,deployedSha256:remoteHash,match:localHash===remoteHash},null,2));
 if(localHash!==remoteHash){console.error('FAIL: deployed rules differ from the reviewed repository rules');process.exitCode=2;}
 else console.log('PASS: deployed production Firestore rules match this revision');
})().catch(e=>{console.error('NOT VERIFIED: '+e.message);process.exitCode=1;});
