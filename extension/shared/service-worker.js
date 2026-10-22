'use strict';

if (typeof importScripts === 'function' && typeof module === 'undefined') {
  importScripts('contract.js', 'domains.js', 'loader.js', 'snapshot-store.js',
    'update-coordinator.js', 'baseline-provider.js');
}

(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./loader.js') : root.W10SharedLoader,
    commonJs ? require('./snapshot-store.js') : root.W10SharedSnapshotStore,
    commonJs ? require('./update-coordinator.js') : root.W10SharedUpdateCoordinator,
    commonJs ? require('./baseline-provider.js') : root.W10SharedBaselineProvider
  );
  if (commonJs) module.exports = api;
  root.W10SharedServiceWorker = api;
  if (!commonJs && root.chrome && root.chrome.runtime && root.chrome.runtime.onMessage) {
    root.__W10_BOOT_MARKER = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    root.__W10_BOOT_TIME_ORIGIN = root.performance && root.performance.timeOrigin;
    const store = root.W10SharedSnapshotStore.createSnapshotStore();
    const coordinator = root.W10SharedUpdateCoordinator.createUpdateCoordinator({
      store,
      fetchImpl: root.fetch.bind(root),
      baselineRawProvider: root.W10SharedBaselineProvider.createBaselineProvider()
    });
    root.chrome.runtime.onMessage.addListener(api.createMessageHandler({
      runtime: root.chrome.runtime,
      coordinator
    }));
  }
})(typeof globalThis === 'object' ? globalThis : this, function (loaderApi, storeApi, coordinatorApi, baselineApi) {
  'use strict';

  const MESSAGE_TYPE = 'W10_GET_SNAPSHOT';
  const GAME_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const GAME_RELEASE_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
  const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
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

  function normalizeIdentity(identity) {
    if (!exactKeys(identity, ['gameVersion', 'gameReleaseId'], ['snapshotId'])
      || typeof identity.gameVersion !== 'string' || !GAME_VERSION.test(identity.gameVersion)
      || typeof identity.gameReleaseId !== 'string' || !GAME_RELEASE_ID.test(identity.gameReleaseId)
      || (identity.snapshotId !== undefined
        && (typeof identity.snapshotId !== 'string' || !SNAPSHOT_ID.test(identity.snapshotId)))) return null;
    return Object.freeze({
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      ...(identity.snapshotId === undefined ? {} : { snapshotId: identity.snapshotId })
    });
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

  function serializeSnapshot(snapshot) {
    if (!snapshot) return null;
    return {
      versionBytes: bytesToBase64(snapshot.versionBytes),
      manifestBytes: bytesToBase64(snapshot.manifestBytes),
      files: [...snapshot.files].map(([filePath, raw]) => [filePath, bytesToBase64(raw)])
    };
  }

  function serializeResult(result) {
    return {
      status: result.status,
      source: result.source,
      identity: result.identity,
      updateStatus: result.updateStatus || null,
      reason: result.reason || null,
      errorCode: result.error && result.error.code ? String(result.error.code) : null,
      snapshot: serializeSnapshot(result.snapshot)
    };
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
      if (!exactKeys(message, ['type', 'identity'], ['active', 'manual']) || message.type !== MESSAGE_TYPE
        || (message.active !== undefined && typeof message.active !== 'boolean')
        || (message.manual !== undefined && typeof message.manual !== 'boolean')) {
        sendResponse(errorResponse('INVALID_MESSAGE'));
        return false;
      }
      const identity = normalizeIdentity(message.identity);
      if (!identity) {
        sendResponse(errorResponse('INVALID_IDENTITY'));
        return false;
      }
      Promise.resolve(coordinator.getSnapshot(identity, {
        active: message.active === undefined ? true : message.active,
        manual: message.manual === true
      })).then((result) => sendResponse({ ok: true, result: serializeResult(result) }), (error) => {
        sendResponse(errorResponse(error && error.code ? String(error.code) : 'UPDATE_FAILED'));
      });
      return true;
    };
  }

  return Object.freeze({ MESSAGE_TYPE, createMessageHandler, normalizeIdentity, serializeResult, trustedSender,
    supportedGamePath });
});
