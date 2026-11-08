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
      assert.equal(snapshot.identity.gameVersion, version); assert.equal(server.requests.length, 9);
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

// Scenario: a manifest is forbidden while legacy JSON is available. Purpose: never downgrade on non-404.
test('UnitT15_manifest禁止存取不可回退', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith('.manifest.json')) return { status: 403, ok: false };
    throw new Error('legacy requested');
  };
  await assert.rejects(loader.downloadSnapshot({ ...raw(), fetchImpl, cryptoApi: webcrypto }));
  assert.match(calls[0], /skills\.manifest\.json$/);
  assert.equal(calls.length, 1);
});

// Scenario: a valid manifest describes a single file or two raw-byte shards. Purpose: preserve exact category bytes.
test('InterT11_manifest單檔與分片重組成功', async () => {
  const { transport } = require('../helpers/source-data-server.cjs');
  for (const sharded of [false, true]) {
    const data = fixture(); const t = transport(data, 'skills', sharded); const server = await localSource(data, { routes: t.routes });
    try {
      const result = await loader.downloadSnapshot({ ...server, ...raw(data), cryptoApi: webcrypto });
      assert.deepEqual(Buffer.from(result.files.skills), t.bytes);
      assert.equal(server.requests.filter(x => /skills\.part-/.test(x.url)).length, sharded ? 2 : 0);
    } finally { await server.close(); }
  }
});
// Scenario: manifests and their payloads are malformed or inconsistent. Purpose: fail closed without legacy requests.
test('InterT12_manifest與分片異常均拒絕且不回退', async () => {
  const { transport } = require('../helpers/source-data-server.cjs'); const data = fixture();
  const cases = [
    m => { m.extra = true; }, m => { m.gameVersion = '9.9'; }, m => { m.category = 'weapons'; },
    m => { m.totalBytes = 32 * 1024 * 1024 + 1; }, m => { m.parts.push({...m.parts[0]}); },
    m => { m.parts = []; }, m => { m.parts[0].index = 2; }, m => { m.parts[0].offset = 1; },
    ...['../skills.json', '/skills.json', 'skills.json?x'].map(path => m => { m.parts[0].path = path; }),
    m => { m.parts[0].sha256 = '0'.repeat(64); }, m => { m.totalSha256 = '0'.repeat(64); },
    m => { m.parts[0].sizeBytes++; m.totalBytes++; }, m => { m.parts[0].sizeBytes--; m.totalBytes--; }
  ];
  for (const mutate of cases) {
    const t = transport(data); mutate(t.manifest); t.routes['skills.manifest.json'].body = JSON.stringify(t.manifest);
    const server = await localSource(data, { routes: t.routes });
    try { await assert.rejects(loader.downloadSnapshot({ ...server, ...raw(data), cryptoApi: webcrypto }));
      assert.ok(!server.requests.some(x => /skills\.json$/.test(x.url)) || server.requests.length === 2);
    } finally { await server.close(); }
  }
  for (const route of [{status:403}, {status:500}, {status:302, headers:{location:'/elsewhere'}}, {mime:'text/html', body:'{}'}, {body:'{'}, {body:' '.repeat(65537)}]) {
    const server = await localSource(data, { routes: { 'skills.manifest.json': route } });
    try { await assert.rejects(loader.downloadSnapshot({ ...server, ...raw(data), cryptoApi: webcrypto })); assert.equal(server.requests.length, 1); }
    finally { await server.close(); }
  }
});
// Scenario: shard order, closure, payload, or later requests fail. Purpose: reject incomplete or tampered transport.
test('InterT13_分片缺失順序大小與總雜湊檢查', async () => {
  const { transport } = require('../helpers/source-data-server.cjs'); const data = fixture();
  const cases = [
    t => { delete t.routes['skills.part-0002.bin']; },
    t => { t.manifest.parts.reverse(); },
    t => { t.manifest.parts[1] = {...t.manifest.parts[0]}; },
    t => { t.manifest.parts[1].offset++; },
    t => { t.manifest.parts.push({...t.manifest.parts[1], index:3}); },
    t => { t.manifest.totalSha256 = '0'.repeat(64); },
    t => { t.routes['skills.part-0002.bin'].body = Buffer.alloc(0); },
    t => { t.routes['skills.part-0002.bin'].body = Buffer.from('xx'); },
    t => { t.routes['skills.part-0002.bin'].mime = 'application/json'; }
  ];
  for (const mutate of cases) {
    const t = transport(data, 'skills', true); mutate(t); t.routes['skills.manifest.json'].body = JSON.stringify(t.manifest);
    const server = await localSource(data, { routes:t.routes });
    try { await assert.rejects(loader.downloadSnapshot({ ...server, ...raw(data), cryptoApi:webcrypto }));
      assert.ok(!server.requests.some(x => /skills\.json$/.test(x.url)));
    } finally { await server.close(); }
  }
});
// Scenario: the second shard stalls. Purpose: cancellation and the common snapshot deadline cover part downloads.
test('UnitT16_分片途中取消或逾時', async () => {
  const { transport } = require('../helpers/source-data-server.cjs'); const data = fixture(); const t = transport(data, 'skills', true);
  for (const timeout of [false, true]) {
    const server = await localSource(data, { routes:t.routes }); const controller = new AbortController(); const original = global.setTimeout;
    const fetchImpl = (url, init) => { if (url.endsWith('part-0002.bin')) { if (!timeout) controller.abort(); return new Promise(() => {}); } return server.fetchImpl(url, init); };
    if (timeout) global.setTimeout = (fn, delay, ...args) => original(fn, delay === 30000 ? 1000 : delay, ...args);
    try { await assert.rejects(loader.downloadSnapshot({ fetchImpl, ...raw(data), signal:controller.signal, cryptoApi:webcrypto }), { code:timeout ? 'TIMEOUT' : 'ABORTED' }); }
    finally { global.setTimeout = original; await server.close(); }
  }
});
