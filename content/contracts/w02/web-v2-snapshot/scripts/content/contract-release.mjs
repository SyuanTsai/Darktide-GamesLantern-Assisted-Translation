import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const DOMAIN_KINDS = Object.freeze([
  'skills',
  'blessings',
  'weapons',
  'terms',
  'catalog',
  'curios',
  'perks',
  'classifications',
  'announcements',
  'game-changes',
]);

export const REQUIRED_FEATURES = Object.freeze([
  'official-errata-details-v1',
  'official-native-localizations-v1',
  'blessing-tier-presentations-v1',
]);
export const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
export const CONTRACT_SCHEMA_PATH = fileURLToPath(
  new URL('../../content/schema/v2/shared-release.schema.json', import.meta.url),
);

const DOMAIN_KIND_SET = new Set(DOMAIN_KINDS);
const REQUIRED_FEATURE_SET = new Set(REQUIRED_FEATURES);
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GAME_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CONTENT_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.([1-9][0-9]*)$/;
const RELATIVE_JSON_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/;
const GAME_RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIXTURE_ID_PATTERN = /^synthetic-[a-z0-9][a-z0-9-]{1,62}$/;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(label + ' must be an object');
}

function requireExactKeys(value, requiredKeys, label) {
  requireRecord(value, label);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) fail(label + ' is missing required property: ' + key);
  }
  const allowed = new Set(requiredKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(label + ' contains unexpected property: ' + key);
  }
}

function requireSha1(value, label) {
  if (typeof value !== 'string' || !SHA1_PATTERN.test(value)) {
    fail(label + ' must be a 40-character lowercase SHA-1');
  }
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(label + ' must be a 64-character lowercase SHA-256');
  }
}

function requireGameVersion(value, label) {
  if (typeof value !== 'string' || !GAME_VERSION_PATTERN.test(value)) {
    fail(label + ' must be a canonical three-part game version');
  }
}

function requireContentVersion(value, gameVersion, label) {
  if (typeof value !== 'string') {
    fail(label + ' must be a four-part contentVersion with a positive revision');
  }
  const match = CONTENT_VERSION_PATTERN.exec(value);
  if (!match || value.slice(0, value.lastIndexOf('.')) !== gameVersion) {
    fail(label + ' must be a four-part contentVersion matching gameVersion with a positive revision');
  }
}

export function buildManifestPath(dataRevision) {
  requireSha256(dataRevision, 'dataRevision');
  return '/data/' + dataRevision + '/manifest.json';
}

export function validateVersion(version) {
  const keys = [
    'schema_version', 'data_revision', 'build_id', 'game_version', 'package_kind', 'game_releases',
  ];
  requireExactKeys(version, keys, 'version');
  if (version.schema_version !== 2) fail('version.schema_version must equal 2');
  requireSha256(version.data_revision, 'version.data_revision');
  requireSha256(version.build_id, 'version.build_id');
  requireGameVersion(version.game_version, 'version.game_version');
  if (version.package_kind !== 'published') fail('version.package_kind must equal "published"');
  if (!Array.isArray(version.game_releases) || version.game_releases.length === 0) {
    fail('version.game_releases must contain at least one release pointer');
  }

  const seenGameVersions = new Set();
  const seenManifestPaths = new Set();
  let selectedRelease = null;
  for (let index = 0; index < version.game_releases.length; index += 1) {
    const release = version.game_releases[index];
    const label = 'version.game_releases[' + index + ']';
    requireExactKeys(release, [
      'game_version', 'content_version', 'data_revision', 'manifest_path', 'manifest_sha256',
    ], label);
    requireGameVersion(release.game_version, label + '.game_version');
    requireContentVersion(release.content_version, release.game_version, label + '.content_version');
    requireSha256(release.data_revision, label + '.data_revision');
    requireSha256(release.manifest_sha256, label + '.manifest_sha256');
    if (release.manifest_path !== buildManifestPath(release.data_revision)) {
      fail(label + '.manifest_path must be the same-origin path for its dataRevision');
    }
    if (seenGameVersions.has(release.game_version)) {
      fail('duplicate game_version in version.game_releases: ' + release.game_version);
    }
    seenGameVersions.add(release.game_version);
    if (seenManifestPaths.has(release.manifest_path)) {
      fail('duplicate manifest_path in version.game_releases: ' + release.manifest_path);
    }
    seenManifestPaths.add(release.manifest_path);
    if (release.game_version === version.game_version) selectedRelease = release;
  }

  if (!selectedRelease) fail('version.game_version must have one matching entry in game_releases');
  if (version.data_revision !== selectedRelease.data_revision) {
    fail('version.data_revision must match the selected game_releases pointer');
  }
  return version;
}

