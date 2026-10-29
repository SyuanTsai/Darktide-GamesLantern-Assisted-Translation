'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot } = require('../w10/browser-runtime.cjs');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const BUILDER_PATH = path.join(REPOSITORY_ROOT, 'scripts', 'release', 'build-production-extension.cjs');
const BASELINE_DIR = path.join(REPOSITORY_ROOT, 'extension', 'release-baseline', 'w15');
const EXPECTED_FILES = Object.freeze({
  'version.json': [655, 'f259d3545dd5f80d4310a859a8e016df9fe42cc19ef5612431eaf8b055e13e0e'],
  'manifest.json': [2259, 'fcd7ff131ae55315fa0b9323355ed0e7b69788ffe03841de025723cec16e8642'],
  'domains/blessings.json': [113990, '3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5'],
  'domains/skills.json': [165051, '108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449'],
  'domains/terms.json': [124557, '602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6'],
  'domains/weapons.json': [6798596, '132ec16e830d4af560bd212095f4fa0209bc8f238eb17a26528e112e6ebd41a8']
});
const SHARED_FILES = Object.freeze([
  'contract.js', 'domains.js', 'loader.js', 'snapshot-store.js', 'update-coordinator.js',
  'document-session.js', 'baseline-provider.js', 'client.js', 'service-worker.js',
  'native-identity.js', 'view-model.js', 'presentation.js', 'production-dataset.js', 'dom-adapter.js',
  'dom-controller.js', 'content-entry.js', 'display.css'
]);
const CONTENT_MATCHES = Object.freeze([
  'https://darktide.gameslantern.com/build-editor*',
  'https://darktide.gameslantern.com/abilities',
  'https://darktide.gameslantern.com/abilities/*',
  'https://darktide.gameslantern.com/weapon-blessing-traits*',
  'https://darktide.gameslantern.com/weapons/*'
]);

let builderModule = null;
if (fs.existsSync(BUILDER_PATH)) builderModule = require(BUILDER_PATH);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function walkFiles(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else result.push(path.relative(directory, absolute).replaceAll(path.sep, '/'));
    }
  };
  visit(directory);
  return result.sort();
}

function copyTree(source, destination) { fs.cpSync(source, destination, { recursive: true, errorOnExist: true }); }

function makeTempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'syp-w16-package-')); }

function requireBuilder() {
  assert.ok(builderModule && typeof builderModule.buildProductionExtensionPackage === 'function',
    'the production MV3 package builder is missing; development builders are not release packages');
  return builderModule.buildProductionExtensionPackage;
}

async function buildFixturePackage(tempRoot, options = {}) {
  const build = requireBuilder();
  const input = {
    version: options.version ?? '1.0.0',
    baselineDir: options.baselineDir ?? BASELINE_DIR,
    outputDir: options.outputDir ?? path.join(tempRoot, 'release')
  };
  if (options.iconDir) input.iconDir = options.iconDir;
  return build(input);
}

function expandZip(zipPath, destination) {
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const command = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$archive = [System.IO.Compression.ZipFile]::OpenRead(' + quote(zipPath) + ')',
    '$destinationRoot = [System.IO.Path]::GetFullPath(' + quote(destination) + ').TrimEnd(\'\\\')',
    '$destinationPrefix = $destinationRoot + \'\\\'',
    'try { foreach ($entry in $archive.Entries) {',
    "  $relative = $entry.FullName.Replace('/', '\\\\')",
    '  $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destinationRoot, $relative))',
    '  if (-not $target.StartsWith($destinationPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw \'ZIP entry escaped extraction directory\' }',
    '  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null',
    '  $input = $entry.Open(); $output = [System.IO.File]::Create($target)',
    '  try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }',
    '} } finally { $archive.Dispose() }'
  ].join('; ');
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'pipe' });
}

