'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { TextDecoder, TextEncoder } = require('node:util');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { createUpdateCoordinator, DAY_MS } = require('../../extension/shared/update-coordinator.js');
const { verifyStoredSnapshot } = require('../../extension/shared/loader.js');
const { ALTERNATE_SNAPSHOT_ID, makeFetch, makeResponse, makeSyntheticPackage, sha256 } = require('./package-fixtures.cjs');

const ORIGIN = 'https://darktide.tw-syuan.com';

function scope(identity) { return JSON.stringify([identity.gameVersion, identity.gameReleaseId]); }

function withContentVersion(pack, contentVersion) {
  pack.manifest.contentVersion = contentVersion;
  pack.manifestBytes = Buffer.from(JSON.stringify(pack.manifest), 'utf8');
  pack.manifestSha256 = sha256(pack.manifestBytes);
  const release = pack.version.game_releases.find((row) => row.game_version === pack.identity.gameVersion);
  release.content_version = contentVersion;
  release.manifest_sha256 = pack.manifestSha256;
  pack.version.data_revision = pack.manifest.dataRevision;
  pack.versionBytes = Buffer.from(JSON.stringify(pack.version), 'utf8');
  pack.resources.set(release.manifest_path, { bytes: pack.manifestBytes, contentType: 'application/json' });
  pack.resources.set('/version.json', { bytes: pack.versionBytes, contentType: 'application/json' });
  pack.fetchImpl = makeFetch(pack.resources);
  return pack;
}

class FakeSnapshotStore {
  constructor() { this.lines = new Map(); }

  line(identity) {
    const key = scope(identity);
    if (!this.lines.has(key)) {
      this.lines.set(key, {
        generation: 0, latest: null, active: null, previous: null,
        schedule: { lastSuccessAt: null, lastAttemptAt: null, lastFailureAt: null, failureCount: 0, nextRetryAt: null }
      });
    }
    return this.lines.get(key);
  }

  async seed(identity, pack, { lastSuccessAt = null } = {}) {
    const snapshot = await verifyStoredSnapshot({
      versionBytes: pack.versionBytes, manifestBytes: pack.manifestBytes, files: pack.rawFiles,
      identity, cryptoApi: webcrypto
    });
    const line = this.line(identity);
    line.active = { source: 'active', snapshot };
    line.schedule.lastSuccessAt = lastSuccessAt;
  }

  async readSnapshot(identity) {
    const line = this.line(identity);
    for (const candidate of [line.active, line.previous]) {
      if (!candidate) continue;
      try {
        const verified = await verifyStoredSnapshot({
          versionBytes: candidate.snapshot.versionBytes,
          manifestBytes: candidate.snapshot.manifestBytes,
          files: candidate.snapshot.files,
          identity,
          cryptoApi: webcrypto
        });
        return { source: candidate.source, snapshot: verified };
      } catch (_) { /* This fake store models raw-cache identity rejection. */ }
    }
    return null;
  }

  async getUpdateState(identity) { return { ...this.line(identity).schedule }; }

  async beginCheck(identity, { attemptAt } = {}) {
    const line = this.line(identity);
    const token = { generation: ++line.generation, expectedActive: line.active, identity: { ...identity } };
    line.latest = token;
    if (attemptAt !== undefined) line.schedule.lastAttemptAt = attemptAt;
    return token;
  }

  matches(line, token) { return line.latest === token && line.generation === token.generation; }

  async recordCheckSuccess({ checkToken, identity, successAt }) {
    const line = this.line(identity);
    if (!this.matches(line, checkToken)) return false;
    line.latest = null;
    Object.assign(line.schedule, { lastSuccessAt: successAt, lastFailureAt: null, failureCount: 0, nextRetryAt: null });
    return true;
  }

  async recordCheckFailure({ checkToken, identity, failedAt, nextRetryAt }) {
    const line = this.line(identity);
    if (!this.matches(line, checkToken)) return false;
    line.latest = null;
    Object.assign(line.schedule, {
      lastFailureAt: failedAt, failureCount: line.schedule.failureCount + 1, nextRetryAt
    });
    return true;
  }

  async commitSnapshot({ checkToken, identity, snapshot, completedAt }) {
    const line = this.line(identity);
    if (!this.matches(line, checkToken)) throw Object.assign(new Error('stale check'), { code: 'STALE_CHECK' });
    const verified = await verifyStoredSnapshot({
      versionBytes: snapshot.versionBytes, manifestBytes: snapshot.manifestBytes,
      files: snapshot.files, identity, cryptoApi: webcrypto
    });
    if (line.active && line.active.snapshot.manifestSha256 !== verified.manifestSha256) {
      line.previous = { source: 'previous', snapshot: line.active.snapshot };
    }
    line.active = { source: 'active', snapshot: verified };
    line.latest = null;
    Object.assign(line.schedule, { lastSuccessAt: completedAt, lastFailureAt: null, failureCount: 0, nextRetryAt: null });
    return { source: 'active', snapshot: verified };
  }
}

