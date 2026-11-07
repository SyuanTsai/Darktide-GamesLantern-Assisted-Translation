const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const { loadRuntime } = require('./browser-runtime.cjs');
const { raw } = require('../helpers/source-data-server.cjs'); const { fixture } = require('../helpers/source-data-fixture.cjs');
// Scenario: real browser persists versions and reopens the store. Purpose: verify native IDB transaction lifetime and corruption fallback.
test('InterT10_ChromiumIndexedDB原子啟用重開與回退', async t => {
  let runtime; try { runtime = loadRuntime(); } catch (e) { t.skip(e.message); return; }
  const server = http.createServer((req,res) => {
    if (req.url === '/') { res.writeHead(200, {'content-type':'text/html'}); res.end('<!doctype html><title>W10 本機測試</title>'); return; }
    const name = req.url.slice(1); if (!['source-data-contract.js','loader.js','snapshot-store.js'].includes(name)) {res.writeHead(404);res.end();return;}
    res.writeHead(200, {'content-type':'text/javascript'}); res.end(fs.readFileSync(path.join(__dirname,'../../extension/shared',name)));
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r)); let browser;
  try {
    browser = await runtime.playwright.chromium.launch({ executablePath: runtime.executablePath, headless: true });
    const context = await browser.newContext(); await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto('http://127.0.0.1:' + server.address().port);
    for (const file of ['source-data-contract.js','loader.js','snapshot-store.js']) await page.addScriptTag({url:'/' + file});
    const encoded = version => { const r = raw(fixture(version)); return {currentBytes:[...r.currentBytes],files:Object.fromEntries(Object.entries(r.files).map(([k,b])=>[k,[...b]]))}; };
    const result = await page.evaluate(async packs => {
      const api = W10SharedSnapshotStore; let store = api.createSnapshotStore();
      for (const p of packs) await store.commitSnapshot({checkToken:await store.beginCheck(), snapshot:{currentBytes:Uint8Array.from(p.currentBytes), files:Object.fromEntries(Object.entries(p.files).map(([k,b])=>[k,Uint8Array.from(b)]))}});
      const active = await store.readSnapshot(); const old = await store.beginCheck(); const fresh = await store.beginCheck(); let stale;
      try { await store.commitSnapshot({checkToken:old,snapshot:active.snapshot}); } catch(e) {stale=e.code;}
      store.close(); store = api.createSnapshotStore(); const reopened = await store.readSnapshot();
      const db = await new Promise((resolve,reject) => {const r=indexedDB.open(api.DATABASE_NAME);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject) => {const tx=db.transaction(['control','snapshots'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        const r=tx.objectStore('control').get('source-data');r.onsuccess=()=>{const key=r.result.activeKey;const get=tx.objectStore('snapshots').get(key);get.onsuccess=()=>{const row=get.result;row.digest='0'.repeat(64);tx.objectStore('snapshots').put(row);};};});
      const fallback=await store.readSnapshot(); await store.cleanup(); store.close(); db.close();
      return {active:active.snapshot.identity.gameVersion,reopened:reopened.snapshot.identity.gameVersion,fallback:fallback.source,version:fallback.snapshot.identity.gameVersion,stale};
    }, [encoded('1.14'), encoded('1.14.1.2')]);
    assert.deepEqual(result,{active:'1.14.1.2',reopened:'1.14.1.2',fallback:'previous',version:'1.14',stale:'STALE_CHECK'});
  } finally { if(browser) await browser.close(); await new Promise(r=>server.close(r)); }
});
