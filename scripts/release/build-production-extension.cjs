'use strict';

const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const contract = require('../../extension/shared/contract.js');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const PRODUCTION_ORIGIN = 'https://darktide.tw-syuan.com';
const BASELINE_DIR = path.join(REPOSITORY_ROOT, 'extension', 'release-baseline', 'w15');
const ICON_DIR = path.join(REPOSITORY_ROOT, 'extension', 'icons');
const ZIP_SCRIPT = path.join(__dirname, 'package-zip.ps1');
const CORE_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
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
const W15 = Object.freeze({
  gameVersion: '1.13.2',
  contentVersion: '1.13.2.3',
  buildId: '6872aee741cef7f150bd79fc25ad251276b15f6a81a9c287f5e3623b6df422dc',
  dataRevision: 'f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f',
  manifestSha256: 'fcd7ff131ae55315fa0b9323355ed0e7b69788ffe03841de025723cec16e8642'
});
const BASELINE_PINS = Object.freeze({
  'version.json': Object.freeze({ sizeBytes: 655, sha256: 'f259d3545dd5f80d4310a859a8e016df9fe42cc19ef5612431eaf8b055e13e0e' }),
  'manifest.json': Object.freeze({ sizeBytes: 2259, sha256: W15.manifestSha256 }),
  'domains/blessings.json': Object.freeze({ sizeBytes: 113990, sha256: '3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5' }),
  'domains/skills.json': Object.freeze({ sizeBytes: 165051, sha256: '108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449' }),
  'domains/terms.json': Object.freeze({ sizeBytes: 124557, sha256: '602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6' }),
  'domains/weapons.json': Object.freeze({ sizeBytes: 6798596, sha256: '132ec16e830d4af560bd212095f4fa0209bc8f238eb17a26528e112e6ebd41a8' })
});
const ICON_PINS = Object.freeze({
  'source.svg': 'c569271e10e615072a265bb42cecba3a64acaa6a88537cbd115dff35ecdd5b07',
  'icon16.png': 'a89b64ac3cb5faf67f6ee3395156985966f277e91cd9452c5322eb7f7895b68d',
  'icon32.png': '522d235920176b106e8edf7546a9e17fb5a8751a499a99549c4b357dc17a5aa6',
  'icon48.png': 'cac604f0318e53299d48572ccc5fdca5f48355f0b746135c6d47bf1ae78499c2',
  'icon128.png': 'b2308f17da417e04d1c1cc09286a56b09aaddaeda540dc4788900c6662b1b856'
});
const ICONS = Object.freeze([
  Object.freeze({ size: 16, path: 'icons/icon16.png' }),
  Object.freeze({ size: 32, path: 'icons/icon32.png' }),
  Object.freeze({ size: 48, path: 'icons/icon48.png' }),
  Object.freeze({ size: 128, path: 'icons/icon128.png' })
]);
const VERSION_PATTERN = /^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*)){0,3}$/;
const ICON_NAME = 'Darktide GamesLantern 繁中助手';
const ICON_DESCRIPTION = 'Integrity-checked Traditional Chinese Darktide data. Native page text is changed only when its identity has a verified local match.';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function requirePlainDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(label + ' must be a plain directory');
  return resolved;
}

function requireRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + ' must be a regular file');
  return filePath;
}

function readUtf8Json(raw, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch (_) { throw new Error(label + ' must be valid UTF-8'); }
  try { return JSON.parse(text); }
  catch (_) { throw new Error(label + ' must be valid JSON'); }
}

function filesUnder(directory) {
  const result = [];
  const visit = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('pinned input directories must not contain symbolic links: ' + relative);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) result.push(relative);
      else throw new Error('pinned input contains a non-regular filesystem entry: ' + relative);
    }
  };
  visit(directory, '');
  return result.sort();
}

function readPinnedFiles(directory, expected, label) {
  const root = requirePlainDirectory(directory, label);
  const actual = filesUnder(root);
  const expectedPaths = Object.keys(expected).sort();
  if (actual.length !== expectedPaths.length || actual.some((file, index) => file !== expectedPaths[index])) {
    throw new Error(label + ' file set differs from the exact W15 release baseline pins');
  }
  const result = new Map();
  for (const relative of expectedPaths) {
    const filePath = path.join(root, ...relative.split('/'));
    const raw = fs.readFileSync(requireRegularFile(filePath, label + ' ' + relative));
    const pin = expected[relative];
    const hash = sha256(raw);
    if (raw.byteLength !== pin.sizeBytes || hash !== pin.sha256) {
      throw new Error(label + ' ' + relative + ' size or SHA-256 differs from the W15 pinned bytes');
    }
    result.set(relative, { raw, sizeBytes: raw.byteLength, sha256: hash });
  }
  return result;
}

function readPngSize(raw, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (raw.length < 24 || !raw.subarray(0, 8).equals(signature) || raw.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(label + ' is not a valid PNG image');
  }
  return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
}