function coordinator(store, fetchImpl, clock, options = {}) {
  return createUpdateCoordinator({ store, fetchImpl, clock, cryptoApi: webcrypto, ...options });
}

test('UnitT10_UnchangedPointerUsesOneVersionRequestAndVerifiedCache', async () => {
  // Scenario: Given a verified active package and the same complete release pointer.
  // Purpose: Avoid refetching manifest/domain files when every pointer field still matches.
  const pack = makeSyntheticPackage();
  const store = new FakeSnapshotStore();
  await store.seed(pack.identity, pack);
  const result = await coordinator(store, pack.fetchImpl, () => 1000).getSnapshot(pack.identity);
  // When the first active document checks its current release.
  // Then it requests version.json once and reuses verified active raw data.
  assert.equal(result.source, 'active');
  assert.equal(result.updateStatus, 'unchanged');
  assert.equal(pack.fetchImpl.calls.length, 1);
  assert.equal(pack.fetchImpl.calls[0].url, ORIGIN + '/version.json');
});

test('UnitT11_ChangedPointerDownloadsPackageWithoutRefetchingVersionIndex', async () => {
  // Scenario: Given a cached R1 and a valid R2 pointer for the same exact game release.
  // Purpose: Reuse the validated version bytes for the changed package transfer.
  const r1 = makeSyntheticPackage();
  const r2 = makeSyntheticPackage({ mutateFileBytes(_path, bytes) { return Buffer.concat([bytes, Buffer.from(' ') ]); } });
  withContentVersion(r2, '9.8.7.2');
  const store = new FakeSnapshotStore();
  await store.seed(r1.identity, r1);
  const result = await coordinator(store, r2.fetchImpl, () => 2000).getSnapshot(r1.identity);
  // When the current pointer differs in manifest identity.
  // Then one index plus manifest and four domains are fetched and R2 becomes active.
  assert.equal(result.source, 'active');
  assert.equal(result.snapshot.manifestSha256, r2.manifestSha256);
  assert.equal(r2.fetchImpl.calls.filter((call) => new URL(call.url).pathname === '/version.json').length, 1);
  assert.equal(r2.fetchImpl.calls.length, 6);
});

test('UnitT12_PersistsTwentyFourHourAndManualScheduleAcrossCoordinatorInstances', async () => {
  // Scenario: Given an unchanged cached package and a schedule shared across worker instances.
  // Purpose: Enforce activity-driven checks without periodic polling and honor manual requests.
  const pack = makeSyntheticPackage();
  const store = new FakeSnapshotStore();
  await store.seed(pack.identity, pack);
  let now = 10_000;
  const first = coordinator(store, pack.fetchImpl, () => now);
  // Given no successful check is stored, inactivity must not start a background request.
  await first.getSnapshot(pack.identity, { active: false });
  assert.equal(pack.fetchImpl.calls.length, 0, 'inactive session polled for updates');
  // When the first document becomes active, and then a new coordinator is created before 24 hours.
  await first.getSnapshot(pack.identity);
  assert.equal(pack.fetchImpl.calls.length, 1);
  const reloaded = coordinator(store, pack.fetchImpl, () => now + DAY_MS - 1);
  await reloaded.getSnapshot(pack.identity);
  assert.equal(pack.fetchImpl.calls.length, 1, 'new coordinator forgot persisted successful check');
  // Then manual work bypasses the interval and a later coordinator observes the 24-hour deadline.
  now += 60 * 60 * 1000;
  const manual = coordinator(store, pack.fetchImpl, () => now);
  await manual.getSnapshot(pack.identity, { manual: true });
  assert.equal(pack.fetchImpl.calls.length, 2, 'manual request did not bypass daily interval');
  now = store.line(pack.identity).schedule.lastSuccessAt + DAY_MS;
  await coordinator(store, pack.fetchImpl, () => now).getSnapshot(pack.identity);
  assert.equal(pack.fetchImpl.calls.length, 3, '24-hour schedule did not trigger a new check');
});

