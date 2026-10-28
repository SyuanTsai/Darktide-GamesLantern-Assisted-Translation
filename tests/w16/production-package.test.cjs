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
  'native-identity.js', 'view-model.js', 'presentation.js', 'dom-adapter.js',
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
      'shared/view-model.js', 'shared/presentation.js', 'shared/dom-adapter.js',
      'shared/dom-controller.js', 'shared/content-entry.js'
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
      'icons/icon48.png', 'manifest.json', ...SHARED_FILES.map((file) => 'shared/' + file)
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

test('InterT20_ChromeLoadsTheReleaseZipAndVerifiesItsBundledBaselineOffline', { timeout: 120000 }, async () => {
  // Scenario: Given the exact ZIP extracted into a fresh Chrome profile, when the MV3 worker and content script run offline.
  // Purpose: Verify a real installed package can read and validate the pinned four-domain baseline without any test harness.
  const tempRoot = makeTempRoot();
  const profileRoot = createPrivateProfileRoot();
  let context;
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

    await context.setOffline(true);
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

    await context.route('https://darktide.gameslantern.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><main><p id="native-copy">Original native page text remains unchanged.</p></main></body></html>'
    }));
    const page = await context.newPage();
    await page.goto('https://darktide.gameslantern.com/abilities/brain-rupture', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-w11-owned="controls"] [role="status"]').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.locator('#native-copy').textContent(), 'Original native page text remains unchanged.');
    assert.equal(await page.locator('[data-w11-owned="details"]').count(), 0);
    assert.equal(await page.locator('[data-w11-owned="blessing-reader"]').count(), 0);
  } finally {
    if (context) await context.close();
    removePrivateProfileRoot(profileRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});
