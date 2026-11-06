const test=require('node:test'); const assert=require('node:assert/strict');
const {loadRuntime}=require('../w10/browser-runtime.cjs');const {displayFixture}=require('../helpers/source-data-display.cjs');
const {files,detailHtml,source}=require('../helpers/source-data-browser.cjs');
// Scenario: a local response mirrors the supported ability detail DOM. Purpose: actual browser observation, safe translation, new identity display and original restoration.
test('InterT10_真實DOM顯示新格式與還原',async t=>{
 let runtime;try{runtime=loadRuntime();}catch(e){t.skip(e.message);return;}
 const browser=await runtime.playwright.chromium.launch({executablePath:runtime.executablePath,headless:true});
 try{
  const context=await browser.newContext();const data=displayFixture();
  await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:detailHtml(data)}):route.abort());
  const page=await context.newPage();await page.goto('https://darktide.gameslantern.com/abilities/example');
  // No extension runtime is present, so content-entry exports without auto-start.
  for(const f of files)await page.addScriptTag({content:source(f)});
  const result=await page.evaluate(async data=>{
   const snapshot=W10SourceDataContract.validateSnapshot({current:data.current,documents:Object.fromEntries(['skills','weapons','blessings','terms'].map(k=>[k,data[k]]))});
   const adapter=W11DomAdapter.createDomAdapter({document});const resolver=W16ProductionDataset.createProductionDatasetResolver({loadSnapshot:async()=>({status:'ready',identity:snapshot.identity,snapshot})});
   const evidence=W11ContentEntry.createNativeEvidenceProvider({document,adapter});
   const controller=W11DomController.createDomController({document,adapter,identityResolver:resolver,getNativeSnapshotBytes:evidence,client:{initialize:async()=>({status:'ready',identity:snapshot.identity,snapshot})}});
   await controller.start();const translated=document.querySelector('.text-lg').textContent,details=document.querySelector('[data-w11-owned="details"]').textContent;
   await controller.setEnabled(false);const restored=document.querySelector('.text-lg').textContent;controller.dispose();return {translated,details,restored};
  },data);
  assert.equal(result.translated,'範例');assert.equal(result.restored,'Example');assert.match(result.details,/勘誤/);assert.doesNotMatch(result.details,/old → new/);
 }finally{await browser.close();}
});
