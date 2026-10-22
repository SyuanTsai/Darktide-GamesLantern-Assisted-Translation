(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./loader.js') : root.W10SharedLoader,
    commonJs ? require('./document-session.js') : root.W10SharedDocumentSession
  );
  if (commonJs) module.exports = api;
  root.W10SharedClient = api;
})(typeof globalThis === 'object' ? globalThis : this, function (loaderApi, sessionApi) {
  'use strict';

  const MESSAGE_TYPE = 'W10_GET_SNAPSHOT';
  const GAME_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const GAME_RELEASE_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
  const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

  function getStatusText(result) {
    if (result && result.status === 'ready') {
      if (result.source === 'active') {
        if (result.updateStatus === 'updated') return '已載入並驗證更新資料。';
        if (result.updateStatus === 'unchanged') return '已驗證相容資料仍為最新。';
        return '已載入相容且已驗證的資料。';
      }
      if (result.source === 'previous') return '更新未完成，暫用上一份已驗證且相容的資料。';
      if (result.source === 'baseline') return '使用隨附且已驗證的基礎資料。';
    }
    const reason = result && (result.reason || result.updateStatus);
    const messages = {
      'unknown-identity': '無法辨識目前遊戲版本或快照，停止套用翻譯並顯示原站內容。',
      'identity-changed': '此頁面的遊戲版本或快照身分已變更，停止套用翻譯並顯示原站內容。',
      'no-compatible-release': '找不到與目前遊戲版本相容的資料，顯示原站內容。',
      'no-compatible-data': '目前沒有可用的相容資料，顯示原站內容。',
      'worker-unavailable': '本機資料服務暫時無法使用，顯示原站內容。',
      'worker-rejected': '本機資料服務拒絕了這次要求，顯示原站內容。',
      'worker-identity-mismatch': '資料服務回傳的遊戲身分不符，顯示原站內容。',
      'worker-result-invalid': '資料服務回傳內容無效，顯示原站內容。',
      'worker-snapshot-invalid': '資料完整性驗證失敗，顯示原站內容。',
      'resolution-failed': '相容資料載入失敗，顯示原站內容。',
      'storage-unavailable': '本機資料庫暫時無法使用，顯示原站內容。'
    };
    return messages[reason] || '目前沒有可用的已驗證資料，顯示原站內容。';
  }

  function original(reason, identity, updateStatus = null) {
    return Object.freeze({ status: 'original', reason, source: 'original', snapshot: null,
      identity: identity || null, updateStatus, statusText: getStatusText({ status: 'original', reason, updateStatus }) });
  }

  function normalizeIdentity(identity) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.keys(identity).some((key) => !['gameVersion', 'gameReleaseId', 'snapshotId'].includes(key))
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

  function sameIdentity(left, right) {
    return !!left && !!right && left.gameVersion === right.gameVersion
      && left.gameReleaseId === right.gameReleaseId && left.snapshotId === right.snapshotId;
  }

  function bytesFromBase64(value) {
    if (typeof value !== 'string' || value.length > 24 * 1024 * 1024 || value.length % 4 !== 0) {
      throw new Error('W10 worker returned malformed raw bytes');
    }
    let padding = 0;
    if (value.endsWith('=')) padding += 1;
    if (value.endsWith('==')) padding += 1;
    const payloadLength = value.length - padding;
    if ((padding === 1 && payloadLength % 4 !== 3)
      || (padding === 2 && payloadLength % 4 !== 2)
      || (padding === 0 && payloadLength % 4 !== 0)) {
      throw new Error('W10 worker returned malformed raw bytes');
    }
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      const isAlphabet = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
        || (code >= 48 && code <= 57) || code === 43 || code === 47;
      if ((index < payloadLength && !isAlphabet) || (index >= payloadLength && code !== 61)) {
        throw new Error('W10 worker returned malformed raw bytes');
      }
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function serializeIdentity(identity) {
    return {
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      ...(identity.snapshotId === undefined ? {} : { snapshotId: identity.snapshotId })
    };
  }

  function validateOptions(options) {
    const value = options || {};
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['active', 'manual'].includes(key))
      || (value.active !== undefined && typeof value.active !== 'boolean')
      || (value.manual !== undefined && typeof value.manual !== 'boolean')) {
      throw new TypeError('W10 client options are invalid');
    }
    return { active: value.active === undefined ? true : value.active, manual: value.manual === true };
  }

  function createW10Client({ runtime = globalThis.chrome && globalThis.chrome.runtime,
    loader = loaderApi, documentSession = sessionApi } = {}) {
    if (!runtime || typeof runtime.sendMessage !== 'function') throw new TypeError('chrome.runtime.sendMessage is unavailable');
    if (!loader || typeof loader.verifyStoredSnapshot !== 'function') throw new TypeError('W10 shared loader is unavailable');
    if (!documentSession || typeof documentSession.createDocumentSession !== 'function') {
      throw new TypeError('W10 document session is unavailable');
    }
    let session = null;

    async function requestAndVerify(identity, options) {
      let response;
      try {
        response = await runtime.sendMessage({
          type: MESSAGE_TYPE,
          identity: serializeIdentity(identity),
          active: options.active,
          manual: options.manual
        });
      } catch (_) {
        return original('worker-unavailable', identity, 'worker-unavailable');
      }
      if (!response || response.ok !== true || !response.result || typeof response.result !== 'object') {
        const code = response && response.error && response.error.code;
        return original('worker-rejected', identity, typeof code === 'string' ? code : 'worker-rejected');
      }
      const result = response.result;
      if (!sameIdentity(normalizeIdentity(result.identity), identity)) {
        return original('worker-identity-mismatch', identity, 'worker-identity-mismatch');
      }
      if (result.source === 'original' || result.snapshot === null) {
        return original(result.reason || 'no-compatible-data', identity, result.updateStatus || result.status || null);
      }
      if (!['active', 'previous', 'baseline'].includes(result.source) || result.status !== 'ready') {
        return original('worker-result-invalid', identity, 'worker-result-invalid');
      }
      try {
        const raw = result.snapshot;
        if (!raw || typeof raw !== 'object' || Object.keys(raw).sort().join(',') !== 'files,manifestBytes,versionBytes'
          || !Array.isArray(raw.files) || raw.files.length > 16) throw new Error('worker snapshot row is malformed');
        const files = new Map();
        for (const row of raw.files) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || files.has(row[0])) {
            throw new Error('worker file row is malformed');
          }
          files.set(row[0], bytesFromBase64(row[1]));
        }
        const snapshot = await loader.verifyStoredSnapshot({
          versionBytes: bytesFromBase64(raw.versionBytes),
          manifestBytes: bytesFromBase64(raw.manifestBytes),
          files,
          identity
        });
        const verified = { status: 'ready', source: result.source, snapshot, identity,
          updateStatus: result.updateStatus || null };
        return Object.freeze({ ...verified, statusText: getStatusText(verified) });
      } catch (_) {
        return original('worker-snapshot-invalid', identity, 'worker-snapshot-invalid');
      }
    }

    function initialize(trustedIdentity, rawOptions = {}) {
      const identity = normalizeIdentity(trustedIdentity);
      if (!identity) return Promise.resolve(original('unknown-identity', null));
      const options = validateOptions(rawOptions);
      if (!session) {
        session = documentSession.createDocumentSession({
          resolveSnapshot: (pinnedIdentity) => requestAndVerify(pinnedIdentity, options)
        });
      }
      return session.initialize(identity).then((result) => Object.freeze({
        ...result, statusText: getStatusText(result)
      }));
    }

    async function checkNow(trustedIdentity) {
      const identity = normalizeIdentity(trustedIdentity);
      if (!identity) return original('unknown-identity', null);
      const result = await requestAndVerify(identity, { active: true, manual: true });
      const summary = { status: result.status, source: result.source,
        updateStatus: result.updateStatus, reason: result.reason || null };
      return Object.freeze({ ...summary, statusText: getStatusText(summary) });
    }

    return Object.freeze({ initialize, checkNow });
  }

  return Object.freeze({ MESSAGE_TYPE, createW10Client, getStatusText });
});
