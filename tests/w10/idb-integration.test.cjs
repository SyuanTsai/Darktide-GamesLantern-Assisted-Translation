'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { ALTERNATE_SNAPSHOT_ID, HISTORICAL_SNAPSHOT_ID, makeSyntheticPackage, sha256 } = require('./package-fixtures.cjs');
const { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot } = require('./browser-runtime.cjs');

const extensionRoot = path.resolve(__dirname, '..', '..');

function withContentVersion(pack, contentVersion) {
  pack.manifest.contentVersion = contentVersion;
  pack.manifestBytes = Buffer.from(JSON.stringify(pack.manifest), 'utf8');
  pack.manifestSha256 = sha256(pack.manifestBytes);
  const release = pack.version.game_releases.find((row) => row.game_version === pack.identity.gameVersion);
  release.content_version = contentVersion;
  release.manifest_sha256 = pack.manifestSha256;
  pack.versionBytes = Buffer.from(JSON.stringify(pack.version), 'utf8');
  pack.resources.set(release.manifest_path, { bytes: pack.manifestBytes, contentType: 'application/json' });
  pack.resources.set('/version.json', { bytes: pack.versionBytes, contentType: 'application/json' });
  return pack;
}

function toBrowserPackage(pack) {
  return {
    versionBytes: pack.versionBytes.toString('base64'),
    manifestBytes: pack.manifestBytes.toString('base64'),
    files: [...pack.rawFiles].map(([filePath, bytes]) => [filePath, bytes.toString('base64')])
  };
}

function makeAssets() {
  return new Map([
    ['/idb-harness.html', path.join(__dirname, 'idb-harness.html')],
    ['/idb-harness.js', path.join(__dirname, 'idb-harness.js')],
    ['/shared/contract.js', path.join(extensionRoot, 'extension/shared/contract.js')],
    ['/shared/domains.js', path.join(extensionRoot, 'extension/shared/domains.js')],
    ['/shared/loader.js', path.join(extensionRoot, 'extension/shared/loader.js')],
    ['/shared/snapshot-store.js', path.join(extensionRoot, 'extension/shared/snapshot-store.js')]
  ]);
}

