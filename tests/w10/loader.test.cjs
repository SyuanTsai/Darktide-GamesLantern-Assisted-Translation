'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { downloadSnapshot, verifyStoredSnapshot } = require('../../extension/shared/loader.js');
const { CORE_DOMAIN_KINDS, resealManifest } = require('./fixtures.cjs');
const { makeFetch, makeSyntheticPackage, sha256 } = require('./package-fixtures.cjs');

 test('UnitT10_DownloadsAndValidatesACompleteIsolatedFourDomainPackage', async () => {
  // Scenario: Given an isolated synthetic index and a complete four-domain package with matching pins.
  // Purpose: Verify the full raw-byte-to-domain path before any cache integration exists.
  const fixture = makeSyntheticPackage();

  // Given the local identity names the exact synthetic game release.
  assert.deepEqual(fixture.manifest.files.map((file) => file.kind).sort(), [...CORE_DOMAIN_KINDS].sort());

  // When the bounded loader downloads the fixed-origin package.
  const snapshot = await downloadSnapshot({
    fetchImpl: fixture.fetchImpl,
    identity: fixture.identity,
    cryptoApi: webcrypto
  });

  // Then it returns verified raw files and all four validated domain documents.
  assert.equal(snapshot.manifestSha256, sha256(fixture.manifestBytes));
  assert.equal(snapshot.manifest.contentVersion, fixture.manifest.contentVersion);
  assert.equal(snapshot.files.size, 4);
  assert.equal(snapshot.domains.size, 4);
  for (const file of fixture.manifest.files) assert.ok(snapshot.files.get(file.path) instanceof Uint8Array);
  for (const kind of CORE_DOMAIN_KINDS) assert.equal(snapshot.domains.get(kind).kind, kind);
  assert.ok(fixture.fetchImpl.calls.every(({ init }) => init.redirect === 'error' && init.credentials === 'omit'));
});

test('UnitT11_RejectsManifestAndDomainBytesThatDifferFromTheirPinnedHashes', async (t) => {
  // Scenario: Given an isolated package whose fetched manifest or domain bytes no longer match the pointer/hash pins.
  // Purpose: Bind parsed identity and every accepted domain to the exact index and manifest raw bytes.
  const fixture = makeSyntheticPackage();
  const manifestPath = fixture.version.game_releases.find((row) => row.game_version === fixture.identity.gameVersion).manifest_path;
  const manifestEntry = fixture.resources.get(manifestPath);
  const changedManifest = Buffer.from(manifestEntry.bytes);
  changedManifest[changedManifest.length - 2] ^= 1;
  const manifestMismatch = makeSyntheticPackage();
  manifestMismatch.resources.set(manifestPath, { ...manifestEntry, bytes: changedManifest });

  // Given both tampered bodies still arrive from their canonical package paths.
  // When the index manifest pin or a file content pin is violated.

  // Then neither malformed package is returned as a usable snapshot.
  await assert.rejects(() => downloadSnapshot({
    fetchImpl: manifestMismatch.fetchImpl,
    identity: fixture.identity,
    cryptoApi: webcrypto
  }), /manifest.*sha-?256|manifest hash/i);

  const file = fixture.manifest.files.find((row) => row.kind === 'skills');
  const filePath = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) + file.path;
  const fileEntry = fixture.resources.get(filePath);
  const changedFile = Buffer.from(fileEntry.bytes);
  changedFile[changedFile.length - 2] ^= 1;
  const fileMismatch = makeSyntheticPackage();
  fileMismatch.resources.set(filePath, { ...fileEntry, bytes: changedFile });
  await assert.rejects(() => downloadSnapshot({
    fetchImpl: fileMismatch.fetchImpl,
    identity: fixture.identity,
    cryptoApi: webcrypto
  }), /file.*(size|sha-?256|hash)|domain.*hash/i);
  t.diagnostic('synthetic package cases isolate raw manifest and file pin mismatches');
});
test('UnitT12_RejectsHttpErrorsChallengesAndRedirectedResponses', async () => {
  // Scenario: Given fixed-origin package requests that return an HTTP error, an HTML challenge, or a final URL change.
  // Purpose: Refuse intermediary pages and any response that escaped the requested static JSON resource.
  const fixture = makeSyntheticPackage();
  const manifestPath = fixture.version.game_releases.find((row) => row.game_version === fixture.identity.gameVersion).manifest_path;
  const missing = makeFetch(fixture.resources, {
    '/version.json': { bytes: Buffer.from('missing'), status: 404, contentType: 'application/json' }
  });
  const challenge = makeFetch(fixture.resources, {
    [manifestPath]: { bytes: Buffer.from('<html>challenge</html>'), contentType: 'text/html' }
  });
  const redirected = makeFetch(fixture.resources, {
    '/version.json': {
      ...fixture.resources.get('/version.json'),
      redirected: true,
      finalUrl: 'https://example.invalid/version.json'
    }
  });

  // Given each response has an otherwise familiar path.
  // When the loader checks status, MIME, redirect state, and final URL.

  // Then no challenge, missing resource, or redirected body becomes package data.
  await assert.rejects(() => downloadSnapshot({ fetchImpl: missing, identity: fixture.identity, cryptoApi: webcrypto }), /HTTP status.*404/i);
  await assert.rejects(() => downloadSnapshot({ fetchImpl: challenge, identity: fixture.identity, cryptoApi: webcrypto }), /redirected|final response URL|MIME type/i);
  await assert.rejects(() => downloadSnapshot({ fetchImpl: redirected, identity: fixture.identity, cryptoApi: webcrypto }), /redirect/i);
});

