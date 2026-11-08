const test=require('node:test'); const assert=require('node:assert/strict');
const {loadRuntime}=require('../w10/browser-runtime.cjs');const {displayFixture}=require('../helpers/source-data-display.cjs');
const {files,detailHtml,source}=require('../helpers/source-data-browser.cjs');
// Scenario: a local response mirrors the supported ability detail DOM. Purpose: actual browser observation, safe translation, new identity display and original restoration.
test('InterT10_真實DOM顯示新格式與還原',async t=>{
 let runtime;try{runtime=loadRuntime();}catch(e){t.skip(e.message);return;}
 const browser=await runtime.playwright.chromium.launch({executablePath:runtime.executablePath,headless:true});
 try{
  const context=await browser.newContext();const data=displayFixture();
  for(const doc of Object.values(data))doc.schemaVersion='1.1.0';
  data.weapons.items=require('../helpers/source-data-fixture-11.cjs').fixture11().weapons.items;
  data.weapons.items[0].values.damageProfiles=structuredClone(require('../fixtures/damage-profiles-examples.json')[1].values.damageProfiles);
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
  assert.equal(result.translated,'範例');assert.equal(result.restored,'Example');assert.match(result.details,/勘誤/);assert.doesNotMatch(result.details,/old → new|default_autogun_assault|700/);
 }finally{await browser.close();}
});

// Scenario: inline name and official corrections survive repeated scans, then a site structure change invalidates the slot. Purpose: prevent observer-driven translation loops and preserve strict structure checks.
test('InterT20_內嵌勘誤重掃穩定且原站變更還原',async t=>{
 let runtime;try{runtime=loadRuntime();}catch(e){t.skip(e.message);return;}
 const browser=await runtime.playwright.chromium.launch({executablePath:runtime.executablePath,headless:true});
 try {
  const data=displayFixture();
  for(const field of ['name','official']) {
   const text=field==='name'?'範例':'中文';
   data.skills.items[0].errata=[{locale:'zh',official:text,corrected:'修正',valueRefs:['/values/params/bonus'], sources: [{ path: 'source.lua', line: 1 }],anchor:{field,locale:'zh',text,occurrence:1}}];
   const context=await browser.newContext(); await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:detailHtml(data)}):route.abort());
   const page=await context.newPage(); await page.goto('https://darktide.gameslantern.com/abilities/example');
   for(const f of files) await page.addScriptTag({content:source(f)});
   const result=await page.evaluate(async data=>{
    const snapshot=W10SourceDataContract.validateSnapshot({current:data.current,documents:Object.fromEntries(['skills','weapons','blessings','terms'].map(k=>[k,data[k]]))});
    const adapter=W11DomAdapter.createDomAdapter({document}); let resolutions=0;
    const controller=W11DomController.createDomController({document,adapter,identityResolver:{resolve:async()=>{resolutions++;return {status:'verified',identity:snapshot.identity};}},getNativeSnapshotBytes:()=>new Uint8Array([1]),client:{initialize:async()=>({status:'ready',snapshot,identity:snapshot.identity})}});
    await controller.start(); const states=[];
    for(let i=0;i<4;i++){await controller.scan();states.push([controller.getState().status,document.querySelectorAll('mark.glat-errata-mark').length]);}
    await new Promise(resolve=>setTimeout(resolve,50)); const before=resolutions; await new Promise(resolve=>setTimeout(resolve,50)); const stable=resolutions===before;
    const unexpected=document.createElement('em'); unexpected.textContent='site'; document.querySelector('.text-lg').append(unexpected);
    await controller.scan(); const changed=[controller.getState().status,document.querySelectorAll('mark.glat-errata-mark').length];
    await controller.setEnabled(false); const restored=document.querySelectorAll('mark.glat-errata-mark').length; controller.dispose();
    return {states,stable,changed,restored};
   },data);
   assert.deepEqual(result.states,Array.from({length:4},()=>['ready',1])); assert.equal(result.stable,true); assert.deepEqual(result.changed,['original',0]); assert.equal(result.restored,0);
   await context.close();
  }
 }finally{await browser.close();}
});
