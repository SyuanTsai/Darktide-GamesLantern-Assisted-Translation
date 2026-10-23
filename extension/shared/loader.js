(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const contract = commonJs ? require('./contract.js') : root.W10SharedContract;
  const domainContract = commonJs ? require('./domains.js') : root.W10SharedDomains;
  const api = factory(contract, domainContract);
  if (commonJs) module.exports = api;
  root.W10SharedLoader = api;
})(typeof globalThis === 'object' ? globalThis : this, function (contract, domainContract) {
  'use strict';

  const ORIGIN = 'https://darktide.tw-syuan.com';
  const VERSION_URL = ORIGIN + '/version.json';
  const CORE_DOMAIN_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
  const CORE_DOMAIN_SET = new Set(CORE_DOMAIN_KINDS);
  const LIMITS = Object.freeze({
    versionBytes: 64 * 1024,
    manifestBytes: 256 * 1024,
    fileBytes: 8 * 1024 * 1024,
    snapshotBytes: 16 * 1024 * 1024,
    timeoutMs: 30000
  });

  function fail(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    throw error;
  }

  function requireDependencies() {
    if (!contract || !domainContract) fail('W10 shared contract and domain validators must load before the loader');
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

  function requireIdentity(identity) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) fail('local game identity is required');
    if (typeof identity.gameVersion !== 'string' || identity.gameVersion.trim() === ''
      || typeof identity.gameReleaseId !== 'string' || identity.gameReleaseId.trim() === '') {
      fail('local identity requires both gameVersion and gameReleaseId');
    }
    if (Object.keys(identity).some((key) => !['gameVersion', 'gameReleaseId', 'snapshotId'].includes(key))) {
      fail('local game identity contains an unexpected property');
    }
    if (identity.snapshotId !== undefined && (typeof identity.snapshotId !== 'string' || identity.snapshotId.trim() === '')) {
      fail('local game identity snapshotId is invalid');
    }
    return {
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId,
      ...(identity.snapshotId === undefined ? {} : { snapshotId: identity.snapshotId })
    };
  }

  function noCompatibleRelease(gameVersion) {
    const error = new Error('no compatible published release for gameVersion ' + gameVersion);
    error.code = 'NO_COMPATIBLE_RELEASE';
    error.status = 'no-compatible-release';
    return error;
  }

  function validateVersionBytes(versionBytes, identity, contractApi) {
    if (versionBytes.byteLength > LIMITS.versionBytes) fail('version index exceeds the 64 KiB limit');
    const version = decodeJson(versionBytes, 'version index');
    contractApi.validateVersion(version);
    const release = contractApi.selectGameRelease(version, identity.gameVersion);
    if (!release) throw noCompatibleRelease(identity.gameVersion);
    return { version, release };
  }

  function canonicalManifestPath(release) {
    const expected = '/data/' + release.data_revision + '/manifest.json';
    if (release.manifest_path !== expected) fail('selected release manifest path is not canonical');
    return expected;
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

  function filePathForManifest(manifestPath, relativePath) {
    const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
    if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.startsWith('/')
      || relativePath.includes('\\') || relativePath.includes('%') || /[?#:]/.test(relativePath)
      || relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      fail('manifest file path is unsafe');
    }
    const pathname = base + relativePath;
    const url = fixedUrl(pathname);
    if (!url.pathname.startsWith(base) || url.pathname !== pathname) fail('manifest file escaped its pinned data directory');
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

  async function selectCoreFiles(manifest, cryptoApi) {
    const selectedFiles = await contract.selectConsumerFiles(manifest, {
      requiredKinds: CORE_DOMAIN_KINDS,
      supportedKinds: CORE_DOMAIN_KINDS,
      cryptoApi
    });
    if (selectedFiles.length !== CORE_DOMAIN_KINDS.length
      || CORE_DOMAIN_KINDS.some((kind) => selectedFiles.filter((row) => row.kind === kind).length !== 1)
      || selectedFiles.some((row) => !CORE_DOMAIN_SET.has(row.kind))) {
      fail('W10 core dependency closure must contain exactly one file for each core domain');
    }
    for (const row of selectedFiles) {
      if (row.sizeBytes > LIMITS.fileBytes) fail('domain file exceeds the 8 MiB file limit: ' + row.path);
    }
    return selectedFiles;
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
        if (total && total.value + chunk.byteLength > total.limit) fail('snapshot exceeds the 16 MiB total byte limit');
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
        cache: 'no-store',
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

  async function inspectRawSnapshot({ versionBytes, manifestBytes, fileBytes, identity, cryptoApi }) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    const versionRaw = asBytes(versionBytes, 'stored version index');
    const manifestRaw = asBytes(manifestBytes, 'stored manifest');
    if (manifestRaw.byteLength > LIMITS.manifestBytes) fail('manifest exceeds the 256 KiB limit');
    const total = { value: manifestRaw.byteLength, limit: LIMITS.snapshotBytes };
    if (total.value > total.limit) fail('snapshot exceeds the 16 MiB total byte limit');

    const { version, release } = validateVersionBytes(versionRaw, normalizedIdentity, contract);
    const manifestPath = canonicalManifestPath(release);
    const manifestSha256 = await sha256(manifestRaw, cryptoApi);
    if (manifestSha256 !== release.manifest_sha256) fail('manifest SHA-256 does not match the selected version pointer');
    const manifest = decodeJson(manifestRaw, 'manifest');
    await contract.validateManifest(manifest, { cryptoApi });
    const exactRelease = await contract.matchReleaseIdentity(version, manifest, {
      gameVersion: normalizedIdentity.gameVersion,
      gameReleaseId: normalizedIdentity.gameReleaseId
    }, { cryptoApi });
    if (!exactRelease) throw noCompatibleRelease(normalizedIdentity.gameVersion);
    if (exactRelease.manifest_path !== manifestPath) fail('manifest metadata differs from the selected version pointer');

    const selectedFiles = await selectCoreFiles(manifest, cryptoApi);
    const declaredTotal = manifestRaw.byteLength + selectedFiles.reduce((sum, row) => sum + row.sizeBytes, 0);
    if (declaredTotal > LIMITS.snapshotBytes) fail('snapshot declared size exceeds the 16 MiB total byte limit');
    if (!(fileBytes instanceof Map) || fileBytes.size !== selectedFiles.length) fail('snapshot raw file map is incomplete or contains unexpected paths');

    const files = new Map();
    const domains = new Map();
    for (const row of selectedFiles) {
      const rawValue = fileBytes.get(row.path);
      const raw = asBytes(rawValue, 'domain file ' + row.path);
      if (raw.byteLength > LIMITS.fileBytes) fail('domain file exceeds the 8 MiB file limit: ' + row.path);
      total.value += raw.byteLength;
      if (total.value > total.limit) fail('snapshot exceeds the 16 MiB total byte limit');
      if (raw.byteLength !== row.sizeBytes) fail('domain file size does not match the manifest pin: ' + row.path);
      if (await sha256(raw, cryptoApi) !== row.sha256) fail('domain file SHA-256 does not match the manifest pin: ' + row.path);
      const document = decodeJson(raw, 'domain file ' + row.path);
      domainContract.validateDomain(document, { kind: row.kind, gameReleaseId: manifest.gameReleaseId });
      files.set(row.path, raw.slice());
      domains.set(row.kind, document);
    }
    const validatedRegistry = domainContract.validateDomainSet(domains, manifest, normalizedIdentity);
    return {
      version,
      versionBytes: versionRaw.slice(),
      release: exactRelease,
      manifest,
      manifestBytes: manifestRaw.slice(),
      manifestSha256,
      files,
      domains,
      identity: validatedRegistry.identity
    };
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

  async function verifyStoredSnapshot({ versionBytes, manifestBytes, files, identity, cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, async () => inspectRawSnapshot({
      versionBytes,
      manifestBytes,
      fileBytes: files,
      identity: normalizedIdentity,
      cryptoApi
    }));
  }

  function sameReleasePointer(left, right) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    return ['content_version', 'data_revision', 'manifest_path', 'manifest_sha256']
      .every((field) => left[field] === right[field]);
  }

  async function fetchVersionIndex({ fetchImpl = globalThis.fetch, identity, cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, async (requestSignal) => {
      const versionBytes = await fetchJsonBytes(fetchImpl, fixedUrl('/version.json'), 'version index',
        LIMITS.versionBytes, null, requestSignal);
      const { version, release } = validateVersionBytes(versionBytes, normalizedIdentity, contract);
      canonicalManifestPath(release);
      return { version, versionBytes, release, identity: normalizedIdentity };
    });
  }

  async function downloadPackageFromVersion({ fetchImpl, identity, versionBytes, cryptoApi, signal }) {
    const normalizedIdentity = requireIdentity(identity);
    const versionRaw = asBytes(versionBytes, 'validated version index');
    const { version, release } = validateVersionBytes(versionRaw, normalizedIdentity, contract);
    const manifestPath = canonicalManifestPath(release);
    const total = { value: 0, limit: LIMITS.snapshotBytes };
    const manifestBytes = await fetchJsonBytes(fetchImpl, fixedUrl(manifestPath), 'manifest',
      LIMITS.manifestBytes, total, signal);
    if (await sha256(manifestBytes, cryptoApi) !== release.manifest_sha256) {
      fail('manifest SHA-256 does not match the selected version pointer');
    }
    const manifest = decodeJson(manifestBytes, 'manifest');
    await contract.validateManifest(manifest, { cryptoApi });
    const matchedRelease = await contract.matchReleaseIdentity(version, manifest, {
      gameVersion: normalizedIdentity.gameVersion,
      gameReleaseId: normalizedIdentity.gameReleaseId
    }, { cryptoApi });
    if (!matchedRelease || matchedRelease.manifest_path !== manifestPath) {
      throw noCompatibleRelease(normalizedIdentity.gameVersion);
    }
    const selectedFiles = await selectCoreFiles(manifest, cryptoApi);
    if (manifestBytes.byteLength + selectedFiles.reduce((sum, row) => sum + row.sizeBytes, 0) > LIMITS.snapshotBytes) {
      fail('snapshot declared size exceeds the 16 MiB total byte limit');
    }
    const fileBytes = new Map();
    for (const row of selectedFiles) {
      const url = filePathForManifest(manifestPath, row.path);
      fileBytes.set(row.path, await fetchJsonBytes(fetchImpl, url, 'domain file ' + row.path,
        LIMITS.fileBytes, total, signal));
    }
    return inspectRawSnapshot({
      versionBytes: versionRaw,
      manifestBytes,
      fileBytes,
      identity: normalizedIdentity,
      cryptoApi
    });
  }

  async function downloadSnapshotFromVersion({ fetchImpl = globalThis.fetch, identity, versionBytes,
    cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, (requestSignal) => downloadPackageFromVersion({
      fetchImpl, identity: normalizedIdentity, versionBytes, cryptoApi, signal: requestSignal
    }));
  }

  async function downloadSnapshot({ fetchImpl = globalThis.fetch, identity, cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, async (requestSignal) => {
      const versionBytes = await fetchJsonBytes(fetchImpl, fixedUrl('/version.json'), 'version index',
        LIMITS.versionBytes, null, requestSignal);
      return downloadPackageFromVersion({
        fetchImpl, identity: normalizedIdentity, versionBytes, cryptoApi, signal: requestSignal
      });
    });
  }

  return Object.freeze({
    LIMITS,
    downloadSnapshot,
    downloadSnapshotFromVersion,
    fetchVersionIndex,
    sameReleasePointer,
    verifyStoredSnapshot
  });
});
