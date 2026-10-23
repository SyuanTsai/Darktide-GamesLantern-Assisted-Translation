'use strict';

(function attachW10IdbScenario(root) {
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function bytesFromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function decodeRaw(raw) {
    return {
      versionBytes: bytesFromBase64(raw.versionBytes),
      manifestBytes: bytesFromBase64(raw.manifestBytes),
      files: new Map(raw.files.map(([filePath, value]) => [filePath, bytesFromBase64(value)]))
    };
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  }

  async function openDb(name) {
    return requestValue(indexedDB.open(name));
  }

  async function inspectRows(name, storeNames, identity) {
    const db = await openDb(name);
    try {
      const transaction = db.transaction([storeNames.control, storeNames.snapshots, storeNames.staging], 'readonly');
      const done = transactionDone(transaction);
      const statesRequest = transaction.objectStore(storeNames.control).getAll();
      const snapshotKeysRequest = transaction.objectStore(storeNames.snapshots).getAllKeys();
      const stagingKeysRequest = transaction.objectStore(storeNames.staging).getAllKeys();
      const [states, snapshotKeys, stagingKeys] = await Promise.all([
        requestValue(statesRequest), requestValue(snapshotKeysRequest), requestValue(stagingKeysRequest)
      ]);
      await done;
      const state = states.find((row) => row.gameVersion === identity.gameVersion
        && row.gameReleaseId === identity.gameReleaseId) ?? null;
      return { state, states, snapshotKeys, stagingKeys };
    } finally {
      db.close();
    }
  }

  async function mutateSnapshot(name, storeName, snapshotKey, mutate) {
    const db = await openDb(name);
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(storeName);
      const get = store.get(snapshotKey);
      get.onsuccess = () => {
        try {
          const row = get.result;
          assert(row, 'expected snapshot row to exist before corruption');
          mutate(row);
          store.put(row);
        } catch (error) {
          try { transaction.abort(); } catch (_) { }
        }
      };
      await done;
    } finally {
      db.close();
    }
  }

  async function insertOrphanRows(name, storeNames) {
    const db = await openDb(name);
    try {
      const transaction = db.transaction([storeNames.snapshots, storeNames.staging], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeNames.snapshots).put({ snapshotKey: 'orphan-snapshot-row' });
      transaction.objectStore(storeNames.staging).put({ stageKey: 'orphan-staging-row', generation: -1 });
      await done;
    } finally {
      db.close();
    }
  }

  async function deleteSnapshot(name, storeName, snapshotKey) {
    const db = await openDb(name);
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeName).delete(snapshotKey);
      await done;
    } finally {
      db.close();
    }
  }

  async function expectReject(operation, code) {
    try {
      await operation();
    } catch (error) {
      if (code) assert(error.code === code, 'expected error code ' + code + ', received ' + error.code + ': ' + error.message);
      return error;
    }
    throw new Error('expected operation to reject' + (code ? ' with ' + code : ''));
  }

  function injectOnePromotionAbort() {
    const prototype = IDBObjectStore.prototype;
    const originalPut = prototype.put;
    let triggered = false;
    prototype.put = function controlledAbortAfterPut() {
      const request = originalPut.apply(this, arguments);
      if (!triggered && this.name === 'snapshots') {
        triggered = true;
        const transaction = this.transaction;
        queueMicrotask(() => {
          try { transaction.abort(); } catch (_) { }
        });
      }
      return request;
    };
    return () => {
      prototype.put = originalPut;
      return triggered;
    };
  }

  function injectOneStagingCorruption() {
    const prototype = IDBObjectStore.prototype;
    const originalPut = prototype.put;
    let triggered = false;
    prototype.put = function controlledStagingCorruption(value) {
      if (!triggered && this.name === 'staging' && value && Array.isArray(value.files)) {
        triggered = true;
        const damaged = { ...value, files: value.files.slice(1) };
        return originalPut.call(this, damaged);
      }
      return originalPut.apply(this, arguments);
    };
    return () => {
      prototype.put = originalPut;
      return triggered;
    };
  }

  root.runW10IdbScenario = async function runW10IdbScenario(input) {
    const api = root.W10SharedSnapshotStore;
    assert(api && typeof api.createSnapshotStore === 'function', 'W10 shared snapshot store browser global did not load');
    assert(api.DATABASE_NAME.includes('w10') && !api.DATABASE_NAME.includes('w01'), 'W10 database namespace must stay isolated from W01');

    const identity = input.identity;
    const storeA = api.createSnapshotStore();
    const storeB = api.createSnapshotStore();
    const packageA = decodeRaw(input.packages.r1);
    const packageSameRevision = decodeRaw(input.packages.r1SameRevisionDifferentContentVersion);
    const packageBad = decodeRaw(input.packages.badR2);
    const packageR2 = decodeRaw(input.packages.r2);
    const packageR3 = decodeRaw(input.packages.r3);
    const packageR4 = decodeRaw(input.packages.r4);
    const otherIdentity = input.otherIdentity;
    const packageOtherRelease = decodeRaw(input.packages.otherRelease);

    // Scenario: Given no active W10 package, a complete raw package can be staged and atomically activated.
    // Purpose: Prove the first active pointer refers only to a fully validated raw snapshot.
    const firstCheck = await storeA.beginCheck(identity);
    await storeA.commitSnapshot({ checkToken: firstCheck, identity, snapshot: packageA });
    const firstRead = await storeA.readSnapshot(identity);
    assert(firstRead && firstRead.source === 'active' && firstRead.snapshot.manifest.contentVersion === input.contentVersions.r1,
      'initial active snapshot did not read back as R1');

    // Scenario: Given equal dataRevision values but different manifest contentVersion pins, each manifest hash has its own row.
    // Purpose: Prevent snapshot-key collisions when a manifest hash changes without changing canonical dataRevision.
    const sameRevisionCheck = await storeA.beginCheck(identity);
    await storeA.commitSnapshot({ checkToken: sameRevisionCheck, identity, snapshot: packageSameRevision });
    const sameRevisionRead = await storeA.readSnapshot(identity);
    assert(sameRevisionRead.snapshot.manifest.contentVersion === input.contentVersions.r1SameRevisionDifferentContentVersion,
      'same-revision contentVersion update was not activated');
    const afterSameRevision = await inspectRows(api.DATABASE_NAME, api.STORE_NAMES, identity);
    assert(afterSameRevision.state.activeKey !== afterSameRevision.state.previousKey,
      'active and previous keys collided for distinct manifest hashes');
    assert(afterSameRevision.snapshotKeys.length === 2, 'both same-dataRevision manifest-hash rows were not retained');

    // Scenario: Given a valid lower contentVersion for the same release, an explicit rollback remains eligible.
    // Purpose: Avoid imposing monotonic version ordering on exact, independently validated package pointers.
    const rollbackCheck = await storeA.beginCheck(identity);
    await storeA.commitSnapshot({ checkToken: rollbackCheck, identity, snapshot: packageA });
    assert((await storeA.readSnapshot(identity)).snapshot.manifest.contentVersion === input.contentVersions.r1,
      'valid older contentVersion rollback was refused');

    // Scenario: Given R1 active, a damaged R2 package fails before promotion and leaves R1 untouched.
    // Purpose: Keep a failed or partially transferred candidate out of active storage.
    const badCheck = await storeA.beginCheck(identity);
    await expectReject(() => storeA.commitSnapshot({ checkToken: badCheck, identity, snapshot: packageBad }));
    const afterBad = await storeA.readSnapshot(identity);
    assert(afterBad.snapshot.manifest.contentVersion === input.contentVersions.r1,
      'failed R2 changed the existing active snapshot');

    // Scenario: Given a valid R2 package after failed validation, one promotion retains the previous compatible package.
    // Purpose: Keep active and fallback pointers in one committed transaction.
    const r2Check = await storeA.beginCheck(identity);
    await storeA.commitSnapshot({ checkToken: r2Check, identity, snapshot: packageR2 });
    assert((await storeA.readSnapshot(identity)).snapshot.manifest.contentVersion === input.contentVersions.r2,
      'valid R2 did not become active');

    // Scenario: Given an explicit transaction abort during promotion, the old active R2 remains readable.
    // Purpose: Verify atomic rollback with a controlled IDB abort injection, not actual disk quota exhaustion.
    const abortCheck = await storeA.beginCheck(identity);
    const restorePut = injectOnePromotionAbort();
    await expectReject(() => storeA.commitSnapshot({ checkToken: abortCheck, identity, snapshot: packageR3 }));
    const abortWasInjected = restorePut();
    assert(abortWasInjected, 'controlled IDB abort was not injected into promotion');
    assert((await storeA.readSnapshot(identity)).snapshot.manifest.contentVersion === input.contentVersions.r2,
      'aborted promotion replaced the prior active snapshot');
    const afterAbort = await inspectRows(api.DATABASE_NAME, api.STORE_NAMES, identity);
    assert(afterAbort.stagingKeys.length === 0, 'aborted promotion left a staging row behind');

    // Scenario: Given two store instances with checks in flight, the newer completed generation wins.
    // Purpose: Persist generation and expected-active CAS across instances so an older late result cannot overwrite it.
    const olderCheck = await storeA.beginCheck(identity);
    const newerCheck = await storeB.beginCheck(identity);
    await storeB.commitSnapshot({ checkToken: newerCheck, identity, snapshot: packageR3 });
    await expectReject(() => storeA.commitSnapshot({ checkToken: olderCheck, identity, snapshot: packageR4 }), 'STALE_CHECK');
    assert((await storeA.readSnapshot(identity)).snapshot.manifest.contentVersion === input.contentVersions.r3,
      'older check replaced the newer completed snapshot');

    // Scenario UnitT30: Given two exact game releases, concurrent checks and promotions are isolated by release identity.
    // Purpose: Preserve each patch line's own generation, active/previous pointers, and bounded package cache.
    const lineACheck = await storeA.beginCheck(identity);
    const lineBCheck = await storeB.beginCheck(otherIdentity);
    await storeB.commitSnapshot({ checkToken: lineBCheck, identity: otherIdentity, snapshot: packageOtherRelease });
    await storeA.commitSnapshot({ checkToken: lineACheck, identity, snapshot: packageR3 });
    const lineARead = await storeA.readSnapshot(identity);
    const lineBRead = await storeB.readSnapshot(otherIdentity);
    assert(lineARead && lineARead.snapshot.manifest.contentVersion === input.contentVersions.r3,
      'a different release check made the current release stale or replaced its active package');
    assert(lineBRead && lineBRead.snapshot.manifest.contentVersion === input.contentVersions.otherRelease,
      'a different release package was not independently activated');
    const afterCrossRelease = await inspectRows(api.DATABASE_NAME, api.STORE_NAMES, identity);
    assert(afterCrossRelease.snapshotKeys.length === 3,
      'release-scoped retention did not keep two base-line packages and the other release package');

    // Scenario UnitT40: Given a verified in-memory package and a corrupted staged database row, activation never copies damaged bytes.
    // Purpose: Treat staging storage as untrusted while retaining atomic promotion from the bytes already verified outside the transaction.
    const stagingCheck = await storeA.beginCheck(identity);
    const restoreStagingCorruption = injectOneStagingCorruption();
    await storeA.commitSnapshot({ checkToken: stagingCheck, identity, snapshot: packageR3 });
    const stagingCorruptionWasInjected = restoreStagingCorruption();
    assert(stagingCorruptionWasInjected, 'controlled staging raw corruption was not injected');
    const afterStagingCorruption = await storeA.readSnapshot(identity);
    assert(afterStagingCorruption && afterStagingCorruption.source === 'active'
      && afterStagingCorruption.snapshot.manifest.contentVersion === input.contentVersions.r3,
    'activation promoted damaged staging bytes instead of its already-verified package');

    // Scenario UnitT50: Given a trusted exact snapshot ID, alternative IDs remain usable while historical and unknown IDs cannot read or commit.
    // Purpose: Pass the caller's complete identity into raw cache verification without inferring patch identity from opaque names.
    const alternativeIdentity = { ...identity, snapshotId: input.snapshotIds.alternative };
    const alternativeCheck = await storeA.beginCheck(alternativeIdentity);
    await storeA.commitSnapshot({ checkToken: alternativeCheck, identity: alternativeIdentity, snapshot: packageR3 });
    assert((await storeA.readSnapshot(alternativeIdentity)).snapshot.manifest.contentVersion === input.contentVersions.r3,
      'known alternative snapshot identity could not read a compatible cache package');
    const historicalIdentity = { ...identity, snapshotId: input.snapshotIds.historical };
    const unknownIdentity = { ...identity, snapshotId: input.snapshotIds.unknown };
    assert((await storeA.readSnapshot(historicalIdentity)) === null, 'historical snapshot identity read a current package');
    assert((await storeA.readSnapshot(unknownIdentity)) === null, 'unknown snapshot identity read a current package');
    const historicalCheck = await storeA.beginCheck(historicalIdentity);
    await expectReject(() => storeA.commitSnapshot({ checkToken: historicalCheck, identity: historicalIdentity, snapshot: packageR3 }));

    // Scenario: Given an active package after database close, a new store instance reopens and verifies its raw bytes.
    // Purpose: Recover state from persistent IDB rather than in-memory parsed objects.
    storeA.close();
    storeB.close();
    const reopened = api.createSnapshotStore();
    const reopenedRead = await reopened.readSnapshot(identity);
    const reopenedOther = await reopened.readSnapshot(otherIdentity);
    assert(reopenedRead && reopenedRead.source === 'active'
      && reopenedRead.snapshot.manifest.contentVersion === input.contentVersions.r3,
    'active snapshot did not survive database close and reopen');
    assert(reopenedOther && reopenedOther.source === 'active'
      && reopenedOther.snapshot.manifest.contentVersion === input.contentVersions.otherRelease,
    'the other release snapshot did not survive database close and reopen');

    // Scenario: Given edited metadata columns in IDB, the caller's identity and raw bytes remain authoritative.
    // Purpose: Never trust parsed or copied identity metadata from the database.
    const pointersBeforeDamage = await inspectRows(api.DATABASE_NAME, api.STORE_NAMES, identity);
    assert(pointersBeforeDamage.snapshotKeys.length === 3 && pointersBeforeDamage.stagingKeys.length === 0,
      'successful promotion did not retain both release scopes without staging');
    const damagedActiveKey = pointersBeforeDamage.state.activeKey;

    // Scenario: Given unreferenced rows and stale staging, cleanup preserves the active and previous pointers.
    // Purpose: Remove abandoned storage without deleting either protected snapshot.
    await insertOrphanRows(api.DATABASE_NAME, api.STORE_NAMES);
    await reopened.cleanup();
    const cleanedRows = await inspectRows(api.DATABASE_NAME, api.STORE_NAMES, identity);
    assert(cleanedRows.snapshotKeys.length === 3 && cleanedRows.stagingKeys.length === 0,
      'cleanup failed to remove orphan rows while preserving every release scope');
    assert(cleanedRows.state.activeKey === pointersBeforeDamage.state.activeKey
      && cleanedRows.state.previousKey === pointersBeforeDamage.state.previousKey,
    'cleanup erased or changed an active/previous pointer');

    await mutateSnapshot(api.DATABASE_NAME, api.STORE_NAMES.snapshots, damagedActiveKey, (row) => {
      row.gameVersion = '9.8.8';
      row.gameReleaseId = 'fixture:w10-tampered';
      row.manifestSha256 = '0'.repeat(64);
    });
    const metadataRead = await reopened.readSnapshot(identity);
    assert(metadataRead && metadataRead.source === 'active'
      && metadataRead.snapshot.manifest.contentVersion === input.contentVersions.r3,
    'edited IDB identity metadata overrode the caller identity or raw manifest');

    // Scenario: Given a missing domain file in active storage, only the compatible previous snapshot can satisfy the read.
    // Purpose: Revalidate cached raw bytes on every read and fall back to the immediately previous compatible package.
    await mutateSnapshot(api.DATABASE_NAME, api.STORE_NAMES.snapshots, damagedActiveKey, (row) => { row.files.pop(); });
    const fallbackRead = await reopened.readSnapshot(identity);
    assert(fallbackRead && fallbackRead.source === 'previous'
      && fallbackRead.snapshot.manifest.contentVersion === input.contentVersions.r2,
    'damaged active package did not fall back to its previous compatible package');

    // Scenario: Given the active row is missing and the caller supplies another release identity, no global version is selected.
    // Purpose: Limit cache reads to active and previous rows matching caller-trusted game identity.
    await deleteSnapshot(api.DATABASE_NAME, api.STORE_NAMES.snapshots, damagedActiveKey);
    const wrongIdentityRead = await reopened.readSnapshot({ gameVersion: '9.8.8', gameReleaseId: 'fixture:w10-other' });
    assert(wrongIdentityRead === null, 'store selected a cache row for an incompatible identity');

    // Scenario: Given a missing IndexedDB factory on first use, the store returns a clear unavailable error.
    // Purpose: Avoid treating absent storage as an empty successful cache.
    const unavailable = api.createSnapshotStore({ indexedDB: null });
    const unavailableError = await expectReject(() => unavailable.readSnapshot(identity), 'IDB_UNAVAILABLE');
    unavailable.close();

    const finalRows = await inspectRows(api.DATABASE_NAME, api.STORE_NAMES, identity);
    assert(finalRows.snapshotKeys.length === 2, 'cleanup failed to retain only the remaining base previous and other-release active packages');
    assert(finalRows.stagingKeys.length === 0, 'cleanup retained staging rows');
    reopened.close();

    return {
      abortWasInjected,
      stagingCorruptionWasInjected,
      activeAfterReopen: reopenedRead.snapshot.manifest.contentVersion,
      fallbackAfterCorruption: fallbackRead.snapshot.manifest.contentVersion,
      failedCandidatePreserved: afterBad.snapshot.manifest.contentVersion,
      idbName: api.DATABASE_NAME,
      previousManifestKeyWasDistinct: afterSameRevision.state.activeKey !== afterSameRevision.state.previousKey,
      unavailableCode: unavailableError.code,
      winnerAfterRace: input.contentVersions.r3,
      snapshotRowsAfterCleanup: cleanedRows.snapshotKeys.length,
      snapshotRowsAfterManualActiveDelete: finalRows.snapshotKeys.length,
      otherReleaseAfterReopen: reopenedOther.snapshot.manifest.contentVersion,
      stagingRowsAfterCleanup: finalRows.stagingKeys.length
    };
  };
})(globalThis);
