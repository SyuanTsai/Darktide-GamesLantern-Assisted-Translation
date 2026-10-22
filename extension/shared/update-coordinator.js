(function (root, factory) {
  const loader = typeof module === 'object' && module.exports
    ? require('./loader.js') : root.W10SharedLoader;
  const api = factory(loader);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedUpdateCoordinator = api;
})(typeof globalThis === 'object' ? globalThis : this, function (loader) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_RETRY_DELAYS = Object.freeze([5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000]);
  const GAME_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

  function fail(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    throw error;
  }

  function normalizeIdentity(identity) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.keys(identity).some((key) => !['gameVersion', 'gameReleaseId', 'snapshotId'].includes(key))) {
      fail('trusted local identity is invalid', 'INVALID_IDENTITY');
    }
    if (typeof identity.gameVersion !== 'string' || !GAME_VERSION.test(identity.gameVersion)
      || typeof identity.gameReleaseId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(identity.gameReleaseId)
      || (identity.snapshotId !== undefined
        && (typeof identity.snapshotId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(identity.snapshotId)))) {
      fail('trusted local identity is invalid', 'INVALID_IDENTITY');
    }
    return Object.freeze({
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      ...(identity.snapshotId === undefined ? {} : { snapshotId: identity.snapshotId })
    });
  }

  function releaseIdentity(identity) {
    return { gameVersion: identity.gameVersion, gameReleaseId: identity.gameReleaseId };
  }

  function scopeKey(identity) {
    return JSON.stringify([identity.gameVersion, identity.gameReleaseId]);
  }

  function isVerifiedSnapshot(value) {
    return !!value && value.snapshot && value.snapshot.version && value.snapshot.release;
  }

  function createUpdateCoordinator({ store, fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto,
    clock = () => Date.now(), baselineRawProvider = async () => null, loaderApi = loader,
    successIntervalMs = DAY_MS, retryDelaysMs = DEFAULT_RETRY_DELAYS } = {}) {
    if (!store || typeof store.readSnapshot !== 'function' || typeof store.beginCheck !== 'function'
      || typeof store.commitSnapshot !== 'function' || typeof store.getUpdateState !== 'function'
      || typeof store.recordCheckSuccess !== 'function' || typeof store.recordCheckFailure !== 'function') {
      fail('W10 snapshot store schedule API is required', 'DEPENDENCY_UNAVAILABLE');
    }
    if (!loaderApi || typeof loaderApi.fetchVersionIndex !== 'function'
      || typeof loaderApi.downloadSnapshotFromVersion !== 'function'
      || typeof loaderApi.verifyStoredSnapshot !== 'function'
      || typeof loaderApi.sameReleasePointer !== 'function') {
      fail('W10 shared loader version API is required', 'DEPENDENCY_UNAVAILABLE');
    }
    if (typeof fetchImpl !== 'function' || typeof clock !== 'function' || typeof baselineRawProvider !== 'function') {
      fail('W10 update coordinator dependencies are invalid', 'INVALID_DEPENDENCY');
    }
    if (!Number.isFinite(successIntervalMs) || successIntervalMs < 1
      || !Array.isArray(retryDelaysMs) || retryDelaysMs.length === 0
      || retryDelaysMs.some((value) => !Number.isFinite(value) || value < 0)) {
      fail('W10 coordinator timing policy is invalid', 'INVALID_POLICY');
    }

    const inFlight = new Map();

    async function readCache(identity) {
      try {
        const cached = await store.readSnapshot(identity);
        return isVerifiedSnapshot(cached) ? cached : null;
      } catch (_) {
        return null;
      }
    }

    async function loadBaseline(identity) {
      try {
        const raw = await baselineRawProvider(identity);
        if (!raw) return null;
        const snapshot = await loaderApi.verifyStoredSnapshot({
          versionBytes: raw.versionBytes,
          manifestBytes: raw.manifestBytes,
          files: raw.files,
          identity,
          cryptoApi
        });
        return { source: 'baseline', snapshot };
      } catch (_) {
        return null;
      }
    }

    async function resolveResult(identity, updateStatus, error) {
      const cached = await readCache(identity);
      if (cached) {
        return Object.freeze({
          status: 'ready',
          source: cached.source,
          snapshot: cached.snapshot,
          identity,
          updateStatus,
          error: error || null
        });
      }
      const baseline = await loadBaseline(identity);
      if (baseline) {
        return Object.freeze({
          status: 'ready', source: 'baseline', snapshot: baseline.snapshot, identity,
          updateStatus, error: error || null
        });
      }
      return Object.freeze({ status: 'original', source: 'original', snapshot: null, identity,
        updateStatus, error: error || null });
    }

    async function runCheck(identity, schedule, now) {
      const localIdentity = releaseIdentity(identity);
      const checkToken = await store.beginCheck(localIdentity, { attemptAt: now });
      try {
        const index = await loaderApi.fetchVersionIndex({ fetchImpl, identity: localIdentity, cryptoApi });
        const before = await store.readSnapshot(localIdentity).catch(() => null);
        if (isVerifiedSnapshot(before) && loaderApi.sameReleasePointer(before.snapshot.release, index.release)) {
          const recorded = await store.recordCheckSuccess({
            checkToken, identity: localIdentity, successAt: clock()
          });
          return { status: recorded ? 'unchanged' : 'stale' };
        }
        const downloaded = await loaderApi.downloadSnapshotFromVersion({
          fetchImpl, identity: localIdentity, versionBytes: index.versionBytes, cryptoApi
        });
        const completedAt = clock();
        const activated = await store.commitSnapshot({
          checkToken, identity: localIdentity, snapshot: downloaded, completedAt
        });
        if (!activated || activated.source !== 'active') fail('verified W10 package was not atomically activated', 'ACTIVATION_FAILED');
        return { status: 'updated' };
      } catch (error) {
        const nextFailure = Math.min(schedule.failureCount || 0, retryDelaysMs.length - 1);
        try {
          await store.recordCheckFailure({
            checkToken,
            identity: localIdentity,
            failedAt: clock(),
            nextRetryAt: clock() + retryDelaysMs[nextFailure]
          });
        } catch (_) {
          // A failed schedule write never changes the current cache or claims activation.
        }
        return { status: 'failed', error };
      }
    }

    async function runScheduledCheck(identity, isManual) {
      const now = clock();
      let schedule;
      try { schedule = await store.getUpdateState(releaseIdentity(identity)); }
      catch (error) { return { status: 'storage-unavailable', error }; }
      const initialOrOldSuccess = schedule.lastFailureAt === null
        && (schedule.lastSuccessAt === null || now - schedule.lastSuccessAt >= successIntervalMs);
      const retryDue = schedule.failureCount > 0 && (schedule.nextRetryAt === null || now >= schedule.nextRetryAt);
      if (!isManual() && !initialOrOldSuccess && !retryDue) return { status: 'not-due' };
      try { return await runCheck(identity, schedule, now); }
      catch (error) { return { status: 'storage-unavailable', error }; }
    }

    async function getSnapshot(trustedIdentity, { active = true, manual = false } = {}) {
      const identity = normalizeIdentity(trustedIdentity);
      if (active !== true && active !== false) fail('activity state must be boolean', 'INVALID_REQUEST');
      if (manual !== true && manual !== false) fail('manual state must be boolean', 'INVALID_REQUEST');
      if (!active) return resolveResult(identity, 'inactive', null);

      const key = scopeKey(identity);
      let entry = inFlight.get(key);
      if (!entry) {
        entry = { manual: manual === true, promise: null };
        entry.promise = runScheduledCheck(identity, () => entry.manual);
        inFlight.set(key, entry);
        entry.promise.finally(() => {
          if (inFlight.get(key) === entry) inFlight.delete(key);
        }).catch(() => {});
      } else if (manual) {
        entry.manual = true;
      }

      let update;
      try { update = await entry.promise; }
      catch (error) { update = { status: 'failed', error }; }
      return resolveResult(identity, update.status, update.error || null);
    }

    function inFlightCount() { return inFlight.size; }

    return Object.freeze({ getSnapshot, inFlightCount });
  }

  return Object.freeze({ DAY_MS, DEFAULT_RETRY_DELAYS, createUpdateCoordinator });
});
