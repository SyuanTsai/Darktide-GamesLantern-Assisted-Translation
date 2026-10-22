'use strict';

(function attachW10Harness(root) {
  function snapshotSummary(result) {
    const snapshot = result && result.snapshot;
    return {
      status: result ? result.status : 'original',
      source: result ? result.source : 'original',
      reason: result ? result.reason || null : 'missing-result',
      statusText: result ? result.statusText || null : null,
      updateStatus: result ? result.updateStatus || null : null,
      identity: result ? result.identity : null,
      contentVersion: snapshot && snapshot.manifest ? snapshot.manifest.contentVersion : null,
      dataRevision: snapshot && snapshot.manifest ? snapshot.manifest.dataRevision : null,
      manifestSha256: snapshot ? snapshot.manifestSha256 : null,
      filePaths: snapshot ? [...snapshot.files.keys()].sort() : []
    };
  }

  async function inspectStore(identity) {
    const name = root.W10SharedSnapshotStore.DATABASE_NAME;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('W10 IDB open failed'));
    });
    try {
      const transaction = db.transaction(['control', 'snapshots'], 'readonly');
      const controlRequest = transaction.objectStore('control').get(JSON.stringify([identity.gameVersion, identity.gameReleaseId]));
      const state = await new Promise((resolve, reject) => {
        controlRequest.onsuccess = () => resolve(controlRequest.result || null);
        controlRequest.onerror = () => reject(controlRequest.error || new Error('W10 control read failed'));
      });
      let active = null;
      if (state && state.activeKey) {
        const snapshotRequest = transaction.objectStore('snapshots').get(state.activeKey);
        active = await new Promise((resolve, reject) => {
          snapshotRequest.onsuccess = () => resolve(snapshotRequest.result || null);
          snapshotRequest.onerror = () => reject(snapshotRequest.error || new Error('W10 active read failed'));
        });
      }
      return {
        generation: state ? state.generation : null,
        lastSuccessAt: state && state.updateSchedule ? state.updateSchedule.lastSuccessAt : null,
        activeKey: state ? state.activeKey : null,
        activeContentVersion: active ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(active.versionBytes))
          .game_releases.find((row) => row.game_version === identity.gameVersion).content_version : null,
        activeManifestSha256: active ? active.manifestSha256 : null
      };
    } finally { db.close(); }
  }

  root.w10Harness = Object.freeze({
    createClient() { return root.W10SharedClient.createW10Client(); },
    snapshotSummary,
    inspectStore
  });
  root.document.getElementById('status').textContent = 'W10 MV3 adapter ready';
})(globalThis);