test('UnitT13_EnforcesDecodedStreamLimitsUtf8AndTreatsContentLengthAsAdvisory', async () => {
  // Scenario: Given decoded JSON streams with compressed-size metadata, oversized body chunks, invalid UTF-8, or excessive total pins.
  // Purpose: Bound actual response bytes and reject malformed text without trusting Content-Length for decompressed size.
  const fixture = makeSyntheticPackage();
  const advisoryHeaders = makeFetch(fixture.resources, {
    '/version.json': {
      ...fixture.resources.get('/version.json'),
      headers: { 'content-length': '1', 'content-encoding': 'gzip' }
    }
  });
  const accepted = await downloadSnapshot({ fetchImpl: advisoryHeaders, identity: fixture.identity, cryptoApi: webcrypto });

  // Given a valid decoded body even when the wire-size hint differs from the decoded JSON length.
  assert.equal(accepted.files.size, 4);

  // When a file stream exceeds its actual-byte limit or pinned bytes contain invalid UTF-8.
  const oversizedFixture = makeSyntheticPackage();
  const firstFile = oversizedFixture.manifest.files.slice().sort((a, b) => a.path.localeCompare(b.path))[0];
  const firstFileUrl = '/data/' + oversizedFixture.manifest.dataRevision + '/' + firstFile.path;
  let chunksSent = 0;
  const overLimitStream = new ReadableStream({
    pull(controller) {
      if (chunksSent >= 9) { controller.close(); return; }
      chunksSent += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    }
  });
  const oversized = makeFetch(oversizedFixture.resources, {
    [firstFileUrl]: { bodyStream: overLimitStream, contentType: 'application/json' }
  });
  await assert.rejects(() => downloadSnapshot({ fetchImpl: oversized, identity: oversizedFixture.identity, cryptoApi: webcrypto }), /8 MiB.*limit/i);

  const invalidUtf8 = makeSyntheticPackage({
    mutateFileBytes(filePath, bytes) { return filePath.endsWith('skills.json') ? Buffer.from([0xff, 0xfe]) : bytes; }
  });
  await assert.rejects(() => downloadSnapshot({ fetchImpl: invalidUtf8.fetchImpl, identity: invalidUtf8.identity, cryptoApi: webcrypto }), /UTF-8 decoding failed/i);

  // Then declared aggregate size above 16 MiB is refused before any domain transfer.
  const totalTooLarge = makeSyntheticPackage({ mutateManifest(manifest) {
    manifest.files[0].sizeBytes = 8 * 1024 * 1024;
    manifest.files[1].sizeBytes = 8 * 1024 * 1024;
  } });
  await assert.rejects(() => downloadSnapshot({ fetchImpl: totalTooLarge.fetchImpl, identity: totalTooLarge.identity, cryptoApi: webcrypto }), /16 MiB total byte limit/i);
  assert.equal(totalTooLarge.fetchImpl.calls.length, 2);
});

