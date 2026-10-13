'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {DEV_ORIGIN,REQUIRED_KINDS}=require('../../extension/w01/loader-core.js');

function sha256(bytes){
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function assertPlainDirectory(directory){
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()) throw new Error('Shared package root must be a plain directory');
}
function resolvePackageFile(root,relativePath){
  if(typeof relativePath!=='string'||!relativePath||relativePath.includes('\\')||
    relativePath.startsWith('/')||relativePath.includes(':'))
    throw new Error('Shared package path is unsafe');
  const parts=relativePath.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..')) throw new Error('Shared package path is unsafe');
  const file=path.resolve(root,...parts);
  if(!file.startsWith(path.resolve(root)+path.sep)) throw new Error('Shared package path escaped its root');
  let current=path.resolve(root);
  for(const part of parts){
    current=path.join(current,part);
    const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink()) throw new Error('Shared package contains a symbolic link');
  }
  if(!fs.statSync(file).isFile()) throw new Error('Shared package member is not a file');
  return file;
}
function inspectSharedPackage(packagePath){
  const root=path.resolve(packagePath);
  assertPlainDirectory(root);
  const versionBytes=fs.readFileSync(resolvePackageFile(root,'version.json'));
  const version=JSON.parse(versionBytes.toString('utf8'));
  if(!['fixture','pending-preview'].includes(version.package_kind))
    throw new Error('Shared package kind is not enabled for the DEV loader');
  if(!Array.isArray(version.game_releases)||version.game_releases.length!==1)
    throw new Error('Shared package must contain one preview game release');
  const entry=version.game_releases[0];
  if(typeof entry.manifest_path!=='string'||!entry.manifest_path.startsWith('/data/'))
    throw new Error('Shared package manifest path is invalid');
  const manifestRelative=entry.manifest_path.slice(1);
  const manifestBytes=fs.readFileSync(resolvePackageFile(root,manifestRelative));
  const manifestSha256=sha256(manifestBytes);
  if(manifestSha256!==entry.manifest_sha256) throw new Error('Local manifest hash differs from version.json');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  const expectedFixtureOnly=version.package_kind==='fixture';
  if(manifest.fixtureOnly!==expectedFixtureOnly||manifest.publicationEligible!==false)
    throw new Error('Shared package flags do not match its DEV package kind');
  const dataRevision=entry.data_revision;
  if(manifest.dataRevision!==dataRevision||manifest.gameVersion!==entry.game_version||
    manifest.contentVersion!==entry.content_version)
    throw new Error('Local manifest identity differs from version.json');
  const files={};
  const routes=new Map([
    ['/version.json',versionBytes],
    [entry.manifest_path,manifestBytes]
  ]);
  for(const kind of REQUIRED_KINDS){
    const metadata=manifest.files.find(file=>file.kind===kind);
    if(!metadata) throw new Error('Local manifest is missing required domain: '+kind);
    const relative='data/'+dataRevision+'/'+metadata.path;
    const bytes=fs.readFileSync(resolvePackageFile(root,relative));
    const digest=sha256(bytes);
    if(bytes.byteLength!==metadata.sizeBytes||digest!==metadata.sha256)
      throw new Error('Local shared domain does not match manifest: '+kind);
    files[kind]={path:metadata.path,sizeBytes:bytes.byteLength,sha256:digest,bytes};
    routes.set('/data/'+dataRevision+'/'+metadata.path,bytes);
  }
  return {root,versionBytes,version,packageKind:version.package_kind,entry,manifestBytes,manifest,manifestSha256,files,routes};
}
function loaderOptionsForPackage(bundle){
  if(bundle.packageKind==='fixture') return {allowFixture:true,allowPendingPreview:false};
  if(bundle.packageKind==='pending-preview') return {allowFixture:false,allowPendingPreview:true};
  throw new Error('Shared package kind is not enabled for the DEV loader');
}
function createPackageFetch(bundle,requests=[]){
  return async(input,options)=>{
    const url=new URL(String(input));
    requests.push({origin:url.origin,path:url.pathname,method:options&&options.method||'GET'});
    if(url.origin!==DEV_ORIGIN) throw new Error('Local package test escaped fixed preview origin');
    const bytes=bundle.routes.get(url.pathname);
    if(!bytes) return {status:404,ok:false,url:url.href,headers:{get:()=> 'text/plain'},
      arrayBuffer:async()=>new ArrayBuffer(0)};
    const copy=Uint8Array.from(bytes);
    return {status:200,ok:true,url:url.href,headers:{get:name=>
      name.toLowerCase()==='content-type'?'application/json; charset=utf-8':null},
      arrayBuffer:async()=>copy.buffer.slice(copy.byteOffset,copy.byteOffset+copy.byteLength)};
  };
}
function createMemoryStore(){
  const snapshots=new Map();
  const active=new Map();
  return {
    async getActive(gameReleaseId){
      const revision=active.get(gameReleaseId);
      return revision?snapshots.get(gameReleaseId+'|'+revision)||null:null;
    },
    async commitSnapshot(snapshot){
      snapshots.set(snapshot.gameReleaseId+'|'+snapshot.dataRevision,snapshot);
      active.set(snapshot.gameReleaseId,snapshot.dataRevision);
    },
    async getSnapshot(gameReleaseId,dataRevision){
      return snapshots.get(gameReleaseId+'|'+dataRevision)||null;
    },
    async activateSnapshot(gameReleaseId,dataRevision){
      if(!snapshots.has(gameReleaseId+'|'+dataRevision)) throw new Error('snapshot unavailable');
      active.set(gameReleaseId,dataRevision);
    }
  };
}

module.exports={DEV_ORIGIN,REQUIRED_KINDS,sha256,inspectSharedPackage,loaderOptionsForPackage,
  createPackageFetch,createMemoryStore};
