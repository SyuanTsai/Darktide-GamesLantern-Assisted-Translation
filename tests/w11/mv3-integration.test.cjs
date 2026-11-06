const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {loadRuntime}=require('../w10/browser-runtime.cjs');const {displayFixture}=require('../helpers/source-data-display.cjs');const {detailHtml}=require('../helpers/source-data-browser.cjs');
const {buildDevExtension}=require('../../scripts/shared/build-dev-extension.cjs');
// Scenario: a real MV3 worker serves a validated display fixture to an offline native page. Purpose: production resolver works without test proofs or fixed release pins.
test('InterT10_MV3新快照自動顯示與版本標示',async t=>{
 let runtime;try{runtime=loadRuntime();}catch(e){t.skip(e.message);return;}
 const built=buildDevExtension();let context;
 try{
  context=await runtime.playwright.chromium.launchPersistentContext(path.join(built.outputRoot,'profile'),{executablePath:runtime.executablePath,headless:true,args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath]});
  const data=displayFixture();
  await context.route('**/*',route=>route.request().url()==='https://darktide.gameslantern.com/abilities/example'?route.fulfill({contentType:'text/html',body:detailHtml(data)}):route.abort());
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
  await worker.evaluate(async data=>{
   globalThis.fetch=async()=>{throw new Error('isolated offline fixture');};
   const encode=x=>new TextEncoder().encode(JSON.stringify(x));const store=W10SharedSnapshotStore.createSnapshotStore();
   await store.commitSnapshot({checkToken:await store.beginCheck(),snapshot:{currentBytes:encode(data.current),files:Object.fromEntries(['skills','weapons','blessings','terms'].map(k=>[k,encode(data[k])]))}});store.close();
  },data);
  const page=await context.newPage();await page.goto('https://darktide.gameslantern.com/abilities/example');
  await page.waitForFunction(()=>document.querySelector('.text-lg')?.textContent==='範例');
  const text=await page.locator('[data-w11-owned="controls"]').textContent();assert.match(text,/9\.8\.7／0000000／example-batch/);
  await page.getByRole('button',{name:'切回原文',exact:true}).click();assert.equal(await page.locator('.text-lg').textContent(),'Example');
 }finally{if(context)await context.close();}
});