export function validateFixtureMarker(marker) {
  requireExactKeys(marker, ['fixtureOnly', 'publicationEligible', 'fixtureId'], 'fixture marker');
  if (marker.fixtureOnly !== true) fail('fixtureOnly must be true for a synthetic fixture');
  if (marker.publicationEligible !== false) fail('publicationEligible must be false for a synthetic fixture');
  if (typeof marker.fixtureId !== 'string' || !FIXTURE_ID_PATTERN.test(marker.fixtureId)) {
    fail('fixtureId must use a synthetic identifier');
  }
  return marker;
}

function validateRelativeJsonPath(value, label) {
  if (typeof value !== 'string' || !RELATIVE_JSON_PATH_PATTERN.test(value)) {
    fail(label + ' must be a safe relative JSON path');
  }
  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    fail(label + ' must not contain empty or traversal path segments');
  }
  if (value.includes('%') || value.includes('\\') || value.startsWith('/')) {
    fail(label + ' must not contain encoded, backslash, or absolute path syntax');
  }
  return value;
}

function assertUniqueStrings(values, label) {
  if (new Set(values).size !== values.length) fail(label + ' must not contain duplicates');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function dataRevisionMaterial(manifest) {
  const files = manifest.files.map(file => ({
    kind: file.kind,
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    dependencies: [...file.dependencies].sort(compareUtf8),
  })).sort((left, right) => compareUtf8(left.path, right.path));

  return canonicalize({
    source: manifest.source,
    web: manifest.web,
    compatibility: {
      dataContractMajor: manifest.compatibility.dataContractMajor,
      requiredFeatures: [...manifest.compatibility.requiredFeatures].sort(compareUtf8),
      gameSnapshotRefs: [...manifest.compatibility.gameSnapshotRefs].sort(compareUtf8),
    },
    files,
    changeIndexPath: manifest.changeIndexPath,
  });
}

export function computeDataRevision(manifest) {
  requireRecord(manifest, 'manifest');
  if (!Array.isArray(manifest.files) || !isRecord(manifest.source) || !isRecord(manifest.web)
      || !isRecord(manifest.compatibility)) {
    fail('manifest is missing dataRevision inputs for the canonical content index');
  }
  const canonical = JSON.stringify(dataRevisionMaterial(manifest));
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function validateDependencyGraph(filesByPath) {
  for (const file of filesByPath.values()) {
    for (const dependency of file.dependencies) {
      if (!filesByPath.has(dependency)) {
        fail('file dependency points to missing path: ' + dependency);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = filePath => {
    if (visiting.has(filePath)) fail('file dependency cycle includes: ' + filePath);
    if (visited.has(filePath)) return;
    visiting.add(filePath);
    for (const dependency of filesByPath.get(filePath).dependencies) visit(dependency);
    visiting.delete(filePath);
    visited.add(filePath);
  };
  for (const filePath of filesByPath.keys()) visit(filePath);
}

export function validateManifest(manifest) {
  requireExactKeys(manifest, [
    'schemaVersion', 'gameReleaseId', 'gameVersion', 'contentVersion', 'dataRevision',
    'source', 'web', 'compatibility', 'files', 'changeIndexPath',
  ], 'manifest');
  if (manifest.schemaVersion !== '2.0.0') fail('manifest.schemaVersion must equal "2.0.0"');
  if (typeof manifest.gameReleaseId !== 'string' || !GAME_RELEASE_ID_PATTERN.test(manifest.gameReleaseId)) {
    fail('manifest.gameReleaseId must be a stable release identifier');
  }
  requireGameVersion(manifest.gameVersion, 'manifest.gameVersion');
  requireContentVersion(manifest.contentVersion, manifest.gameVersion, 'manifest.contentVersion');
  requireSha256(manifest.dataRevision, 'manifest.dataRevision');

  requireExactKeys(manifest.source, ['repository', 'commit', 'sourceRevision', 'manifestSha256'], 'manifest.source');
  if (manifest.source.repository !== SOURCE_REPOSITORY) {
    fail('manifest.source.repository must be the fixed public Source repository');
  }
  requireSha1(manifest.source.commit, 'source.commit');
  requireSha256(manifest.source.sourceRevision, 'source.sourceRevision');
  requireSha256(manifest.source.manifestSha256, 'source.manifestSha256');

  requireExactKeys(manifest.web, ['authoringCommit', 'compilerCommit'], 'manifest.web');
  requireSha1(manifest.web.authoringCommit, 'web.authoringCommit');
  requireSha1(manifest.web.compilerCommit, 'web.compilerCommit');

  requireExactKeys(manifest.compatibility, ['dataContractMajor', 'requiredFeatures', 'gameSnapshotRefs'], 'manifest.compatibility');
  if (manifest.compatibility.dataContractMajor !== 2) {
    fail('compatibility.dataContractMajor must equal 2');
  }
  const features = manifest.compatibility.requiredFeatures;
  if (!Array.isArray(features)) fail('compatibility.requiredFeatures must be an array');
  assertUniqueStrings(features, 'compatibility.requiredFeatures');
  for (const feature of features) {
    if (!REQUIRED_FEATURE_SET.has(feature)) {
      fail('compatibility.requiredFeatures contains unknown required feature: ' + String(feature));
    }
  }
  if (features.includes('blessing-tier-presentations-v1') && !features.includes('official-native-localizations-v1')) {
    fail('compatibility.requiredFeatures blessing-tier-presentations-v1 requires official-native-localizations-v1');
  }
  const snapshots = manifest.compatibility.gameSnapshotRefs;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    fail('compatibility.gameSnapshotRefs must contain at least one snapshot reference');
  }
  assertUniqueStrings(snapshots, 'compatibility.gameSnapshotRefs');
  for (const snapshot of snapshots) {
    if (typeof snapshot !== 'string' || !SNAPSHOT_ID_PATTERN.test(snapshot)) {
      fail('compatibility.gameSnapshotRefs contains an invalid snapshot reference');
    }
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('manifest.files must contain at least one domain file');
  }
  const filesByPath = new Map();
  const lowerPaths = new Set();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const file = manifest.files[index];
    const label = 'manifest.files[' + index + ']';
    requireExactKeys(file, ['kind', 'path', 'sizeBytes', 'sha256', 'dependencies'], label);
    if (typeof file.kind !== 'string' || !DOMAIN_KIND_SET.has(file.kind)) {
      fail(label + '.kind is not a known shared domain kind');
    }
    validateRelativeJsonPath(file.path, label + '.path');
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) {
      fail(label + '.sizeBytes must be a positive safe integer');
    }
    requireSha256(file.sha256, label + '.sha256');
    if (!Array.isArray(file.dependencies)) fail(label + '.dependencies must be an array');
    assertUniqueStrings(file.dependencies, label + '.dependencies');
    for (const dependency of file.dependencies) {
      validateRelativeJsonPath(dependency, label + '.dependencies');
    }
    const lowerPath = file.path.toLowerCase();
    if (filesByPath.has(file.path)) fail('duplicate file path: ' + file.path);
    if (lowerPaths.has(lowerPath)) fail('file paths have a case-insensitive collision: ' + file.path);
    filesByPath.set(file.path, file);
    lowerPaths.add(lowerPath);
  }

  validateDependencyGraph(filesByPath);
  if (manifest.changeIndexPath !== null) {
    validateRelativeJsonPath(manifest.changeIndexPath, 'manifest.changeIndexPath');
    const changeIndex = filesByPath.get(manifest.changeIndexPath);
    if (!changeIndex) fail('manifest.changeIndexPath must reference a listed file');
    if (changeIndex.kind !== 'game-changes') {
      fail('manifest.changeIndexPath must identify a game-changes file');
    }
  }

  if (manifest.dataRevision !== computeDataRevision(manifest)) {
    fail('manifest.dataRevision does not match the canonical content index');
  }
  return manifest;
}

export function selectGameRelease(version, gameVersion) {
  validateVersion(version);
  requireGameVersion(gameVersion, 'requested gameVersion');
  return version.game_releases.find(release => release.game_version === gameVersion) ?? null;
}

export function selectConsumerFiles(manifest, { requiredKinds, supportedKinds } = {}) {
  validateManifest(manifest);
  if (!Array.isArray(requiredKinds) || !Array.isArray(supportedKinds)) {
    fail('consumer requiredKinds and supportedKinds must be arrays');
  }
  for (const [label, kinds] of [['requiredKinds', requiredKinds], ['supportedKinds', supportedKinds]]) {
    assertUniqueStrings(kinds, 'consumer ' + label);
    for (const kind of kinds) {
      if (typeof kind !== 'string' || !DOMAIN_KIND_SET.has(kind)) {
        fail('unknown consumer kind: ' + String(kind));
      }
    }
  }
  const supported = new Set(supportedKinds);
  for (const kind of requiredKinds) {
    if (!supported.has(kind)) fail('required kind is not in the consumer supported set: ' + kind);
  }

  const filesByPath = new Map(manifest.files.map(file => [file.path, file]));
  const selected = new Map();
  const addFile = file => {
    if (!supported.has(file.kind)) {
      fail('dependency kind is not supported by the consumer: ' + file.kind);
    }
    if (selected.has(file.path)) return;
    selected.set(file.path, file);
    for (const dependency of file.dependencies) addFile(filesByPath.get(dependency));
  };
  for (const kind of requiredKinds) {
    const matchingFiles = manifest.files.filter(file => file.kind === kind);
    if (matchingFiles.length === 0) fail('required kind is missing from manifest.files: ' + kind);
    for (const file of matchingFiles) addFile(file);
  }
  return [...selected.values()].sort((left, right) => compareUtf8(left.path, right.path));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function readSafeFile(root, relativePath) {
  const segments = relativePath.split('/');
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!isInside(root, current)) fail('package path escapes its root: ' + relativePath);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') fail('missing file: ' + relativePath);
      throw error;
    }
    if (info.isSymbolicLink()) fail('symbolic links are not permitted in a release package: ' + relativePath);
    if (index < segments.length - 1 && !info.isDirectory()) {
      fail('parent path is not a directory: ' + relativePath);
    }
    if (index === segments.length - 1 && !info.isFile()) {
      fail('package path is not a regular file: ' + relativePath);
    }
  }
  return readFile(current);
}

