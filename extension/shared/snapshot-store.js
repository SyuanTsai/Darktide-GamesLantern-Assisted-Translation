(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./loader.js'));
  } else {
    root.W10SharedSnapshotStore = factory(root.W10SharedLoader);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (loader) {
  'use strict';

  const DATABASE_NAME = 'darktide-w10-source-data-snapshots-v1';
  const DATABASE_VERSION = 1;
  const STORE_NAMES = Object.freeze({
    control: 'control',
    snapshots: 'snapshots',
    staging: 'staging'
  });
  function makeError(message, code, cause) {
    const error = new Error(message);
    if (code) error.code = code;
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  function fail(message, code) {
    throw makeError(message, code);
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // All versions share one atomic active/previous scope. No caller-supplied game identity.
  function normalizeIdentity() { return 'source-data'; }
  function scopeKey() { return 'source-data'; }
  function sameScope(a, b) { return a === 'source-data' && b === 'source-data'; }
  function sameIdentity(a, b) { return sameScope(a, b); }

  function normalizeCheckToken(checkToken, identity) {
    if (!isRecord(checkToken) || !Number.isSafeInteger(checkToken.generation) || checkToken.generation < 1
      || !(checkToken.expectedActiveKey === null || typeof checkToken.expectedActiveKey === 'string')) {
      fail('check token is malformed', 'INVALID_CHECK');
    }
    const tokenIdentity = checkToken.identity;
    if (!sameIdentity(tokenIdentity, identity)) fail('check token identity differs from the source-data scope', 'INVALID_CHECK');
    return Object.freeze({
      generation: checkToken.generation,
      expectedActiveKey: checkToken.expectedActiveKey,
      identity: tokenIdentity
    });
  }

  function newState(identity) {
    return {
      id: scopeKey(identity),
      generation: 0,
      latestCheck: null,
      activeKey: null,
      previousKey: null,
      updateSchedule: newUpdateSchedule()
    };
  }

  function newUpdateSchedule() {
    return { lastSuccessAt: null, lastAttemptAt: null, lastFailureAt: null, failureCount: 0, nextRetryAt: null };
  }

  function normalizeTime(value, label) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      fail('W10 update schedule ' + label + ' is corrupt', 'IDB_CORRUPT');
    }
    return value;
  }

  function normalizeUpdateSchedule(value) {
    if (value === undefined) return newUpdateSchedule();
    if (!isRecord(value) || Object.keys(value).some((key) => ![
      'lastSuccessAt', 'lastAttemptAt', 'lastFailureAt', 'failureCount', 'nextRetryAt'
    ].includes(key)) || !Number.isSafeInteger(value.failureCount) || value.failureCount < 0) {
      fail('W10 update schedule is corrupt', 'IDB_CORRUPT');
    }
    return {
      lastSuccessAt: normalizeTime(value.lastSuccessAt, 'lastSuccessAt'),
      lastAttemptAt: normalizeTime(value.lastAttemptAt, 'lastAttemptAt'),
      lastFailureAt: normalizeTime(value.lastFailureAt, 'lastFailureAt'),
      failureCount: value.failureCount,
      nextRetryAt: normalizeTime(value.nextRetryAt, 'nextRetryAt')
    };
  }

  function normalizeTimestamp(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      fail(label + ' must be a non-negative finite timestamp', 'INVALID_SCHEDULE');
    }
    return value;
  }

  function normalizeState(value, identity) {
    if (value === undefined) return newState(identity);
    if (!isRecord(value) || value.id !== scopeKey(identity)
      || !Number.isSafeInteger(value.generation) || value.generation < 0
      || !(value.activeKey === null || typeof value.activeKey === 'string')
      || !(value.previousKey === null || typeof value.previousKey === 'string')) {
      fail('W10 IndexedDB control record is corrupt', 'IDB_CORRUPT');
    }
    if (value.latestCheck !== null) {
      if (!isRecord(value.latestCheck) || value.latestCheck.generation !== value.generation
        || !(value.latestCheck.expectedActiveKey === null || typeof value.latestCheck.expectedActiveKey === 'string')) {
        fail('W10 IndexedDB check generation is corrupt', 'IDB_CORRUPT');
      }
      if (!sameScope(value.latestCheck.identity, identity)) {
        fail('W10 IndexedDB check identity is in the wrong release scope', 'IDB_CORRUPT');
      }
      if (typeof value.latestCheck.expectedActiveKey === 'string'
        && !snapshotKeyBelongsToScope(value.latestCheck.expectedActiveKey, identity)) {
        fail('W10 IndexedDB check pointer crosses release scopes', 'IDB_CORRUPT');
      }
    }
    if ((typeof value.activeKey === 'string' && !snapshotKeyBelongsToScope(value.activeKey, identity))
      || (typeof value.previousKey === 'string' && !snapshotKeyBelongsToScope(value.previousKey, identity))) {
      fail('W10 IndexedDB snapshot pointer crosses release scopes', 'IDB_CORRUPT');
    }
    return {
      id: scopeKey(identity),
      generation: value.generation,
      latestCheck: value.latestCheck ? {
        generation: value.latestCheck.generation,
        expectedActiveKey: value.latestCheck.expectedActiveKey,
        identity: value.latestCheck.identity
      } : null,
      activeKey: value.activeKey,
      previousKey: value.previousKey,
      updateSchedule: normalizeUpdateSchedule(value.updateSchedule)
    };
  }

  function checkMatches(state, token, identity) {
    return state.latestCheck !== null
      && state.latestCheck.generation === token.generation
      && state.generation === token.generation
      && state.activeKey === token.expectedActiveKey
      && state.latestCheck.expectedActiveKey === token.expectedActiveKey
      && sameIdentity(state.latestCheck.identity, identity)
      && sameIdentity(token.identity, identity);
  }

  function snapshotKey(identity, digest) {
    return JSON.stringify(['source-data', identity.gameVersion, identity.sourceCommit, identity.textBatch, digest]);
  }
  function stagingKey(token, digest) { return JSON.stringify(['source-data', token.generation, digest]); }
  function snapshotKeyBelongsToScope(key) {
    try {
      const p = JSON.parse(key);
      return p.length === 5 && p[0] === 'source-data' && /^[0-9]+(\.[0-9]+){1,3}$/.test(p[1])
        && /^[a-fA-F0-9]{40}$/.test(p[2]) && /^[A-Za-z0-9._-]{1,128}$/.test(p[3]) && /^[a-f0-9]{64}$/.test(p[4]);
    } catch (_) { return false; }
  }
  function stagingKeyBelongsToScope(key) { return parseStagingKey(key) !== null; }
  function parseStagingKey(key) {
    try { const p = JSON.parse(key); return p.length === 3 && p[0] === 'source-data' && Number.isSafeInteger(p[1])
      ? { scopeId: p[0], generation: p[1] } : null; } catch (_) { return null; }
  }

  function bytes(value, label) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    fail(label + ' must be raw bytes');
  }

  function copyVerifiedSnapshot(verified, key) {
    return { snapshotKey: key, identity: { ...verified.identity }, digest: verified.digest,
      currentBytes: bytes(verified.currentBytes, 'current'),
      files: Object.fromEntries(Object.entries(verified.files).map(([k, raw]) => [k, bytes(raw, k)])) };
  }

  function requestResult(request) {
    return request.result;
  }

  function runTransaction(db, storeNames, mode, label, start) {
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure = null;
      try {
        transaction = db.transaction(storeNames, mode);
      } catch (error) {
        reject(makeError(label + ' transaction could not start', 'IDB_UNAVAILABLE', error));
        return;
      }
      transaction.oncomplete = () => {
        if (failure) reject(failure);
        else resolve(result);
      };
      transaction.onerror = () => {
        if (!failure) failure = makeError(label + ' transaction failed', 'IDB_TRANSACTION_FAILED', transaction.error);
      };
      transaction.onabort = () => {
        reject(failure || makeError(label + ' transaction aborted', 'IDB_ABORTED', transaction.error));
      };
      const context = {
        setResult(value) { result = value; },
        abort(error) {
          failure = error instanceof Error ? error : makeError(String(error), 'IDB_TRANSACTION_FAILED');
          try { transaction.abort(); } catch (_) { reject(failure); }
        }
      };
      try {
        start(transaction, context);
      } catch (error) {
        context.abort(error);
      }
    });
  }

  function requestFailure(request, transaction, context, label) {
    request.onerror = () => context.abort(makeError(label + ' request failed', 'IDB_TRANSACTION_FAILED', request.error));
  }

  function createSnapshotStore({ indexedDB = globalThis.indexedDB, cryptoApi = globalThis.crypto } = {}) {
    if (!loader || typeof loader.verifyStoredSnapshot !== 'function') {
      fail('W10 shared loader is required before the snapshot store', 'DEPENDENCY_UNAVAILABLE');
    }
    let openPromise = null;
    let database = null;

    function openDatabase() {
      if (!indexedDB || typeof indexedDB.open !== 'function') {
        return Promise.reject(makeError('IndexedDB is unavailable for the W10 snapshot store', 'IDB_UNAVAILABLE'));
      }
      if (database) return Promise.resolve(database);
      if (openPromise) return openPromise;
      openPromise = new Promise((resolve, reject) => {
        let request;
        try {
          request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        } catch (error) {
          reject(makeError('W10 IndexedDB could not be opened', 'IDB_UNAVAILABLE', error));
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAMES.control)) {
            db.createObjectStore(STORE_NAMES.control, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.snapshots)) {
            db.createObjectStore(STORE_NAMES.snapshots, { keyPath: 'snapshotKey' });
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.staging)) {
            db.createObjectStore(STORE_NAMES.staging, { keyPath: 'stageKey' });
          }
        };
        request.onblocked = () => reject(makeError('W10 IndexedDB upgrade is blocked by another connection', 'IDB_BLOCKED'));
        request.onerror = () => reject(makeError('W10 IndexedDB could not be opened', 'IDB_UNAVAILABLE', request.error));
        request.onsuccess = () => {
          database = request.result;
          database.onversionchange = () => {
            database.close();
            database = null;
            openPromise = null;
          };
          resolve(database);
        };
      }).catch((error) => {
        openPromise = null;
        throw error;
      });
      return openPromise;
    }

    function close() {
      if (database) database.close();
      database = null;
      openPromise = null;
    }

    async function beginCheck({ attemptAt } = {}) {
      const identity = normalizeIdentity();
      const startedAt = attemptAt === undefined ? null : normalizeTimestamp(attemptAt, 'attemptAt');
      const db = await openDatabase();
      return runTransaction(db, [STORE_NAMES.control, STORE_NAMES.staging], 'readwrite', 'begin check', (transaction, context) => {
        const control = transaction.objectStore(STORE_NAMES.control);
        const staging = transaction.objectStore(STORE_NAMES.staging);
        const get = control.get(scopeKey(identity));
        requestFailure(get, transaction, context, 'read check state');
        get.onsuccess = () => {
          try {
            const state = normalizeState(requestResult(get), identity);
            const generation = state.generation + 1;
            if (!Number.isSafeInteger(generation)) fail('W10 check generation limit was reached', 'GENERATION_EXHAUSTED');
            const token = Object.freeze({ generation, expectedActiveKey: state.activeKey, identity });
            state.generation = generation;
            state.latestCheck = token;
            if (startedAt !== null) state.updateSchedule.lastAttemptAt = startedAt;
            control.put(state);
            const keys = staging.getAllKeys();
            requestFailure(keys, transaction, context, 'list staging rows');
            keys.onsuccess = () => {
              for (const key of requestResult(keys)) {
                if (stagingKeyBelongsToScope(key, identity)) staging.delete(key);
              }
              context.setResult(token);
            };
          } catch (error) {
            context.abort(error);
          }
        };
      });
    }

    async function getUpdateState() {
      const identity = normalizeIdentity();
      const db = await openDatabase();
      return runTransaction(db, STORE_NAMES.control, 'readonly', 'read update schedule', (transaction, context) => {
        const get = transaction.objectStore(STORE_NAMES.control).get(scopeKey(identity));
        requestFailure(get, transaction, context, 'read update schedule');
        get.onsuccess = () => {
          try { context.setResult(normalizeState(requestResult(get), identity).updateSchedule); }
          catch (error) { context.abort(error); }
        };
      });
    }

    async function recordCheckSuccess({ checkToken, successAt } = {}) {
      const identity = normalizeIdentity();
      const token = normalizeCheckToken(checkToken, identity);
      const completedAt = normalizeTimestamp(successAt, 'successAt');
      const db = await openDatabase();
      return runTransaction(db, STORE_NAMES.control, 'readwrite', 'record update success', (transaction, context) => {
        const control = transaction.objectStore(STORE_NAMES.control);
        const get = control.get(scopeKey(identity));
        requestFailure(get, transaction, context, 'read update state for success');
        get.onsuccess = () => {
          try {
            const state = normalizeState(requestResult(get), identity);
            if (!checkMatches(state, token, identity)) return context.setResult(false);
            state.latestCheck = null;
            state.updateSchedule = {
              lastSuccessAt: completedAt,
              lastAttemptAt: state.updateSchedule.lastAttemptAt,
              lastFailureAt: null,
              failureCount: 0,
              nextRetryAt: null
            };
            control.put(state);
            context.setResult(true);
          } catch (error) { context.abort(error); }
        };
      });
    }

    async function recordCheckFailure({ checkToken, failedAt, nextRetryAt } = {}) {
      const identity = normalizeIdentity();
      const token = normalizeCheckToken(checkToken, identity);
      const completedAt = normalizeTimestamp(failedAt, 'failedAt');
      const retryAt = normalizeTimestamp(nextRetryAt, 'nextRetryAt');
      const db = await openDatabase();
      return runTransaction(db, STORE_NAMES.control, 'readwrite', 'record update failure', (transaction, context) => {
        const control = transaction.objectStore(STORE_NAMES.control);
        const get = control.get(scopeKey(identity));
        requestFailure(get, transaction, context, 'read update state for failure');
        get.onsuccess = () => {
          try {
            const state = normalizeState(requestResult(get), identity);
            if (!checkMatches(state, token, identity)) return context.setResult(false);
            state.latestCheck = null;
            state.updateSchedule = {
              lastSuccessAt: state.updateSchedule.lastSuccessAt,
              lastAttemptAt: state.updateSchedule.lastAttemptAt,
              lastFailureAt: completedAt,
              failureCount: Math.min(Number.MAX_SAFE_INTEGER, state.updateSchedule.failureCount + 1),
              nextRetryAt: retryAt
            };
            control.put(state);
            context.setResult(true);
          } catch (error) { context.abort(error); }
        };
      });
    }

    async function inspectValidPointers(identity) {
      const db = await openDatabase();
      const state = await runTransaction(db, STORE_NAMES.control, 'readonly', 'read snapshot pointers', (transaction, context) => {
        const get = transaction.objectStore(STORE_NAMES.control).get(scopeKey(identity));
        requestFailure(get, transaction, context, 'read snapshot pointers');
        get.onsuccess = () => {
          try { context.setResult(normalizeState(requestResult(get), identity)); }
          catch (error) { context.abort(error); }
        };
      });
      const candidates = [];
      for (const [source, key] of [['active', state.activeKey], ['previous', state.previousKey]]) {
        if (typeof key !== 'string' || candidates.some((candidate) => candidate.snapshotKey === key)) continue;
        const record = await runTransaction(db, STORE_NAMES.snapshots, 'readonly', 'read ' + source + ' snapshot', (transaction, context) => {
          const get = transaction.objectStore(STORE_NAMES.snapshots).get(key);
          requestFailure(get, transaction, context, 'read ' + source + ' snapshot');
          get.onsuccess = () => context.setResult(requestResult(get));
        });
        if (!record) continue;
        try {
          const verified = await loader.verifyStoredSnapshot({ currentBytes: record.currentBytes, files: record.files, cryptoApi });
          const expectedKey = snapshotKey(verified.identity, verified.digest);
          if (expectedKey !== key || record.snapshotKey !== key || record.digest !== verified.digest
            || !loader.sameIdentity(record.identity, verified.identity)) continue;
          candidates.push({ source, snapshotKey: key, snapshot: verified });
        } catch (_) {
          // Stored identity and parsed values are untrusted; invalid active data can fall back to previous.
        }
      }
      return { state, active: candidates.find((candidate) => candidate.source === 'active') ?? null,
        previous: candidates.find((candidate) => candidate.source === 'previous') ?? null };
    }

    async function readSnapshot() {
      const identity = normalizeIdentity();
      const pointers = await inspectValidPointers(identity);
      return pointers.active || pointers.previous || null;
    }

    async function stageSnapshot(snapshot, identity, token) {
      const verified = await loader.verifyStoredSnapshot({ currentBytes: snapshot && snapshot.currentBytes,
        files: snapshot && snapshot.files, cryptoApi });
      const key = snapshotKey(verified.identity, verified.digest);
      const stageKey = stagingKey(token, verified.digest);
      const record = copyVerifiedSnapshot(verified, key);
      record.stageKey = stageKey;
      record.generation = token.generation;
      const db = await openDatabase();
      await runTransaction(db, [STORE_NAMES.control, STORE_NAMES.staging], 'readwrite', 'stage snapshot', (transaction, context) => {
        const control = transaction.objectStore(STORE_NAMES.control);
        const stateRequest = control.get(scopeKey(identity));
        requestFailure(stateRequest, transaction, context, 'read check generation');
        stateRequest.onsuccess = () => {
          try {
            const state = normalizeState(requestResult(stateRequest), identity);
            if (!checkMatches(state, token, identity)) fail('snapshot check is stale or active state changed', 'STALE_CHECK');
            transaction.objectStore(STORE_NAMES.staging).put(record);
            context.setResult(true);
          } catch (error) {
            context.abort(error);
          }
        };
      });
      return { key, stageKey, record, verified };
    }

    async function activateStaged(staged, identity, token, validPointers, committedAt) {
      const db = await openDatabase();
      return runTransaction(db, [STORE_NAMES.control, STORE_NAMES.snapshots, STORE_NAMES.staging], 'readwrite',
        'activate snapshot', (transaction, context) => {
          const control = transaction.objectStore(STORE_NAMES.control);
          const snapshots = transaction.objectStore(STORE_NAMES.snapshots);
          const staging = transaction.objectStore(STORE_NAMES.staging);
          const stateRequest = control.get(scopeKey(identity));
          requestFailure(stateRequest, transaction, context, 'read activation state');
          stateRequest.onsuccess = () => {
            try {
              const state = normalizeState(requestResult(stateRequest), identity);
              if (!checkMatches(state, token, identity)) fail('snapshot check is stale or active state changed', 'STALE_CHECK');
              const stagedRequest = staging.get(staged.stageKey);
              requestFailure(stagedRequest, transaction, context, 'read staged snapshot');
              stagedRequest.onsuccess = () => {
                try {
                  if (requestResult(stagedRequest) === undefined) fail('staged snapshot is missing', 'IDB_CORRUPT');
                  // The staging row is only an existence check. Its raw bytes and metadata are untrusted.
                  const record = staged.record;
                  if (!record || record.snapshotKey !== staged.key || staged.stageKey !== stagingKey(token, record.digest)) {
                    fail('verified in-memory staged snapshot is inconsistent', 'IDB_CORRUPT');
                  }
                  const newestKey = staged.key;
                  let previousKey = null;
                  if (state.activeKey !== newestKey && validPointers.active
                    && validPointers.active.snapshotKey === state.activeKey) {
                    previousKey = state.activeKey;
                  } else if (validPointers.previous && validPointers.previous.snapshotKey !== newestKey
                    && validPointers.previous.snapshotKey === state.previousKey) {
                    previousKey = state.previousKey;
                  }
                  const keyList = snapshots.getAllKeys();
                  requestFailure(keyList, transaction, context, 'list stored snapshots');
                  keyList.onsuccess = () => {
                    snapshots.put(copyVerifiedSnapshot(staged.verified, staged.key));
                    for (const existingKey of requestResult(keyList)) {
                      if (snapshotKeyBelongsToScope(existingKey, identity)
                        && existingKey !== newestKey && existingKey !== previousKey) snapshots.delete(existingKey);
                    }
                    state.activeKey = newestKey;
                    state.previousKey = previousKey;
                    state.latestCheck = null;
                    if (committedAt !== null) {
                      state.updateSchedule = {
                        lastSuccessAt: committedAt,
                        lastAttemptAt: state.updateSchedule.lastAttemptAt,
                        lastFailureAt: null,
                        failureCount: 0,
                        nextRetryAt: null
                      };
                    }
                    control.put(state);
                    staging.delete(staged.stageKey);
                    const oldStages = staging.getAllKeys();
                    requestFailure(oldStages, transaction, context, 'list completed staging rows');
                    oldStages.onsuccess = () => {
                      for (const key of requestResult(oldStages)) {
                        if (stagingKeyBelongsToScope(key, identity)) staging.delete(key);
                      }
                      context.setResult({
                        source: 'active',
                        snapshotKey: newestKey,
                        snapshot: staged.verified
                      });
                    };
                  };
                } catch (error) {
                  context.abort(error);
                }
              };
            } catch (error) {
              context.abort(error);
            }
          };
        });
    }

    async function deleteStaging(stageKey) {
      try {
        const db = await openDatabase();
        await runTransaction(db, STORE_NAMES.staging, 'readwrite', 'remove failed staging row', (transaction, context) => {
          transaction.objectStore(STORE_NAMES.staging).delete(stageKey);
          context.setResult(true);
        });
      } catch (_) {
        // A failed cleanup must not conceal the original validation or activation failure.
      }
    }

    async function commitSnapshot({ checkToken, snapshot, completedAt } = {}) {
      const identity = normalizeIdentity();
      const token = normalizeCheckToken(checkToken, identity);
      const committedAt = completedAt === undefined ? null : normalizeTimestamp(completedAt, 'completedAt');
      const staged = await stageSnapshot(snapshot, identity, token);
      try {
        const validPointers = await inspectValidPointers(identity);
        return await activateStaged(staged, identity, token, validPointers, committedAt);
      } catch (error) {
        await deleteStaging(staged.stageKey);
        throw error;
      }
    }

    async function cleanup() {
      const db = await openDatabase();
      return runTransaction(db, [STORE_NAMES.control, STORE_NAMES.snapshots, STORE_NAMES.staging], 'readwrite', 'cleanup snapshot store',
        (transaction, context) => {
          const control = transaction.objectStore(STORE_NAMES.control);
          const controlsRequest = control.getAll();
          requestFailure(controlsRequest, transaction, context, 'read cleanup states');
          controlsRequest.onsuccess = () => {
            try {
              const snapshots = transaction.objectStore(STORE_NAMES.snapshots);
              const staging = transaction.objectStore(STORE_NAMES.staging);
              const snapshotKeys = snapshots.getAllKeys();
              const stagingKeys = staging.getAllKeys();
              requestFailure(snapshotKeys, transaction, context, 'list snapshots for cleanup');
              requestFailure(stagingKeys, transaction, context, 'list staging for cleanup');
              let snapshotsReady = false;
              let stagingReady = false;
              const applyCleanup = () => {
                if (!snapshotsReady || !stagingReady) return;
                try {
                  const statesByScope = new Map();
                  const protectedSnapshots = new Set();
                  for (const row of requestResult(controlsRequest)) {
                    const identity = normalizeIdentity();
                    const state = normalizeState(row, identity);
                    statesByScope.set(state.id, state);
                    if (state.activeKey) protectedSnapshots.add(state.activeKey);
                    if (state.previousKey) protectedSnapshots.add(state.previousKey);
                  }
                  for (const key of requestResult(snapshotKeys)) {
                    if (!protectedSnapshots.has(key)) snapshots.delete(key);
                  }
                  for (const key of requestResult(stagingKeys)) {
                    const parsed = parseStagingKey(key);
                    const state = parsed && statesByScope.get(parsed.scopeId);
                    if (!state || !state.latestCheck || parsed.generation !== state.latestCheck.generation) staging.delete(key);
                  }
                  context.setResult(true);
                } catch (error) {
                  context.abort(error);
                }
              };
              snapshotKeys.onsuccess = () => { snapshotsReady = true; applyCleanup(); };
              stagingKeys.onsuccess = () => { stagingReady = true; applyCleanup(); };
            } catch (error) {
              context.abort(error);
            }
          };
        });
    }

    return Object.freeze({
      beginCheck,
      cleanup,
      close,
      commitSnapshot,
      getUpdateState,
      readSnapshot,
      recordCheckFailure,
      recordCheckSuccess
    });
  }

  return Object.freeze({
    DATABASE_NAME,
    STORE_NAMES,
    createSnapshotStore
  });
});
