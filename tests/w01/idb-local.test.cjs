'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,createRelease}=require('./fixtures.cjs');
const {loadPlaywright,headlessShellPath}=require('./playwright-runtime.cjs');

function serializeRoutes(release){
  return Object.fromEntries([...release.routes.entries()].map(([pathname,bytes])=>[pathname,bytes.toString('base64')]));
}
function createPrivateOutput(){
  const tempRoot=path.resolve(os.tmpdir()),privateRoot=path.join(tempRoot,'syp-311-w01');
  fs.mkdirSync(privateRoot,{recursive:true});
  const stat=fs.lstatSync(privateRoot);
  if(!stat.isDirectory()||stat.isSymbolicLink()) throw new Error('W01 private temp root is not a plain directory');
  const outputRoot=fs.mkdtempSync(path.join(privateRoot,'idb-local-'));
  if(!path.resolve(outputRoot).startsWith(privateRoot+path.sep)) throw new Error('W01 local IDB profile escaped private temp root');
  return {outputRoot,profilePath:path.join(outputRoot,'profile')};
}

test('InterT20_RealBrowserIndexedDbAbortRollbackOnPrivateLocalOrigin',async t=>{
  if(process.platform!=='win32'){t.skip('This private browser harness uses the configured Windows Playwright runtime.');return;}
  const {playwright,version:playwrightVersion}=loadPlaywright();
  const executablePath=process.env.SYP_W01_CHROMIUM_EXE||headlessShellPath();
  if(!fs.existsSync(executablePath)){t.skip('Installed Playwright headless shell is unavailable; no download is attempted.');return;}
  const output=createPrivateOutput();
  const r1=createRelease({dataRevision:DATA_R1,contentVersion:'0.0.1'});
  const r2=createRelease({dataRevision:DATA_R2,contentVersion:'0.0.2'});
  const r2InvalidRoutes=serializeRoutes(r2);
  r2InvalidRoutes['/data/'+DATA_R2+'/skills.json']=Buffer.from('invalid-json').toString('base64');
  const root=path.resolve(__dirname,'..','..');
  const assets=new Map([
    ['/idb-harness.html',path.join(__dirname,'idb-harness.html')],
    ['/idb-harness.js',path.join(__dirname,'idb-harness.js')],
    ['/loader-core.js',path.join(root,'extension','w01','loader-core.js')]
  ]);
  const server=http.createServer((request,response)=>{
    const asset=assets.get(new URL(request.url,'http://127.0.0.1').pathname);
    if(!asset){response.writeHead(404);response.end();return;}
    const type=asset.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8';
    response.writeHead(200,{'content-type':type,'cache-control':'no-store'});
    fs.createReadStream(asset).pipe(response);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  let context;
  const pageErrors=[];
  const originalWorkingDirectory=process.cwd();
  try{
    process.chdir(output.outputRoot);
    context=await playwright.chromium.launchPersistentContext(output.profilePath,{
      executablePath,headless:true,viewport:{width:960,height:640}
    });
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:'+address.port+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.runW01IdbScenario==='function',{timeout:10000});
    const result=await page.evaluate(input=>window.runW01IdbScenario(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,
      r1DataRevision:DATA_R1,r2DataRevision:DATA_R2,
      r1Routes:serializeRoutes(r1),r2Routes:serializeRoutes(r2),r2InvalidRoutes
    });
    assert.deepEqual(pageErrors,[]);
    assert.equal(result.initialActive.dataRevision,DATA_R1);
    assert.equal(result.invalidUpdateRejected,true);
    assert.equal(result.activeAfterInvalid.dataRevision,DATA_R1);
    assert.equal(result.transactionAbortObserved,true);
    assert.equal(result.activeAfterAbort.dataRevision,DATA_R1);
    assert.equal(result.abortedSnapshotAbsent,true);
    assert.equal(result.activeAfterValidR2.dataRevision,DATA_R2);
    assert.equal(result.rollbackResult.dataRevision,DATA_R1);
    assert.equal(result.activeAfterRollback.dataRevision,DATA_R1);
    assert.equal(result.extensionRuntimeAvailable,false);
    await page.screenshot({path:path.join(output.outputRoot,'idb-local.png'),fullPage:true});
    t.diagnostic(JSON.stringify({
      browser:process.env.SYP_W01_CHROMIUM_EXE?'Copied full Playwright Chromium':'Playwright Chromium headless shell',
      playwrightVersion,
      projectDeclaredPlaywright:'1.62.1',
      browserFileVersion:'156.0.8078.4',
      origin:'http://127.0.0.1:'+address.port,
      loadedExtension:false,
      activeRevisionAfterRollback:result.activeAfterRollback.dataRevision,
      idbAbortPreservedRevision:result.activeAfterAbort.dataRevision,
      profilePreserved:true,
      privateOutput:output.outputRoot
    },null,2));
  }finally{
    if(context) await context.close();
    await new Promise(resolve=>server.close(resolve));
    process.chdir(originalWorkingDirectory);
  }
});