function parseJsonBytes(bytes, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(label + ' must be valid UTF-8 JSON');
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(label + ' must contain valid JSON');
  }
}

function addExpectedPath(expected, lowerPaths, relativePath, record, label) {
  const normalized = relativePath.split(path.sep).join('/');
  const lower = normalized.toLowerCase();
  const previous = expected.get(normalized);
  if (previous) {
    if (previous.role === 'domain' && record.role === 'domain' && isDeepStrictEqual(previous.record, record.record)) return;
    fail('package path is claimed by multiple release entries: ' + normalized);
  }
  if (lowerPaths.has(lower) && !expected.has(normalized)) {
    fail('package paths have a case-insensitive collision: ' + normalized);
  }
  expected.set(normalized, { role: record.role, record: record.record });
  lowerPaths.add(lower);
  if (record.role === 'domain') return;
  if (!record.role) fail(label + ' has no package path role');
}

async function collectPackageFiles(root) {
  const files = [];
  const visit = async (directory, prefix) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail('symbolic links are not permitted in a release package: ' + relative);
      if (info.isDirectory()) await visit(absolute, relative);
      else if (info.isFile()) files.push(relative);
      else fail('unsupported filesystem entry in release package: ' + relative);
    }
  };
  await visit(root, '');
  return files;
}

