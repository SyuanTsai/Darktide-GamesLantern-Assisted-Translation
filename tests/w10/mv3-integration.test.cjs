'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PREVIEW_ORIGIN, buildDevExtension } = require('../../scripts/shared/build-dev-extension.cjs');
const {
  PRIMARY_SNAPSHOT_ID,
  makeSyntheticPackage,
  sha256
} = require('./package-fixtures.cjs');
const { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot } = require('./browser-runtime.cjs');

const SHARED_PROGRAM_FILES = Object.freeze([
  'baseline-provider.js', 'client.js', 'contract.js', 'document-session.js', 'domains.js',
  'loader.js', 'service-worker.js', 'snapshot-store.js', 'update-coordinator.js'
]);

function removeBuild(result) {
  if (!result) return;
  const privateRoot = path.resolve(path.join(os.tmpdir(), 'syp-w10-builds'));
  const output = path.resolve(result.outputRoot);
  if (!output.startsWith(privateRoot + path.sep) || !path.basename(output).startsWith('build-')) {
    throw new Error('Refusing to remove a path outside the private W10 build root');
  }
  fs.rmSync(output, { recursive: true, force: true, maxRetries: 3 });
}

function setContentVersion(pack, contentVersion) {
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

function sharedProgramHash(extensionPath) {
  const sharedRoot = path.join(extensionPath, 'shared');
  const hash = createHash('sha256');
  for (const name of SHARED_PROGRAM_FILES) {
    hash.update(name, 'utf8');
    hash.update(fs.readFileSync(path.join(sharedRoot, name)));
  }
  return hash.digest('hex');
}

function candidateRoutePackage(extensionPath) {
  const baselineRoot = path.join(extensionPath, 'baseline');
  const versionBytes = fs.readFileSync(path.join(baselineRoot, 'version.json'));
  const manifestBytes = fs.readFileSync(path.join(baselineRoot, 'manifest.json'));
  const version = JSON.parse(versionBytes.toString('utf8'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const release = version.game_releases.find((row) => row.game_version === manifest.gameVersion);
  assert.ok(release);
  const dataDirectory = release.manifest_path.slice(0, release.manifest_path.lastIndexOf('/') + 1);
  const resources = new Map([
    ['/version.json', { bytes: versionBytes, contentType: 'application/json' }],
    [release.manifest_path, { bytes: manifestBytes, contentType: 'application/json' }]
  ]);
  const fileBytes = new Map();
  for (const row of manifest.files) {
    const bytes = fs.readFileSync(path.join(baselineRoot, ...row.path.split('/')));
    fileBytes.set(row.path, bytes);
    resources.set(dataDirectory + row.path, { bytes, contentType: 'application/json' });
  }
  return { manifest, resources, fileBytes, version, versionBytes, manifestBytes };
}

async function startExtension({ includeCandidate = false } = {}) {
  const runtime = loadRuntime();
  const priorCandidate = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  let built;
  let profileRoot;
  let context;
  try {
    if (!includeCandidate) delete process.env.SYP_W10_APPROVED_PACKAGE_DIR;
    built = buildDevExtension({ includeTestHarness: true });
  } finally {
    if (priorCandidate === undefined) delete process.env.SYP_W10_APPROVED_PACKAGE_DIR;
    else process.env.SYP_W10_APPROVED_PACKAGE_DIR = priorCandidate;
  }
  profileRoot = createPrivateProfileRoot();
  const originalWorkingDirectory = process.cwd();
  try {
    process.chdir(built.outputRoot);
    context = await runtime.playwright.chromium.launchPersistentContext(path.join(profileRoot, 'p'), {
      executablePath: runtime.executablePath,
      headless: true,
      viewport: { width: 960, height: 640 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + built.extensionPath, '--load-extension=' + built.extensionPath]
    });
    let worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith('/shared/service-worker.js'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    assert.ok(worker.url().endsWith('/shared/service-worker.js'), 'W10 MV3 service worker did not load');
    const extensionId = new URL(worker.url()).hostname;
    return { built, context, extensionId, originalWorkingDirectory, profileRoot, runtime, worker };
  } catch (error) {
    if (context) await context.close();
    process.chdir(originalWorkingDirectory);
    removePrivateProfileRoot(profileRoot);
    removeBuild(built);
    throw error;
  }
}

async function stopExtension(started) {
  if (!started) return;
  if (started.context) await started.context.close();
  if (started.originalWorkingDirectory) process.chdir(started.originalWorkingDirectory);
  removePrivateProfileRoot(started.profileRoot);
  removeBuild(started.built);
}

function addPreviewRoute(context, state) {
  context.route(PREVIEW_ORIGIN + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let workerOwned = false;
    try { workerOwned = !!request.serviceWorker(); } catch (_) { }
    state.requests.push({ pathname: url.pathname, workerOwned });
    if (state.offline) {
      await route.abort('internetdisconnected');
      return;
    }
    const resource = state.current && state.current.resources.get(url.pathname);
    if (!resource) {
      await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
      return;
    }
    let body = Buffer.from(resource.bytes);
    if (state.corruptPath === url.pathname) body = Buffer.concat([body, Buffer.from(' ') ]);
    await route.fulfill({
      status: 200,
      contentType: resource.contentType + '; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body
    });
  });
}

async function openHarness(context, extensionId) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('chrome-extension://' + extensionId + '/w10-harness.html');
  await page.waitForFunction(() => !!globalThis.w10Harness, { timeout: 10000 });
  return { page, pageErrors };
}

test('InterT30_Mv3ClientPinsDocumentsAndSurvivesWorkerRestartAndFailedUpdate', async (t) => {
  // Scenario: Given an isolated preview-origin MV3 build and synthetic R1/R2 packages.
  // Purpose: Verify JSON messages, exact version-only unchanged checks, document pinning, rollback, and real worker restart.
  const r1 = setContentVersion(makeSyntheticPackage(), '9.8.7.1');
  const r2 = setContentVersion(makeSyntheticPackage({
    mutateFileBytes(_filePath, bytes) { return Buffer.concat([bytes, Buffer.from(' ') ]); }
  }), '9.8.7.2');
  const identity = { ...r1.identity, snapshotId: PRIMARY_SNAPSHOT_ID };
  const current = { current: r1, offline: false, corruptPath: null, requests: [] };
  let started;
  try {
    started = await startExtension();
    const sharedCodeBefore = sharedProgramHash(started.built.extensionPath);
    addPreviewRoute(started.context, current);
    const first = await openHarness(started.context, started.extensionId);
    const firstPage = first.page;
    const firstInit = await firstPage.evaluate(async (trustedIdentity) => {
      const client = globalThis.w10Harness.createClient();
      globalThis.__w10PinnedClient = client;
      return globalThis.w10Harness.snapshotSummary(await client.initialize(trustedIdentity));
    }, identity);
    assert.equal(firstInit.status, 'ready');
    assert.equal(firstInit.source, 'active');
    assert.equal(firstInit.contentVersion, '9.8.7.1');
    assert.match(firstInit.statusText, /已載入|已驗證/);
    assert.equal(current.requests.length, 6, 'initial update should fetch one version, one manifest, and four core domains');

    // Given R1 is active, When a manual check sees the identical pointer, Then it fetches only version.json.
    const beforeUnchanged = current.requests.length;
    const unchanged = await firstPage.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.createClient().checkNow(trustedIdentity), identity);
    assert.equal(unchanged.updateStatus, 'unchanged');
    assert.deepEqual(current.requests.slice(beforeUnchanged).map((entry) => entry.pathname), ['/version.json']);

    // When R2 is announced with a corrupt domain body, the complete candidate is rejected and R1 stays active.
    current.current = r2;
    current.corruptPath = r2.manifest.gameVersion === '9.8.7'
      ? r2.version.game_releases.find((row) => row.game_version === '9.8.7').manifest_path.replace(/\/manifest\.json$/, '/domains/skills.json')
      : null;
    const failedUpdate = await firstPage.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.createClient().checkNow(trustedIdentity), identity);
    assert.equal(failedUpdate.source, 'active');
    assert.equal(failedUpdate.updateStatus, 'failed');
    const activeAfterFailure = await firstPage.evaluate((trustedIdentity) =>
      globalThis.w10Harness.inspectStore(trustedIdentity), identity);
    assert.equal(activeAfterFailure.activeContentVersion, '9.8.7.1');

    // When R2 is served correctly and manually checked, the cache advances while this document remains pinned to R1.
    current.corruptPath = null;
    const updated = await firstPage.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.createClient().checkNow(trustedIdentity), identity);
    assert.equal(updated.updateStatus, 'updated');
    const sharedCodeAfter = sharedProgramHash(started.built.extensionPath);
    assert.equal(sharedCodeAfter, sharedCodeBefore, 'the shared code changed while package bytes moved from R1 to R2');
    const stillPinned = await firstPage.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.snapshotSummary(await globalThis.__w10PinnedClient.initialize(trustedIdentity)), identity);
    assert.equal(stillPinned.contentVersion, '9.8.7.1');
    assert.equal(stillPinned.status, 'ready');
    const changedIdentity = await firstPage.evaluate(async () => {
      const result = await globalThis.__w10PinnedClient.initialize({
        gameVersion: '9.8.7', gameReleaseId: 'fixture:changed-line'
      });
      return globalThis.w10Harness.snapshotSummary(result);
    });
    assert.equal(changedIdentity.source, 'original');
    assert.equal(changedIdentity.reason, 'identity-changed');
    assert.match(changedIdentity.statusText, /原站內容/);

    const second = await openHarness(started.context, started.extensionId);
    const secondInit = await second.page.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.snapshotSummary(await globalThis.w10Harness.createClient().initialize(trustedIdentity)), identity);
    assert.equal(secondInit.contentVersion, '9.8.7.2');
    assert.equal(secondInit.status, 'ready');
    const lastSuccessBeforeRestart = (await second.page.evaluate((trustedIdentity) =>
      globalThis.w10Harness.inspectStore(trustedIdentity), identity)).lastSuccessAt;
    assert.ok(Number.isFinite(lastSuccessBeforeRestart));

    const unknownPage = await openHarness(started.context, started.extensionId);
    const unknown = await unknownPage.page.evaluate(async () => {
      const client = globalThis.w10Harness.createClient();
      const result = await client.initialize({ gameVersion: '9.8.8', gameReleaseId: 'fixture:unknown-line' });
      return globalThis.w10Harness.snapshotSummary(result);
    });
    assert.equal(unknown.source, 'original');
    assert.equal(unknown.status, 'original');
    assert.match(unknown.statusText, /原站內容/);

    const beforeBoot = await started.worker.evaluate(() => ({
      marker: globalThis.__W10_BOOT_MARKER,
      timeOrigin: globalThis.__W10_BOOT_TIME_ORIGIN
    }));
    assert.ok(beforeBoot.marker);
    const cdp = await started.context.newCDPSession(second.page);
    const targets = await cdp.send('Target.getTargets');
    const workerTarget = targets.targetInfos.find((item) => item.type === 'service_worker'
      && item.url === started.worker.url());
    assert.ok(workerTarget, 'live W10 service worker target was not found before controlled restart');
    await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
    const beforeRestartRequests = current.requests.length;
    const resumed = await second.page.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.snapshotSummary(await globalThis.w10Harness.createClient().initialize(trustedIdentity)), identity);
    assert.equal(resumed.contentVersion, '9.8.7.2');
    const afterBoot = await started.worker.evaluate(() => ({
      marker: globalThis.__W10_BOOT_MARKER,
      timeOrigin: globalThis.__W10_BOOT_TIME_ORIGIN
    }));
    assert.ok(afterBoot.marker);
    assert.notEqual(afterBoot.marker, beforeBoot.marker, 'service worker boot marker did not reset after termination');
    assert.notEqual(afterBoot.timeOrigin, beforeBoot.timeOrigin, 'service worker execution context did not restart');
    assert.equal(current.requests.length, beforeRestartRequests, 'restart should reuse the persistent cache without a version fetch');
    const afterRestartStore = await second.page.evaluate((trustedIdentity) =>
      globalThis.w10Harness.inspectStore(trustedIdentity), identity);
    assert.equal(afterRestartStore.activeContentVersion, '9.8.7.2');
    assert.equal(afterRestartStore.lastSuccessAt, lastSuccessBeforeRestart);
    assert.ok(current.requests.every((entry) => entry.workerOwned), 'a fixed-origin data request was not owned by the MV3 worker');
    assert.deepEqual(first.pageErrors, []);
    assert.deepEqual(second.pageErrors, []);
    assert.deepEqual(unknownPage.pageErrors, []);
    t.diagnostic(JSON.stringify({
      playwrightVersion: started.runtime.playwrightVersion,
      chromeVersion: started.context.browser().version(),
      sharedCodeSha256BeforeAndAfter: sharedCodeBefore,
      extensionId: started.extensionId,
      previewOrigin: PREVIEW_ORIGIN,
      workerDataRequests: current.requests.length,
      unchangedManualRequestPaths: ['/version.json'],
      failedUpdatePreserved: activeAfterFailure.activeContentVersion,
      documentOneVersion: stillPinned.contentVersion,
      changedIdentitySource: changedIdentity.source,
      documentTwoVersion: secondInit.contentVersion,
      unknownIdentitySource: unknown.source,
      beforeBoot,
      afterBoot,
      persistedActive: afterRestartStore.activeContentVersion,
      persistedLastSuccessAt: afterRestartStore.lastSuccessAt
    }, null, 2));
  } finally {
    await stopExtension(started);
  }
});

