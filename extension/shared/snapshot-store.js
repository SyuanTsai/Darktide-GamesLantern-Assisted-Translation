(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./loader.js'));
  } else {
    root.W10SharedSnapshotStore = factory(root.W10SharedLoader);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (loader) {
  'use strict';

  const DATABASE_NAME = 'darktide-w10-shared-snapshots-v1';
  const DATABASE_VERSION = 1;
  const STORE_NAMES = Object.freeze({
    control: 'control',
    snapshots: 'snapshots',
    staging: 'staging'
  });
  const GAME_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const GAME_RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
  const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

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

  function normalizeIdentity(identity) {
    if (!isRecord(identity)) fail('trusted identity must be an object', 'INVALID_IDENTITY');
    const keys = Object.keys(identity).sort();
    if (keys.some((key) => !['gameReleaseId', 'gameVersion', 'snapshotId'].includes(key))
      || !keys.includes('gameReleaseId') || !keys.includes('gameVersion')) {
      fail('trusted identity must contain gameVersion and gameReleaseId, with optional snapshotId', 'INVALID_IDENTITY');
    }
    if (typeof identity.gameVersion !== 'string' || !GAME_VERSION_PATTERN.test(identity.gameVersion)) {
      fail('trusted identity.gameVersion is invalid', 'INVALID_IDENTITY');
    }
    if (typeof identity.gameReleaseId !== 'string' || !GAME_RELEASE_ID_PATTERN.test(identity.gameReleaseId)) {
      fail('trusted identity.gameReleaseId is invalid', 'INVALID_IDENTITY');
    }
    if (identity.snapshotId !== undefined
      && (typeof identity.snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(identity.snapshotId))) {
      fail('trusted identity.snapshotId is invalid', 'INVALID_IDENTITY');
    }
    return Object.freeze({
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      ...(identity.snapshotId === undefined ? {} : { snapshotId: identity.snapshotId })
    });
  }

  function scopeKey(identity) {
    return JSON.stringify([identity.gameVersion, identity.gameReleaseId]);
  }

  function sameScope(left, right) {
    return !!left && !!right && left.gameVersion === right.gameVersion && left.gameReleaseId === right.gameReleaseId;
  }

  function sameIdentity(left, right) {
    return sameScope(left, right) && left.snapshotId === right.snapshotId;
  }

  function normalizeCheckToken(checkToken, identity) {
    if (!isRecord(checkToken) || !Number.isSafeInteger(checkToken.generation) || checkToken.generation < 1
      || !(checkToken.expectedActiveKey === null || typeof checkToken.expectedActiveKey === 'string')) {
      fail('check token is malformed', 'INVALID_CHECK');
    }
    const tokenIdentity = normalizeIdentity(checkToken.identity);
    if (!sameIdentity(tokenIdentity, identity)) fail('check token identity differs from the trusted identity', 'INVALID_CHECK');
    return Object.freeze({
      generation: checkToken.generation,
      expectedActiveKey: checkToken.expectedActiveKey,
      identity: tokenIdentity
    });
  }

  function newState(identity) {
    return {
      id: scopeKey(identity),
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      generation: 0,
      latestCheck: null,
      activeKey: null,
      previousKey: null
    };
  }

  function normalizeState(value, identity) {
    if (value === undefined) return newState(identity);
    if (!isRecord(value) || value.id !== scopeKey(identity)
      || value.gameVersion !== identity.gameVersion || value.gameReleaseId !== identity.gameReleaseId
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
      if (!sameScope(normalizeIdentity(value.latestCheck.identity), identity)) {
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
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      generation: value.generation,
      latestCheck: value.latestCheck ? {
        generation: value.latestCheck.generation,
        expectedActiveKey: value.latestCheck.expectedActiveKey,
        identity: normalizeIdentity(value.latestCheck.identity)
      } : null,
      activeKey: value.activeKey,
      previousKey: value.previousKey
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

  function snapshotKey(identity, manifestSha256) {
    return JSON.stringify([identity.gameVersion, identity.gameReleaseId, manifestSha256]);
  }

  function stagingKey(token, manifestSha256) {
    return JSON.stringify([scopeKey(token.identity), token.generation, manifestSha256]);
  }

  function snapshotKeyBelongsToScope(key, identity) {
    if (typeof key !== 'string') return false;
    try {
      const parts = JSON.parse(key);
      return Array.isArray(parts) && parts.length === 3
        && parts[0] === identity.gameVersion && parts[1] === identity.gameReleaseId;
    } catch (_) {
      return false;
    }
  }

  function stagingKeyBelongsToScope(key, identity) {
    if (typeof key !== 'string') return false;
    try {
      const parts = JSON.parse(key);
      return Array.isArray(parts) && parts.length === 3 && parts[0] === scopeKey(identity);
    } catch (_) {
      return false;
    }
  }

  function parseStagingKey(key) {
    if (typeof key !== 'string') return null;
    try {
      const parts = JSON.parse(key);
      if (!Array.isArray(parts) || parts.length !== 3 || typeof parts[0] !== 'string'
        || !Number.isSafeInteger(parts[1]) || parts[1] < 1) return null;
      const scopeParts = JSON.parse(parts[0]);
      if (!Array.isArray(scopeParts) || scopeParts.length !== 2
        || typeof scopeParts[0] !== 'string' || typeof scopeParts[1] !== 'string') return null;
      return { scopeId: parts[0], generation: parts[1] };
    } catch (_) {
      return null;
    }
  }

  function bytes(value, label) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    fail(label + ' must be raw bytes');
  }

  function copyVerifiedSnapshot(verified, key) {
    return {
      snapshotKey: key,
      gameVersion: verified.identity.gameVersion,
      gameReleaseId: verified.identity.gameReleaseId,
      manifestSha256: verified.manifestSha256,
      versionBytes: bytes(verified.versionBytes, 'versionBytes'),
      manifestBytes: bytes(verified.manifestBytes, 'manifestBytes'),
      files: [...verified.files].map(([filePath, raw]) => [filePath, bytes(raw, 'file ' + filePath)])
    };
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

    async function beginCheck(trustedIdentity) {
      const identity = normalizeIdentity(trustedIdentity);
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
          if (!record || typeof record !== 'object' || !Array.isArray(record.files)) continue;
          const rawFiles = new Map(record.files.map((entry) => {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
              fail('stored raw file row is corrupt', 'IDB_CORRUPT');
            }
            return [entry[0], bytes(entry[1], 'stored file ' + entry[0])];
          }));
          const verified = await loader.verifyStoredSnapshot({
            versionBytes: bytes(record.versionBytes, 'stored versionBytes'),
            manifestBytes: bytes(record.manifestBytes, 'stored manifestBytes'),
            files: rawFiles,
            identity,
            cryptoApi
          });
          const expectedKey = snapshotKey(identity, verified.manifestSha256);
          if (expectedKey !== key || record.snapshotKey !== key) continue;
          candidates.push({ source, snapshotKey: key, snapshot: verified });
        } catch (_) {
          // Stored identity and parsed values are untrusted; invalid active data can fall back to previous.
        }
      }
      return { state, active: candidates.find((candidate) => candidate.source === 'active') ?? null,
        previous: candidates.find((candidate) => candidate.source === 'previous') ?? null };
    }

    async function readSnapshot(trustedIdentity) {
      const identity = normalizeIdentity(trustedIdentity);
      const pointers = await inspectValidPointers(identity);
      return pointers.active || pointers.previous || null;
    }

    async function stageSnapshot(snapshot, identity, token) {
      const verified = await loader.verifyStoredSnapshot({
        versionBytes: snapshot && snapshot.versionBytes,
        manifestBytes: snapshot && snapshot.manifestBytes,
        files: snapshot && snapshot.files,
        identity,
        cryptoApi
      });
      const key = snapshotKey(identity, verified.manifestSha256);
      const stageKey = stagingKey(token, verified.manifestSha256);
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

    async function activateStaged(staged, identity, token, validPointers) {
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
                  if (!record || record.snapshotKey !== staged.key || staged.stageKey !== stagingKey(token, record.manifestSha256)) {
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
                    snapshots.put({
                      snapshotKey: record.snapshotKey,
                      gameVersion: record.gameVersion,
                      gameReleaseId: record.gameReleaseId,
                      manifestSha256: record.manifestSha256,
                      versionBytes: record.versionBytes,
                      manifestBytes: record.manifestBytes,
                      files: record.files
                    });
                    for (const existingKey of requestResult(keyList)) {
                      if (snapshotKeyBelongsToScope(existingKey, identity)
                        && existingKey !== newestKey && existingKey !== previousKey) snapshots.delete(existingKey);
                    }
                    state.activeKey = newestKey;
                    state.previousKey = previousKey;
                    state.latestCheck = null;
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

    async function commitSnapshot({ checkToken, identity: trustedIdentity, snapshot } = {}) {
      const identity = normalizeIdentity(trustedIdentity);
      const token = normalizeCheckToken(checkToken, identity);
      const staged = await stageSnapshot(snapshot, identity, token);
      try {
        const validPointers = await inspectValidPointers(identity);
        return await activateStaged(staged, identity, token, validPointers);
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
                    if (row && row.id === 'control') {
                      control.delete('control');
                      continue;
                    }
                    if (!isRecord(row) || typeof row.gameVersion !== 'string' || typeof row.gameReleaseId !== 'string') {
                      fail('W10 IndexedDB cleanup encountered an invalid scope record', 'IDB_CORRUPT');
                    }
                    const identity = normalizeIdentity({
                      gameVersion: row.gameVersion,
                      gameReleaseId: row.gameReleaseId
                    });
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
      readSnapshot
    });
  }

  return Object.freeze({
    DATABASE_NAME,
    STORE_NAMES,
    createSnapshotStore
  });
});
