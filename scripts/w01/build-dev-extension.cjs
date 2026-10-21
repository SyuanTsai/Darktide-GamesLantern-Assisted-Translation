'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const DEV_ORIGIN='https://darktide-zh-tw-preview.syuan-tsai.workers.dev';
const REPOSITORY_ROOT=path.resolve(__dirname,'..','..');

function ensurePrivateRoot(){
  const tempRoot=path.resolve(os.tmpdir());
  const privateRoot=path.join(tempRoot,'syp-311-w01');
  fs.mkdirSync(privateRoot,{recursive:true});
  const stat=fs.lstatSync(privateRoot);
  if(!stat.isDirectory()||stat.isSymbolicLink()) throw new Error('W01 temp root is not a plain directory');
  const actual=path.resolve(privateRoot);
  if(actual!==privateRoot||!actual.startsWith(tempRoot+path.sep)) throw new Error('W01 temp root escaped the system temp directory');
  return privateRoot;
}
function copyRequired(source,target){
  const stat=fs.lstatSync(source);
  if(!stat.isFile()||stat.isSymbolicLink()) throw new Error('W01 build input is not a regular file: '+path.basename(source));
  fs.copyFileSync(source,target);
}
function buildDevExtension({includeTestHarness=false,outputRoot=null}={}){
  const privateRoot=ensurePrivateRoot();
  const root=outputRoot?path.resolve(outputRoot):path.join(privateRoot,'dev-build-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  if(!root.startsWith(privateRoot+path.sep)) throw new Error('W01 build output must remain under the private temp root');
  if(fs.existsSync(root)) throw new Error('W01 build output already exists');
  const extensionPath=path.join(root,'extension');
  fs.mkdirSync(extensionPath,{recursive:true});
  const sourceDir=path.join(REPOSITORY_ROOT,'extension','w01');
  copyRequired(path.join(sourceDir,'loader-core.js'),path.join(extensionPath,'loader-core.js'));
  copyRequired(path.join(sourceDir,'service-worker.js'),path.join(extensionPath,'service-worker.js'));
  copyRequired(path.join(sourceDir,'preview.html'),path.join(extensionPath,'preview.html'));
  copyRequired(path.join(sourceDir,'preview.js'),path.join(extensionPath,'preview.js'));
  copyRequired(path.join(sourceDir,'preview.css'),path.join(extensionPath,'preview.css'));
  const manifest={
    manifest_version:3,
    name:'GLAT Shared Data Loader W01 DEV',
    version:'0.0.1',
    description:'Private development build for the W01 shared-data loader.',
    permissions:[],
    host_permissions:[DEV_ORIGIN+'/*'],
    background:{service_worker:'service-worker.js',type:'classic'},
    content_security_policy:{extension_pages:"script-src 'self'; object-src 'self'"}
  };
  fs.writeFileSync(path.join(extensionPath,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  if(includeTestHarness){
    const testDir=path.join(REPOSITORY_ROOT,'tests','w01');
    copyRequired(path.join(testDir,'idb-harness.html'),path.join(extensionPath,'idb-harness.html'));
    copyRequired(path.join(testDir,'idb-harness.js'),path.join(extensionPath,'idb-harness.js'));
  }
  return {outputRoot:root,extensionPath,manifest,includeTestHarness};
}

if(require.main===module){
  const built=buildDevExtension();
  process.stdout.write(JSON.stringify({outputRoot:built.outputRoot,extensionPath:built.extensionPath,
    manifest:built.manifest,includeTestHarness:built.includeTestHarness})+'\n');
}

module.exports={DEV_ORIGIN,buildDevExtension};
