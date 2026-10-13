'use strict';

function bytesFromBase64(encoded){
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
  return bytes;
}
function fixedFixtureFetch(routes){
  return async input=>{
    const url=new URL(String(input));
    if(url.origin!==W01SharedLoader.DEV_ORIGIN) throw new Error('fixture fetch escaped fixed preview origin');
    const encoded=routes[url.pathname];
    if(typeof encoded!=='string') return {status:404,ok:false,url:url.href,
      headers:{get:()=> 'text/plain'},arrayBuffer:async()=>new ArrayBuffer(0)};
    const bytes=bytesFromBase64(encoded);
    return {status:200,ok:true,url:url.href,
      headers:{get:name=>name.toLowerCase()==='content-type'?'application/json; charset=utf-8':null},
      arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  };
}
function sendToBackground(message){
  return new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage(message,response=>{
      const lastError=chrome.runtime.lastError;
      if(lastError){reject(new Error('background messaging failed'));return;}
      if(!response||response.ok!==true){reject(new Error(response&&response.error||'background request failed'));return;}
      resolve(response);
    });
  });
}
function snapshotSummary(snapshot){
  return snapshot?{gameReleaseId:snapshot.gameReleaseId,gameVersion:snapshot.gameVersion,
    contentVersion:snapshot.contentVersion,dataRevision:snapshot.dataRevision}:null;
}
async function runW01IdbScenario(input){
  const api=W01SharedLoader,releaseId=input.gameReleaseId,gameVersion=input.gameVersion;
  // Every test invocation uses a new persistent profile, so its extension origin starts with an empty database.
  const store=new api.IndexedDbSnapshotStore();
  await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r1Routes),store,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  const afterR1=await store.getActive(releaseId);
  await api.verifyStoredSnapshot(afterR1,{allowFixture:true});

  let invalidUpdateRejected=false;
  try{
    await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r2InvalidRoutes),store,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  }catch{invalidUpdateRejected=true;}
  const afterInvalid=await store.getActive(releaseId);

  const faultStore=new api.IndexedDbSnapshotStore(indexedDB,{beforeCommit(){throw new Error('simulated IndexedDB transaction abort');}});
  let transactionAbortObserved=false;
  try{
    await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r2Routes),store:faultStore,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  }catch(error){transactionAbortObserved=error.message==='simulated IndexedDB transaction abort';}
  const afterAbort=await store.getActive(releaseId);
  const abortedSnapshot=await store.getSnapshot(releaseId,input.r2DataRevision);

  await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r2Routes),store,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  const afterR2=await store.getActive(releaseId);
  const rolledBack=await api.rollback({store,gameReleaseId:releaseId,dataRevision:input.r1DataRevision,allowFixture:true});
  const afterRollback=await store.getActive(releaseId);
  const backgroundStatus=globalThis.chrome&&chrome.runtime?await sendToBackground({type:'W01_GET_STATUS',gameReleaseId:releaseId}):null;
  const result={
    gameVersion,
    initialActive:snapshotSummary(afterR1),
    invalidUpdateRejected,
    activeAfterInvalid:snapshotSummary(afterInvalid),
    transactionAbortObserved,
    activeAfterAbort:snapshotSummary(afterAbort),
    abortedSnapshotAbsent:abortedSnapshot===null,
    activeAfterValidR2:snapshotSummary(afterR2),
    rollbackResult:snapshotSummary(rolledBack),
    activeAfterRollback:snapshotSummary(afterRollback),
    serviceWorkerActive:backgroundStatus&&backgroundStatus.active,
    extensionRuntimeAvailable:Boolean(backgroundStatus)
  };
  document.getElementById('result').textContent=JSON.stringify(result);
  document.body.dataset.testState='complete';
  return result;
}
async function runW01PreviewFaultStages(input){
  const api=W01SharedLoader,releaseId=input.gameReleaseId,gameVersion=input.gameVersion;
  const store=new api.IndexedDbSnapshotStore();
  await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r1Routes),store,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  const afterR1=await store.getActive(releaseId);
  await api.verifyStoredSnapshot(afterR1,{allowFixture:true});
  let invalidUpdateRejected=false;
  try{
    await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r2InvalidRoutes),store,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  }catch{invalidUpdateRejected=true;}
  const afterInvalid=await store.getActive(releaseId);
  const faultStore=new api.IndexedDbSnapshotStore(indexedDB,{beforeCommit(){throw new Error('simulated IndexedDB transaction abort');}});
  let transactionAbortObserved=false;
  try{
    await api.loadAndActivate({fetchImpl:fixedFixtureFetch(input.r2Routes),store:faultStore,gameVersion,gameReleaseId:releaseId,allowFixture:true});
  }catch(error){transactionAbortObserved=error.message==='simulated IndexedDB transaction abort';}
  const afterAbort=await store.getActive(releaseId);
  const abortedSnapshot=await store.getSnapshot(releaseId,input.r2DataRevision);
  return {
    initialActive:snapshotSummary(afterR1),
    invalidUpdateRejected,
    activeAfterInvalid:snapshotSummary(afterInvalid),
    transactionAbortObserved,
    activeAfterAbort:snapshotSummary(afterAbort),
    abortedSnapshotAbsent:abortedSnapshot===null
  };
}
async function activateW01PreviewR2(input){
  const result=await W01SharedLoader.loadAndActivate({
    fetchImpl:fixedFixtureFetch(input.r2Routes),
    store:new W01SharedLoader.IndexedDbSnapshotStore(),
    gameVersion:input.gameVersion,
    gameReleaseId:input.gameReleaseId,
    allowFixture:true
  });
  return snapshotSummary(result);
}
window.runW01IdbScenario=runW01IdbScenario;
window.runW01PreviewFaultStages=runW01PreviewFaultStages;
window.activateW01PreviewR2=activateW01PreviewR2;
