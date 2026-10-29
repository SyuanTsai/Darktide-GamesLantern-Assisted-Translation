'use strict';

const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const loader = require('../../extension/shared/loader.js');
const presentation = require('../../extension/shared/presentation.js');
const { PREVIEW_ORIGIN, buildDevExtension } = require('../../scripts/shared/build-dev-extension.cjs');
const { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot } = require('../w10/browser-runtime.cjs');

const GAME_ORIGIN = 'https://darktide.gameslantern.com';
const GAME_RELEASE_ID = 'darktide:1.13.2';
const SNAPSHOT_ID = 'psyker-skills-blessings-1.13.2-18-files';
const MANIFEST_SHA256 = 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7';
const DATA_REVISION = '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62';
const DOMAIN_BYTES = 7065789;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function removeBuild(result) {
  if (!result) return;
  const privateRoot = path.resolve(path.join(os.tmpdir(), 'syp-w10-builds'));
  const output = path.resolve(result.outputRoot);
  if (!output.startsWith(privateRoot + path.sep) || !path.basename(output).startsWith('build-')) {
    throw new Error('Refusing to remove a build outside the private W10 root');
  }
  fs.rmSync(output, { recursive: true, force: true, maxRetries: 3 });
}

function readCandidate() {
  const inputRoot = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  if (!inputRoot || !path.isAbsolute(inputRoot)) throw new Error('SYP_W10_APPROVED_PACKAGE_DIR must name the fixed local candidate');
  const manifestBytes = fs.readFileSync(path.join(inputRoot, 'manifest.json'));
  assert.equal(sha256(manifestBytes), MANIFEST_SHA256, 'candidate manifest raw SHA changed');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.dataRevision, DATA_REVISION);
  const files = new Map();
  let domainBytes = 0;
  for (const row of manifest.files) {
    const raw = fs.readFileSync(path.join(inputRoot, ...row.path.split('/')));
    assert.equal(raw.byteLength, row.sizeBytes, row.path + ' raw size differs from the manifest');
    assert.equal(sha256(raw), row.sha256, row.path + ' raw SHA differs from the manifest');
    files.set(row.path, raw);
    domainBytes += raw.byteLength;
  }
  assert.equal(domainBytes, DOMAIN_BYTES, 'candidate four-domain byte total changed');
  const skills = JSON.parse(files.get('domains/skills.json').toString('utf8'));
  const release = skills.source.gameReleases.find((row) => row.gameReleaseId === GAME_RELEASE_ID
    && row.gameVersion === manifest.gameVersion);
  assert.ok(release && release.snapshot.snapshotId === SNAPSHOT_ID, 'candidate primary snapshot identity changed');
  const identity = { gameVersion: manifest.gameVersion, gameReleaseId: GAME_RELEASE_ID, snapshotId: SNAPSHOT_ID };
  const version = {
    schema_version: 2,
    data_revision: manifest.dataRevision,
    build_id: MANIFEST_SHA256,
    game_version: manifest.gameVersion,
    package_kind: 'published',
    game_releases: [{
      game_version: manifest.gameVersion,
      content_version: manifest.contentVersion,
      data_revision: manifest.dataRevision,
      manifest_path: '/data/' + manifest.dataRevision + '/manifest.json',
      manifest_sha256: MANIFEST_SHA256
    }]
  };
  const versionBytes = Buffer.from(JSON.stringify(version) + '\n', 'utf8');
  return loader.verifyStoredSnapshot({ versionBytes, manifestBytes, files, identity, cryptoApi: webcrypto })
    .then((snapshot) => ({ identity, manifest, manifestBytes, files, version, versionBytes, snapshot,
      model: presentation.buildSkillViewModels(snapshot).find((row) => row.nativeName === 'Brain Rupture'),
      blessings: presentation.buildBlessingViewModels(snapshot, {}) }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function makeDescriptionMarkup(model, descriptionClass) {
  const paragraphs = model.nativeDescription.split('\n\n');
  if (paragraphs.length !== 2) throw new Error('candidate ability no longer has the observed two-paragraph native shape');
  const parameter = Object.values(model.translationParams).find((value) => value && paragraphs[1].includes(value));
  if (!parameter) throw new Error('candidate ability has no official parameter for the observed styled native span');
  const index = paragraphs[1].indexOf(parameter);
  return `<div class="${descriptionClass}">${escapeHtml(paragraphs[0])}<br><br>${escapeHtml(paragraphs[1].slice(0, index))}`
    + `<span class="native-parameter">${escapeHtml(parameter)}</span>${escapeHtml(paragraphs[1].slice(index + parameter.length))}</div>`;
}

function makeCardMarkup(model) {
  return `<div id="native-card"><a class="flex items-center gap-2" title="${escapeHtml(model.nativeName)}" `
    + `href="${GAME_ORIGIN}/abilities/brain-rupture"><img alt="" src="https://gameslantern.com/storage/sites/darktide/exporter/talents/psyker/tactical/psyker_brain_burst_improved.png">`
    + `<div><div class="font-teko">${escapeHtml(model.nativeName)}</div>${makeDescriptionMarkup(model, 'text-xs')}</div></a></div>`;
}

function makeTooltipMarkup(model) {
  return `<div id="native-build-tooltip" class="fixed max-w-sm w-full pointer-events-none"><div>`
    + `<div class="text-lg">${escapeHtml(model.nativeName)}</div>${makeDescriptionMarkup(model, 'font-normal')}`
    + `</div></div>`;
}

function packageFromBuild(built) {
  const root = path.join(built.extensionPath, 'baseline');
  const versionBytes = fs.readFileSync(path.join(root, 'version.json'));
  const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
  const version = JSON.parse(versionBytes.toString('utf8'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const release = version.game_releases.find((row) => row.game_version === manifest.gameVersion);
  assert.ok(release);
  const prefix = release.manifest_path.slice(0, release.manifest_path.lastIndexOf('/') + 1);
  const resources = new Map([
    ['/version.json', { bytes: versionBytes, contentType: 'application/json' }],
    [release.manifest_path, { bytes: manifestBytes, contentType: 'application/json' }]
  ]);
  let totalDomainBytes = 0;
  for (const row of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, ...row.path.split('/')));
    assert.equal(bytes.byteLength, row.sizeBytes);
    assert.equal(sha256(bytes), row.sha256);
    totalDomainBytes += bytes.byteLength;
    resources.set(prefix + row.path, { bytes, contentType: 'application/json' });
  }
  assert.equal(sha256(manifestBytes), MANIFEST_SHA256);
  assert.equal(totalDomainBytes, DOMAIN_BYTES);
  return { manifest, resources, version };
}

function addPackageRoute(context, pack, routeState) {
  context.route(PREVIEW_ORIGIN + '/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let workerOwned = false;
    try { workerOwned = !!request.serviceWorker(); } catch (_) { }
    routeState.requests.push({ pathname, workerOwned });
    const resource = pack.resources.get(pathname);
    if (!resource) {
      await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
      return;
    }
    await route.fulfill({ status: 200, contentType: resource.contentType + '; charset=utf-8',
      headers: { 'cache-control': 'no-store' }, body: Buffer.from(resource.bytes) });
  });
}

async function launchBuilt(built, runtime) {
  const profileRoot = createPrivateProfileRoot();
  let context;
  try {
    context = await runtime.playwright.chromium.launchPersistentContext(path.join(profileRoot, 'p'), {
      executablePath: runtime.executablePath,
      headless: false,
      viewport: { width: 1050, height: 760 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--window-position=-32000,-32000', '--enable-unsafe-extension-debugging']
    });

    const managerPage = await context.newPage();
    await managerPage.goto('chrome://extensions/');
    const developerMode = await managerPage.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      const toolbar = manager && manager.shadowRoot && manager.shadowRoot.querySelector('extensions-toolbar');
      const toggle = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector('#devMode');
      if (!toggle || toggle.disabled) return { available: false };
      if (!toggle.checked) toggle.click();
      return { available: true };
    });
    assert.equal(developerMode.available, true, 'Chrome developer mode control is unavailable in the fresh profile');
    await managerPage.waitForFunction(() => {
      const manager = document.querySelector('extensions-manager');
      const toolbar = manager && manager.shadowRoot && manager.shadowRoot.querySelector('extensions-toolbar');
      const toggle = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector('#devMode');
      return !!toggle && toggle.checked;
    }, null, { timeout: 5000 });

    const workerReady = context.waitForEvent('serviceworker', {
      predicate: (candidate) => candidate.url().endsWith('/shared/service-worker.js'),
      timeout: 20000
    }).catch((error) => ({ error }));
    const cdp = await context.browser().newBrowserCDPSession();
    let installed;
    try {
      installed = await cdp.send('Extensions.loadUnpacked', { path: built.extensionPath });
    } finally {
      await cdp.detach();
    }
    assert.match(installed.id, /^[a-p]{32}$/, 'Chrome did not return a valid ID for the unpacked test extension');

    let worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith('/shared/service-worker.js'));
    if (!worker) {
      const result = await workerReady;
      if (result && result.error) throw result.error;
      worker = result;
    }
    assert.ok(worker.url().endsWith('/shared/service-worker.js'));
    const extensionId = new URL(worker.url()).hostname;
    assert.equal(extensionId, installed.id, 'the started service worker must belong to the loaded unpacked extension');
    return { context, worker, extensionId, profileRoot };
  } catch (error) {
    if (context) await context.close();
    removePrivateProfileRoot(profileRoot);
    throw error;
  }
}

