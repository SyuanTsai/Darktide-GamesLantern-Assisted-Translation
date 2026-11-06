const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { memoryIndexedDB } = require('../helpers/memory-indexeddb.cjs');
const { raw, localSource } = require('../helpers/source-data-server.cjs');
const { fixture } = require('../helpers/source-data-fixture.cjs');
const loader = require('../../extension/shared/loader.js');
const { createSnapshotStore, DATABASE_NAME } = require('../../extension/shared/snapshot-store.js');
const { createUpdateCoordinator, SUCCESS_INTERVAL_MS, DEFAULT_RETRY_DELAYS } = require('../../extension/shared/update-coordinator.js');
function setup() {
  const indexedDB = memoryIndexedDB(); const store = createSnapshotStore({ indexedDB, cryptoApi: webcrypto });
  return { indexedDB, store, db: () => indexedDB.databases.get(DATABASE_NAME) };
}
async function snapshot(version) { return loader.verifyStoredSnapshot({ ...raw(fixture(version)), cryptoApi: webcrypto }); }
async function commit(store, version) { return store.commitSnapshot({ checkToken: await store.beginCheck(), snapshot: await snapshot(version) }); }
// Scenario: two full versions arrive. Purpose: previous survives version switches; local digest detects byte corruption.
test('UnitT10_原子啟用保留previous並複驗損毀', async () => {
  const { store, indexedDB, db } = setup();
  assert.equal(DATABASE_NAME, 'darktide-w10-source-data-snapshots-v1');
  await commit(store, '1.14'); await commit(store, '1.14.1.2');
  assert.equal((await store.readSnapshot()).snapshot.identity.gameVersion, '1.14.1.2');
  assert.equal(db().maps.get('snapshots').size, 2); assert.equal(db().maps.get('staging').size, 0);
  const control = db().maps.get('control').get('source-data'); const row = db().maps.get('snapshots').get(control.activeKey);
  row.files.skills = new Uint8Array(Buffer.concat([row.files.skills, Buffer.from(' ')]));
  assert.equal((await store.readSnapshot()).source, 'previous');
  assert.equal((await store.readSnapshot()).snapshot.identity.gameVersion, '1.14');
  const previous = db().maps.get('snapshots').get(control.previousKey); previous.identity.textBatch = 'wrong';
  assert.equal(await store.readSnapshot(), null);
  assert.deepEqual([...indexedDB.databases.keys()], [DATABASE_NAME]); await store.cleanup(); store.close();
});
// Scenario: a newer generation wins while an old check is still downloading. Purpose: preserve CAS and staged isolation.
test('UnitT20_拒絕過期generation且不改active', async () => {
  const { store, db } = setup(); await commit(store, '1.14');
  const old = await store.beginCheck(); const newest = await store.beginCheck();
  await assert.rejects(store.commitSnapshot({ checkToken: old, snapshot: await snapshot('1.15') }), { code: 'STALE_CHECK' });
  assert.equal((await store.readSnapshot()).snapshot.identity.gameVersion, '1.14');
  await store.commitSnapshot({ checkToken: newest, snapshot: await snapshot('1.16') });
  assert.equal(await store.recordCheckSuccess({ checkToken: old, successAt: 1 }), false);
  assert.equal(db().maps.get('staging').size, 0); store.close();
});
// Scenario: pointer identity is unchanged, then a new version is published. Purpose: skip files and preserve atomic previous.
test('InterT30_相同識別只抓current不同識別啟用整組', async () => {
  const { store, db } = setup(); const data = fixture('1.14'); const server = await localSource(data); let now = 100;
  const coordinator = createUpdateCoordinator({ store, fetchImpl: server.fetchImpl, cryptoApi: webcrypto, clock: () => now });
  try {
    assert.equal((await coordinator.getSnapshot()).updateStatus, 'updated'); assert.equal(server.requests.length, 5);
    assert.equal((await coordinator.getSnapshot()).updateStatus, 'not-due'); assert.equal(server.requests.length, 5);
    now += SUCCESS_INTERVAL_MS;
    assert.equal((await coordinator.getSnapshot()).updateStatus, 'unchanged'); assert.equal(server.requests.length, 6);
    Object.assign(data, fixture('1.15'));
    assert.equal((await coordinator.getSnapshot({ manual: true })).snapshot.identity.gameVersion, '1.15');
    assert.equal(server.requests.length, 11); assert.equal(db().maps.get('snapshots').size, 2);
    assert.equal(SUCCESS_INTERVAL_MS, 6 * 60 * 60 * 1000);
  } finally { await server.close(); store.close(); }
});
// Scenario: failures continue without a cache. Purpose: enforce all retry delays and keep original.
test('UnitT40_失敗退避依序且手動可略過等待', async () => {
  const { store } = setup(); let now = 100; let calls = 0;
  const coordinator = createUpdateCoordinator({ store, fetchImpl: async () => { calls++; throw new Error('offline'); }, cryptoApi: webcrypto, clock: () => now });
  for (const delay of [...DEFAULT_RETRY_DELAYS, DEFAULT_RETRY_DELAYS.at(-1)]) {
    assert.equal((await coordinator.getSnapshot()).source, 'original'); const state = await store.getUpdateState();
    assert.equal(state.nextRetryAt - now, delay); const previousCalls = calls;
    assert.equal((await coordinator.getSnapshot()).updateStatus, 'not-due'); assert.equal(calls, previousCalls);
    now = state.nextRetryAt;
  }
  const previousCalls = calls; await coordinator.getSnapshot({ manual: true }); assert.equal(calls, previousCalls + 1); store.close();
});
// Scenario: any fetch contract fails with an active cache. Purpose: keep active; no cache preserves original.
test('InterT50_各種下載失敗回退active或原文', async () => {
  for (const options of [{ error: true }, { status: 404 }, { mime: 'text/html' }, { body: () => ' '.repeat(65537) }]) {
    const { store } = setup(); const server = await localSource(fixture('1.15'), options);
    const coordinator = createUpdateCoordinator({ store, fetchImpl: server.fetchImpl, cryptoApi: webcrypto });
    try {
      assert.equal((await coordinator.getSnapshot()).source, 'original'); await commit(store, '1.14');
      const result = await coordinator.getSnapshot({ manual: true }); assert.equal(result.source, 'active'); assert.equal(result.identity.gameVersion, '1.14');
    } finally { await server.close(); store.close(); }
  }
});
// Scenario: concurrent requests overlap one check. Purpose: one download and inactive reads do not trigger fetch.
test('InterT60_合併inflight且inactive不抓取', async () => {
  const { store } = setup(); const server = await localSource();
  const coordinator = createUpdateCoordinator({ store, fetchImpl: server.fetchImpl, cryptoApi: webcrypto });
  try {
    assert.equal((await coordinator.getSnapshot({ active: false })).source, 'original'); assert.equal(server.requests.length, 0);
    const results = await Promise.all([coordinator.getSnapshot(), coordinator.getSnapshot({ manual: true }), coordinator.getSnapshot()]);
    assert.ok(results.every(x => x.status === 'ready')); assert.equal(server.requests.length, 5); assert.equal(coordinator.inFlightCount(), 0);
  } finally { await server.close(); store.close(); }
});
// Scenario: activation transaction aborts after staging. Purpose: active/previous pointers and bytes stay atomic.
test('UnitT70_啟用交易失敗保留active並清除staging', async () => {
  const { store, db } = setup(); await commit(store, '1.14');
  const original = db().transaction;
  db().transaction = function(names, mode) {
    const tx = original.call(this, names, mode);
    if (Array.isArray(names) && names.includes('snapshots') && mode === 'readwrite') {
      const getStore = tx.objectStore.bind(tx);
      tx.objectStore = k => { const s = getStore(k); if (k === 'snapshots') s.put = () => { throw new Error('simulated disk full'); }; return s; };
    }
    return tx;
  };
  await assert.rejects(commit(store, '1.15'), error => error.code === 'IDB_TRANSACTION_FAILED' && error.cause.message === 'simulated disk full');
  assert.equal((await store.readSnapshot()).snapshot.identity.gameVersion, '1.14');
  assert.equal(db().maps.get('staging').size, 0); db().transaction = original; store.close();
});
// Scenario: transport hangs with and without active data. Purpose: timeout returns fallback rather than adopting any new bytes.
test('UnitT80_逾時依序回退active_previous_original', async () => {
  const { store, db } = setup(); const coordinator = createUpdateCoordinator({ store, fetchImpl: () => new Promise(() => {}), cryptoApi: webcrypto });
  const original = global.setTimeout; global.setTimeout = (fn, delay, ...args) => original(fn, delay === 30000 ? 5 : delay, ...args);
  try {
    assert.equal((await coordinator.getSnapshot({ manual: true })).source, 'original');
    await commit(store, '1.14'); await commit(store, '1.15');
    assert.equal((await coordinator.getSnapshot({ manual: true })).source, 'active');
    const control = db().maps.get('control').get('source-data'); db().maps.get('snapshots').get(control.activeKey).digest = 'bad';
    assert.equal((await coordinator.getSnapshot({ manual: true })).source, 'previous');
  } finally { global.setTimeout = original; store.close(); }
});
// Scenario: same game version gets a new source commit or text batch. Purpose: detect same-version publication changes.
test('InterT90_同版sourceCommit與textBatch改變會重新下載', async () => {
  const { store } = setup(); const data = fixture('1.14'); const server = await localSource(data);
  const coordinator = createUpdateCoordinator({ store, fetchImpl: server.fetchImpl, cryptoApi: webcrypto });
  try {
    await coordinator.getSnapshot(); let expected = 5;
    for (const [field, value] of [['sourceCommit', 'a'.repeat(40)], ['textBatch', 'next-batch']]) {
      for (const document of Object.values(data)) document[field] = value;
      const result = await coordinator.getSnapshot({ manual: true }); expected += 5;
      assert.equal(result.updateStatus, 'updated'); assert.equal(result.identity[field], value); assert.equal(server.requests.length, expected);
    }
  } finally { await server.close(); store.close(); }
});
