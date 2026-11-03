'use strict';

const { createHash } = require('node:crypto');
const {
  CORE_DOMAIN_KINDS,
  makeManifest,
  makeVersionForManifest,
  resealManifest
} = require('./fixtures.cjs');

// Isolated test-only identities. They do not reserve or publish a game/content version.
const GAME_VERSION = '9.8.7';
const GAME_RELEASE_ID = 'fixture:w10-loader';
const PRIMARY_SNAPSHOT_ID = 'isolated-primary-snapshot-alpha';
const ALTERNATE_SNAPSHOT_ID = 'isolated-alternative-snapshot-beta';
const HISTORICAL_SNAPSHOT_ID = 'opaque-historical-snapshot-gamma';
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshot(snapshotId, marker) {
  return {
    snapshotId,
    commit: marker.repeat(40),
    contentSha256: marker.repeat(64),
    manifestSha256: String.fromCharCode(marker.charCodeAt(0) + 1).repeat(64)
  };
}

function release(gameReleaseId, gameVersion, snapshotId, marker) {
  return {
    gameBuild: 'isolated-test-build-' + marker,
    gameReleaseId,
    gameVersion,
    releaseOrder: marker === 'a' ? 1 : 2,
    snapshot: snapshot(snapshotId, marker)
  };
}

function makeDomain(kind, changes = {}, identity = { gameVersion: GAME_VERSION, gameReleaseId: GAME_RELEASE_ID }) {
  const document = {
    schemaVersion: 'w08-shared-domain/1.0.0',
    kind,
    gameReleaseId: identity.gameReleaseId,
    source: {
      repository: SOURCE_REPOSITORY,
      gameReleases: [
        release('fixture:w10-history', '9.8.6', HISTORICAL_SNAPSHOT_ID, 'a'),
        release(identity.gameReleaseId, identity.gameVersion, PRIMARY_SNAPSHOT_ID, 'c')
      ],
      sourceSnapshots: [
        { gameReleaseId: identity.gameReleaseId, snapshot: snapshot(ALTERNATE_SNAPSHOT_ID, 'e') }
      ],
      sourceRefs: [],
      records: [],
      tombstones: [],
      reviewReceipts: []
    },
    web: {
      presentations: [],
      officialInputs: { sources: [] },
      termLocalizations: [],
      termRules: [],
      announcements: [],
      gameChanges: [],
      officialTextChanges: [],
      reviewTargets: [],
      reviewReceipts: []
    }
  };
  return typeof changes === 'function' ? changes(document) ?? document : document;
}

function makeSyntheticPackage({ mutateManifest, mutateDomains, mutateFileBytes, gameVersion = GAME_VERSION,
  gameReleaseId = GAME_RELEASE_ID } = {}) {
  const domains = new Map();
  for (const kind of CORE_DOMAIN_KINDS) {
    domains.set(kind, makeDomain(kind, mutateDomains ? (document) => mutateDomains(kind, document) : undefined,
      { gameVersion, gameReleaseId }));
  }

  const manifest = makeManifest();
  manifest.gameReleaseId = gameReleaseId;
  manifest.gameVersion = gameVersion;
  manifest.contentVersion = gameVersion + '.1';
  manifest.compatibility.gameSnapshotRefs = [
    PRIMARY_SNAPSHOT_ID,
    ALTERNATE_SNAPSHOT_ID,
    HISTORICAL_SNAPSHOT_ID
  ];
  const rawFiles = new Map();
  for (const file of manifest.files) {
    let bytes = Buffer.from(JSON.stringify(domains.get(file.kind)), 'utf8');
    if (mutateFileBytes) bytes = Buffer.from(mutateFileBytes(file.path, bytes) ?? bytes);
    rawFiles.set(file.path, bytes);
    file.sizeBytes = bytes.byteLength;
    file.sha256 = sha256(bytes);
  }
  if (mutateManifest) mutateManifest(manifest);
  resealManifest(manifest);

  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  const version = makeVersionForManifest(manifest);
  const releaseRow = version.game_releases.find((row) => row.game_version === gameVersion);
  releaseRow.manifest_sha256 = manifestSha256;
  version.data_revision = manifest.dataRevision;
  version.game_version = gameVersion;
  const versionBytes = Buffer.from(JSON.stringify(version), 'utf8');
  const manifestPath = releaseRow.manifest_path;
  const dataDirectory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
  const resources = new Map([
    ['/version.json', { bytes: versionBytes, contentType: 'application/json' }],
    [manifestPath, { bytes: manifestBytes, contentType: 'application/json' }]
  ]);
  for (const file of manifest.files) {
    resources.set(dataDirectory + file.path, { bytes: rawFiles.get(file.path), contentType: 'application/json' });
  }

  return {
    domains,
    fetchImpl: makeFetch(resources),
    manifest,
    manifestBytes,
    manifestSha256,
    resources,
    rawFiles,
    version,
    versionBytes,
    identity: { gameVersion, gameReleaseId }
  };
}