test('InterT05_NoBaselineAndNetworkDisconnectReturnsOriginal', async (t) => {
  // Scenario: Given a fresh extension profile with no cached or bundled baseline package.
  // Purpose: Confirm a real disconnected fixed-origin request leaves the client in original-site state.
  const pack = makeSyntheticPackage();
  const state = { current: null, offline: true, corruptPath: null, requests: [] };
  let started;
  try {
    started = await startExtension();
    addPreviewRoute(started.context, state);
    const opened = await openHarness(started.context, started.extensionId);
    const result = await opened.page.evaluate(async (identity) =>
      globalThis.w10Harness.snapshotSummary(await globalThis.w10Harness.createClient().initialize(identity)), pack.identity);
    assert.equal(result.status, 'original');
    assert.equal(result.source, 'original');
    assert.match(result.statusText, /原站內容/);
    assert.deepEqual(state.requests.map((entry) => entry.pathname), ['/version.json']);
    assert.ok(state.requests.every((entry) => entry.workerOwned));
    const stored = await opened.page.evaluate((identity) => globalThis.w10Harness.inspectStore(identity), pack.identity);
    assert.equal(stored.activeKey, null);
    assert.equal(stored.lastSuccessAt, null);
    assert.deepEqual(opened.pageErrors, []);
    t.diagnostic(JSON.stringify({ source: result.source, statusText: result.statusText,
      fixedOriginRoute: state.requests, activeKey: stored.activeKey, lastSuccessAt: stored.lastSuccessAt }, null, 2));
  } finally {
    await stopExtension(started);
  }
});

