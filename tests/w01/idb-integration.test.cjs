'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildDevExtension}=require('../../scripts/w01/build-dev-extension.cjs');
const {GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,createRelease}=require('./fixtures.cjs');
const {loadPlaywright}=require('./playwright-runtime.cjs');

function serializeRoutes(release){
  return Object.fromEntries([...release.routes.entries()].map(([pathname,bytes])=>[pathname,bytes.toString('base64')]));
}

test('InterT10_DevExtensionUsesIndexedDbTransactionsAndServiceWorkerSeesRollback',async t=>{
  const {playwright,version:playwrightVersion}=loadPlaywright();
  const built=buildDevExtension({includeTestHarness:true});
  const profilePath=path.join(built.outputRoot,'profile');
  const screenshotPath=path.join(built.outputRoot,'idb-integration.png');
  const r1=createRelease({dataRevision:DATA_R1,contentVersion:'0.0.1'});
  const r2=createRelease({dataRevision:DATA_R2,contentVersion:'0.0.2'});
  const r2InvalidRoutes=serializeRoutes(r2);
  r2InvalidRoutes['/data/'+DATA_R2+'/skills.json']=Buffer.from('invalid-json').toString('base64');
  let context;
  let pageErrors=[];
  const consoleErrors=[];
  const browserRequests=[];
  const originalWorkingDirectory=process.cwd();
  try{
    process.chdir(built.outputRoot);
    try{
      context=await playwright.chromium.launchPersistentContext(profilePath,{
        channel:'chromium',executablePath:process.env.SYP_W01_CHROMIUM_EXE||undefined,headless:true,viewport:{width:960,height:640},
        ignoreDefaultArgs:['--disable-extensions'],
        args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath]
      });
    }catch(error){
      if(error.message.includes('spawn UNKNOWN')){
        t.diagnostic('Bundled Chromium could not start: '+error.message);
        t.skip('Loaded-extension integration unavailable because the installed Playwright Chromium has a Windows side-by-side startup error.');
        return;
      }
      throw error;
    }
    let worker=context.serviceWorkers().find(candidate=>candidate.url().endsWith('/service-worker.js'));
    if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
    assert.ok(worker.url().endsWith('/service-worker.js'),'the W01 MV3 service worker did not load');
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('request',request=>{
      const url=new URL(request.url());
      browserRequests.push({origin:url.protocol+'//'+url.host,path:url.pathname});
    });
    await page.goto('chrome-extension://'+extensionId+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.runW01IdbScenario==='function',{timeout:10000});
    const result=await page.evaluate(input=>window.runW01IdbScenario(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,
      r1DataRevision:DATA_R1,r2DataRevision:DATA_R2,
      r1Routes:serializeRoutes(r1),r2Routes:serializeRoutes(r2),r2InvalidRoutes
    });
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(consoleErrors,[]);
    assert.ok(browserRequests.every(request=>request.origin==='chrome-extension://'+extensionId));
    assert.equal(result.initialActive.dataRevision,DATA_R1);
    assert.equal(result.invalidUpdateRejected,true);
    assert.equal(result.activeAfterInvalid.dataRevision,DATA_R1);
    assert.equal(result.transactionAbortObserved,true);
    assert.equal(result.activeAfterAbort.dataRevision,DATA_R1);
    assert.equal(result.abortedSnapshotAbsent,true);
    assert.equal(result.activeAfterValidR2.dataRevision,DATA_R2);
    assert.equal(result.rollbackResult.dataRevision,DATA_R1);
    assert.equal(result.activeAfterRollback.dataRevision,DATA_R1);
    assert.equal(result.serviceWorkerActive.dataRevision,DATA_R1);
    await page.screenshot({path:screenshotPath,fullPage:true});
    t.diagnostic(JSON.stringify({
      devBuild:'isolated MV3 unpacked extension',
      extensionId,
      playwrightVersion,
      projectDeclaredPlaywright:'1.62.1',
      chromeVersion:context.browser().version(),
      serviceWorker:worker.url(),
      browserRequestOrigins:[...new Set(browserRequests.map(request=>request.origin))],
      browserRequestCount:browserRequests.length,
      consoleErrors,
      pageErrors,
      activeRevisionAfterRollback:result.activeAfterRollback.dataRevision,
      idbAbortPreservedRevision:result.activeAfterAbort.dataRevision,
      profilePreserved:true,
      screenshotPath
    },null,2));
  }finally{
    if(context) await context.close();
    process.chdir(originalWorkingDirectory);
  }
});