function startHarnessServer() {
  const assets = makeAssets();
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const filePath = assets.get(pathname);
    if (!filePath || !fs.existsSync(filePath)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
    });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('InterT10_RealChromiumIndexedDbStagesAndAtomicallyPromotesVerifiedSnapshots', async (t) => {
  // Scenario: Given isolated raw W10 packages and an empty private Chromium profile.
  // Purpose: Verify IDB staging, atomic promotion, generation CAS, restart recovery, and previous-compatible fallback.
  const runtime = loadRuntime();
  const profileRoot = createPrivateProfileRoot();
  let server;
  let port;
  let context;
  try {
    ({ server, port } = await startHarnessServer());
    context = await runtime.playwright.chromium.launchPersistentContext(path.join(profileRoot, 'p'), {
      executablePath: runtime.executablePath,
      headless: true,
      viewport: { width: 960, height: 640 }
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:' + port + '/idb-harness.html');
    await page.waitForFunction(() => typeof window.runW10IdbScenario === 'function', { timeout: 10000 });

    // Given two manifests with one canonical dataRevision but distinct contentVersion bytes and hashes.
    const r1 = makeSyntheticPackage();
    const r1SameRevisionDifferentContentVersion = withContentVersion(makeSyntheticPackage(), '9.8.7.2');
    assert.equal(r1.manifest.dataRevision, r1SameRevisionDifferentContentVersion.manifest.dataRevision);
    assert.notEqual(r1.manifestSha256, r1SameRevisionDifferentContentVersion.manifestSha256);
    const badR2 = makeSyntheticPackage({
      mutateFileBytes(filePath, bytes) {
        return filePath.endsWith('skills.json') ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
      }
    });
    const r2 = makeSyntheticPackage({
      mutateFileBytes(filePath, bytes) { return Buffer.concat([bytes, Buffer.from(' ') ]); }
    });
    const r3 = makeSyntheticPackage({
      mutateFileBytes(filePath, bytes) { return Buffer.concat([bytes, Buffer.from('  ') ]); }
    });
    const r4 = makeSyntheticPackage({
      mutateFileBytes(filePath, bytes) { return Buffer.concat([bytes, Buffer.from('   ') ]); }
    });
    const otherRelease = makeSyntheticPackage({ gameVersion: '9.8.8', gameReleaseId: 'fixture:w10-line-b' });
    withContentVersion(r1, '9.8.7.1');
    withContentVersion(r2, '9.8.7.3');
    withContentVersion(r3, '9.8.7.4');
    withContentVersion(r4, '9.8.7.5');
    const badR2Bytes = toBrowserPackage(badR2);
    const corruptFile = badR2Bytes.files.find(([filePath]) => filePath.endsWith('skills.json'));
    corruptFile[1] = Buffer.from('invalid-json', 'utf8').toString('base64');

    // When the scenario runs, raw byte arrays are verified by the shared loader before IDB transactions.
    const result = await page.evaluate((input) => window.runW10IdbScenario(input), {
      identity: r1.identity,
      otherIdentity: otherRelease.identity,
      packages: {
        r1: toBrowserPackage(r1),
        r1SameRevisionDifferentContentVersion: toBrowserPackage(r1SameRevisionDifferentContentVersion),
        badR2: badR2Bytes,
        r2: toBrowserPackage(r2),
        r3: toBrowserPackage(r3),
        r4: toBrowserPackage(r4),
        otherRelease: toBrowserPackage(otherRelease)
      },
      snapshotIds: {
        alternative: ALTERNATE_SNAPSHOT_ID,
        historical: HISTORICAL_SNAPSHOT_ID,
        unknown: 'isolated-unknown-snapshot-delta'
      },
      contentVersions: {
        r1: '9.8.7.1',
        r1SameRevisionDifferentContentVersion: '9.8.7.2',
        r2: '9.8.7.3',
        r3: '9.8.7.4',
        r4: '9.8.7.5',
        otherRelease: '9.8.8.1'
      }
    });

    // Then only a complete verified current or previous snapshot survives faults, races, and database reopen.
    assert.deepEqual(pageErrors, []);
    assert.equal(result.failedCandidatePreserved, '9.8.7.1');
    assert.equal(result.abortWasInjected, true);
    assert.equal(result.winnerAfterRace, '9.8.7.4');
    assert.equal(result.activeAfterReopen, '9.8.7.4');
    assert.equal(result.fallbackAfterCorruption, '9.8.7.3');
    assert.equal(result.unavailableCode, 'IDB_UNAVAILABLE');
    assert.equal(result.snapshotRowsAfterCleanup, 3);
    assert.equal(result.snapshotRowsAfterManualActiveDelete, 2);
    assert.equal(result.stagingRowsAfterCleanup, 0);
    assert.equal(result.stagingCorruptionWasInjected, true);
    assert.equal(result.otherReleaseAfterReopen, '9.8.8.1');
    t.diagnostic(JSON.stringify({
      browserVersion: context.browser().version(),
      playwrightVersion: runtime.playwrightVersion,
      origin: 'http://127.0.0.1:' + port,
      database: result.idbName,
      controlledAbort: 'synthetic IDB transaction abort; not actual disk quota exhaustion',
      activeAfterReopen: result.activeAfterReopen,
      fallbackAfterCorruption: result.fallbackAfterCorruption,
      snapshotRowsAfterCleanup: result.snapshotRowsAfterCleanup,
      stagingRowsAfterCleanup: result.stagingRowsAfterCleanup
    }, null, 2));
  } finally {
    if (context) await context.close();
    if (server && server.listening) await new Promise((resolve) => server.close(resolve));
    removePrivateProfileRoot(profileRoot);
  }
});