test('UnitT14_RequiresExactPatchReleaseAndSnapshotIdentityAndRejectsUnsupportedPackageRefs', async () => {
  // Scenario: Given a local game identity that is absent, contradictory, snapshot-only, historical, or uses unsupported features.
  // Purpose: Select only the exact patch and reject historical refs that do not resolve to the requested release.
  const fixture = makeSyntheticPackage();
  await assert.rejects(() => downloadSnapshot({
    fetchImpl: fixture.fetchImpl,
    identity: { gameVersion: '9.9.9', gameReleaseId: 'fixture:missing' },
    cryptoApi: webcrypto
  }), (error) => error.code === 'NO_COMPATIBLE_RELEASE' && error.status === 'no-compatible-release');
  assert.equal(fixture.fetchImpl.calls.length, 1);

  const wrongRelease = makeSyntheticPackage();
  await assert.rejects(() => downloadSnapshot({
    fetchImpl: wrongRelease.fetchImpl,
    identity: { gameVersion: wrongRelease.identity.gameVersion, gameReleaseId: 'fixture:wrong-release' },
    cryptoApi: webcrypto
  }), (error) => error.code === 'NO_COMPATIBLE_RELEASE');

  const snapshotOnly = makeSyntheticPackage();
  await assert.rejects(() => downloadSnapshot({
    fetchImpl: snapshotOnly.fetchImpl,
    identity: { snapshotId: 'isolated-primary-snapshot-alpha' },
    cryptoApi: webcrypto
  }), /gameVersion and gameReleaseId/i);
  assert.equal(snapshotOnly.fetchImpl.calls.length, 0);

  const historical = makeSyntheticPackage();
  await assert.rejects(() => downloadSnapshot({
    fetchImpl: historical.fetchImpl,
    identity: { ...historical.identity, snapshotId: 'opaque-historical-snapshot-gamma' },
    cryptoApi: webcrypto
  }), /snapshot identity does not belong to the exact game release/i);

  const unsupported = makeSyntheticPackage({ mutateManifest(manifest) {
    manifest.compatibility.requiredFeatures.push('fixture-unsupported-feature');
  } });
  await assert.rejects(() => downloadSnapshot({ fetchImpl: unsupported.fetchImpl, identity: unsupported.identity, cryptoApi: webcrypto }), /unknown required feature/i);
});

test('UnitT15_RejectsBadDomainRefsAndAbortedRequestsAndRevalidatesStoredRawBytes', async () => {
  // Scenario: Given a dangling Source record ref, a cancelled request, or a raw cache entry whose bytes changed.
  // Purpose: Validate all domain references before returning and recheck stored bytes without trusting parsed objects.
  const badRefs = makeSyntheticPackage({ mutateDomains(kind, document) {
    if (kind === 'skills') document.source.records.push({
      recordId: 'fixture:root', gameReleaseId: document.gameReleaseId, kind: 'skill',
      refs: [{ recordId: 'fixture:missing', gameReleaseId: document.gameReleaseId, kind: 'term' }]
    });
    return document;
  } });
  await assert.rejects(() => downloadSnapshot({ fetchImpl: badRefs.fetchImpl, identity: badRefs.identity, cryptoApi: webcrypto }), /typed closure is incomplete/i);

  const cancelled = makeSyntheticPackage();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => downloadSnapshot({ fetchImpl: cancelled.fetchImpl, identity: cancelled.identity, cryptoApi: webcrypto, signal: controller.signal }), /cancelled|aborted/i);
  assert.equal(cancelled.fetchImpl.calls.length, 0);

  const validRaw = makeSyntheticPackage();
  const stored = await verifyStoredSnapshot({
    versionBytes: validRaw.versionBytes,
    manifestBytes: validRaw.manifestBytes,
    files: validRaw.rawFiles,
    identity: validRaw.identity,
    cryptoApi: webcrypto
  });
  assert.equal(stored.domains.size, 4);
  const altered = new Map(validRaw.rawFiles);
  const firstPath = validRaw.manifest.files[0].path;
  const changed = altered.get(firstPath).slice();
  changed[0] ^= 1;
  altered.set(firstPath, changed);
  await assert.rejects(() => verifyStoredSnapshot({
    versionBytes: validRaw.versionBytes,
    manifestBytes: validRaw.manifestBytes,
    files: altered,
    identity: validRaw.identity,
    cryptoApi: webcrypto
  }), /file SHA-256/i);
  await assert.rejects(() => verifyStoredSnapshot({
    versionBytes: validRaw.version,
    manifestBytes: validRaw.manifest,
    files: validRaw.domains,
    identity: validRaw.identity,
    cryptoApi: webcrypto
  }), /must be raw bytes/i);
});

