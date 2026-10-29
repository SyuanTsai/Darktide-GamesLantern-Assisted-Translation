'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const PRODUCTION_ORIGIN = 'https://darktide.tw-syuan.com';
const PREVIEW_ORIGIN = 'https://darktide-zh-tw-preview.syuan-tsai.workers.dev';
const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const SHARED_FILES = Object.freeze([
  'contract.js', 'domains.js', 'loader.js', 'snapshot-store.js',
  'update-coordinator.js', 'document-session.js', 'baseline-provider.js',
  'client.js', 'service-worker.js', 'native-identity.js', 'view-model.js',
  'presentation.js', 'production-dataset.js', 'dom-adapter.js', 'dom-controller.js', 'content-entry.js', 'display.css'
]);
const GAME_CONTENT_MATCHES = Object.freeze([
  'https://darktide.gameslantern.com/build-editor*',
  'https://darktide.gameslantern.com/abilities',
  'https://darktide.gameslantern.com/abilities/*',
  'https://darktide.gameslantern.com/weapon-blessing-traits*',
  'https://darktide.gameslantern.com/weapons/*'
]);
const CORE_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
const EXPECTED_MANIFEST_SHA256 = 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7';
const EXPECTED_DATA_REVISION = '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62';

function digest(raw) { return createHash('sha256').update(raw).digest('hex'); }

function ensurePrivateRoot() {
  const tempRoot = path.resolve(os.tmpdir());
  const privateRoot = path.join(tempRoot, 'syp-w10-builds');
  fs.mkdirSync(privateRoot, { recursive: true });
  const stat = fs.lstatSync(privateRoot);
  const resolved = path.resolve(privateRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolved !== privateRoot
    || !resolved.startsWith(tempRoot + path.sep)) {
    throw new Error('W10 private build root must be a plain directory inside the system temp root');
  }
  return privateRoot;
}

function requireRegularFile(source) {
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('W10 build input is not a regular file: ' + path.basename(source));
  return source;
}

function copyRequired(source, target) {
  requireRegularFile(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}

function writeNew(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
}

function verifyApprovedCandidate(extensionRoot) {
  const configured = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  if (!configured) return { included: false };
  const selectedDirectory = path.resolve(configured);
  const directoryStat = fs.lstatSync(selectedDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('W10 approved candidate input must be a plain directory');
  }
  const manifestPath = path.join(selectedDirectory, 'manifest.json');
  const manifestBytes = fs.readFileSync(requireRegularFile(manifestPath));
  if (manifestBytes.byteLength > 256 * 1024 || digest(manifestBytes) !== EXPECTED_MANIFEST_SHA256) {
    throw new Error('W09 candidate manifest raw bytes differ from the pinned isolation manifest');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== '2.0.0' || manifest.gameReleaseId !== 'darktide:1.13.2'
    || manifest.gameVersion !== '1.13.2' || manifest.contentVersion !== '1.13.2.1'
    || manifest.dataRevision !== EXPECTED_DATA_REVISION || manifest.changeIndexPath !== null
    || !Array.isArray(manifest.files) || manifest.files.length !== CORE_KINDS.length
    || !manifest.source || manifest.source.repository !== 'https://github.com/SyuanTsai/DarkTide-Source-Data'
    || !manifest.web || manifest.web.authoringCommit !== 'b4b11ec055adad42bb6732f833946886446e89cd'
    || new Set(manifest.files.map((file) => file.kind)).size !== CORE_KINDS.length
    || manifest.files.some((file) => !CORE_KINDS.includes(file.kind)
      || file.path !== 'domains/' + file.kind + '.json' || !Array.isArray(file.dependencies))) {
    throw new Error('fixed W09 manifest does not match the four-core isolation package contract');
  }
  const copied = [];
  let totalBytes = manifestBytes.byteLength;
  for (const file of manifest.files) {
    const source = path.join(selectedDirectory, ...file.path.split('/'));
    const raw = fs.readFileSync(requireRegularFile(source));
    const sha256 = digest(raw);
    if (file.sizeBytes !== raw.byteLength || file.sha256 !== sha256) {
      throw new Error('W09 candidate domain differs from its pinned manifest raw bytes: ' + file.path);
    }
    totalBytes += raw.byteLength;
    if (totalBytes > 16 * 1024 * 1024) throw new Error('W09 candidate exceeds the W10 raw snapshot size limit');
    const target = path.join(extensionRoot, 'baseline', ...file.path.split('/'));
    writeNew(target, raw);
    copied.push({ path: file.path, sizeBytes: raw.byteLength, sha256 });
  }
  const manifestTarget = path.join(extensionRoot, 'baseline', 'manifest.json');
  writeNew(manifestTarget, manifestBytes);
  const release = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: manifest.dataRevision,
    manifest_path: '/data/' + manifest.dataRevision + '/manifest.json',
    manifest_sha256: EXPECTED_MANIFEST_SHA256
  };
  const localProposalIndex = {
    schema_version: 2,
    data_revision: manifest.dataRevision,
    build_id: digest(manifestBytes),
    game_version: manifest.gameVersion,
    package_kind: 'published',
    game_releases: [release]
  };
  writeNew(path.join(extensionRoot, 'baseline', 'version.json'), Buffer.from(JSON.stringify(localProposalIndex) + '\n', 'utf8'));
  const provenance = {
    schemaVersion: 'w10-isolation-only-local-baseline/1',
    sourceWebHead: manifest.web.authoringCommit,
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    dataRevision: EXPECTED_DATA_REVISION,
    gameReleaseId: manifest.gameReleaseId,
    proposedContentVersion: manifest.contentVersion,
    actualContentVersion: null,
    isolationOnly: true,
    selected: false,
    allocationReserved: false,
    publicationEligible: false,
    packageKind: 'local-proposal-pointer-only'
  };
  writeNew(path.join(extensionRoot, 'baseline', 'provenance.json'), Buffer.from(JSON.stringify(provenance, null, 2) + '\n', 'utf8'));
  return { included: true, provenance, copied };
}

