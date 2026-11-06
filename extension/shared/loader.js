(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./source-data-contract.js') : root.W10SourceDataContract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedLoader = api;
})(typeof globalThis === 'object' ? globalThis : this, function (contract) {
  'use strict';
  const ORIGIN = 'https://darktide.tw-syuan.com';
  const CURRENT_URL = ORIGIN + '/source-data/current.json';
  const CATEGORIES = contract.CATEGORIES;
  const LIMITS = Object.freeze({ currentBytes: 64 * 1024, fileBytes: 32 * 1024 * 1024, snapshotBytes: 64 * 1024 * 1024, timeoutMs: 30000 });
  function fail(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    throw error;
  }

  function asBytes(value, label) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    fail(label + ' must be raw bytes');
  }

  function arrayBufferForDigest(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async function sha256(bytes, cryptoApi) {
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      fail('SHA-256 crypto is unavailable');
    }
    const digest = await cryptoApi.subtle.digest('SHA-256', arrayBufferForDigest(bytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function decodeJson(bytes, label) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(label + ' BOM is forbidden');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      fail(label + ' UTF-8 decoding failed: ' + error.message);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      fail(label + ' JSON is invalid: ' + error.message);
    }
  }

  function fixedUrl(pathname) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')
      || pathname.includes('\\') || /[?#%]/.test(pathname)) fail('package URL path is unsafe');
    const url = new URL(pathname, ORIGIN);
    if (url.origin !== ORIGIN || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      fail('package URL escaped the fixed production origin');
    }
    return url;
  }

  function assertJsonResponse(response, expectedUrl, label) {
    if (!response || response.status !== 200 || response.ok !== true) {
      fail(label + ' HTTP status is not 200' + (response && Number.isInteger(response.status) ? ': ' + response.status : ''));
    }
    if (response.redirected !== false) fail(label + ' response followed a redirect');
    if (typeof response.url !== 'string' || response.url.length === 0) fail(label + ' final response URL is missing');
    let finalUrl;
    try {
      finalUrl = new URL(response.url);
    } catch (_) {
      fail(label + ' final response URL is invalid');
    }
    if (finalUrl.href !== expectedUrl.href || finalUrl.origin !== ORIGIN) fail(label + ' final response URL differs from the fixed request URL');
    if (!response.headers || typeof response.headers.get !== 'function') fail(label + ' response headers are missing');
    const contentType = response.headers.get('content-type');
    if (typeof contentType !== 'string') fail(label + ' MIME type is missing');
    const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim().toLowerCase());
    if (mediaType !== 'application/json') fail(label + ' MIME type must be application/json');
    for (const parameter of parameters) {
      const match = /^charset\s*=\s*["']?([^"']+)["']?$/.exec(parameter);
      if (/^charset\s*=/i.test(parameter) && (!match || !['utf-8', 'utf8'].includes(match[1]))) {
        fail(label + ' MIME charset must be UTF-8');
      }
    }
  }

  async function readBounded(response, label, maxBytes, total, signal) {
    if (!response.body || typeof response.body.getReader !== 'function') fail(label + ' response body is not a readable stream');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    let aborted = false;
    const cancelOnAbort = () => {
      aborted = true;
      try { Promise.resolve(reader.cancel(signal.reason)).catch(() => {}); } catch (_) { }
    };
    if (signal) signal.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      while (true) {
        if (signal && signal.aborted) fail('snapshot download cancelled', 'ABORTED');
        const result = await reader.read();
        if (signal && signal.aborted) fail('snapshot download cancelled', 'ABORTED');
        if (result.done) break;
        const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
        if (chunk.byteLength === 0) continue;
        length += chunk.byteLength;
        if (length > maxBytes) fail(label + ' exceeds the ' + formatByteLimit(maxBytes) + ' limit');
        if (total && total.value + chunk.byteLength > total.limit) fail('snapshot exceeds the 64 MiB total byte limit');
        if (total) total.value += chunk.byteLength;
        chunks.push(chunk.slice());
      }
    } catch (error) {
      try { await reader.cancel(error); } catch (_) { }
      if (aborted || (signal && signal.aborted)) fail('snapshot download cancelled', 'ABORTED');
      throw error;
    } finally {
      if (signal) signal.removeEventListener('abort', cancelOnAbort);
      try { reader.releaseLock(); } catch (_) { }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  function formatByteLimit(bytes) {
    if (bytes % (1024 * 1024) === 0) return (bytes / (1024 * 1024)) + ' MiB';
    if (bytes % 1024 === 0) return (bytes / 1024) + ' KiB';
    return bytes + ' byte';
  }

  async function fetchJsonBytes(fetchImpl, url, label, maxBytes, total, signal) {
    if (typeof fetchImpl !== 'function') fail('fetchImpl must be a function');
    if (signal && signal.aborted) fail('snapshot request was aborted', 'ABORTED');
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'omit',
        redirect: 'error',
        signal
      });
    } catch (error) {
      if (signal && signal.aborted) fail('snapshot request was aborted', 'ABORTED');
      fail(label + ' request failed: ' + error.message);
    }
    assertJsonResponse(response, url, label);
    return readBounded(response, label, maxBytes, total, signal);
  }

  function withDeadline(externalSignal, operation) {
    if (externalSignal !== undefined && (!externalSignal || typeof externalSignal.addEventListener !== 'function'
      || typeof externalSignal.aborted !== 'boolean')) fail('signal must be an AbortSignal');
    const controller = new AbortController();
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = (message, code) => {
      const error = new Error(message);
      error.code = code;
      controller.abort(error);
      rejectAbort(error);
    };
    const onExternalAbort = () => abort('snapshot download cancelled', 'ABORTED');
    if (externalSignal && externalSignal.aborted) onExternalAbort();
    else if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => abort('snapshot download timed out', 'TIMEOUT'), LIMITS.timeoutMs);
    const work = Promise.resolve().then(() => operation(controller.signal));
    return Promise.race([work, aborted]).finally(() => {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    });
  }

  function sameIdentity(a, b) {
    return !!a && !!b && contract.IDENTITY_KEYS.every(k => typeof a[k] === 'string' && a[k] === b[k]);
  }
  function readCurrent(currentBytes) {
    const bytes = asBytes(currentBytes, 'current');
    if (bytes.byteLength > LIMITS.currentBytes) fail('current exceeds 64 KiB');
    const current = decodeJson(bytes, 'current'); contract.validateCurrent(current); return current;
  }
  async function inspectRaw({ currentBytes, files, cryptoApi }) {
    // Copy before awaiting crypto so caller mutations cannot alter the verified snapshot.
    const currentSource = asBytes(currentBytes, 'current');
    if (currentSource.byteLength > LIMITS.currentBytes) fail('current exceeds 64 KiB');
    if (!files || typeof files !== 'object' || Array.isArray(files)
      || Object.keys(files).sort().join(',') !== [...CATEGORIES].sort().join(',')) fail('exactly four category files are required');
    const sources = Object.fromEntries(CATEGORIES.map(k => [k, asBytes(files[k], k)]));
    let total = currentSource.byteLength;
    for (const k of CATEGORIES) {
      if (sources[k].byteLength > LIMITS.fileBytes) fail(k + ' exceeds 32 MiB');
      total += sources[k].byteLength;
    }
    if (total > LIMITS.snapshotBytes) fail('snapshot exceeds 64 MiB');
    const currentRaw = currentSource.slice();
    const copied = Object.fromEntries(CATEGORIES.map(k => [k, sources[k].slice()]));
    const current = readCurrent(currentRaw);
    const documents = Object.fromEntries(CATEGORIES.map(k => [k, decodeJson(copied[k], k)]));
    const validated = contract.validateSnapshot({ current, documents });
    // Fixed order and length framing avoid ambiguous concatenation; this is local corruption detection only.
    const combined = new Uint8Array(total + 5 * 4); const view = new DataView(combined.buffer); let offset = 0;
    for (const bytes of [currentRaw, ...CATEGORIES.map(k => copied[k])]) {
      view.setUint32(offset, bytes.length); offset += 4; combined.set(bytes, offset); offset += bytes.length;
    }
    const digest = await sha256(combined, cryptoApi);
    return Object.freeze({ ...validated, currentBytes: currentRaw, files: Object.freeze(copied), digest });
  }
  async function fetchCurrent({ fetchImpl = globalThis.fetch, signal } = {}) {
    return withDeadline(signal, async internalSignal => {
      const currentBytes = await fetchJsonBytes(fetchImpl, fixedUrl('/source-data/current.json'), 'current', LIMITS.currentBytes, null, internalSignal);
      return { currentBytes, current: readCurrent(currentBytes) };
    });
  }
  async function downloadSnapshot({ fetchImpl = globalThis.fetch, currentBytes, signal, cryptoApi = globalThis.crypto } = {}) {
    const currentSource = asBytes(currentBytes, 'current');
    if (currentSource.byteLength > LIMITS.currentBytes) fail('current exceeds 64 KiB');
    const copiedCurrent = currentSource.slice(); const current = readCurrent(copiedCurrent);
    return withDeadline(signal, async internalSignal => {
      const total = { value: copiedCurrent.length, limit: LIMITS.snapshotBytes }; const files = {};
      for (const k of CATEGORIES) {
        const url = fixedUrl('/source-data/' + current.gameVersion + '/' + k + '.json');
        files[k] = await fetchJsonBytes(fetchImpl, url, k, LIMITS.fileBytes, total, internalSignal);
      }
      return inspectRaw({ currentBytes: copiedCurrent, files, cryptoApi });
    });
  }
  async function verifyStoredSnapshot({ currentBytes, files, cryptoApi = globalThis.crypto } = {}) {
    return inspectRaw({ currentBytes, files, cryptoApi });
  }
  return Object.freeze({ ORIGIN, CURRENT_URL, CATEGORIES, LIMITS, fetchCurrent, downloadSnapshot, verifyStoredSnapshot, sameIdentity });
});