test('UnitT16_ExportsTheSameLoaderApiToBrowserGlobalAndCommonJs', () => {
  // Scenario: Given shared contract, domain, and loader sources loaded as classic browser scripts and through CommonJS.
  // Purpose: Keep one fixed-origin loader API available to the extension worker and Node tests.
  const sandbox = {
    AbortController,
    ArrayBuffer,
    Map,
    Set,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    clearTimeout,
    setTimeout
  };
  sandbox.globalThis = sandbox;

  // Given browser-global dependencies are loaded in their required order.
  for (const name of ['contract.js', 'domains.js', 'loader.js']) {
    const sourcePath = require('node:path').resolve(__dirname, '../../extension/shared/' + name);
    require('node:vm').runInNewContext(require('node:fs').readFileSync(sourcePath, 'utf8'), sandbox, { filename: name });
  }

  // Then the browser and CommonJS exports have the same public functions.
  assert.deepEqual(Object.keys(sandbox.W10SharedLoader).sort(), Object.keys(require('../../extension/shared/loader.js')).sort());
  assert.equal(typeof sandbox.W10SharedLoader.downloadSnapshot, 'function');
  assert.equal(typeof sandbox.W10SharedLoader.verifyStoredSnapshot, 'function');
});
test('UnitT18_IgnoresUnneededGameChangeFileWhileSelectingTheFourCoreDependencyClosure', async () => {
  // Scenario: Given a valid shared manifest with a game-changes file outside the required four-core closure.
  // Purpose: Let supported shared extensions coexist without downloading data the extension does not consume.
  const fixture = makeSyntheticPackage();
  const extraBytes = Buffer.from('{"schemaVersion":"isolated-unused-game-changes"}', 'utf8');
  fixture.manifest.files.push({
    kind: 'game-changes',
    path: 'domains/game-changes.json',
    sizeBytes: extraBytes.byteLength,
    sha256: sha256(extraBytes),
    dependencies: []
  });
  fixture.manifest.changeIndexPath = 'domains/game-changes.json';
  resealManifest(fixture.manifest);
  const manifestBytes = Buffer.from(JSON.stringify(fixture.manifest), 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  const current = fixture.version.game_releases.find((row) => row.game_version === fixture.identity.gameVersion);
  current.data_revision = fixture.manifest.dataRevision;
  current.manifest_path = '/data/' + fixture.manifest.dataRevision + '/manifest.json';
  current.manifest_sha256 = manifestSha256;
  fixture.version.data_revision = fixture.manifest.dataRevision;
  const versionBytes = Buffer.from(JSON.stringify(fixture.version), 'utf8');
  const dataDirectory = current.manifest_path.slice(0, current.manifest_path.lastIndexOf('/') + 1);
  const resources = new Map([
    ['/version.json', { bytes: versionBytes, contentType: 'application/json' }],
    [current.manifest_path, { bytes: manifestBytes, contentType: 'application/json' }]
  ]);
  for (const file of fixture.manifest.files) {
    resources.set(dataDirectory + file.path, {
      bytes: file.path === 'domains/game-changes.json' ? extraBytes : fixture.rawFiles.get(file.path),
      contentType: 'application/json'
    });
  }
  fixture.fetchImpl = makeFetch(resources);

  // Given a valid changeIndexPath points to the unneeded extension row.
  assert.equal(fixture.manifest.changeIndexPath, 'domains/game-changes.json');

  // When the extension requests its supported core data.
  const snapshot = await downloadSnapshot({ fetchImpl: fixture.fetchImpl, identity: fixture.identity, cryptoApi: webcrypto });

  // Then it validates and returns only the four core files, never fetching the extra game-changes file.
  assert.equal(snapshot.files.size, 4);
  assert.equal(snapshot.domains.size, 4);
  assert.equal(fixture.fetchImpl.calls.length, 6);
  assert.ok(!fixture.fetchImpl.calls.some(({ url }) => new URL(url).pathname.endsWith('/domains/game-changes.json')));
});