function readIcons(directory) {
  const expected = Object.keys(ICON_PINS).sort();
  const root = requirePlainDirectory(directory, 'release icon directory');
  const actual = filesUnder(root);
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error('release icon file set differs from the fixed source and derived PNG assets');
  }
  const result = new Map();
  for (const relative of expected) {
    const raw = fs.readFileSync(requireRegularFile(path.join(root, relative), 'release icon ' + relative));
    const hash = sha256(raw);
    if (hash !== ICON_PINS[relative]) throw new Error('release icon ' + relative + ' SHA-256 differs from its fixed source asset');
    if (relative.endsWith('.png')) {
      const edge = Number(/^icon([0-9]+)\.png$/.exec(relative)[1]);
      const dimensions = readPngSize(raw, relative);
      if (dimensions.width !== edge || dimensions.height !== edge) throw new Error(relative + ' dimensions do not match its manifest size');
    }
    result.set(relative, { raw, sizeBytes: raw.byteLength, sha256: hash });
  }
  return result;
}

function validateVersion(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new TypeError('extension version must be one to four canonical numeric components');
  }
  const components = version.split('.');
  if (components.every((component) => component === '0')) {
    throw new TypeError('extension version must not consist only of zero components');
  }
  for (const component of components) {
    if (Number(component) > 65535) throw new TypeError('extension version components must be at most 65535');
  }
  return version;
}

async function readBaseline(directory) {
  const files = readPinnedFiles(directory, BASELINE_PINS, 'W15 production baseline');
  const versionBytes = files.get('version.json').raw;
  const manifestBytes = files.get('manifest.json').raw;
  const version = readUtf8Json(versionBytes, 'W15 version.json');
  const manifest = readUtf8Json(manifestBytes, 'W15 manifest.json');
  contract.validateVersion(version);
  await contract.validateManifest(manifest, { cryptoApi: webcrypto });
  const release = contract.selectGameRelease(version, W15.gameVersion);
  if (!release || release.content_version !== W15.contentVersion || release.data_revision !== W15.dataRevision
    || release.manifest_sha256 !== W15.manifestSha256 || manifest.gameVersion !== W15.gameVersion
    || manifest.contentVersion !== W15.contentVersion || manifest.dataRevision !== W15.dataRevision
    || sha256(manifestBytes) !== W15.manifestSha256) {
    throw new Error('W15 baseline identity or current release pointer differs from the fixed production pins');
  }
  const selected = await contract.selectConsumerFiles(manifest, {
    requiredKinds: [...CORE_KINDS], supportedKinds: [...CORE_KINDS], cryptoApi: webcrypto
  });
  const paths = selected.map((file) => file.path).sort();
  const expectedPaths = CORE_KINDS.map((kind) => 'domains/' + kind + '.json').sort();
  if (paths.length !== expectedPaths.length || paths.some((file, index) => file !== expectedPaths[index])) {
    throw new Error('W15 baseline core-domain dependency closure is not exactly the four supported files');
  }
  for (const file of selected) {
    const raw = files.get(file.path).raw;
    if (raw.byteLength !== file.sizeBytes || sha256(raw) !== file.sha256) {
      throw new Error('W15 baseline core domain differs from the shared manifest: ' + file.path);
    }
  }
  return { files, version, manifest };
}

function buildManifest(version) {
  return {
    manifest_version: 3,
    name: ICON_NAME,
    version,
    description: ICON_DESCRIPTION,
    icons: { '16': 'icons/icon16.png', '32': 'icons/icon32.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' },
    permissions: [],
    host_permissions: [PRODUCTION_ORIGIN + '/*'],
    background: { service_worker: 'shared/service-worker.js', type: 'classic' },
    content_scripts: [{
      matches: [...CONTENT_MATCHES],
      js: [
        'shared/contract.js', 'shared/domains.js', 'shared/loader.js',
        'shared/document-session.js', 'shared/client.js', 'shared/native-identity.js',
        'shared/view-model.js', 'shared/presentation.js', 'shared/dom-adapter.js',
        'shared/dom-controller.js', 'shared/content-entry.js'
      ],
      css: ['shared/display.css'],
      run_at: 'document_idle',
      all_frames: false
    }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" }
  };
}

function writeNew(filePath, raw) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, raw, { flag: 'wx' });
}

function copyRaw(raw, filePath) { writeNew(filePath, raw); }

function inventory(directory) {
  return filesUnder(directory).map((relative) => {
    const raw = fs.readFileSync(path.join(directory, ...relative.split('/')));
    return { path: relative, sizeBytes: raw.byteLength, sha256: sha256(raw) };
  });
}

function validateOutputDirectory(directory) {
  if (typeof directory !== 'string' || directory.trim() === '') throw new TypeError('outputDir is required');
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root || resolved === REPOSITORY_ROOT) {
    throw new Error('release output directory must be a new, non-root directory');
  }
  if (fs.existsSync(resolved)) throw new Error('release output directory already exists');
  let current = path.dirname(resolved);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('release output path must not traverse a symbolic-link directory');
    }
    current = path.dirname(current);
  }
  return resolved;
}

