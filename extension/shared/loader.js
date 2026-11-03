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
  const SPLIT_DOMAIN_KINDS = Object.freeze([
    'skills', 'terms', 'weapons-index', 'weapon-family', 'blessings-index', 'blessing'
  ]);
  const MAX_DOMAIN_BYTES = 16 * 1024 * 1024;
  const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
  const LIMITS = Object.freeze({
    versionBytes: 64 * 1024,
    manifestBytes: 256 * 1024,
    fileBytes: MAX_DOMAIN_BYTES,
    snapshotBytes: MAX_PACKAGE_BYTES,
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
      if (row.sizeBytes > LIMITS.fileBytes) fail('domain file exceeds the 16 MiB file limit: ' + row.path);
    }
    return selectedFiles;
  }

  function normalizePage(page) {
    if (!page || typeof page !== 'object' || Array.isArray(page)
      || Object.keys(page).some((key) => key !== 'pathname') || typeof page.pathname !== 'string') {
      fail('current page pathname is required for a split package');
    }
    const pathname = page.pathname.replace(/\/$/, '') || '/';
    if (!/^\/(?:build-editor|abilities(?:\/[a-z0-9-]+)?|weapon-blessing-traits|weapons(?:\/[a-z0-9-]+){1,2})$/i.test(pathname)) {
      fail('current page pathname is not supported');
    }
    return pathname;
  }

  function slugify(value) {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  }

  function familyIdForPath(index, familySlug) {
    if (!index) return null;
    const records = Array.isArray(index.source?.records) ? index.source.records : [];
    const presentations = Array.isArray(index.web?.presentations) ? index.web.presentations : [];
    const sources = Array.isArray(index.web?.officialInputs?.sources) ? index.web.officialInputs.sources : [];
    const matches = new Set();
    for (const record of records) {
      if (record?.kind !== 'weapon' || typeof record.payload?.familyId !== 'string') continue;
      const presentation = presentations.find((row) => row?.entityRef?.gameReleaseId === record.gameReleaseId
        && row.entityRef?.kind === 'weapon' && row.entityRef?.recordId === record.recordId && row.locale === 'zh-TW');
      const ids = Array.isArray(presentation?.nameOfficialLocaleRefs)
        ? presentation.nameOfficialLocaleRefs.filter((row) => row?.sourceLocale === 'en').map((row) => row.officialSourceId) : [];
      const source = ids.length === 1 ? sources.find((row) => row?.officialSourceId === ids[0]
        && row.sourceLocale === 'en' && row.entityRef?.recordId === record.recordId
        && row.entityRef?.gameReleaseId === record.gameReleaseId) : null;
      if (source && slugify(source.resolvedText) === familySlug) matches.add(record.payload.familyId);
    }
    if (matches.size !== 1) fail('weapon page does not resolve to exactly one split weapon family');
    return [...matches][0];
  }

  function blessingSlug(recordId) {
    return typeof recordId === 'string'
      ? recordId.replace(/^darktide:blessing:/, '').replace(/[^A-Za-z0-9._-]/g, '-') : '';
  }

  function splitLeafName(filePath, prefix) {
    return filePath.startsWith(prefix) && filePath.endsWith('.json')
      ? filePath.slice(prefix.length, -'.json'.length) : '';
  }

  function validateSplitDocumentBinding(row, document, manifest) {
    if (contract.manifestFormat(manifest) !== 'split') return;
    const records = Array.isArray(document?.source?.records) ? document.source.records : [];
    if (row.kind === 'weapons-index') {
      if (records.some((record) => record?.kind !== 'weapon')) fail('weapons-index contains a non-weapon Source record');
      const indexed = new Set(records.map((record) => record.payload?.familyId)
        .filter((familyId) => typeof familyId === 'string' && familyId));
      const declared = new Set(manifest.files.filter((file) => file.kind === 'weapon-family')
        .map((file) => splitLeafName(file.path, 'domains/weapons/')));
      if (indexed.size !== declared.size || [...indexed].some((familyId) => !declared.has(familyId))) {
        fail('weapons-index familyId set does not match weapon-family manifest paths');
      }
    } else if (row.kind === 'weapon-family') {
      const familyIds = new Set(records.filter((record) => record?.kind === 'weapon')
        .map((record) => record.payload?.familyId).filter((familyId) => typeof familyId === 'string' && familyId));
      const pathFamilyId = splitLeafName(row.path, 'domains/weapons/');
      if (familyIds.size !== 1 || !familyIds.has(pathFamilyId)) {
        fail('weapon-family familyId does not match its manifest path');
      }
    } else if (row.kind === 'blessings-index') {
      if (records.some((record) => record?.kind !== 'blessing')) fail('blessings-index contains a non-blessing Source record');
      const indexed = new Set(records.map((record) => blessingSlug(record.recordId)).filter(Boolean));
      if (indexed.size !== records.length) fail('blessings-index recordId slugs must be unique');
      const declared = new Set(manifest.files.filter((file) => file.kind === 'blessing')
        .map((file) => splitLeafName(file.path, 'domains/blessings/')));
      if (indexed.size !== declared.size || [...indexed].some((slug) => !declared.has(slug))) {
        fail('blessings-index recordId slugs do not match blessing manifest paths');
      }
    } else if (row.kind === 'blessing') {
      const roots = records.filter((record) => record?.kind === 'blessing');
      const pathSlug = splitLeafName(row.path, 'domains/blessings/');
      if (roots.length !== 1 || blessingSlug(roots[0].recordId) !== pathSlug) {
        fail('blessing recordId does not match its manifest path');
      }
    }
  }

  function selectSplitFiles(manifest, page, documents = new Map()) {
    const pathname = normalizePage(page);
    const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
    const selected = new Map();
    const add = (file) => {
      if (!file) fail('split page requires a domain file that is missing from the manifest');
      if (!SPLIT_DOMAIN_KINDS.includes(file.kind)) fail('split page dependency kind is unsupported: ' + file.kind);
      if (selected.has(file.path)) return;
      selected.set(file.path, file);
      for (const dependency of file.dependencies) add(filesByPath.get(dependency));
    };
    const addKind = (kind) => {
      const rows = manifest.files.filter((file) => file.kind === kind);
      if (rows.length !== 1) fail('split page requires exactly one ' + kind + ' file');
      add(rows[0]);
    };
    if (pathname === '/build-editor' || pathname === '/abilities' || pathname.startsWith('/abilities/')) {
      addKind('skills');
    } else if (pathname.startsWith('/weapons/')) {
      addKind('weapons-index');
      addKind('blessings-index');
      const index = documents.get('domains/weapons-index.json');
      if (index) {
        const familySlug = pathname.split('/')[2];
        const familyId = familyIdForPath(index, familySlug);
        add(filesByPath.get('domains/weapons/' + familyId + '.json'));
      }
    } else if (pathname === '/weapon-blessing-traits') {
      addKind('blessings-index');
      addKind('weapons-index');
      for (const file of manifest.files.filter((row) => row.kind === 'blessing')) add(file);
    }
    for (const row of selected.values()) {
      if (row.sizeBytes > LIMITS.fileBytes) fail('domain file exceeds the 16 MiB file limit: ' + row.path);
    }
    return [...selected.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  }

  function selectStoredSplitFiles(manifest, fileBytes) {
    if (!(fileBytes instanceof Map) || fileBytes.size === 0) fail('stored split snapshot has no domain files');
    const rows = [...fileBytes.keys()].map((filePath) => manifest.files.find((row) => row.path === filePath));
    if (rows.some((row) => !row || !SPLIT_DOMAIN_KINDS.includes(row.kind))) {
      fail('stored split snapshot contains an undeclared or unsupported domain file');
    }
    const kinds = rows.map((row) => row.kind);
    const count = (kind) => kinds.filter((value) => value === kind).length;
    const validSkill = rows.length === 2 && count('skills') === 1 && count('terms') === 1;
    const validWeaponDetail = rows.length === 3 && count('weapons-index') === 1
      && count('blessings-index') === 1 && count('weapon-family') === 1;
    const blessingCount = count('blessing');
    const allBlessingCount = manifest.files.filter((row) => row.kind === 'blessing').length;
    const validBlessing = rows.length === blessingCount + 2 && count('weapons-index') === 1
      && count('blessings-index') === 1 && blessingCount > 0
      && blessingCount === allBlessingCount;
    if (!validSkill && !validWeaponDetail && !validBlessing) {
      fail('stored split snapshot file set does not match a supported page closure');
    }
    const paths = new Set(rows.map((row) => row.path));
    for (const row of rows) {
      if (row.sizeBytes > LIMITS.fileBytes) fail('domain file exceeds the 16 MiB file limit: ' + row.path);
      if (row.dependencies.some((dependency) => !paths.has(dependency))) {
        fail('stored split snapshot omits a selected file dependency');
      }
    }
    return rows.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  }

  async function selectPageFiles(manifest, page, cryptoApi, documents, fileBytes) {
    if (contract.manifestFormat(manifest) === 'legacy') return selectCoreFiles(manifest, cryptoApi);
    if (page === undefined) return selectStoredSplitFiles(manifest, fileBytes);
    return selectSplitFiles(manifest, page, documents);
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
        if (total && total.value + chunk.byteLength > total.limit) fail('snapshot exceeds the 24 MiB total byte limit');
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

  async function inspectRawSnapshot({ versionBytes, manifestBytes, fileBytes, identity, page, cryptoApi }) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    const versionRaw = asBytes(versionBytes, 'stored version index');
    const manifestRaw = asBytes(manifestBytes, 'stored manifest');
    if (manifestRaw.byteLength > LIMITS.manifestBytes) fail('manifest exceeds the 256 KiB limit');
    const total = { value: manifestRaw.byteLength, limit: LIMITS.snapshotBytes };
    if (total.value > total.limit) fail('snapshot exceeds the 24 MiB total byte limit');

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

    const parsedDocuments = new Map();
    if (fileBytes instanceof Map) {
      const manifestFiles = new Map(manifest.files.map((row) => [row.path, row]));
      for (const [filePath, rawValue] of fileBytes) {
        const row = manifestFiles.get(filePath);
        if (!row) fail('snapshot raw file map contains a path not declared by the manifest');
        const raw = asBytes(rawValue, 'domain file ' + filePath);
        if (raw.byteLength > LIMITS.fileBytes) fail('domain file exceeds the 16 MiB file limit: ' + filePath);
        if (raw.byteLength !== row.sizeBytes) fail('domain file size does not match the manifest pin: ' + filePath);
        if (await sha256(raw, cryptoApi) !== row.sha256) fail('domain file SHA-256 does not match the manifest pin: ' + filePath);
        const document = decodeJson(raw, 'domain file ' + filePath);
        validateSplitDocumentBinding(row, document, manifest);
        domainContract.validateDomain(document, { kind: row.kind, gameReleaseId: manifest.gameReleaseId });
        parsedDocuments.set(filePath, document);
      }
    }
    const selectedFiles = await selectPageFiles(manifest, page, cryptoApi, parsedDocuments, fileBytes);
    const declaredTotal = manifestRaw.byteLength + selectedFiles.reduce((sum, row) => sum + row.sizeBytes, 0);
    if (declaredTotal > LIMITS.snapshotBytes) fail('snapshot declared size exceeds the 24 MiB total byte limit');
    if (!(fileBytes instanceof Map) || fileBytes.size !== selectedFiles.length) fail('snapshot raw file map is incomplete or contains unexpected paths');

    const files = new Map();
    const domains = new Map();
    for (const row of selectedFiles) {
      const rawValue = fileBytes.get(row.path);
      const raw = asBytes(rawValue, 'domain file ' + row.path);
      if (raw.byteLength > LIMITS.fileBytes) fail('domain file exceeds the 16 MiB file limit: ' + row.path);
      total.value += raw.byteLength;
      if (total.value > total.limit) fail('snapshot exceeds the 24 MiB total byte limit');
      if (raw.byteLength !== row.sizeBytes) fail('domain file size does not match the manifest pin: ' + row.path);
      if (await sha256(raw, cryptoApi) !== row.sha256) fail('domain file SHA-256 does not match the manifest pin: ' + row.path);
      const document = parsedDocuments.get(row.path);
      validateSplitDocumentBinding(row, document, manifest);
      domainContract.validateDomain(document, { kind: row.kind, gameReleaseId: manifest.gameReleaseId });
      files.set(row.path, raw.slice());
      domains.set(contract.manifestFormat(manifest) === 'legacy' ? row.kind : row.path, document);
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

  async function verifyStoredSnapshot({ versionBytes, manifestBytes, files, identity, page,
    cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, async () => inspectRawSnapshot({
      versionBytes,
      manifestBytes,
      fileBytes: files,
      identity: normalizedIdentity,
      page,
      cryptoApi
    }));
  }

  function sameReleasePointer(left, right) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    return ['content_version', 'data_revision', 'manifest_path', 'manifest_sha256']
      .every((field) => left[field] === right[field]);
  }

  function snapshotSupportsPage(snapshot, page) {
    if (!snapshot || !(snapshot.files instanceof Map) || !(snapshot.domains instanceof Map) || !snapshot.manifest) return false;
    if (contract.manifestFormat(snapshot.manifest) === 'legacy') return true;
    try {
      const selected = selectSplitFiles(snapshot.manifest, page, snapshot.domains);
      return selected.length === snapshot.files.size && selected.every((row) => snapshot.files.has(row.path));
    } catch (_) {
      return false;
    }
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

  async function downloadPackageFromVersion({ fetchImpl, identity, versionBytes, page, cryptoApi, signal }) {
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
    let selectedFiles = await selectPageFiles(manifest, page, cryptoApi, new Map());
    if (manifestBytes.byteLength + selectedFiles.reduce((sum, row) => sum + row.sizeBytes, 0) > LIMITS.snapshotBytes) {
      fail('snapshot declared size exceeds the 24 MiB total byte limit');
    }
    const fileBytes = new Map();
    for (const row of selectedFiles) {
      const url = filePathForManifest(manifestPath, row.path);
      fileBytes.set(row.path, await fetchJsonBytes(fetchImpl, url, 'domain file ' + row.path,
        LIMITS.fileBytes, total, signal));
    }
    if (contract.manifestFormat(manifest) === 'split' && String(page?.pathname || '').replace(/\/$/, '').startsWith('/weapons/')) {
      const documents = new Map([...fileBytes].map(([filePath, raw]) => [filePath, decodeJson(raw, 'domain file ' + filePath)]));
      selectedFiles = await selectPageFiles(manifest, page, cryptoApi, documents);
      if (manifestBytes.byteLength + selectedFiles.reduce((sum, row) => sum + row.sizeBytes, 0) > LIMITS.snapshotBytes) {
        fail('snapshot declared size exceeds the 24 MiB total byte limit');
      }
      for (const row of selectedFiles) {
        if (fileBytes.has(row.path)) continue;
        const url = filePathForManifest(manifestPath, row.path);
        fileBytes.set(row.path, await fetchJsonBytes(fetchImpl, url, 'domain file ' + row.path,
          LIMITS.fileBytes, total, signal));
      }
    }
    return inspectRawSnapshot({
      versionBytes: versionRaw,
      manifestBytes,
      fileBytes,
      identity: normalizedIdentity,
      page,
      cryptoApi
    });
  }

  async function downloadSnapshotFromVersion({ fetchImpl = globalThis.fetch, identity, versionBytes, page,
    cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, (requestSignal) => downloadPackageFromVersion({
      fetchImpl, identity: normalizedIdentity, versionBytes, page, cryptoApi, signal: requestSignal
    }));
  }

  async function downloadSnapshot({ fetchImpl = globalThis.fetch, identity, page,
    cryptoApi = globalThis.crypto, signal } = {}) {
    requireDependencies();
    const normalizedIdentity = requireIdentity(identity);
    return withDeadline(signal, async (requestSignal) => {
      const versionBytes = await fetchJsonBytes(fetchImpl, fixedUrl('/version.json'), 'version index',
        LIMITS.versionBytes, null, requestSignal);
      return downloadPackageFromVersion({
        fetchImpl, identity: normalizedIdentity, versionBytes, page, cryptoApi, signal: requestSignal
      });
    });
  }

  return Object.freeze({
    LIMITS,
    downloadSnapshot,
    downloadSnapshotFromVersion,
    fetchVersionIndex,
    sameReleasePointer,
    snapshotSupportsPage,
    verifyStoredSnapshot
  });
});