async function stopBuilt(started, built) {
  if (started && started.context) await started.context.close();
  if (started) removePrivateProfileRoot(started.profileRoot);
  removeBuild(built);
}

async function installGameRoutes(context, candidate) {
  context.route(GAME_ORIGIN + '/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/build-editor'
      ? '<main><div id="darktide-build-editor"><section><h2>Talent Tree Patch</h2><div><button class="bg-primary/20">Depths of the Damned<span>Live</span></button><button>Skitarii Class<span>Old</span></button></div></section></div></main>'
      : pathname === '/weapon-blessing-traits'
        ? '<main><p id="native-blessing-page">Native blessing content remains unchanged.</p><div id="late-card-slot"></div></main>'
        : '<main><div id="late-card-slot"></div></main>';
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Games Lantern fixture</title></head><body>' + body + '</body></html>' });
  });
  context.route('https://gameslantern.com/storage/**', (route) => route.abort('internetdisconnected'));
}

async function openHarness(context, extensionId) {
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/w10-harness.html');
  await page.waitForFunction(() => !!globalThis.w10Harness, { timeout: 10000 });
  return page;
}

test('InterT10_RealMv3ContentEntryLoadsPinnedCandidateAndRestoresOnNativePatchChange', { timeout: 120000 }, async (t) => {
  // Scenario: Given an isolated includeTestHarness MV3 build and the fixed unselected candidate.
  // Purpose: Verify late native slot discovery, W10 worker/download/IDB/client raw revalidation, local UI restore, patch invalidation, and worker restart.
  if (!process.env.SYP_W10_APPROVED_PACKAGE_DIR) {
    t.skip('SYP_W10_APPROVED_PACKAGE_DIR is unset; no fixed-candidate MV3 route was exercised');
    return;
  }
  const candidate = await readCandidate();
  assert.ok(candidate.model, 'approved candidate must contain the uniquely matched Brain Rupture view');
  const priorCandidate = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  let built;
  let started;
  try {
    built = buildDevExtension({ includeTestHarness: true });
    assert.equal(built.approvedBaseline.included, true);
    const pack = packageFromBuild(built);
    const routeState = { requests: [] };
    const runtime = loadRuntime();
    started = await launchBuilt(built, runtime);
    addPackageRoute(started.context, pack, routeState);
    await installGameRoutes(started.context, candidate);

    const abilityPage = await started.context.newPage();
    const pageDiagnostics = [];
    const runtimeContexts = [];
    const runtimeExceptions = [];
    abilityPage.on('pageerror', (error) => pageDiagnostics.push('pageerror: ' + error.message));
    abilityPage.on('console', (message) => {
      if (message.type() === 'error') pageDiagnostics.push('console: ' + message.text());
    });
    const devtools = await started.context.newCDPSession(abilityPage);
    devtools.on('Runtime.executionContextCreated', (event) => runtimeContexts.push(event.context));
    devtools.on('Runtime.exceptionThrown', (event) => runtimeExceptions.push(event.exceptionDetails));
    await devtools.send('Runtime.enable');
    await abilityPage.goto(GAME_ORIGIN + '/abilities/brain-rupture', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await abilityPage.waitForSelector('[data-w11-owned="controls"]', { timeout: 5000 }).catch(async (error) => {
      const isolatedGlobals = [];
      for (const context of runtimeContexts.filter((row) => row.auxData && row.auxData.type === 'isolated')) {
        try {
          const value = await devtools.send('Runtime.evaluate', { contextId: context.id, returnByValue: true,
            expression: 'JSON.stringify({origin: location.origin, runtimeId: globalThis.chrome?.runtime?.id || null, '
              + 'entry: typeof globalThis.W11ContentEntry, client: typeof globalThis.W10SharedClient, '
              + 'controller: typeof globalThis.W11DomController, adapter: typeof globalThis.W11DomAdapter, '
              + 'instance: !!globalThis.__W11_CONTENT_ENTRY_INSTANCE__})' });
          isolatedGlobals.push({ origin: context.origin, name: context.name, value: value.result.value });
        } catch (diagnosticError) { isolatedGlobals.push({ id: context.id, error: diagnosticError.message }); }
      }
      t.diagnostic(JSON.stringify({ url: abilityPage.url(), title: await abilityPage.title(),
        html: (await abilityPage.content()).slice(0, 1500), errors: pageDiagnostics, isolatedGlobals,
        contexts: runtimeContexts.map((row) => ({ id: row.id, origin: row.origin, name: row.name, auxData: row.auxData })),
        exceptions: runtimeExceptions.map((row) => row.exception && row.exception.description || row.text) }));
      throw error;
    });
    const controlsBeforeSlot = await abilityPage.locator('[data-w11-owned="controls"] [role="status"]').textContent();
    assert.equal(controlsBeforeSlot, '目前沒有可信的本機資料身分，保留原站內容。');
    assert.equal(await abilityPage.locator('[data-w11-owned="controls"]').getAttribute('data-status'), 'original');
    await abilityPage.evaluate((markup) => document.querySelector('#late-card-slot').insertAdjacentHTML('beforeend', markup),
      makeCardMarkup(candidate.model));
    try {
      await abilityPage.waitForFunction((expectedName) => {
        const name = document.querySelector('#native-card .font-teko');
        return !!name && name.textContent === expectedName
          && !!document.querySelector('#native-card [data-w11-owned="details"]');
      }, candidate.model.translatedName, { timeout: 45000 });
    } catch (error) {
      const isolated = runtimeContexts.find((row) => row.auxData && row.auxData.type === 'isolated'
        && row.origin === GAME_ORIGIN);
      let state = null;
      if (isolated) {
        try {
          const value = await devtools.send('Runtime.evaluate', { contextId: isolated.id, awaitPromise: true,
            returnByValue: true,
            expression: '(async () => { const api = globalThis.W11ContentEntry; const inst = globalThis.__W11_CONTENT_ENTRY_INSTANCE__; '
              + 'const adapter = globalThis.W11DomAdapter.createDomAdapter({document}); const bytes = inst.evidenceProvider(); '
              + 'const digest = await crypto.subtle.digest("SHA-256", bytes); const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join(""); '
              + 'const resolver = globalThis.W11NativeIdentity.createNativeIdentityResolver({proofs: globalThis.W11TestProofRegistry.proofs, cryptoApi: crypto}); '
              + 'return JSON.stringify({state: inst.controller.getState(), status: document.querySelector("[data-w11-owned=controls] [role=status]")?.textContent, '
              + 'bytes: bytes.byteLength, hash, slots: adapter.collectSkillSlots(document).map(slot => adapter.observe(slot)), '
              + 'resolved: await resolver.resolve(bytes), routes: location.pathname}); })()' });
          state = value.result.value;
        } catch (diagnosticError) { state = { error: diagnosticError.message }; }
      }
      t.diagnostic(JSON.stringify({ pageErrors: pageDiagnostics, runtimeExceptions: runtimeExceptions.map((row) => row.exception?.description || row.text),
        isolatedState: state, requests: routeState.requests, html: (await abilityPage.content()).slice(0, 2500) }));
      throw error;
    }
    const applied = await abilityPage.evaluate(() => ({
      name: document.querySelector('#native-card .font-teko').textContent,
      description: document.querySelector('#native-card .text-xs').innerText,
      detailsSummary: document.querySelector('[data-w11-owned="details"] summary')?.textContent,
      status: document.querySelector('[data-w11-owned="controls"] [role="status"]')?.textContent,
      ownedPanels: document.querySelectorAll('[data-w11-owned="details"]').length
    }));
    assert.equal(applied.name, candidate.model.translatedName);
    assert.equal(applied.description.replace(/\r/g, ''), candidate.model.translatedDescription);
    assert.equal(applied.detailsSummary, '詳細說明');
    assert.equal(applied.status, '使用本機資料版本 1.13.2.1；只翻譯與資料逐項相符的原文。');
    assert.equal(applied.ownedPanels, 1);
    const stableOwnedMutations = await abilityPage.evaluate(async () => {
      const controls = document.querySelector('[data-w11-owned="controls"]');
      let count = 0;
      const observer = new MutationObserver((rows) => { count += rows.length; });
      observer.observe(controls, { childList: true, characterData: true, subtree: true });
      await new Promise((resolve) => setTimeout(resolve, 250));
      observer.disconnect();
      return count;
    });
    assert.equal(stableOwnedMutations, 0, 'settled content-entry status must not churn owned DOM or rescan indefinitely');
    assert.equal(routeState.requests.length, 6, 'first compatible client call should fetch exactly version, manifest, and four domains');
    assert.ok(routeState.requests.every((request) => request.workerOwned), 'fixed-origin data fetches must be owned by the MV3 service worker');
    assert.deepEqual(routeState.requests.map((request) => request.pathname).sort(), [
      '/version.json',
      pack.version.game_releases.find((row) => row.game_version === candidate.manifest.gameVersion).manifest_path,
      ...candidate.manifest.files.map((row) => '/data/' + candidate.manifest.dataRevision + '/' + row.path)
    ].sort());

    await abilityPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await abilityPage.waitForFunction(() => document.querySelector('#native-card .font-teko')?.textContent === 'Brain Rupture'
      && !!document.querySelector('[data-w11-owned="controls"]'));
    await abilityPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await abilityPage.waitForFunction((expectedName) => document.querySelector('#native-card .font-teko')?.textContent === expectedName,
      candidate.model.translatedName);
    assert.equal(routeState.requests.length, 6, 'simulated persisted-page restoration should reapply the same pinned snapshot without fetching');

    await abilityPage.getByRole('button', { name: '切回原文' }).click();
    await abilityPage.waitForFunction(() => document.querySelector('#native-card .font-teko')?.textContent === 'Brain Rupture'
      && !document.querySelector('[data-w11-owned="details"]'));
    await abilityPage.getByRole('button', { name: '啟用繁體' }).click();
    await abilityPage.waitForFunction((expectedName) => document.querySelector('#native-card .font-teko')?.textContent === expectedName,
      candidate.model.translatedName);
    assert.equal(routeState.requests.length, 6, 'disable/re-enable within one document must reuse its verified pinned snapshot');

    const harness = await openHarness(started.context, started.extensionId);
    const beforeRestartStore = await harness.evaluate((identity) => globalThis.w10Harness.inspectStore(identity), candidate.identity);
    assert.equal(beforeRestartStore.activeContentVersion, candidate.manifest.contentVersion);
    assert.equal(beforeRestartStore.activeManifestSha256, MANIFEST_SHA256);
    assert.equal(typeof beforeRestartStore.lastSuccessAt, 'number');
    const beforeRestart = await started.worker.evaluate(() => {
      globalThis.__w11Mv3RestartSentinel = 'old-worker-context';
      return { timeOrigin: performance.timeOrigin, sentinel: globalThis.__w11Mv3RestartSentinel };
    });
    const cdp = await started.context.newCDPSession(harness);
    try {
      const targets = await cdp.send('Target.getTargets');
      const workerTarget = targets.targetInfos.find((target) => target.type === 'service_worker'
        && target.url === started.worker.url());
      assert.ok(workerTarget, 'real MV3 service worker target should be discoverable');
      await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
      const wakeResult = await harness.evaluate((identity) => globalThis.w10Harness.createClient()
        .initialize(identity).then((result) => globalThis.w10Harness.snapshotSummary(result)), candidate.identity);
      assert.equal(wakeResult.status, 'ready');
      const afterRestart = await started.worker.evaluate(() => ({
        timeOrigin: performance.timeOrigin,
        sentinel: globalThis.__w11Mv3RestartSentinel === undefined ? null : globalThis.__w11Mv3RestartSentinel
      }));
      assert.equal(afterRestart.sentinel, null, 'the restarted worker must have a fresh global context');
      assert.notEqual(afterRestart.timeOrigin, beforeRestart.timeOrigin);
    } finally {
      await cdp.detach();
    }
    const afterRestartStore = await harness.evaluate((identity) => globalThis.w10Harness.inspectStore(identity), candidate.identity);
    assert.equal(afterRestartStore.activeContentVersion, candidate.manifest.contentVersion);
    assert.equal(afterRestartStore.activeManifestSha256, MANIFEST_SHA256);
    assert.equal(afterRestartStore.lastSuccessAt, beforeRestartStore.lastSuccessAt);
    assert.equal(routeState.requests.length, 6, 'a worker restart during the persisted 24-hour schedule must not redownload version.json');

    const editorPage = await started.context.newPage();
    await editorPage.goto(GAME_ORIGIN + '/build-editor', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await editorPage.waitForSelector('[data-w11-owned="controls"]');
    await editorPage.evaluate((markup) => document.querySelector('#darktide-build-editor').insertAdjacentHTML('beforeend', markup),
      makeTooltipMarkup(candidate.model));
    await editorPage.waitForFunction((expectedName) => document.querySelector('#native-build-tooltip .text-lg')?.textContent === expectedName
      && !!document.querySelector('#native-build-tooltip [data-w11-owned="details"]'), candidate.model.translatedName,
    { timeout: 45000 });
    assert.equal(routeState.requests.length, 6, 'a second document on the same release uses the verified shared cache');
    await editorPage.evaluate(() => {
      const buttons = [...document.querySelectorAll('#darktide-build-editor button')];
      buttons[0].classList.remove('bg-primary/20');
      buttons[1].classList.add('bg-primary/20');
    });
    await editorPage.waitForFunction(() => document.querySelector('#native-build-tooltip .text-lg')?.textContent === 'Brain Rupture'
      && !document.querySelector('#native-build-tooltip [data-w11-owned="details"]'), undefined, { timeout: 10000 });
    assert.match(await editorPage.locator('[data-w11-owned="controls"] [role="status"]').textContent(), /身分已變更|原站內容/);
    assert.equal(routeState.requests.length, 6, 'patch-label mismatch must stop locally without another package request');

    const blessingPage = await started.context.newPage();
    await blessingPage.goto(GAME_ORIGIN + '/weapon-blessing-traits', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await blessingPage.waitForSelector('[data-w11-owned="controls"]', { timeout: 5000 });
    await blessingPage.waitForFunction(() => document.querySelector('[data-w11-owned="controls"]')?.dataset.status === 'original'
      && document.querySelector('[data-w11-owned="controls"] [role="status"]')?.textContent === '目前沒有可信的本機資料身分，保留原站內容。',
    null, { timeout: 10000 });
    assert.equal(await blessingPage.locator('[data-w11-owned="controls"]').getAttribute('data-status'), 'original',
      'the empty blessing page has no trusted native identity before the fixed candidate card appears');
    await blessingPage.evaluate((markup) => document.querySelector('#late-card-slot').insertAdjacentHTML('beforeend', markup),
      makeCardMarkup(candidate.model));
    await blessingPage.waitForFunction((expectedName) => document.querySelector('#native-card .font-teko')?.textContent === expectedName
      && document.querySelector('#native-card [data-w11-owned="details"]') !== null,
    candidate.model.translatedName, { timeout: 15000 });
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { timeout: 45000 });
    assert.equal(candidate.blessings.length, 4, 'reader must receive all four Source tier models');
    assert.equal(await blessingPage.getByLabel('祝福', { exact: true }).inputValue(), '');
    assert.equal(await blessingPage.getByLabel('祝福變體', { exact: true }).inputValue(), '');
    assert.match(await blessingPage.locator('[data-w11-blessing-result]').textContent(), /請選擇祝福/);
    assert.equal(await blessingPage.locator('[data-w11-blessing-applicability]').textContent(), '');
    await blessingPage.getByLabel('祝福', { exact: true }).selectOption(candidate.blessings[0].blessingRef.recordId);
    await blessingPage.getByLabel('祝福變體', { exact: true }).selectOption(candidate.blessings[0].variantRef.recordId);
    assert.deepEqual(await blessingPage.locator('[data-w11-owned="blessing-reader"] [data-w11-tier]').allTextContents(),
      ['LV1', 'LV2', 'LV3', 'LV4']);
    assert.match(await blessingPage.locator('[data-w11-blessing-applicability]').textContent(), /尚未驗證/);
    assert.match(await blessingPage.locator('[data-w11-blessing-result]').textContent(), /請明確選擇階級/);
    await blessingPage.getByRole('button', { name: 'LV1', exact: true }).click();
    const blessingTierOne = await blessingPage.locator('[data-w11-blessing-result]').textContent();
    assert.match(blessingTierOne, /LV1/);
    assert.match(blessingTierOne, /17%/);
    await blessingPage.getByRole('button', { name: 'LV4', exact: true }).click();
    const blessingTierFour = await blessingPage.locator('[data-w11-blessing-result]').textContent();
    assert.match(blessingTierFour, /LV4/);
    assert.match(blessingTierFour, /20%/);
    assert.notEqual(blessingTierFour, blessingTierOne, 'tier change must replace the complete blessing values and details');
    assert.equal(await blessingPage.locator('#native-card .font-teko').textContent(), candidate.model.translatedName,
      'the reader test page must have a real fixed-candidate native card matching its test proof');
    assert.equal(await blessingPage.locator('#native-blessing-page').textContent(), 'Native blessing content remains unchanged.',
      'a matched skill proof must not claim or rewrite unrelated native blessing content');
    assert.equal(await blessingPage.locator('#native-blessing-page [data-w11-owned]').count(), 0,
      'the independent blessing reader must not claim an unverified native blessing row');
    await blessingPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { state: 'detached' });
    await blessingPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { timeout: 15000 });
    assert.equal(await blessingPage.getByLabel('祝福', { exact: true }).inputValue(), '',
      'persisted-page resume rebuilds a reader without carrying a page-local tier selection');
    assert.equal(routeState.requests.length, 6, 'persisted-page resume must reuse the document-pinned package');
    await blessingPage.getByRole('button', { name: '切回原文' }).click();
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { state: 'detached' });
    const disabledBfCacheState = await blessingPage.evaluate(async () => {
      const controls = document.querySelector('[data-w11-owned="controls"]');
      const changed = await new Promise((resolve) => {
        let settled = false;
        let timer;
        const observer = new MutationObserver(() => {
          if (controls.dataset.status !== 'original') finish(controls.dataset.status);
        });
        const finish = (value) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          resolve(value);
        };
        observer.observe(controls, { attributes: true, attributeFilter: ['data-status'] });
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        timer = setTimeout(() => finish(controls.dataset.status), 1000);
      });
      return { changed, status: controls.dataset.status,
        readerCount: document.querySelectorAll('[data-w11-owned="blessing-reader"]').length };
    });
    assert.equal(disabledBfCacheState.changed, 'original');
    assert.equal(disabledBfCacheState.status, 'original');
    assert.equal(disabledBfCacheState.readerCount, 0,
      'a persisted-page round trip must preserve the user’s disabled intent');
    await blessingPage.getByRole('button', { name: '啟用繁體' }).click();
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { timeout: 15000 });
    assert.equal(routeState.requests.length, 6, 'same-document disable/re-enable must reuse its verified snapshot');
  } finally {
    await stopBuilt(started, built);
    process.env.SYP_W10_APPROVED_PACKAGE_DIR = priorCandidate;
  }
});