test('UnitT10_ProductionPackagePinsW15BaselineAndUsesTheExactMV3Boundary', async () => {
  // Scenario: Given the verified W15 six-file raw baseline and locally supplied icon fixture, when a release package is built.
  // Purpose: Keep package identity, four-core baseline bytes, exact site access, and test/dev exclusions pinned.
  const tempRoot = makeTempRoot();
  try {
    const result = await buildFixturePackage(tempRoot, { version: '1.0.0' });
    assert.equal(result.manifest.manifest_version, 3);
    assert.equal(result.manifest.version, '1.0.0');
    assert.deepEqual(result.manifest.permissions, []);
    assert.deepEqual(result.manifest.host_permissions, ['https://darktide.tw-syuan.com/*']);
    assert.deepEqual(result.manifest.content_scripts[0].matches, CONTENT_MATCHES);
    assert.deepEqual(result.manifest.content_scripts[0].js, [
      'shared/contract.js', 'shared/domains.js', 'shared/loader.js',
      'shared/document-session.js', 'shared/client.js', 'shared/native-identity.js',
      'shared/view-model.js', 'shared/presentation.js', 'shared/production-dataset.js', 'shared/dom-adapter.js',
      'shared/dom-controller.js', 'shared/production-dataset-pin.js', 'shared/content-entry.js'
    ]);
    assert.deepEqual(result.manifest.content_scripts[0].css, ['shared/display.css']);
    assert.deepEqual(result.manifest.icons, {
      '16': 'icons/icon16.png', '32': 'icons/icon32.png',
      '48': 'icons/icon48.png', '128': 'icons/icon128.png'
    });
    assert.equal(Object.hasOwn(result.manifest, 'externally_connectable'), false);
    assert.equal(Object.hasOwn(result.manifest, 'web_accessible_resources'), false);
    assert.equal(Object.hasOwn(result.manifest, 'update_url'), false);

    const packageFiles = walkFiles(result.packageDirectory);
    assert.deepEqual(packageFiles, [
      'PRIVACY.md', 'baseline/domains/blessings.json', 'baseline/domains/skills.json',
      'baseline/domains/terms.json', 'baseline/domains/weapons.json', 'baseline/manifest.json',
      'baseline/version.json', 'icons/icon128.png', 'icons/icon16.png', 'icons/icon32.png',
      'icons/icon48.png', 'manifest.json', 'shared/production-dataset-pin.js',
      ...SHARED_FILES.map((file) => 'shared/' + file)
    ].sort());
    assert.equal(packageFiles.some((file) => /test-support|harness|fixture|preview/i.test(file)), false);
    assert.equal(packageFiles.includes('baseline/domains/announcements.json'), false);
    assert.equal(result.manifest.name.length > 0, true);
    assert.equal(result.manifest.description.length > 0, true);

    for (const [relative, [size, hash]] of Object.entries(EXPECTED_FILES)) {
      const packagedPath = relative === 'version.json' ? 'baseline/version.json'
        : relative === 'manifest.json' ? 'baseline/manifest.json' : 'baseline/' + relative;
      const raw = fs.readFileSync(path.join(result.packageDirectory, ...packagedPath.split('/')));
      assert.equal(raw.byteLength, size, relative + ' size must match the W15 raw input');
      assert.equal(sha256(raw), hash, relative + ' bytes must remain identical to the W15 raw input');
    }
    const baselineManifest = JSON.parse(fs.readFileSync(path.join(result.packageDirectory, 'baseline/manifest.json'), 'utf8'));
    const baselineVersion = JSON.parse(fs.readFileSync(path.join(result.packageDirectory, 'baseline/version.json'), 'utf8'));
    assert.equal(baselineManifest.contentVersion, '1.13.2.3');
    assert.equal(baselineManifest.dataRevision, 'f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f');
    const productionPinSource = fs.readFileSync(path.join(result.packageDirectory, 'shared/production-dataset-pin.js'), 'utf8');
    const productionPinJson = productionPinSource.match(/Object\.freeze\((\{[\s\S]*\})\);/);
    assert.ok(productionPinJson, 'release package must carry a generated production data-line pin');
    assert.deepEqual(JSON.parse(productionPinJson[1]), {
      schema: 'w16-production-dataset-pin/1',
      gameVersion: baselineManifest.gameVersion,
      gameReleaseId: baselineManifest.gameReleaseId,
      contentVersion: baselineManifest.contentVersion,
      dataRevision: baselineManifest.dataRevision,
      manifestSha256: sha256(fs.readFileSync(path.join(result.packageDirectory, 'baseline/manifest.json')))
    });
    assert.equal(baselineVersion.game_version, '1.13.2');
    assert.equal(baselineVersion.data_revision, baselineManifest.dataRevision);
    assert.equal(result.receipt.contentVersion, '1.13.2.3');
    assert.equal(result.receipt.gameVersion, '1.13.2');
    assert.equal(result.receipt.dataRevision, baselineManifest.dataRevision);
    assert.equal(result.receipt.localPaths, undefined, 'build receipts must not leak local workspace paths');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('UnitT20_RejectsChangedW15BaselineBytesBeforeCreatingReleaseOutput', async () => {
  // Scenario: Given a copied W15 baseline with one core JSON byte changed, when packaging is requested.
  // Purpose: Refuse stale, corrupted, or substituted domain bytes before creating a distributable output.
  const tempRoot = makeTempRoot();
  const corruptBaseline = path.join(tempRoot, 'corrupt-baseline');
  copyTree(BASELINE_DIR, corruptBaseline);
  const weaponPath = path.join(corruptBaseline, 'domains', 'weapons.json');
  const weaponBytes = fs.readFileSync(weaponPath);
  weaponBytes[weaponBytes.length - 1] ^= 1;
  fs.writeFileSync(weaponPath, weaponBytes);
  const outputDir = path.join(tempRoot, 'must-not-exist');
  try {
    await assert.rejects(() => buildFixturePackage(tempRoot, { baselineDir: corruptBaseline, outputDir }), /baseline|pin|SHA|hash/i);
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('UnitT30_RejectsInvalidChromeVersionAndIncompleteIconSet', async () => {
  // Scenario: Given an invalid extension version or a missing required raster size, when the builder validates inputs.
  // Purpose: Prevent an invalid store version or incomplete manifest icon set from entering a release package.
  assert.equal(builderModule.validateVersion('1'), '1');
  assert.throws(() => builderModule.validateVersion('0.0.0'), /zero components/i);
  const tempRoot = makeTempRoot();
  try {
    await assert.rejects(() => buildFixturePackage(tempRoot, { version: '01.2.3' }), /version/i);
    const icons = path.join(tempRoot, 'missing-icons');
    await assert.rejects(() => buildFixturePackage(tempRoot, { iconDir: icons }), /icon|PNG/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('InterT10_ReleaseZipHasManifestAtRootAndExpandsToTheSameFileBytes', async () => {
  // Scenario: Given a built unpacked MV3 release and its ZIP, when the archive is extracted by Windows' ZIP reader.
  // Purpose: Verify the actual store upload archive is valid, rooted correctly, and byte-identical to the unpacked package.
  const tempRoot = makeTempRoot();
  try {
    const result = await buildFixturePackage(tempRoot);
    const extracted = path.join(tempRoot, 'extracted');
    fs.mkdirSync(extracted);
    expandZip(result.archivePath, extracted);
    assert.equal(fs.existsSync(path.join(extracted, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(extracted, 'unpacked', 'manifest.json')), false);
    assert.deepEqual(walkFiles(extracted), walkFiles(result.packageDirectory));
    for (const relative of walkFiles(result.packageDirectory)) {
      const left = fs.readFileSync(path.join(result.packageDirectory, ...relative.split('/')));
      const right = fs.readFileSync(path.join(extracted, ...relative.split('/')));
      assert.equal(right.byteLength, left.byteLength, relative + ' extracted size differs');
      assert.equal(sha256(right), sha256(left), relative + ' extracted bytes differ');
    }
    assert.equal(result.receipt.archive.sha256, sha256(fs.readFileSync(result.archivePath)));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('InterT20_ChromeLoadsTheReleaseZipAndVerifiesItsBundledBaselineOffline', { timeout: 120000 }, async (t) => {
  // Scenario: Given the exact ZIP extracted into a fresh Chrome profile and Root-observed native Brain Rupture markup, when the MV3 worker and content script run offline.
  // Purpose: Verify a real production package maps only an exact W15 item without test proof support, while changed native text stays untouched.
  const tempRoot = makeTempRoot();
  const profileRoot = createPrivateProfileRoot();
  let context;
  let releasePendingVersionRequest = null;
  let blessingCdp;
  let versionRequestFinished = Promise.resolve();
  const waitForStep = async (promise, label, timeoutMs = 10000) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out waiting for ' + label)), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  try {
    const result = await buildFixturePackage(tempRoot, { version: '1.0.0' });
    const extracted = path.join(tempRoot, 'chrome-install');
    fs.mkdirSync(extracted);
    expandZip(result.archivePath, extracted);

    const runtime = loadRuntime();
    assert.equal(runtime.playwrightVersion, '1.62.1');
    context = await runtime.playwright.chromium.launchPersistentContext(path.join(profileRoot, 'profile'), {
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

    const serviceWorkerReady = context.waitForEvent('serviceworker', {
      predicate: (candidate) => candidate.url().endsWith('/shared/service-worker.js'),
      timeout: 20000
    }).catch((error) => ({ error }));
    const cdp = await context.browser().newBrowserCDPSession();
    let installed;
    try {
      installed = await cdp.send('Extensions.loadUnpacked', { path: extracted });
    } finally {
      await cdp.detach();
    }
    assert.match(installed.id, /^[a-p]{32}$/, 'Chrome did not return a valid ID for the unpacked release');
    let worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith('/shared/service-worker.js'));
    if (!worker) {
      const result = await serviceWorkerReady;
      if (result && result.error) throw result.error;
      worker = result;
    }
    assert.ok(worker.url().endsWith('/shared/service-worker.js'));
    const extensionId = new URL(worker.url()).hostname;
    assert.equal(extensionId, installed.id);

    const localBaseline = await worker.evaluate(async () => {
      const raw = await globalThis.W10SharedBaselineProvider.createBaselineProvider()();
      if (!raw) throw new Error('packaged baseline files were not readable from the installed extension');
      const identity = {
        gameVersion: '1.13.2',
        gameReleaseId: 'darktide:1.13.2',
        snapshotId: 'psyker-skills-blessings-1.13.2-18-files'
      };
      const snapshot = await globalThis.W10SharedLoader.verifyStoredSnapshot({ ...raw, identity });
      return {
        extensionId: chrome.runtime.id,
        manifestVersion: chrome.runtime.getManifest().manifest_version,
        extensionVersion: chrome.runtime.getManifest().version,
        identity: snapshot.identity,
        dataRevision: snapshot.manifest.dataRevision,
        domainKinds: [...snapshot.domains.keys()].sort(),
        rawPaths: [...snapshot.files.keys()].sort()
      };
    });
    assert.equal(localBaseline.extensionId, extensionId);
    assert.equal(localBaseline.manifestVersion, 3);
    assert.equal(localBaseline.extensionVersion, '1.0.0');
    assert.deepEqual(localBaseline.identity, {
      gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2',
      snapshotId: 'psyker-skills-blessings-1.13.2-18-files'
    });
    assert.equal(localBaseline.dataRevision, builderModule.W15.dataRevision);
    assert.deepEqual(localBaseline.domainKinds, ['blessings', 'skills', 'terms', 'weapons']);
    assert.deepEqual(localBaseline.rawPaths, [
      'domains/blessings.json', 'domains/skills.json', 'domains/terms.json', 'domains/weapons.json'
    ]);

    const observedAbilityCard = '<a href="https://darktide.gameslantern.com/abilities/brain-rupture" title="Brain Rupture" class="flex items-center gap-2">'
      + '<img src="https://gameslantern.com/storage/sites/darktide/exporter/talents/psyker/tactical/psyker_brain_burst_improved.png" width="60" height="60" loading="lazy">'
      + '<div><div class="font-teko text-lg/5 lg:text-xl text-pretty text-[#D7E4CE] font-medium hover:underline">Brain Rupture</div>'
      + '<div class="text-xs">Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.<br>\n<br>\n'
      + 'This is an augmented version of <span style="color: rgb(226,199,126);">Brain Burst</span> dealing '
      + '<span style="color: rgb(226,199,126);">+50%</span> Damage.</div></div></a>';
    const driftedAbilityCard = observedAbilityCard.replace('dealing <span', 'dealing slightly more <span');
    const detailAbility = '<div class="shadow-md border px-4 py-3 max-w-sm"><div class="flex text-sm"><div>Ability</div></div>'
      + '<div class="text-lg">Brain Rupture</div><div class="font-normal leading-5">'
      + 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.<br>\n<br>\n'
      + 'This is an augmented version of <span style="color: rgb(226,199,126);">Brain Burst</span> dealing '
      + '<span style="color: rgb(226,199,126);">+50%</span> Damage.</div></div>';
    const weaponDetail = (route, title, imagePath) => '<main><div class="relative" id="header-region">'
      + '<img alt="Header Image" src="https://darktide.gameslantern.com' + imagePath + '">'
      + '<div class="card-bg text-neutral-200"><div class="lg:absolute inset-x-0 bottom-0 pb-8">'
      + '<div class="relative flex justify-center pb-4 w-full"><h1><span>' + title + '</span><br><span>Warhammer 40,000</span></h1>'
      + '<div class="outline-title">\n  <span>' + title + '</span>\n  <br>\n  <span>Warhammer 40,000</span>\n</div></div></div></div></div>'
      + '<h2 class="text-xs">Stats</h2><div class="w-full grid"><div id="native-stats">native weapon stats</div></div>'
      + '<h2 class="text-xs">Actions</h2><div class="w-full grid"><div id="native-actions">native weapon actions</div></div>'
      + '<div id="native-damage-table">native interactive damage table</div></main>';
    const pageBodies = new Map([
      ['/abilities', '<main><section id="brain-rupture">' + observedAbilityCard
        + '</section><section id="drifted-brain-rupture">' + driftedAbilityCard + '</section></main>'],
      ['/abilities/brain-rupture', detailAbility],
      ['/weapon-blessing-traits', '<main><p id="native-blessing-page">Native blessing content remains unchanged.</p></main>'],
      ['/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe', weaponDetail(
        '/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe',
        'Orestes Mk&nbsp;IV Assault Chainaxe',
        '/storage/sites/darktide/weapons/VPoQRZKAlr4zEvg4uroy4gJ3z6IwTwyKS0MFKd4E.png')],
      ['/weapons/infantry-lasgun/kantrael-mk-vii-infantry-lasgun', weaponDetail(
        '/weapons/infantry-lasgun/kantrael-mk-vii-infantry-lasgun', 'Kantrael Mk VII Infantry Lasgun',
        '/storage/sites/darktide/weapons/a01-unmapped-lasgun-fixture.png')]
    ]);
    await context.route('https://darktide.gameslantern.com/**', (route) => {
      const url = new URL(route.request().url());
      const body = pageBodies.get(url.pathname) || '<main></main>';
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body>' + body + '</body></html>' });
    });
    const blessingPage = await context.newPage();
    blessingCdp = await context.newCDPSession(blessingPage);
    const blessingExecutionContexts = [];
    blessingCdp.on('Runtime.executionContextCreated', (event) => {
      blessingExecutionContexts.push(event.context);
    });
    await blessingCdp.send('Runtime.enable');
    let releaseVersionRequest;
    let resolveVersionRequestSeen;
    let resolveVersionRequestFinished;
    const versionRequestSeen = new Promise((resolve) => { resolveVersionRequestSeen = resolve; });
    versionRequestFinished = new Promise((resolve) => { resolveVersionRequestFinished = resolve; });
    const versionRequestGate = new Promise((resolve) => {
      releaseVersionRequest = resolve;
      releasePendingVersionRequest = resolve;
    });
    await context.route(builderModule.PRODUCTION_ORIGIN + '/version.json', async (route) => {
      resolveVersionRequestSeen();
      await versionRequestGate;
      try { await route.abort('internetdisconnected'); }
      finally { resolveVersionRequestFinished(); }
    });
    await blessingPage.goto('https://darktide.gameslantern.com/weapon-blessing-traits', {
      waitUntil: 'domcontentloaded', timeout: 15000
    });
    assert.equal(await blessingPage.evaluate(() => typeof globalThis.W11TestProofRegistry), 'undefined');
    await waitForStep(versionRequestSeen, 'the normal MV3 pinned snapshot request');
    await blessingPage.waitForSelector('[data-w11-owned="controls"]', { timeout: 5000 });
    assert.equal(await blessingPage.locator('[data-w11-owned="blessing-reader"]').count(), 0,
      'the reader must remain absent while its normal-package snapshot request is pending');
    assert.equal(await blessingPage.locator('#native-blessing-page').textContent(), 'Native blessing content remains unchanged.');

    // Scenario: Given a pending local snapshot request, when the SPA leaves the blessing overview before it resolves.
    // Purpose: Ensure late completion cannot insert the independent reader into an unrelated route.
    await blessingPage.evaluate(() => {
      history.pushState({}, '', '/abilities');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await blessingPage.waitForFunction(() => location.pathname === '/abilities');
    assert.equal(await blessingPage.locator('[data-w11-owned="blessing-reader"]').count(), 0);
    releaseVersionRequest();
    await waitForStep(versionRequestFinished, 'completion of the delayed version request');
    let contentEntryContextId = null;
    const contextDiagnostics = [];
    for (const executionContext of blessingExecutionContexts) {
      if (!executionContext.auxData || executionContext.auxData.type !== 'isolated') continue;
      try {
        const probe = await blessingCdp.send('Runtime.evaluate', { contextId: executionContext.id,
          returnByValue: true,
          expression: 'JSON.stringify({entry: typeof globalThis.W11ContentEntry, instance: typeof globalThis.__W11_CONTENT_ENTRY_INSTANCE__, '
            + 'loader: typeof globalThis.__W11_CONTENT_ENTRY_INSTANCE__?.identityResolver?.loadPinnedSnapshotForReading})' });
        const summary = JSON.parse(probe.result.value || 'null');
        contextDiagnostics.push({ id: executionContext.id, origin: executionContext.origin, summary });
        if (summary && summary.instance === 'object' && summary.loader === 'function') {
          contentEntryContextId = executionContext.id;
          break;
        }
      } catch (error) { contextDiagnostics.push({ id: executionContext.id, error: error.message }); }
    }
    assert.ok(contentEntryContextId, 'the MV3 content-entry context must expose its own pinned snapshot loader: '
      + JSON.stringify(contextDiagnostics));
    const snapshotEvaluation = await waitForStep(blessingCdp.send('Runtime.evaluate', {
      contextId: contentEntryContextId,
      awaitPromise: true,
      returnByValue: true,
      expression: 'globalThis.__W11_CONTENT_ENTRY_INSTANCE__.identityResolver.loadPinnedSnapshotForReading()'
        + '.then(snapshot => snapshot && snapshot.manifest.contentVersion)'
    }), 'the content script validated snapshot promise');
    assert.equal(snapshotEvaluation.result.value, '1.13.2.3',
      'the delayed loader must resolve the same verified local snapshot: '
        + JSON.stringify({ contextId: contentEntryContextId, result: snapshotEvaluation.result,
          exception: snapshotEvaluation.exceptionDetails && snapshotEvaluation.exceptionDetails.text }));
    assert.equal(await blessingPage.locator('[data-w11-owned="blessing-reader"]').count(), 0,
      'a completed request from a stale route generation must not create the reader');
    await blessingPage.evaluate(() => {
      history.pushState({}, '', '/weapon-blessing-traits/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { timeout: 15000 });
    assert.equal(await blessingPage.evaluate(() => location.pathname), '/weapon-blessing-traits/',
      'the supported overview reader also accepts the existing trailing-slash route');
    await context.setOffline(true);

    const page = await context.newPage();
    await page.goto('https://darktide.gameslantern.com/abilities', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-w11-owned="controls"] [role="status"]');
      return status && status.textContent !== '正在確認本機資料…';
    }, null, { timeout: 10000 });
    assert.equal(await page.locator('#brain-rupture .font-teko').textContent(), '顱腦崩裂',
      'the exact observed native item should use its unique W15 presentation in the production package');
    assert.equal(await page.locator('#brain-rupture [data-w11-owned="details"]').count(), 1);
    assert.equal(await page.locator('#drifted-brain-rupture .font-teko').textContent(), 'Brain Rupture',
      'a native description drift must stay in the original language');
    assert.equal(await page.locator('#drifted-brain-rupture [data-w11-owned="details"]').count(), 0);
    assert.equal(await page.locator('[data-w11-owned="blessing-reader"]').count(), 0);

    assert.equal(await blessingPage.locator('[data-w11-owned="blessing-reader"]').count(), 1);
    assert.equal(await blessingPage.locator('[data-w11-owned="controls"]').getAttribute('data-status'), 'original',
      'the independent reader must not claim that a native blessing or tier was translated');
    assert.match(await blessingPage.locator('[data-w11-blessing-reader-source]').textContent(),
      /本機資料版本 1\.13\.2\.3.*獨立閱讀器.*未驗證此頁原生祝福或階級適用性/);
    assert.equal(await blessingPage.locator('#native-blessing-page').textContent(), 'Native blessing content remains unchanged.');
    assert.equal(await blessingPage.getByLabel('祝福', { exact: true }).inputValue(), '');
    assert.equal(await blessingPage.getByLabel('祝福變體', { exact: true }).inputValue(), '');
    await blessingPage.getByLabel('祝福', { exact: true }).selectOption({ index: 1 });
    await blessingPage.getByLabel('祝福變體', { exact: true }).selectOption({ index: 1 });
    await blessingPage.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'a02-high-z-site-overlay';
      overlay.setAttribute('aria-label', 'controlled site overlay');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'auto',
        background: 'rgb(0 0 0 / 2%)'
      });
      document.body.append(overlay);
    });
    const readerOverlay = blessingPage.locator('#a02-high-z-site-overlay');
    const reader = blessingPage.locator('[data-w11-owned="blessing-reader"]');
    const readerStatus = blessingPage.locator('[data-w11-blessing-reader-source]');
    assert.equal(await readerOverlay.isVisible(), true, 'the controlled site overlay must remain visible');
    assert.match(await readerStatus.textContent(), /本機資料版本 1\.13\.2\.3.*獨立閱讀器.*未驗證此頁原生祝福或階級適用性/);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await blessingPage.setViewportSize(viewport);
      const layout = await blessingPage.evaluate(() => {
        const controls = document.querySelector('[data-w11-owned="controls"]');
        const reader = document.querySelector('[data-w11-owned="blessing-reader"]');
        const style = getComputedStyle(reader);
        const controlsBounds = controls.getBoundingClientRect();
        return { readerInControls: reader.parentElement === controls,
          overflowY: style.overflowY, maxHeight: Number.parseFloat(style.maxHeight),
          controlsLeft: controlsBounds.left, controlsRight: controlsBounds.right };
      });
      assert.equal(layout.readerInControls, true, 'the production reader must use the existing top-layer controls');
      assert.equal(layout.overflowY, 'auto', 'the reader content must scroll inside its bounded panel');
      assert.ok(layout.maxHeight <= Math.min(viewport.height * 0.5, 448) + 1,
        'the reader panel must stay below the viewport height limit');
      assert.ok(layout.controlsLeft >= 0 && layout.controlsRight <= viewport.width,
        'the controls and actions must remain inside the viewport');
      await reader.getByRole('button', { name: 'LV1', exact: true }).click({ timeout: 2500 });
      const readerTierOne = await blessingPage.locator('[data-w11-blessing-result]').textContent();
      await reader.getByRole('button', { name: 'LV4', exact: true }).click({ timeout: 2500 });
      const readerTierFour = await blessingPage.locator('[data-w11-blessing-result]').textContent();
      assert.match(readerTierOne, /LV1/);
      assert.match(readerTierOne, /17%/);
      assert.match(readerTierFour, /LV4/);
      assert.match(readerTierFour, /20%/);
      assert.notEqual(readerTierFour, readerTierOne, 'the standalone reader must show the selected Source tier values');
      assert.match(await blessingPage.locator('[data-w11-blessing-applicability]').textContent(), /尚未驗證/);
      assert.equal(await readerStatus.isVisible(), true, 'the local data version and applicability note must remain readable');
      const bounds = await reader.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
        'the blessing reader must stay inside the current viewport');
      assert.equal(await readerOverlay.isVisible(), true, 'tier clicks must leave the site overlay untouched');
    }
    assert.equal(await blessingPage.locator('main [data-w11-owned="details"], main [data-w11-owned="weapon"]').count(), 0,
      'reading local blessings must not create native translation records');
    const readerBounds = await blessingPage.locator('[data-w11-owned="blessing-reader"]').boundingBox();
    assert.ok(readerBounds && readerBounds.x >= 0 && readerBounds.x + readerBounds.width <= 390,
      'the independent reader must remain within a 390px viewport');
    await blessingPage.getByRole('button', { name: '切回原文' }).click({ timeout: 2500 });
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { state: 'detached' });
    assert.equal(await blessingPage.locator('[data-w11-owned="controls"]').getAttribute('data-status'), 'original');
    assert.equal(await readerOverlay.isVisible(), true, 'ordinary restore must leave the site overlay untouched');
    await blessingPage.getByRole('button', { name: '啟用繁體' }).click({ timeout: 2500 });
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { timeout: 5000 });
    assert.equal(await readerOverlay.isVisible(), true, 'ordinary re-enable must leave the site overlay untouched');
    await readerOverlay.evaluate((element) => element.remove());
    await blessingPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { state: 'detached' });
    await blessingPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await blessingPage.waitForSelector('[data-w11-owned="blessing-reader"]', { timeout: 5000 });
    assert.equal(await blessingPage.locator('[data-w11-owned="controls"]').getAttribute('data-status'), 'original');

    const detailPage = await context.newPage();
    await detailPage.goto('https://darktide.gameslantern.com/abilities/brain-rupture', { waitUntil: 'domcontentloaded' });
    await detailPage.waitForFunction(() => document.querySelector('[data-w11-owned="controls"] [role="status"]')?.textContent
      !== '正在確認本機資料…', null, { timeout: 10000 });
    assert.equal(await detailPage.locator('.shadow-md.border.max-w-sm .text-lg').textContent(), '顱腦崩裂',
      'the supported ability detail card should use the exact W15 model');
    assert.equal(await detailPage.locator('.shadow-md.border.max-w-sm [data-w11-owned="details"]').count(), 1);
    // Scenario: Given the controls are active, when a later site overlay occupies the entire viewport with a higher z-index, use ordinary clicks at desktop and mobile widths.
    // Purpose: Keep user-controlled restore and re-enable reachable without removing or altering site overlays, and ensure the controls do not trap focus.
    await detailPage.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'a01-high-z-site-overlay';
      overlay.setAttribute('aria-label', 'controlled site overlay');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'auto',
        background: 'rgb(0 0 0 / 2%)'
      });
      const outsideFocusTarget = document.createElement('button');
      outsideFocusTarget.id = 'a01-outside-focus-target';
      outsideFocusTarget.textContent = 'site focus target';
      document.body.append(overlay, outsideFocusTarget);
    });
    const controls = detailPage.locator('[data-w11-owned="controls"]');
    const overlay = detailPage.locator('#a01-high-z-site-overlay');
    assert.equal(await overlay.isVisible(), true, 'the controlled site overlay must remain visible');
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await detailPage.setViewportSize(viewport);
      await controls.getByRole('button', { name: '切回原文' }).click({ timeout: 5000 });
      await detailPage.waitForFunction(() => document.querySelector('.shadow-md.border.max-w-sm .text-lg')?.textContent === 'Brain Rupture'
        && document.querySelectorAll('.shadow-md.border.max-w-sm [data-w11-owned="details"]').length === 0);
      assert.equal(await overlay.isVisible(), true, 'ordinary restore clicks must leave the overlay untouched');
      await controls.getByRole('button', { name: '啟用繁體' }).click({ timeout: 5000 });
      await detailPage.waitForFunction(() => document.querySelector('.shadow-md.border.max-w-sm .text-lg')?.textContent === '顱腦崩裂'
        && document.querySelectorAll('.shadow-md.border.max-w-sm [data-w11-owned="details"]').length === 1);
      assert.equal(await overlay.isVisible(), true, 'ordinary enable clicks must leave the overlay untouched');
      assert.equal(await detailPage.locator(':modal').count(), 0, 'translation controls must not open a modal dialog');
      await detailPage.locator('#a01-outside-focus-target').focus();
      assert.equal(await detailPage.locator('#a01-outside-focus-target').evaluate((element) => document.activeElement === element), true,
        'focus must remain available outside the translation controls');
    }

    const weaponPage = await context.newPage();
    await weaponPage.goto('https://darktide.gameslantern.com/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe',
      { waitUntil: 'domcontentloaded' });
    await weaponPage.waitForFunction(() => document.querySelector('[data-w11-owned="controls"] [role="status"]')?.textContent
      !== '正在確認本機資料…', null, { timeout: 10000 });
    assert.equal(await weaponPage.locator('#header-region h1 span').first().textContent(), 'Orestes Mk\u00a0IV 突擊鏈斧',
      'the exact observed chainaxe mark should keep its brand and mark while translating the weapon family');
    assert.equal(await weaponPage.locator('[data-w11-owned="weapon"]').count(), 1);
    assert.equal(await weaponPage.locator('#native-stats').textContent(), 'native weapon stats');
    assert.equal(await weaponPage.locator('#native-actions').textContent(), 'native weapon actions');
    assert.equal(await weaponPage.locator('#native-damage-table').textContent(), 'native interactive damage table');
    await weaponPage.locator('[data-w11-owned="controls"] button').filter({ hasText: '切回原文' }).click();
    await weaponPage.waitForFunction(() => document.querySelector('#header-region h1 span')?.textContent === 'Orestes Mk\u00a0IV Assault Chainaxe'
      && document.querySelectorAll('[data-w11-owned="weapon"]').length === 0);

    const unknownWeaponPage = await context.newPage();
    await unknownWeaponPage.goto('https://darktide.gameslantern.com/weapons/infantry-lasgun/kantrael-mk-vii-infantry-lasgun',
      { waitUntil: 'domcontentloaded' });
    await unknownWeaponPage.waitForFunction(() => document.querySelector('[data-w11-owned="controls"] [role="status"]')?.textContent
      !== '正在確認本機資料…', null, { timeout: 10000 });
    assert.equal(await unknownWeaponPage.locator('#header-region h1 span').first().textContent(), 'Kantrael Mk VII Infantry Lasgun',
      'an unsupported native weapon tuple must remain in the original language');
    assert.equal(await unknownWeaponPage.locator('[data-w11-owned="weapon"]').count(), 0);
  } finally {
    if (releasePendingVersionRequest) releasePendingVersionRequest();
    if (context) {
      try { await waitForStep(versionRequestFinished, 'delayed version request cleanup', 2000); } catch (_) { }
      try { await context.unroute(builderModule.PRODUCTION_ORIGIN + '/version.json'); } catch (_) { }
      await context.close();
    }
    if (blessingCdp) { try { await blessingCdp.detach(); } catch (_) { } }
    removePrivateProfileRoot(profileRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});
