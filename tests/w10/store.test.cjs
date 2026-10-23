'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const storeApi = require('../../extension/shared/snapshot-store.js');

test('UnitT10_ExportsW10StoreApiWithoutSharingTheW01Namespace', () => {
  // Scenario: Given the CommonJS consumer loads the W10 shared store module.
  // Purpose: Expose the same isolated store API used by the browser global without touching W01 storage.
  assert.equal(typeof storeApi.createSnapshotStore, 'function');
  assert.ok(storeApi.DATABASE_NAME.includes('w10'));
  assert.ok(!storeApi.DATABASE_NAME.includes('w01'));
  assert.deepEqual(Object.keys(storeApi.STORE_NAMES).sort(), ['control', 'snapshots', 'staging']);
  const store = storeApi.createSnapshotStore({ indexedDB: null });
  assert.equal(typeof store.beginCheck, 'function');
  assert.equal(typeof store.commitSnapshot, 'function');
  assert.equal(typeof store.readSnapshot, 'function');
  assert.equal(typeof store.getUpdateState, 'function');
  assert.equal(typeof store.recordCheckFailure, 'function');
  assert.equal(typeof store.recordCheckSuccess, 'function');
  assert.equal(typeof store.cleanup, 'function');
  store.close();
});

test('UnitT20_ReportsUnavailableIndexedDbInsteadOfTreatingItAsAnEmptyCache', async () => {
  // Scenario: Given no IndexedDB implementation is available on first use.
  // Purpose: Make unavailable storage an explicit failure rather than a successful empty-cache result.
  const store = storeApi.createSnapshotStore({ indexedDB: null });
  await assert.rejects(() => store.readSnapshot({ gameVersion: '9.8.7', gameReleaseId: 'fixture:w10-loader' }),
    (error) => error.code === 'IDB_UNAVAILABLE' && /IndexedDB is unavailable/.test(error.message));
  store.close();
});
