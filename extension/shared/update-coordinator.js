(function (root, factory) {
  const loader = typeof module === 'object' && module.exports
    ? require('./loader.js') : root.W10SharedLoader;
  const api = factory(loader);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedUpdateCoordinator = api;
})(typeof globalThis === 'object' ? globalThis : this, function (loader) {
  'use strict';

  const SUCCESS_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_RETRY_DELAYS = Object.freeze([5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000]);
  function fail(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    throw error;
  }

  function isVerifiedSnapshot(value) { return !!value && value.snapshot && value.snapshot.identity; }

  function createUpdateCoordinator({ store, fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto,
    clock = () => Date.now(), loaderApi = loader,
    successIntervalMs = SUCCESS_INTERVAL_MS, retryDelaysMs = DEFAULT_RETRY_DELAYS } = {}) {
    if (!store || typeof store.readSnapshot !== 'function' || typeof store.beginCheck !== 'function'
      || typeof store.commitSnapshot !== 'function' || typeof store.getUpdateState !== 'function'
      || typeof store.recordCheckSuccess !== 'function' || typeof store.recordCheckFailure !== 'function') {
      fail('W10 snapshot store schedule API is required', 'DEPENDENCY_UNAVAILABLE');
    }
    if (!loaderApi || typeof loaderApi.fetchCurrent !== 'function' || typeof loaderApi.downloadSnapshot !== 'function'
      || typeof loaderApi.sameIdentity !== 'function' || typeof fetchImpl !== 'function' || typeof clock !== 'function') {
      fail('source-data dependencies are unavailable', 'INVALID_DEPENDENCY');
    }
    if (!Number.isFinite(successIntervalMs) || successIntervalMs < 1
      || !Array.isArray(retryDelaysMs) || retryDelaysMs.length === 0
      || retryDelaysMs.some((value) => !Number.isFinite(value) || value < 0)) {
      fail('W10 coordinator timing policy is invalid', 'INVALID_POLICY');
    }

    const inFlight = new Map();

    async function readCache() {
      try {
        const cached = await store.readSnapshot();
        return isVerifiedSnapshot(cached) ? cached : null;
      } catch (_) {
        return null;
      }
    }

    async function resolveResult(updateStatus, error) {
      const cached = await readCache();
      if (cached) {
        return Object.freeze({
          status: 'ready',
          source: cached.source,
          snapshot: cached.snapshot,
          identity: cached.snapshot.identity,
          updateStatus,
          error: error || null
        });
      }
      return Object.freeze({ status: 'original', source: 'original', snapshot: null, identity: null,
        updateStatus, error: error || null });
    }

    async function runCheck(schedule, now) {
      const checkToken = await store.beginCheck({ attemptAt: now });
      try {
        const index = await loaderApi.fetchCurrent({ fetchImpl });
        const before = await store.readSnapshot().catch(() => null);
        if (isVerifiedSnapshot(before) && before.source === 'active' && loaderApi.sameIdentity(before.snapshot.identity, index.current)) {
          const recorded = await store.recordCheckSuccess({
            checkToken, successAt: clock()
          });
          return { status: recorded ? 'unchanged' : 'stale' };
        }
        const downloaded = await loaderApi.downloadSnapshot({
          fetchImpl, currentBytes: index.currentBytes, cryptoApi
        });
        const completedAt = clock();
        const activated = await store.commitSnapshot({
          checkToken, snapshot: downloaded, completedAt
        });
        if (!activated || activated.source !== 'active') fail('verified W10 package was not atomically activated', 'ACTIVATION_FAILED');
        return { status: 'updated' };
      } catch (error) {
        const nextFailure = Math.min(schedule.failureCount || 0, retryDelaysMs.length - 1);
        try {
          await store.recordCheckFailure({
            checkToken,
            failedAt: clock(),
            nextRetryAt: clock() + retryDelaysMs[nextFailure]
          });
        } catch (_) {
          // A failed schedule write never changes the current cache or claims activation.
        }
        return { status: 'failed', error };
      }
    }

    async function runScheduledCheck(isManual) {
      const now = clock();
      let schedule;
      try { schedule = await store.getUpdateState(); }
      catch (error) { return { status: 'storage-unavailable', error }; }
      const initialOrOldSuccess = schedule.lastFailureAt === null
        && (schedule.lastSuccessAt === null || now - schedule.lastSuccessAt >= successIntervalMs);
      const retryDue = schedule.failureCount > 0 && (schedule.nextRetryAt === null || now >= schedule.nextRetryAt);
      if (!isManual() && !initialOrOldSuccess && !retryDue) return { status: 'not-due' };
      try { return await runCheck(schedule, now); }
      catch (error) { return { status: 'storage-unavailable', error }; }
    }

    async function getSnapshot({ active = true, manual = false } = {}) {
      if (active !== true && active !== false) fail('activity state must be boolean', 'INVALID_REQUEST');
      if (manual !== true && manual !== false) fail('manual state must be boolean', 'INVALID_REQUEST');
      if (!active) return resolveResult('inactive', null);

      const key = 'source-data';
      let entry = inFlight.get(key);
      if (!entry) {
        entry = { manual: manual === true, promise: null };
        entry.promise = runScheduledCheck(() => entry.manual);
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
      return resolveResult(update.status, update.error || null);
    }

    function inFlightCount() { return inFlight.size; }

    return Object.freeze({ getSnapshot, inFlightCount });
  }

  return Object.freeze({ SUCCESS_INTERVAL_MS, DEFAULT_RETRY_DELAYS, createUpdateCoordinator });
});
