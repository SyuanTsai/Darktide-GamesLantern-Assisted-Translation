(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedDocumentSession = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const GAME_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const RELEASE_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
  const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

  function normalizedIdentity(identity) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.keys(identity).some((key) => !['gameVersion', 'gameReleaseId', 'snapshotId'].includes(key))
      || typeof identity.gameVersion !== 'string' || !GAME_VERSION.test(identity.gameVersion)
      || typeof identity.gameReleaseId !== 'string' || !RELEASE_ID.test(identity.gameReleaseId)
      || (identity.snapshotId !== undefined
        && (typeof identity.snapshotId !== 'string' || !SNAPSHOT_ID.test(identity.snapshotId)))) return null;
    return Object.freeze({
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      ...(identity.snapshotId === undefined ? {} : { snapshotId: identity.snapshotId })
    });
  }

  function sameIdentity(left, right) {
    return !!left && !!right && left.gameVersion === right.gameVersion
      && left.gameReleaseId === right.gameReleaseId && left.snapshotId === right.snapshotId;
  }

  function original(reason, identity, updateStatus = null) {
    return Object.freeze({ status: 'original', reason, source: 'original', snapshot: null,
      identity: identity || null, updateStatus });
  }

  function createDocumentSession({ resolveSnapshot } = {}) {
    if (typeof resolveSnapshot !== 'function') throw new TypeError('resolveSnapshot must be a function');
    let identity = null;
    let initialization = null;

    function initialize(trustedIdentity) {
      const candidate = normalizedIdentity(trustedIdentity);
      if (!candidate) return Promise.resolve(original('unknown-identity', null));
      if (initialization) {
        if (sameIdentity(identity, candidate)) return initialization;
        return Promise.resolve(original('identity-changed', candidate));
      }
      identity = candidate;
      initialization = Promise.resolve().then(() => resolveSnapshot(candidate)).then((result) => {
        if (!result || result.status !== 'ready' || !result.snapshot
          || !['active', 'previous', 'baseline'].includes(result.source)
          || (result.identity && !sameIdentity(normalizedIdentity(result.identity), candidate))) {
          return original('no-compatible-data', candidate, result && (result.updateStatus || result.status));
        }
        return Object.freeze({
          status: 'ready',
          source: result.source,
          snapshot: result.snapshot,
          identity: candidate,
          updateStatus: result.updateStatus || null
        });
      }).catch(() => original('resolution-failed', candidate));
      return initialization;
    }

    return Object.freeze({ initialize, getSnapshot: initialize });
  }

  return Object.freeze({ createDocumentSession });
});
