const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path');
const { loadRuntime } = require('./browser-runtime.cjs');
const { fixture } = require('../helpers/source-data-fixture.cjs');
const { buildDevExtension } = require('../../scripts/shared/build-dev-extension.cjs');
// Scenario: an unpacked worker serves a new-format fixture to its own extension page.
// Purpose: native MV3 messaging, base64 and client revalidation work without public network access.
test('InterT10_MV3新格式訊息與client複驗', async t => {
  let runtime; try {runtime=loadRuntime();} catch(e) {t.skip(e.message);return;}
  const built=buildDevExtension({includeTestHarness:true}); const profile=path.join(built.outputRoot,'profile'); let context;
  try {
    context=await runtime.playwright.chromium.launchPersistentContext(profile,{executablePath:runtime.executablePath,headless:true,
      args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath]});
    let worker=context.serviceWorkers()[0]; if(!worker) worker=await context.waitForEvent('serviceworker');
    const extensionBase=worker.url().replace('/shared/service-worker.js','/');
    await context.route('**/*',route=>route.request().url().startsWith(extensionBase)?route.continue():route.abort());
    // Seed via the real store so the original boot coordinator can serve inactive without fetching.
    await worker.evaluate(async data=>{
      const raw=new TextEncoder();const store=W10SharedSnapshotStore.createSnapshotStore();
      await store.commitSnapshot({checkToken:await store.beginCheck(),snapshot:{currentBytes:raw.encode(JSON.stringify(data.current)),files:Object.fromEntries(['skills','weapons','blessings','terms'].map(k=>[k,raw.encode(JSON.stringify(data[k]))]))}});store.close();
    },fixture('1.14'));
    const page=await context.newPage(); await page.goto(worker.url().replace('/shared/service-worker.js','/w10-harness.html'));
    const result=await page.evaluate(async()=>{const client=W10SharedClient.createW10Client();const x=await client.initialize({active:false});return {status:x.status,source:x.source,identity:x.identity,files:Object.keys(x.snapshot.files)};});
    assert.equal(result.status,'ready');assert.equal(result.identity.gameVersion,'1.14');assert.equal(result.files.length,4);
  } finally {if(context) await context.close();}
});
