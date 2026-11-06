const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const loader = require('../../extension/shared/loader.js');
const { fixture } = require('../helpers/source-data-fixture.cjs');
const { localSource, raw } = require('../helpers/source-data-server.cjs');
// Scenario: current points at a complete local set. Purpose: fixed URL and revalidation contract.
test('InterT10_下載五檔並保留請求防護', async () => {
  for (const version of ['1.13.4', '1.14', '1.13.4.1']) {
    const server = await localSource(fixture(version));
    try {
      const current = await loader.fetchCurrent(server);
      const snapshot = await loader.downloadSnapshot({ ...server, ...current, cryptoApi: webcrypto });
      assert.equal(snapshot.identity.gameVersion, version); assert.equal(server.requests.length, 5);
      assert.ok(Object.isFrozen(snapshot.documents.skills));
      for (const { url, init } of server.requests) {
        assert.ok(url.includes('/source-data/')); assert.equal(init.cache, 'no-cache'); assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error'); assert.equal(init.mode, 'cors');
      }
      assert.match(snapshot.digest, /^[a-f0-9]{64}$/);
    } finally { await server.close(); }
  }
});
// Scenario: HTTP contract fails. Purpose: no partial snapshot is returned.
test('InterT20_拒絕網路狀態MIME及最終URL錯誤', async () => {
  for (const options of [{ error: true }, { status: 404 }, { mime: 'text/html' }, { finalUrl: 'https://elsewhere.invalid/' }]) {
    const server = await localSource(fixture(), options);
    try { await assert.rejects(loader.fetchCurrent(server)); } finally { await server.close(); }
  }
});
// Scenario: persisted bytes are not valid JSON UTF-8 or exceed limits. Purpose: fail closed before decode.
test('UnitT30_拒絕BOM無效UTF8與位元組超限', async () => {
  for (const bytes of [Uint8Array.of(239,187,191,123,125), Uint8Array.of(0xff), new Uint8Array(65537)]) {
    await assert.rejects(loader.verifyStoredSnapshot({ ...raw(), currentBytes: bytes, cryptoApi: webcrypto }));
  }
  const large = new Uint8Array(32 * 1024 * 1024 + 1);
  await assert.rejects(loader.verifyStoredSnapshot({ ...raw(), files: { ...raw().files, skills: large }, cryptoApi: webcrypto }));
  const half = new Uint8Array(32 * 1024 * 1024);
  await assert.rejects(loader.verifyStoredSnapshot({ ...raw(), files: { ...raw().files, skills: half, weapons: half }, cryptoApi: webcrypto }));
});
// Scenario: any category identity changes. Purpose: reject mixed releases atomically.
test('UnitT40_跨檔四欄識別全部核對', async () => {
  for (const category of ['skills','weapons','blessings','terms']) for (const field of ['gameVersion','sourceCommit','textBatch','schemaVersion']) {
    const data = fixture(); data[category][field] = field === 'sourceCommit' ? 'a'.repeat(40) : '9.9';
    await assert.rejects(loader.verifyStoredSnapshot({ ...raw(data), cryptoApi: webcrypto }));
  }
});
// Scenario: a fetch never resolves or is cancelled. Purpose: bounded lifetime even for uncooperative transport.
test('UnitT50_逾時與取消不產生快照', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(loader.fetchCurrent({ fetchImpl: () => new Promise(() => {}), signal }), { code: 'ABORTED' });
  const original = global.setTimeout;
  global.setTimeout = (fn, delay, ...args) => original(fn, delay === 30000 ? 5 : delay, ...args);
  try { await assert.rejects(loader.fetchCurrent({ fetchImpl: () => new Promise(() => {}) }), { code: 'TIMEOUT' }); }
  finally { global.setTimeout = original; }
});
// Scenario: a stream exceeds the current limit. Purpose: reject during streaming, not after full buffering.
test('InterT60_串流超限整組拒絕', async () => {
  const server = await localSource(fixture(), { body: () => ' '.repeat(65537) });
  try { await assert.rejects(loader.fetchCurrent(server)); } finally { await server.close(); }
});
