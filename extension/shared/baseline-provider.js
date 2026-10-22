(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedBaselineProvider = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const BASELINE_PATHS = Object.freeze([
    'baseline/version.json',
    'baseline/manifest.json',
    'baseline/domains/skills.json',
    'baseline/domains/blessings.json',
    'baseline/domains/weapons.json',
    'baseline/domains/terms.json'
  ]);
  const CORE_PATHS = Object.freeze([
    'domains/skills.json',
    'domains/blessings.json',
    'domains/weapons.json',
    'domains/terms.json'
  ]);

  function extensionAssetUrl(chromeApi, relativePath) {
    const runtime = chromeApi && chromeApi.runtime;
    if (!runtime || typeof runtime.id !== 'string' || typeof runtime.getURL !== 'function') return null;
    const rawUrl = runtime.getURL(relativePath);
    let url;
    try { url = new URL(rawUrl); } catch (_) { throw new Error('W10 baseline asset URL is invalid'); }
    if (url.protocol !== 'chrome-extension:' || url.hostname !== runtime.id
      || url.username || url.password || url.port || url.search || url.hash) {
      throw new Error('W10 baseline asset escaped the fixed extension origin');
    }
    return url;
  }

  async function readLocalBytes(chromeApi, fetchImpl, relativePath, maxBytes) {
    const url = extensionAssetUrl(chromeApi, relativePath);
    if (!url) return null;
    const response = await fetchImpl(url.href, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
    if (!response || response.status === 404) return null;
    if (response.status !== 200 || response.ok !== true || response.redirected !== false
      || response.url !== url.href || !response.body || typeof response.body.getReader !== 'function') {
      throw new Error('W10 extension-local baseline asset failed its response checks');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
        length += chunk.byteLength;
        if (length > maxBytes) throw new Error('W10 extension-local baseline asset exceeds its byte limit');
        chunks.push(chunk.slice());
      }
    } catch (error) {
      try { await reader.cancel(error); } catch (_) { }
      throw error;
    } finally {
      try { reader.releaseLock(); } catch (_) { }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  function createBaselineProvider({ chromeApi = globalThis.chrome, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('W10 baseline local fetch is unavailable');
    return async function baselineRawProvider() {
      const versionBytes = await readLocalBytes(chromeApi, fetchImpl, BASELINE_PATHS[0], 64 * 1024);
      if (!versionBytes) return null;
      const manifestBytes = await readLocalBytes(chromeApi, fetchImpl, BASELINE_PATHS[1], 256 * 1024);
      if (!manifestBytes) return null;
      const files = new Map();
      let totalBytes = versionBytes.byteLength + manifestBytes.byteLength;
      for (let index = 0; index < CORE_PATHS.length; index += 1) {
        const bytes = await readLocalBytes(chromeApi, fetchImpl, BASELINE_PATHS[index + 2], 8 * 1024 * 1024);
        if (!bytes) return null;
        totalBytes += bytes.byteLength;
        if (totalBytes > 16 * 1024 * 1024) throw new Error('W10 extension-local baseline exceeds the snapshot byte limit');
        files.set(CORE_PATHS[index], bytes);
      }
      return { versionBytes, manifestBytes, files };
    };
  }

  return Object.freeze({ BASELINE_PATHS, CORE_PATHS, createBaselineProvider });
});