test('UnitT13_MergesInflightReleaseCheckButValidatesEachCallersSnapshotIdentity', async () => {
  // Scenario: Given two documents on one release requesting primary and alternative snapshots together.
  // Purpose: Reserve one in-flight check before its store read settles and retain caller-specific snapshot guards.
  const pack = makeSyntheticPackage();
  const store = new FakeSnapshotStore();
  let releaseVersion;
  let requested;
  const requestedPromise = new Promise((resolve) => { requested = resolve; });
  const gate = new Promise((resolve) => { releaseVersion = resolve; });
  let releaseSchedule;
  let scheduleRequested;
  const scheduleRequestedPromise = new Promise((resolve) => { scheduleRequested = resolve; });
  const scheduleGate = new Promise((resolve) => { releaseSchedule = resolve; });
  const readSchedule = store.getUpdateState.bind(store);
  store.getUpdateState = async (identity) => {
    scheduleRequested();
    await scheduleGate;
    return readSchedule(identity);
  };
  const fetchImpl = async (input, init) => {
    if (new URL(String(input)).pathname === '/version.json') {
      requested();
      await gate;
    }
    return pack.fetchImpl(input, init);
  };
  const updater = coordinator(store, fetchImpl, () => 3000);
  const primary = updater.getSnapshot(pack.identity);
  await scheduleRequestedPromise;
  const alternative = updater.getSnapshot({ ...pack.identity, snapshotId: ALTERNATE_SNAPSHOT_ID });
  const unknown = updater.getSnapshot({ ...pack.identity, snapshotId: 'isolated-unknown-snapshot-delta' });
  releaseSchedule();
  await requestedPromise;
  releaseVersion();
  const [primaryResult, alternateResult, unknownResult] = await Promise.all([primary, alternative, unknown]);
  // When both identities join before the index response completes.
  // Then one network package is fetched and each result retains its own trusted snapshot identity.
  assert.equal(pack.fetchImpl.calls.filter((call) => new URL(call.url).pathname === '/version.json').length, 1);
  assert.equal(primaryResult.source, 'active');
  assert.equal(alternateResult.source, 'active');
  assert.equal(alternateResult.identity.snapshotId, ALTERNATE_SNAPSHOT_ID);
  assert.equal(unknownResult.source, 'original', 'shared network work bypassed an unknown caller snapshot identity');
  assert.equal(unknownResult.snapshot, null);
  assert.equal(pack.fetchImpl.calls.length, 6);
});

test('UnitT14_AppliesBoundedFailureBackoffAndRecoversWithoutLosingCachedActive', async () => {
  // Scenario: Given a valid cached package and a broken version endpoint.
  // Purpose: Preserve active data and retry only after the persisted bounded delay.
  const pack = makeSyntheticPackage();
  const store = new FakeSnapshotStore();
  await store.seed(pack.identity, pack);
  let now = 5000;
  const brokenFetch = async (input) => makeResponse(String(input), {
    status: 503, bytes: Buffer.from('upstream unavailable'), contentType: 'application/json'
  });
  const first = await coordinator(store, brokenFetch, () => now).getSnapshot(pack.identity);
  // When the first index request fails, and another active document checks before retryAt.
  assert.equal(first.source, 'active');
  assert.equal(first.updateStatus, 'failed');
  const schedule = await store.getUpdateState(pack.identity);
  assert.equal(schedule.failureCount, 1);
  assert.equal(schedule.nextRetryAt, now + 5 * 60 * 1000);
  now += 5 * 60 * 1000 - 1;
  await coordinator(store, brokenFetch, () => now).getSnapshot(pack.identity);
  assert.equal(schedule.failureCount, 1);
  // Then the retry is delayed until the stored bound, advances the bounded backoff, and preserves active.
  now += 1;
  await coordinator(store, brokenFetch, () => now).getSnapshot(pack.identity);
  const afterRetry = await store.getUpdateState(pack.identity);
  assert.equal(afterRetry.failureCount, 2);
  assert.equal(afterRetry.nextRetryAt, now + 30 * 60 * 1000);
  assert.equal((await store.readSnapshot(pack.identity)).source, 'active');
});

test('UnitT15_FallsBackFromFailedCacheReadToVerifiedBaselineThenOriginal', async () => {
  // Scenario: Given failed network checks and no compatible active cache.
  // Purpose: Keep the offline baseline validated but never persist it as an active release.
  const pack = makeSyntheticPackage();
  const store = new FakeSnapshotStore();
  const brokenFetch = async (input) => makeResponse(String(input), {
    status: 404, bytes: Buffer.from('not found'), contentType: 'text/plain'
  });
  const baseline = coordinator(store, brokenFetch, () => 7000, {
    baselineRawProvider: async () => ({ versionBytes: pack.versionBytes, manifestBytes: pack.manifestBytes, files: pack.rawFiles })
  });
  // When network is unavailable and the only package source is the validated offline baseline.
  const fallback = await baseline.getSnapshot(pack.identity);
  // Then the baseline remains uncommitted; without a baseline, the same failure yields original content.
  assert.equal(fallback.source, 'baseline');
  assert.equal(fallback.status, 'ready');
  assert.equal(store.line(pack.identity).active, null, 'baseline was written as a published active snapshot');
  const original = await coordinator(store, brokenFetch, () => 8000).getSnapshot(pack.identity);
  assert.equal(original.source, 'original');
  assert.equal(original.snapshot, null);
  assert.equal(original.status, 'original');
});

