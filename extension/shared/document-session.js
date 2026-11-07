(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./loader.js') : root.W10SharedLoader);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedDocumentSession = api;
})(typeof globalThis === 'object' ? globalThis : this, function (loader) {
  'use strict';
  function original(reason, updateStatus = null) {
    return Object.freeze({ status: 'original', source: 'original', snapshot: null, identity: null, reason, updateStatus });
  }
  function createDocumentSession({ resolveSnapshot } = {}) {
    if (typeof resolveSnapshot !== 'function') throw new TypeError('resolveSnapshot must be a function');
    let initialization = null;
    function initialize() {
      // Pin the first resolution (including original) for the entire document lifetime.
      if (!initialization) initialization = Promise.resolve().then(() => resolveSnapshot()).then(result => {
        if (!result || result.status !== 'ready' || !result.snapshot || !['active', 'previous'].includes(result.source)
          || !loader.sameIdentity(result.identity, result.snapshot.identity)) return original('no-compatible-data', result && result.updateStatus);
        return Object.freeze({ status: 'ready', source: result.source, snapshot: result.snapshot,
          identity: Object.freeze({ ...result.snapshot.identity }), updateStatus: result.updateStatus || null });
      }).catch(() => original('resolution-failed'));
      return initialization;
    }
    return Object.freeze({ initialize, getSnapshot: initialize });
  }
  return Object.freeze({ createDocumentSession });
});