function createZip(packageDirectory, archivePath) {
  if (process.platform !== 'win32') throw new Error('production ZIP packaging is supported on the Windows build host only');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ZIP_SCRIPT,
    '-SourceDirectory', packageDirectory, '-DestinationPath', archivePath
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw new Error('Windows ZIP packaging could not start: ' + result.error.message);
  if (result.status !== 0) throw new Error('Windows ZIP packaging failed: ' + String(result.stderr || result.stdout).trim());
  requireRegularFile(archivePath, 'release ZIP');
}

async function buildProductionExtensionPackage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['version', 'baselineDir', 'iconDir', 'outputDir'].includes(key))) {
    throw new TypeError('production package accepts only version, baselineDir, iconDir, and outputDir');
  }
  const version = validateVersion(options.version);
  const outputDirectory = validateOutputDirectory(options.outputDir);
  const baselineDirectory = options.baselineDir === undefined ? BASELINE_DIR : path.resolve(options.baselineDir);
  const iconDirectory = options.iconDir === undefined ? ICON_DIR : path.resolve(options.iconDir);
  const baseline = await readBaseline(baselineDirectory);
  const icons = readIcons(iconDirectory);
  const manifest = buildManifest(version);
  const packageDirectory = path.join(outputDirectory, 'unpacked');
  const archiveName = 'darktide-gameslantern-zh-tw-' + version + '.zip';
  const archivePath = path.join(outputDirectory, archiveName);
  const receiptPath = path.join(outputDirectory, 'package-receipt.json');

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(packageDirectory);
  for (const relative of SHARED_FILES) {
    const source = requireRegularFile(path.join(REPOSITORY_ROOT, 'extension', 'shared', relative), 'shared runtime file ' + relative);
    copyRaw(fs.readFileSync(source), path.join(packageDirectory, 'shared', relative));
  }
  for (const relative of Object.keys(BASELINE_PINS)) {
    const targetRelative = relative === 'version.json' || relative === 'manifest.json'
      ? 'baseline/' + relative : 'baseline/' + relative;
    copyRaw(baseline.files.get(relative).raw, path.join(packageDirectory, ...targetRelative.split('/')));
  }
  for (const relative of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
    copyRaw(icons.get(relative).raw, path.join(packageDirectory, 'icons', relative));
  }
  const privacyBytes = fs.readFileSync(requireRegularFile(path.join(REPOSITORY_ROOT, 'PRIVACY.md'), 'privacy policy'));
  copyRaw(privacyBytes, path.join(packageDirectory, 'PRIVACY.md'));
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeNew(path.join(packageDirectory, 'manifest.json'), manifestBytes);

  const packageFiles = inventory(packageDirectory);
  createZip(packageDirectory, archivePath);
  const archiveBytes = fs.readFileSync(archivePath);
  const receipt = {
    schema: 'w16-extension-package/1',
    extensionVersion: version,
    productionOrigin: PRODUCTION_ORIGIN,
    gameVersion: W15.gameVersion,
    contentVersion: W15.contentVersion,
    buildId: W15.buildId,
    dataRevision: W15.dataRevision,
    sharedManifestSha256: W15.manifestSha256,
    baselineFiles: Object.keys(BASELINE_PINS).map((file) => ({ path: file, ...BASELINE_PINS[file] })),
    iconAssets: Object.keys(ICON_PINS).map((file) => ({ path: file, sha256: ICON_PINS[file] })),
    packageFiles,
    archive: { fileName: archiveName, sizeBytes: archiveBytes.byteLength, sha256: sha256(archiveBytes) }
  };
  writeNew(receiptPath, Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8'));
  return { outputDirectory, packageDirectory, archivePath, receiptPath, manifest, receipt };
}

function parseCli(argv) {
  const allowed = new Set(['--version', '--output-dir']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || Object.hasOwn(values, key)) throw new Error('unsupported or duplicate option: ' + key);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(key + ' requires a value');
    values[key] = value;
    index += 1;
  }
  if (!values['--version'] || !values['--output-dir']) throw new Error('--version and --output-dir are required');
  return { version: values['--version'], outputDir: values['--output-dir'] };
}

if (require.main === module) {
  let options;
  try { options = parseCli(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(String(error.message || error) + '\n');
    process.exitCode = 2;
  }
  if (options) {
    buildProductionExtensionPackage(options).then((result) => {
      process.stdout.write(JSON.stringify({
        extensionVersion: result.receipt.extensionVersion,
        contentVersion: result.receipt.contentVersion,
        packageDirectory: result.packageDirectory,
        archivePath: result.archivePath,
        archiveSha256: result.receipt.archive.sha256
      }) + '\n');
    }, (error) => {
      process.stderr.write(String(error && error.message || error) + '\n');
      process.exitCode = 1;
    });
  }
}

module.exports = {
  BASELINE_PINS,
  CONTENT_MATCHES,
  ICON_PINS,
  PRODUCTION_ORIGIN,
  SHARED_FILES,
  W15,
  buildProductionExtensionPackage,
  parseCli,
  readPngSize,
  validateVersion
};
