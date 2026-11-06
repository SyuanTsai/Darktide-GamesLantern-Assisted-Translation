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
  function getStatusText(result) {
    if (result && result.status === 'ready') {
      if (result.source === 'active') {
        if (result.updateStatus === 'updated') return '已載入並驗證更新資料。';
        if (result.updateStatus === 'unchanged') return '已驗證相容資料仍為最新。';
        return '已載入相容且已驗證的資料。';
      }
      if (result.source === 'previous') return '更新未完成，暫用上一份已驗證且相容的資料。';
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

  function bytesFromBase64(value) {
    if (typeof value !== 'string' || value.length > 4 * Math.ceil(loaderApi.LIMITS.fileBytes / 3) || value.length % 4 !== 0) {
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
    loader = loaderApi, documentSession = sessionApi, cryptoApi = globalThis.crypto } = {}) {
    if (!runtime || typeof runtime.sendMessage !== 'function') throw new TypeError('chrome.runtime.sendMessage is unavailable');
    if (!loader || typeof loader.verifyStoredSnapshot !== 'function') throw new TypeError('W10 shared loader is unavailable');
    if (!documentSession || typeof documentSession.createDocumentSession !== 'function') {
      throw new TypeError('W10 document session is unavailable');
    }
    let session = null;

    async function requestAndVerify(options) {
      let identity = null;
      let response;
      try {
        response = await runtime.sendMessage({
          type: MESSAGE_TYPE,
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
      if (result.source === 'original' || result.snapshot === null) {
        return original(result.reason || 'no-compatible-data', identity, result.updateStatus || result.status || null);
      }
      if (!['active', 'previous'].includes(result.source) || result.status !== 'ready') {
        return original('worker-result-invalid', identity, 'worker-result-invalid');
      }
      try {
        const raw = result.snapshot;
        if (!raw || typeof raw !== 'object' || Object.keys(raw).sort().join(',') !== 'currentBytes,files'
          || !raw.files || Object.keys(raw.files).sort().join(',') !== [...loader.CATEGORIES].sort().join(',')) throw new Error('malformed snapshot');
        let encodedBytes = raw.currentBytes.length;
        for (const k of loader.CATEGORIES) encodedBytes += raw.files[k].length;
        if (encodedBytes > 4 * Math.ceil(loader.LIMITS.snapshotBytes / 3) + 16) throw new Error('message exceeds limit');
        if (raw.currentBytes.length > 4 * Math.ceil(loader.LIMITS.currentBytes / 3)) throw new Error('current exceeds limit');
        const snapshot = await loader.verifyStoredSnapshot({ currentBytes: bytesFromBase64(raw.currentBytes),
          files: Object.fromEntries(loader.CATEGORIES.map(k => [k, bytesFromBase64(raw.files[k])])), cryptoApi });
        if (!loader.sameIdentity(result.identity, snapshot.identity)) return original('worker-identity-mismatch', null);
        identity = snapshot.identity;
        const verified = { status: 'ready', source: result.source, snapshot, identity,
          updateStatus: result.updateStatus || null };
        return Object.freeze({ ...verified, statusText: getStatusText(verified) });
      } catch (_) {
        return original('worker-snapshot-invalid', identity, 'worker-snapshot-invalid');
      }
    }

    function initialize(rawOptions = {}) {
      const options = validateOptions(rawOptions);
      if (!session) session = documentSession.createDocumentSession({ resolveSnapshot: () => requestAndVerify(options) });
      return session.initialize().then(result => Object.freeze({ ...result, statusText: getStatusText(result) }));
    }
    async function checkNow() {
      const result = await requestAndVerify({ active: true, manual: true });
      const summary = { status: result.status, source: result.source, updateStatus: result.updateStatus, reason: result.reason || null };
      return Object.freeze({ ...summary, statusText: getStatusText(summary) });
    }

    return Object.freeze({ initialize, checkNow });
  }

  return Object.freeze({ MESSAGE_TYPE, createW10Client, getStatusText });
});