export async function validateReleaseDirectory(packageRoot) {
  if (typeof packageRoot !== 'string' || packageRoot.length === 0) fail('package root is required');
  const absoluteRoot = path.resolve(packageRoot);
  let rootInfo;
  try {
    rootInfo = await lstat(absoluteRoot);
  } catch (error) {
    if (error && error.code === 'ENOENT') fail('package root does not exist');
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail('package root must be a real directory');
  const root = await realpath(absoluteRoot);
  const fixtureBytes = await readSafeFile(root, 'fixture.json').catch(error => {
    if (error && /missing file: fixture\.json/.test(error.message)) return null;
    throw error;
  });
  const fixtureOnly = fixtureBytes !== null;
  if (fixtureOnly) validateFixtureMarker(parseJsonBytes(fixtureBytes, 'fixture.json'));

  const versionBytes = await readSafeFile(root, 'version.json');
  const version = validateVersion(parseJsonBytes(versionBytes, 'version.json'));
  const expected = new Map();
  const lowerPaths = new Set();
  addExpectedPath(expected, lowerPaths, 'version.json', { role: 'version' }, 'version.json');
  if (fixtureOnly) addExpectedPath(expected, lowerPaths, 'fixture.json', { role: 'fixture' }, 'fixture.json');

  const releaseIds = new Set();
  const manifests = [];
  for (const pointer of version.game_releases) {
    const manifestRelativePath = pointer.manifest_path.slice(1);
    addExpectedPath(expected, lowerPaths, manifestRelativePath, { role: 'manifest' }, pointer.manifest_path);
    const manifestBytes = await readSafeFile(root, manifestRelativePath);
    if (sha256(manifestBytes) !== pointer.manifest_sha256) {
      fail('manifest SHA-256 mismatch for ' + pointer.game_version);
    }
    const manifest = validateManifest(parseJsonBytes(manifestBytes, manifestRelativePath));
    if (
      manifest.gameVersion !== pointer.game_version
      || manifest.contentVersion !== pointer.content_version
      || manifest.dataRevision !== pointer.data_revision
    ) {
      fail('version pointer and manifest release identity do not match for ' + pointer.game_version);
    }
    if (releaseIds.has(manifest.gameReleaseId)) {
      fail('duplicate gameReleaseId in version.game_releases: ' + manifest.gameReleaseId);
    }
    releaseIds.add(manifest.gameReleaseId);
    manifests.push(manifest);

    for (const file of manifest.files) {
      const relativePath = path.posix.join('data', manifest.dataRevision, file.path);
      const record = { role: 'domain', record: file };
      addExpectedPath(expected, lowerPaths, relativePath, record, file.path);
    }
  }

  const checkedDomains = new Set();
  let totalDomainBytes = 0;
  for (const manifest of manifests) {
    for (const file of manifest.files) {
      const relativePath = path.posix.join('data', manifest.dataRevision, file.path);
      const key = relativePath.toLowerCase();
      if (checkedDomains.has(key)) continue;
      checkedDomains.add(key);
      const bytes = await readSafeFile(root, relativePath);
      if (bytes.byteLength !== file.sizeBytes) {
        fail('domain file size mismatch: ' + file.path);
      }
      if (sha256(bytes) !== file.sha256) {
        fail('domain file SHA-256 mismatch: ' + file.path);
      }
      const data = parseJsonBytes(bytes, file.path);
      if (!isRecord(data)) fail('domain file must contain a JSON object: ' + file.path);
      totalDomainBytes += bytes.byteLength;
    }
  }

  const actualFiles = await collectPackageFiles(root);
  const actualLowerPaths = new Set();
  for (const file of actualFiles) {
    const lower = file.toLowerCase();
    if (actualLowerPaths.has(lower)) fail('package paths have a case-insensitive collision: ' + file);
    actualLowerPaths.add(lower);
  }
  const actualSet = new Set(actualFiles);
  for (const expectedPath of expected.keys()) {
    if (!actualSet.has(expectedPath)) fail('missing file: ' + expectedPath);
  }
  for (const actualPath of actualFiles) {
    if (!expected.has(actualPath)) fail('unlisted file in release package: ' + actualPath);
  }

  return {
    valid: true,
    fixtureOnly,
    releasesChecked: version.game_releases.length,
    domainFilesChecked: checkedDomains.size,
    totalDomainBytes,
  };
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--root' || !argv[1] || argv[1].startsWith('--')) {
    fail('usage: node scripts/content/contract-release.mjs --root <package-directory>');
  }
  return argv[1];
}

async function main() {
  try {
    const packageRoot = parseArguments(process.argv.slice(2));
    const result = await validateReleaseDirectory(packageRoot);
    process.stdout.write(
      'Shared-release contract validation passed: releases=' + result.releasesChecked
      + ' domainFiles=' + result.domainFilesChecked
      + ' bytes=' + result.totalDomainBytes
      + ' fixtureOnly=' + String(result.fixtureOnly)
      + '. Structural validation does not grant publication approval.\n',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown validation failure';
    process.stderr.write('Shared-release contract validation failed: ' + message + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