function makeSplitSyntheticPackage({ mutateSplitDocuments } = {}) {
  const legacy = makeSyntheticPackage({ mutateDomains(kind, document) {
    if (kind === 'weapons') {
      const entityRef = { recordId: 'fixture:weapon:chainaxe', gameReleaseId: GAME_RELEASE_ID, kind: 'weapon' };
      document.source.records.push({ ...entityRef, payload: { familyId: 'chainaxe_p1', markId: 'chainaxe_p1_m1' } });
      document.web.presentations.push({ entityRef, locale: 'zh-TW', name: '鏈鋸斧',
        nameOfficialLocaleRefs: [{ officialSourceId: 'fixture:weapon-name-en', sourceLocale: 'en' }] });
      document.web.officialInputs.sources.push({ entityRef, officialSourceId: 'fixture:weapon-name-en',
        sourceLocale: 'en', sourceText: 'Assault Chainaxe', resolvedText: 'Assault Chainaxe', segments: [] });
    }
    if (kind === 'blessings') {
      const entityRef = { recordId: 'darktide:blessing:rev-it-up', gameReleaseId: GAME_RELEASE_ID, kind: 'blessing' };
      document.source.records.push({ ...entityRef, payload: { variantRefs: [] } });
      document.web.presentations.push({ entityRef, locale: 'zh-TW', name: '提速',
        nameOfficialLocaleRefs: [{ officialSourceId: 'fixture:blessing-name-en', sourceLocale: 'en' }] });
      document.web.officialInputs.sources.push({ entityRef, officialSourceId: 'fixture:blessing-name-en',
        sourceLocale: 'en', sourceText: 'Rev It Up', resolvedText: 'Rev It Up', segments: [] });
    }
    return document;
  } });
  const splitDocuments = new Map();
  for (const kind of ['skills', 'terms']) splitDocuments.set('domains/' + kind + '.json', legacy.domains.get(kind));
  for (const [kind, filePath, sourceKind] of [
    ['weapons-index', 'domains/weapons-index.json', 'weapons'],
    ['weapon-family', 'domains/weapons/chainaxe_p1.json', 'weapons'],
    ['blessings-index', 'domains/blessings-index.json', 'blessings'],
    ['blessing', 'domains/blessings/rev-it-up.json', 'blessings']
  ]) {
    const document = structuredClone(legacy.domains.get(sourceKind));
    document.kind = kind;
    splitDocuments.set(filePath, document);
  }
  if (mutateSplitDocuments) mutateSplitDocuments(splitDocuments);
  const dependencies = {
    skills: ['domains/terms.json'], terms: [], 'weapons-index': [],
    'weapon-family': ['domains/weapons-index.json'], 'blessings-index': [],
    blessing: ['domains/blessings-index.json']
  };
  const manifest = structuredClone(legacy.manifest);
  manifest.compatibility.requiredFeatures.push('split-weapon-blessing-domains-v1');
  manifest.files = [...splitDocuments].map(([filePath, document]) => {
    const bytes = Buffer.from(JSON.stringify(document), 'utf8');
    return { kind: document.kind, path: filePath, sizeBytes: bytes.byteLength,
      sha256: sha256(bytes), dependencies: dependencies[document.kind] };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  resealManifest(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  const version = makeVersionForManifest(manifest);
  version.data_revision = manifest.dataRevision;
  version.game_version = manifest.gameVersion;
  version.game_releases.find((row) => row.game_version === manifest.gameVersion).manifest_sha256 = manifestSha256;
  const versionBytes = Buffer.from(JSON.stringify(version), 'utf8');
  const manifestPath = version.game_releases.find((row) => row.game_version === manifest.gameVersion).manifest_path;
  const dataDirectory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
  const rawFiles = new Map([...splitDocuments].map(([filePath, document]) =>
    [filePath, Buffer.from(JSON.stringify(document), 'utf8')]));
  const resources = new Map([
    ['/version.json', { bytes: versionBytes, contentType: 'application/json' }],
    [manifestPath, { bytes: manifestBytes, contentType: 'application/json' }]
  ]);
  for (const [filePath, bytes] of rawFiles) {
    resources.set(dataDirectory + filePath, { bytes, contentType: 'application/json' });
  }
  return { domains: splitDocuments, fetchImpl: makeFetch(resources), manifest, manifestBytes, manifestSha256,
    rawFiles, resources, version, versionBytes, identity: legacy.identity };
}

function makeFetch(resources, overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, init });
    const entry = overrides[url.pathname] ?? resources.get(url.pathname);
    if (!entry) return makeResponse(url.href, { status: 404, bytes: Buffer.from('not found'), contentType: 'text/plain' });
    return makeResponse(url.href, entry);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function makeResponse(url, {
  bytes,
  status = 200,
  contentType = 'application/json',
  headers = {},
  redirected = false,
  finalUrl,
  bodyStream,
  chunks
}) {
  const bodyBytes = Buffer.from(bytes ?? []);
  const rows = chunks ?? [bodyBytes];
  const body = bodyStream ?? new ReadableStream({
    start(controller) {
      for (const chunk of rows) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    }
  });
  const values = new Map(Object.entries({ 'content-type': contentType, ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    body,
    headers: { get(name) { return values.get(String(name).toLowerCase()) ?? null; } },
    ok: status >= 200 && status < 300,
    redirected,
    status,
    url: finalUrl ?? url
  };
}

module.exports = {
  ALTERNATE_SNAPSHOT_ID,
  GAME_RELEASE_ID,
  GAME_VERSION,
  HISTORICAL_SNAPSHOT_ID,
  PRIMARY_SNAPSHOT_ID,
  SOURCE_REPOSITORY,
  makeDomain,
  makeFetch,
  makeResponse,
  makeSplitSyntheticPackage,
  makeSyntheticPackage,
  sha256
};