test('InterT20_NormalBuildHasNoTestProofAndLeavesUnknownNativeFactsUntouched', { timeout: 90000 }, async (t) => {
  // Scenario: Given a normal build whose trusted native proof registry is empty.
  // Purpose: Ensure the real content script UI reports unknown identity without requesting or rewriting the page.
  const priorCandidate = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  delete process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  let built;
  let started;
  try {
    built = buildDevExtension();
    assert.equal(built.includeTestHarness, false);
    assert.equal(fs.existsSync(path.join(built.extensionPath, 'test-support', 'native-proof-registry.js')), false);
    const contentScriptNames = built.manifest.content_scripts[0].js;
    assert.equal(contentScriptNames.some((name) => name.includes('test-support') || name.includes('w10-harness')), false);
    const runtime = loadRuntime();
    started = await launchBuilt(built, runtime);
    const requests = [];
    started.context.route(PREVIEW_ORIGIN + '/**', async (route) => {
      requests.push(route.request().url());
      await route.abort('internetdisconnected');
    });
    started.context.route(GAME_ORIGIN + '/**', async (route) => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body><main><div id="native-card">'
        + '<a class="flex items-center gap-2" title="Brain Rupture" href="' + GAME_ORIGIN
        + '/abilities/brain-rupture"><img alt=""><div><div class="font-teko">Brain Rupture</div>'
        + '<div class="text-xs">Native first paragraph.<br><br>Native second paragraph.</div></div></a></div></main></body></html>' }));
    const page = await started.context.newPage();
    await page.goto(GAME_ORIGIN + '/abilities/brain-rupture', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('[data-w11-owned="controls"]', { timeout: 5000 }).catch(async (error) => {
      t.diagnostic(JSON.stringify({ url: page.url(), title: await page.title(), html: (await page.content()).slice(0, 1500) }));
      throw error;
    });
    const state = await page.evaluate(() => ({
      name: document.querySelector('#native-card .font-teko').textContent,
      description: document.querySelector('#native-card .text-xs').textContent,
      ownedContent: document.querySelectorAll('[data-w11-owned="details"], [data-w11-owned="weapon"]').length,
      status: document.querySelector('[data-w11-owned="controls"] [role="status"]').textContent,
      registryPresent: typeof globalThis.W11TestProofRegistry !== 'undefined'
    }));
    assert.equal(state.name, 'Brain Rupture');
    assert.equal(state.description, 'Native first paragraph.Native second paragraph.');
    assert.equal(state.ownedContent, 0);
    assert.equal(state.status, '目前沒有可信的本機資料身分，保留原站內容。');
    assert.equal(state.registryPresent, false);
    assert.deepEqual(requests, []);
  } finally {
    await stopBuilt(started, built);
    if (priorCandidate === undefined) delete process.env.SYP_W10_APPROVED_PACKAGE_DIR;
    else process.env.SYP_W10_APPROVED_PACKAGE_DIR = priorCandidate;
  }
});
