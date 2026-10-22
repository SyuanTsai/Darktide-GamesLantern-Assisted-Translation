'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const storeApi = require('../../extension/shared/snapshot-store.js');
const runtimeHelperPath = path.resolve(__dirname, 'browser-runtime.cjs');
const { loadRuntime } = require(runtimeHelperPath);

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

test('UnitT90_ExplicitBrowserRuntimeWorksWithoutTaskSiblingPathManifest', () => {
  // Scenario: Given only explicit Playwright and Chromium paths, the test helper is copied into a clean temporary checkout.
  // Purpose: Keep task-local runtime-paths.json optional so the browser suite remains runnable from a fresh clone.
  const runtime = loadRuntime();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syp-w10-runtime-clean-'));
  const helperDirectory = path.join(temporaryRoot, 'repo', 'tests', 'w10');
  fs.mkdirSync(helperDirectory, { recursive: true });
  const isolatedHelperPath = path.join(helperDirectory, 'browser-runtime.cjs');
  fs.copyFileSync(runtimeHelperPath, isolatedHelperPath);
  const pathsFile = path.resolve(helperDirectory, '..', '..', '..', 'runtime-paths.json');
  const previousPlaywrightRoot = process.env.SYP_W10_PLAYWRIGHT_ROOT;
  const previousChromium = process.env.SYP_W10_CHROMIUM_EXE;
  try {
    assert.equal(fs.existsSync(pathsFile), false, 'temporary clean checkout unexpectedly has runtime-paths.json');
    process.env.SYP_W10_PLAYWRIGHT_ROOT = runtime.playwrightRoot;
    process.env.SYP_W10_CHROMIUM_EXE = runtime.executablePath;
    const isolatedRuntime = require(isolatedHelperPath).loadRuntime();
    assert.equal(isolatedRuntime.playwrightVersion, runtime.playwrightVersion);
    assert.equal(isolatedRuntime.executablePath, runtime.executablePath);
  } finally {
    if (previousPlaywrightRoot === undefined) delete process.env.SYP_W10_PLAYWRIGHT_ROOT;
    else process.env.SYP_W10_PLAYWRIGHT_ROOT = previousPlaywrightRoot;
    if (previousChromium === undefined) delete process.env.SYP_W10_CHROMIUM_EXE;
    else process.env.SYP_W10_CHROMIUM_EXE = previousChromium;
    const temporaryBase = path.resolve(os.tmpdir());
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    if (!resolvedTemporaryRoot.startsWith(temporaryBase + path.sep)
      || !path.basename(resolvedTemporaryRoot).startsWith('syp-w10-runtime-clean-')) {
      throw new Error('Refusing to remove a path outside the named W10 runtime test directory');
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});