test('UnitT16_AllowsAValidLowerContentVersionForTheSameGamePatch', async () => {
  // Scenario: Given active content 9.8.7.4 and a valid same-patch pointer to 9.8.7.2.
  // Purpose: Permit a producer rollback without selecting a larger version from another patch.
  const newer = makeSyntheticPackage({ mutateFileBytes(_path, bytes) { return Buffer.concat([bytes, Buffer.from('  ') ]); } });
  withContentVersion(newer, '9.8.7.4');
  const lower = makeSyntheticPackage({ mutateFileBytes(_path, bytes) { return Buffer.concat([bytes, Buffer.from(' ') ]); } });
  withContentVersion(lower, '9.8.7.2');
  const store = new FakeSnapshotStore();
  await store.seed(newer.identity, newer);
  // When a valid same-patch version index points to a smaller content revision.
  const result = await coordinator(store, lower.fetchImpl, () => 9000).getSnapshot(lower.identity);
  // Then exact patch selection accepts the rollback rather than retaining a global maximum.
  assert.equal(result.source, 'active');
  assert.equal(result.snapshot.manifest.contentVersion, '9.8.7.2');
  assert.equal(lower.fetchImpl.calls.filter((call) => new URL(call.url).pathname === '/version.json').length, 1);
});

test('UnitT17_ExportsCoordinatorAndDocumentSessionToBrowserGlobalAndCommonJs', () => {
  // Scenario: Given the shared modules are loaded as browser scripts in dependency order.
  // Purpose: Keep extension service-worker globals aligned with the CommonJS unit-test APIs.
  const sandbox = { console, URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Map, Set, Object, Promise, Error, AbortController };
  sandbox.globalThis = sandbox;
  for (const name of ['contract.js', 'domains.js', 'loader.js', 'snapshot-store.js', 'update-coordinator.js', 'document-session.js']) {
    const sourcePath = path.resolve(__dirname, '../../extension/shared/' + name);
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: name });
  }
  // When exports are inspected through both supported loading modes.
  // Then each shared API exposes the same named functions.
  assert.deepEqual(Object.keys(sandbox.W10SharedUpdateCoordinator).sort(),
    Object.keys(require('../../extension/shared/update-coordinator.js')).sort());
  assert.deepEqual(Object.keys(sandbox.W10SharedDocumentSession).sort(),
    Object.keys(require('../../extension/shared/document-session.js')).sort());
  assert.equal(typeof sandbox.W10SharedUpdateCoordinator.createUpdateCoordinator, 'function');
  assert.equal(typeof sandbox.W10SharedDocumentSession.createDocumentSession, 'function');
});

test('UnitT18_NeverClaimsActivationWhenStorageIsUnavailableOrCommitFails', async () => {
  // Scenario: Given a valid network package but unavailable schedule storage or a failed atomic commit.
  // Purpose: Prevent UI state from claiming a package was activated before durable store success.
  const pack = makeSyntheticPackage();
  const unavailable = new FakeSnapshotStore();
  unavailable.getUpdateState = async () => { throw Object.assign(new Error('IndexedDB unavailable'), { code: 'IDB_UNAVAILABLE' }); };
  const baselineResult = await coordinator(unavailable, pack.fetchImpl, () => 11000, {
    baselineRawProvider: async () => ({ versionBytes: pack.versionBytes, manifestBytes: pack.manifestBytes, files: pack.rawFiles })
  }).getSnapshot(pack.identity);
  assert.equal(baselineResult.source, 'baseline');
  assert.equal(baselineResult.updateStatus, 'storage-unavailable');
  assert.equal(pack.fetchImpl.calls.length, 0, 'unavailable storage still started a network update');

  const failingCommit = new FakeSnapshotStore();
  failingCommit.commitSnapshot = async () => { throw Object.assign(new Error('controlled activation failure'), { code: 'IDB_ABORTED' }); };
  const failedResult = await coordinator(failingCommit, pack.fetchImpl, () => 12000).getSnapshot(pack.identity);
  assert.equal(failedResult.source, 'original');
  assert.equal(failedResult.snapshot, null);
  assert.equal(failedResult.updateStatus, 'failed');
  assert.equal(failingCommit.line(pack.identity).active, null, 'failed commit produced an active snapshot');
});