function buildDevExtension(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => key !== 'includeTestHarness')) {
    throw new TypeError('W10 dev build accepts only the includeTestHarness option');
  }
  const includeTestHarness = options.includeTestHarness === undefined ? false : options.includeTestHarness;
  if (typeof includeTestHarness !== 'boolean') throw new TypeError('includeTestHarness must be a boolean');
  const privateRoot = ensurePrivateRoot();
  const outputRoot = path.join(privateRoot, 'build-' + randomUUID().slice(0, 12));
  if (fs.existsSync(outputRoot)) throw new Error('W10 build output already exists');
  const resolvedOutput = path.resolve(outputRoot);
  if (!resolvedOutput.startsWith(privateRoot + path.sep)) throw new Error('W10 build output escaped the private temp root');
  fs.mkdirSync(outputRoot);
  const extensionPath = path.join(outputRoot, 'extension');
  fs.mkdirSync(extensionPath);
  const sharedSource = path.join(REPOSITORY_ROOT, 'extension', 'shared');
  const sharedTarget = path.join(extensionPath, 'shared');
  fs.mkdirSync(sharedTarget);
  try {
    for (const name of SHARED_FILES) {
      const source = requireRegularFile(path.join(sharedSource, name));
      const target = path.join(sharedTarget, name);
      if (name === 'loader.js') {
        const sourceText = fs.readFileSync(source, 'utf8');
        const hits = sourceText.split(PRODUCTION_ORIGIN).length - 1;
        if (hits !== 1) throw new Error('W10 loader fixed production origin did not match the build replacement contract');
        writeNew(target, Buffer.from(sourceText.replace(PRODUCTION_ORIGIN, PREVIEW_ORIGIN), 'utf8'));
      } else {
        copyRequired(source, target);
      }
    }
    const selectedOrigin = PREVIEW_ORIGIN;
    const manifest = {
      manifest_version: 3,
      name: 'DarkTide Shared Snapshot W10 DEV',
      version: '0.1.0',
      description: 'Private W10 shared-snapshot integration build.',
      permissions: [],
      host_permissions: [selectedOrigin + '/*'],
      background: { service_worker: 'shared/service-worker.js', type: 'classic' },
      content_scripts: [{
        matches: [...GAME_CONTENT_MATCHES],
        js: [
          'shared/contract.js', 'shared/domains.js', 'shared/loader.js',
          'shared/document-session.js', 'shared/client.js', 'shared/native-identity.js',
          'shared/view-model.js', 'shared/presentation.js', 'shared/production-dataset.js', 'shared/dom-adapter.js',
          'shared/dom-controller.js', ...(includeTestHarness ? ['test-support/native-proof-registry.js'] : []),
          'shared/content-entry.js'
        ],
        css: ['shared/display.css'],
        run_at: 'document_idle',
        all_frames: false
      }],
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" }
    };
    writeNew(path.join(extensionPath, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
    const approvedBaseline = verifyApprovedCandidate(extensionPath);
    if (includeTestHarness) {
      const testSource = path.join(REPOSITORY_ROOT, 'tests', 'w10');
      copyRequired(path.join(testSource, 'mv3-harness.html'), path.join(extensionPath, 'w10-harness.html'));
      copyRequired(path.join(testSource, 'mv3-harness.js'), path.join(extensionPath, 'w10-harness.js'));
      copyRequired(path.join(REPOSITORY_ROOT, 'tests', 'w11', 'native-proof-registry.js'),
        path.join(extensionPath, 'test-support', 'native-proof-registry.js'));
    }
    return { outputRoot, extensionPath, manifest, selectedOrigin, includeTestHarness, approvedBaseline };
  } catch (error) {
    const safeRoot = path.resolve(outputRoot);
    if (safeRoot.startsWith(privateRoot + path.sep) && path.basename(safeRoot).startsWith('build-')) {
      fs.rmSync(safeRoot, { recursive: true, force: true, maxRetries: 3 });
    }
    throw error;
  }
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => arg !== '--include-test-harness');
  if (unknown.length) throw new Error('unsupported W10 build option: ' + unknown.join(', '));
  const result = buildDevExtension({ includeTestHarness: args.has('--include-test-harness') });
  process.stdout.write(JSON.stringify({ outputRoot: result.outputRoot, extensionPath: result.extensionPath,
    selectedOrigin: result.selectedOrigin, includeTestHarness: result.includeTestHarness,
    approvedBaseline: result.approvedBaseline }) + '\n');
}

module.exports = { PRODUCTION_ORIGIN, PREVIEW_ORIGIN, buildDevExtension };
