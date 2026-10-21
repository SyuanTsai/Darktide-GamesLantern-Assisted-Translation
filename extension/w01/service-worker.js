'use strict';

importScripts('loader-core.js');

const loader=self.W01SharedLoader;
const store=new loader.IndexedDbSnapshotStore();

function trustedExtensionPage(sender){
  return Boolean(sender&&sender.id===chrome.runtime.id&&typeof sender.url==='string'&&
    sender.url.startsWith('chrome-extension://'+chrome.runtime.id+'/'));
}
function summary(snapshot){
  if(!snapshot) return null;
  const manifest=snapshot.manifest||{};
  const fileHashes={};
  for(const [kind,file] of Object.entries(snapshot.files||{}))
    fileHashes[kind]={sizeBytes:file.sizeBytes,sha256:file.sha256};
  return {
    gameReleaseId:snapshot.gameReleaseId,
    gameVersion:snapshot.gameVersion,
    contentVersion:snapshot.contentVersion,
    dataRevision:snapshot.dataRevision,
    manifestSha256:snapshot.manifestSha256||null,
    versionBuildId:snapshot.versionBuildId||null,
    packageKind:manifest.fixtureOnly===true?'fixture':manifest.publicationEligible===true?'published':'pending-preview',
    fixtureOnly:manifest.fixtureOnly===true,
    publicationEligible:manifest.publicationEligible===true,
    fileHashes
  };
}
function trackedPreviewFetch(){
  const requests=[];
  const fetchImpl=async(input,options)=>{
    const url=new URL(String(input));
    if(url.origin!==loader.DEV_ORIGIN||url.protocol!=='https:')
      throw new Error('W01 request escaped the fixed HTTPS preview origin');
    try{
      const response=await fetch(url.href,options);
      requests.push({url:url.href,status:response.status,
        contentType:response.headers.get('content-type')||''});
      return response;
    }catch(error){
      requests.push({url:url.href,networkError:true});
      throw error;
    }
  };
  return {fetchImpl,requests};
}
function respondWith(promise,sendResponse){
  promise.then(value=>sendResponse({ok:true,...value}),error=>
    sendResponse({ok:false,error:error instanceof Error?error.message:'W01 request failed'}));
}
function sendActiveSnapshot(gameReleaseId,sendResponse,includeDomains=false){
  if(typeof gameReleaseId!=='string'){
    sendResponse({ok:false,error:'W01 game release identity is required'});
    return false;
  }
  respondWith((async()=>{
    const active=await store.getActive(gameReleaseId);
    if(!active) return includeDomains?{snapshot:null}:{active:null};
    const verified=await loader.verifyStoredSnapshot(active,{allowFixture:true,allowPendingPreview:true});
    if(!includeDomains) return {active:summary(verified)};
    return {snapshot:{active:summary(verified),manifest:verified.manifest,domains:verified.domains}};
  })(),sendResponse);
  return true;
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!trustedExtensionPage(sender)){
    sendResponse({ok:false,error:'W01 accepts requests only from this extension'});
    return false;
  }
  if(!message||typeof message.type!=='string'){
    sendResponse({ok:false,error:'W01 request type is invalid'});
    return false;
  }
  if(message.type==='W01_LIST_ACTIVE'){
    respondWith((async()=>{
      const active=await store.listActive();
      return {activeReleases:active.map(pointer=>({gameReleaseId:pointer.gameReleaseId,
        gameVersion:pointer.gameVersion,contentVersion:pointer.contentVersion,
        dataRevision:pointer.dataRevision}))};
    })(),sendResponse);
    return true;
  }
  if(message.type==='W01_GET_STATUS'){
    return sendActiveSnapshot(message.gameReleaseId,sendResponse);
  }
  if(message.type==='W01_GET_SNAPSHOT'){
    return sendActiveSnapshot(message.gameReleaseId,sendResponse,true);
  }
  if(message.type==='W01_CHECK_AND_ACTIVATE'){
    if(typeof message.gameVersion!=='string'||typeof message.gameReleaseId!=='string'){
      sendResponse({ok:false,error:'W01 game release identity is required'});
      return false;
    }
    const tracked=trackedPreviewFetch();
    respondWith((async()=>{
      try{
        const snapshot=await loader.loadAndActivate({
          fetchImpl:tracked.fetchImpl,
          store,
          gameVersion:message.gameVersion,
          gameReleaseId:message.gameReleaseId,
          allowFixture:true,
          allowPendingPreview:true
        });
        return {active:summary(snapshot),networkRequests:tracked.requests};
      }catch(error){
        return {ok:false,error:error instanceof Error?error.message:'W01 activation failed',
          networkRequests:tracked.requests};
      }
    })(),sendResponse);
    return true;
  }
  if(message.type==='W01_ROLLBACK'){
    respondWith((async()=>{
      const snapshot=await loader.rollback({
        store,
        gameReleaseId:message.gameReleaseId,
        dataRevision:message.dataRevision,
        allowFixture:true,
        allowPendingPreview:true
      });
      return {active:summary(snapshot)};
    })(),sendResponse);
    return true;
  }
  sendResponse({ok:false,error:'W01 request type is unsupported'});
  return false;
});