test('InterT40_ApprovedUnselectedCandidateWorksAsAnOfflineBaselineWithoutPublishingActive', async (t) => {
  // Scenario: Given the explicit fixed-input candidate directory and an offline fixed preview route.
  // Purpose: Verify the real 7 MiB candidate passes the extension baseline, JSON message, and client raw-byte validation path.
  if (!process.env.SYP_W10_APPROVED_PACKAGE_DIR) {
    t.skip('SYP_W10_APPROVED_PACKAGE_DIR is not set; no approved candidate package was supplied');
    return;
  }
  const state = { current: null, offline: true, corruptPath: null, requests: [] };
  let started;
  try {
    started = await startExtension({ includeCandidate: true });
    addPreviewRoute(started.context, state);
    const opened = await openHarness(started.context, started.extensionId);
    const identity = {
      gameVersion: '1.13.2',
      gameReleaseId: 'darktide:1.13.2',
      snapshotId: 'psyker-skills-blessings-1.13.2-18-files'
    };
    const baseline = await opened.page.evaluate(async (trustedIdentity) =>
      globalThis.w10Harness.snapshotSummary(await globalThis.w10Harness.createClient().initialize(trustedIdentity)), identity);
    assert.equal(baseline.status, 'ready');
    assert.equal(baseline.source, 'baseline');
    assert.equal(baseline.contentVersion, '1.13.2.1');
    assert.equal(baseline.dataRevision, '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62');
    assert.equal(baseline.manifestSha256, 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7');
    assert.deepEqual(state.requests.map((entry) => entry.pathname), ['/version.json']);
    assert.ok(state.requests.every((entry) => entry.workerOwned));
    const stored = await opened.page.evaluate((trustedIdentity) => globalThis.w10Harness.inspectStore(trustedIdentity), identity);
    assert.equal(stored.activeKey, null, 'an extension-local baseline was incorrectly written as a published active snapshot');
    assert.equal(stored.lastSuccessAt, null, 'a failed offline fetch was incorrectly recorded as successful publication');
    assert.match(baseline.statusText, /基礎資料/);
    assert.deepEqual(opened.pageErrors, []);
    t.diagnostic(JSON.stringify({
      source: baseline.source,
      proposalOnlyContentVersion: baseline.contentVersion,
      manifestSha256: baseline.manifestSha256,
      dataRevision: baseline.dataRevision,
      remoteRouteRequests: state.requests,
      activeKey: stored.activeKey,
      lastSuccessAt: stored.lastSuccessAt,
      provenance: JSON.parse(fs.readFileSync(path.join(started.built.extensionPath, 'baseline', 'provenance.json'), 'utf8'))
    }, null, 2));
  } finally {
    await stopExtension(started);
  }
});

test('InterT50_ApprovedCandidateDownloadsThroughFixedPreviewRouteAndActivatesExactRawBytes', async (t) => {
  // Scenario: Given the explicit unselected W09 package and the isolated fixed-preview MV3 build.
  // Purpose: Exercise true-candidate download, IndexedDB activation, JSON message transport, and client byte revalidation.
  if (!process.env.SYP_W10_APPROVED_PACKAGE_DIR) {
    t.skip('SYP_W10_APPROVED_PACKAGE_DIR is not set; no approved candidate package was supplied');
    return;
  }
  const state = { current: null, offline: false, corruptPath: null, requests: [] };
  let started;
  try {
    started = await startExtension({ includeCandidate: true });
    const packageEvidence = candidateRoutePackage(started.built.extensionPath);
    state.current = packageEvidence;
    addPreviewRoute(started.context, state);
    const opened = await openHarness(started.context, started.extensionId);
    const identity = {
      gameVersion: '1.13.2',
      gameReleaseId: 'darktide:1.13.2',
      snapshotId: 'psyker-skills-blessings-1.13.2-18-files'
    };
    const evidence = await opened.page.evaluate(async (trustedIdentity) => {
      const result = await globalThis.w10Harness.createClient().initialize(trustedIdentity);
      const summary = globalThis.w10Harness.snapshotSummary(result);
      const files = [];
      if (result.snapshot) {
        for (const [path, bytes] of result.snapshot.files) {
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          files.push({ path, sizeBytes: bytes.byteLength, sha256: [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0')).join('') });
        }
      }
      return { summary, files, totalDomainBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) };
    }, identity);
    const expectedRows = packageEvidence.manifest.files.map((row) => ({
      path: row.path, sizeBytes: row.sizeBytes, sha256: row.sha256
    })).sort((left, right) => left.path.localeCompare(right.path));
    assert.equal(evidence.summary.status, 'ready');
    assert.equal(evidence.summary.source, 'active');
    assert.equal(evidence.summary.contentVersion, '1.13.2.1');
    assert.equal(evidence.summary.dataRevision, '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62');
    assert.equal(evidence.summary.manifestSha256, 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7');
    assert.equal(evidence.totalDomainBytes, 7_065_789);
    assert.deepEqual(evidence.files.sort((left, right) => left.path.localeCompare(right.path)), expectedRows);
    const manifestPath = packageEvidence.version.game_releases.find((row) => row.game_version === '1.13.2').manifest_path;
    const dataDirectory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
    assert.deepEqual(state.requests.map((entry) => entry.pathname), [
      '/version.json', manifestPath, ...packageEvidence.manifest.files.map((row) => dataDirectory + row.path)
    ]);
    assert.ok(state.requests.every((entry) => entry.workerOwned), 'candidate route requests were not owned by the extension worker');
    const stored = await opened.page.evaluate((trustedIdentity) => globalThis.w10Harness.inspectStore(trustedIdentity), identity);
    assert.ok(stored.activeKey);
    assert.equal(stored.activeContentVersion, '1.13.2.1');
    assert.equal(stored.activeManifestSha256, 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7');
    assert.ok(Number.isFinite(stored.lastSuccessAt));
    assert.deepEqual(opened.pageErrors, []);
    t.diagnostic(JSON.stringify({
      source: evidence.summary.source,
      manifestSha256: evidence.summary.manifestSha256,
      dataRevision: evidence.summary.dataRevision,
      totalDomainBytes: evidence.totalDomainBytes,
      files: evidence.files,
      fixedOriginLocalRouteOnly: true,
      routeRequests: state.requests,
      activeContentVersion: stored.activeContentVersion,
      activeManifestSha256: stored.activeManifestSha256,
      lastSuccessAt: stored.lastSuccessAt,
      packageSelection: 'unselected isolation-only proposal; not allocated or published'
    }, null, 2));
  } finally {
    await stopExtension(started);
  }
});
