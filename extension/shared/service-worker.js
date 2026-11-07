'use strict';

if (typeof importScripts === 'function' && typeof module === 'undefined') {
  importScripts('source-data-contract.js', 'loader.js', 'snapshot-store.js', 'update-coordinator.js');
}

(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./loader.js') : root.W10SharedLoader,
    commonJs ? require('./snapshot-store.js') : root.W10SharedSnapshotStore,
    commonJs ? require('./update-coordinator.js') : root.W10SharedUpdateCoordinator
  );
  if (commonJs) module.exports = api;
  root.W10SharedServiceWorker = api;
  if (!commonJs && root.chrome && root.chrome.runtime && root.chrome.runtime.onMessage) {
    root.__W10_BOOT_MARKER = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    root.__W10_BOOT_TIME_ORIGIN = root.performance && root.performance.timeOrigin;
    const store = root.W10SharedSnapshotStore.createSnapshotStore();
    const coordinator = root.W10SharedUpdateCoordinator.createUpdateCoordinator({
      store,
      fetchImpl: root.fetch.bind(root)
    });
    root.chrome.runtime.onMessage.addListener(api.createMessageHandler({
      runtime: root.chrome.runtime,
      coordinator
    }));
  }
})(typeof globalThis === 'object' ? globalThis : this, function (loaderApi, storeApi, coordinatorApi) {
  'use strict';

  const MESSAGE_TYPE = 'W10_GET_SNAPSHOT';
  const FILE_MESSAGE_TYPE = 'W10_GET_SNAPSHOT_FILE';
  // 32 MiB base64 約 42.7 MiB；預留 1 MiB 包裝仍低於 64 MiB。
  if (4 * Math.ceil(loaderApi.LIMITS.fileBytes / 3) + 1024 * 1024 >= 64 * 1024 * 1024) throw new Error('message limit exceeded');
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const GAME_ORIGIN = 'https://darktide.gameslantern.com';

  function errorResponse(code) {
    return { ok: false, error: { code } };
  }

  function exactKeys(value, required, optional) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (required.some((key) => !Object.hasOwn(value, key))) return false;
    const allowed = new Set(required.concat(optional));
    return keys.every((key) => allowed.has(key));
  }

  function validExtensionAddress(value, extensionId) {
    if (typeof value !== 'string' || value.length === 0) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'chrome-extension:' && parsed.hostname === extensionId
        && parsed.username === '' && parsed.password === '' && parsed.port === '';
    } catch (_) { return false; }
  }

  function supportedGamePath(pathname) {
    return typeof pathname === 'string'
      && /^\/(?:build-editor|abilities(?:\/[a-z0-9-]+)?|weapon-blessing-traits|weapons(?:\/[a-z0-9-]+){1,2})\/?$/i.test(pathname);
  }

  function validGamePageSender(sender) {
    if (!sender || sender.frameId !== 0 || !sender.tab || !Number.isInteger(sender.tab.id)
      || sender.tab.id < 0 || sender.origin !== GAME_ORIGIN || typeof sender.url !== 'string') return false;
    try {
      const parsed = new URL(sender.url);
      return parsed.protocol === 'https:' && parsed.hostname === 'darktide.gameslantern.com'
        && parsed.origin === GAME_ORIGIN && !parsed.username && !parsed.password && !parsed.port
        && supportedGamePath(parsed.pathname);
    } catch (_) { return false; }
  }

  function trustedSender(sender, runtimeId) {
    if (!sender || typeof runtimeId !== 'string' || sender.id !== runtimeId) return false;
    const addresses = [sender.origin, sender.url].filter((value) => value !== undefined && value !== null);
    if (addresses.length > 0 && addresses.every((value) => validExtensionAddress(value, runtimeId))) return true;
    return validGamePageSender(sender);
  }

  function bytesToBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const encoded = [];
    const alignedChunkSize = 3 * 16 * 1024;
    for (let offset = 0; offset < bytes.length; offset += alignedChunkSize) {
      const end = Math.min(bytes.length, offset + alignedChunkSize);
      let binary = '';
      for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]);
      if (typeof btoa === 'function') {
        encoded.push(btoa(binary));
      } else {
        let output = '';
        for (let index = 0; index < binary.length; index += 3) {
          const first = binary.charCodeAt(index);
          const hasSecond = index + 1 < binary.length;
          const hasThird = index + 2 < binary.length;
          const second = hasSecond ? binary.charCodeAt(index + 1) : 0;
          const third = hasThird ? binary.charCodeAt(index + 2) : 0;
          const packed = (first << 16) | (second << 8) | third;
          output += BASE64[(packed >>> 18) & 63] + BASE64[(packed >>> 12) & 63]
            + (hasSecond ? BASE64[(packed >>> 6) & 63] : '=') + (hasThird ? BASE64[packed & 63] : '=');
        }
        encoded.push(output);
      }
    }
    return encoded.join('');
  }

  function serializeResult(result) {
    const snapshot = result.snapshot;
    return { status: result.status, source: result.source, identity: result.identity,
      updateStatus: result.updateStatus || null, reason: result.reason || null,
      errorCode: result.error && result.error.code ? String(result.error.code) : null,
      snapshot: snapshot ? { currentBytes: bytesToBase64(snapshot.currentBytes), digest: snapshot.digest,
        sizes: Object.fromEntries(loaderApi.CATEGORIES.map(k => [k, snapshot.files[k].byteLength])) } : null };
  }

  function createMessageHandler({ runtime, coordinator } = {}) {
    if (!runtime || typeof runtime.id !== 'string' || !coordinator || typeof coordinator.getSnapshot !== 'function') {
      throw new TypeError('W10 message handler requires runtime and coordinator');
    }
    return function handleMessage(message, sender, sendResponse) {
      if (typeof sendResponse !== 'function') return false;
      if (!trustedSender(sender, runtime.id)) {
        sendResponse(errorResponse('UNTRUSTED_SENDER'));
        return false;
      }
      const isFile = message && message.type === FILE_MESSAGE_TYPE;
      if (isFile ? (!exactKeys(message, ['type', 'category', 'identity', 'digest'], [])
        || !loaderApi.CATEGORIES.includes(message.category) || typeof message.digest !== 'string'
        || !/^[a-f0-9]{64}$/.test(message.digest) || !exactKeys(message.identity, ['schemaVersion','gameVersion','sourceCommit','textBatch'], []))
        : (!exactKeys(message, ['type'], ['active', 'manual']) || message.type !== MESSAGE_TYPE
        || (message.active !== undefined && typeof message.active !== 'boolean')
        || (message.manual !== undefined && typeof message.manual !== 'boolean'))) {
        sendResponse(errorResponse('INVALID_MESSAGE')); return false;
      }
      Promise.resolve(coordinator.getSnapshot(isFile ? { active: false, manual: false } : {
        active: message.active === undefined ? true : message.active, manual: message.manual === true
      })).then((result) => {
        if (!isFile) return sendResponse({ ok: true, result: serializeResult(result) });
        const snapshot = result.snapshot;
        if (!snapshot || snapshot.digest !== message.digest || !loaderApi.sameIdentity(snapshot.identity, message.identity)) return sendResponse(errorResponse('SNAPSHOT_CHANGED'));
        return sendResponse({ ok: true, identity: snapshot.identity, digest: snapshot.digest, category: message.category, bytes: bytesToBase64(snapshot.files[message.category]) });
      }, (error) => sendResponse(errorResponse(error && error.code ? String(error.code) : 'UPDATE_FAILED')));
      return true;
    };
  }

  return Object.freeze({ MESSAGE_TYPE, FILE_MESSAGE_TYPE, createMessageHandler, serializeResult, trustedSender,
    supportedGamePath });
});
