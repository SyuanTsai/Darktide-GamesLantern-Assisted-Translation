import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT_RELATIVE = 'content/contracts/w02/dev-capability.json';
const LOCK_RELATIVE = 'content/contracts/w02/owner-snapshot.lock.json';
const SOURCE_SNAPSHOT = 'source-v2-snapshot';
const WEB_SNAPSHOT = 'web-v2-snapshot';
const PINNED_LOCK_SHA256 = '90c13714911497e9c757e8402b3929a1c46c2527053842e83010cec279dcb0b9';
const MAX_OWNER_FILES = 32;
const MAX_OWNER_FILE_BYTES = 256 * 1024;
const MAX_OWNER_TOTAL_BYTES = 1024 * 1024;
const require = createRequire(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(label + ' must be an object');
}

function assertExactKeys(value, keys, label) {
  assertRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(label + ' has missing or unknown keys');
  }
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.length === 0) ||
      new Set(values).size !== values.length) {
    fail(label + ' must be a unique string list');
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function sameObject(actual, expected) {
  return JSON.stringify(sortObject(actual)) === JSON.stringify(sortObject(expected));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJsonBytes(bytes, label) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    fail(label + ' is not valid UTF-8 JSON');
  }
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
      value.includes(String.fromCharCode(0)) || value.startsWith('/') || /^[A-Za-z]:/.test(value) ||
      value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    fail(label + ' is not a safe relative path');
  }
  return value;
}

function safeChildPath(root, relativePath, label) {
  const safe = safeRelativePath(relativePath, label);
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...safe.split('/'));
  const relative = path.relative(absoluteRoot, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    fail(label + ' escaped its pinned root');
  }
  return target;
}

function collectRegularFiles(root, label) {
  let info;
  try {
    info = fs.lstatSync(root);
  } catch {
    fail(label + ' directory is missing');
  }
  if (info.isSymbolicLink() || !info.isDirectory()) fail(label + ' must be a real directory');
  const realRoot = fs.realpathSync(root);
  const found = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const itemInfo = fs.lstatSync(absolute);
      if (itemInfo.isSymbolicLink()) fail(label + ' contains a symbolic link');
      if (itemInfo.isDirectory()) {
        visit(absolute);
      } else if (itemInfo.isFile()) {
        const relative = path.relative(realRoot, absolute).split(path.sep).join('/');
        found.push(relative);
      } else {
        fail(label + ' contains a non-file entry');
      }
    }
  };
  visit(realRoot);
  return found.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function readRegularFile(root, relativePath, label) {
  const absolute = safeChildPath(root, relativePath, label);
  let info;
  try {
    info = fs.lstatSync(absolute);
  } catch {
    fail(label + ' is missing: ' + relativePath);
  }
  if (info.isSymbolicLink() || !info.isFile()) fail(label + ' is not a regular file: ' + relativePath);
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(absolute);
  const relative = path.relative(realRoot, realTarget);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    fail(label + ' escaped its pinned root: ' + relativePath);
  }
  return fs.readFileSync(realTarget);
}

function validateContract(contract, lock, packageJson, lockBytes) {
  assertExactKeys(contract, [
    'contractVersion', 'packageVersion', 'snapshotLockSha256', 'runtimeIntegration',
    'publicationEligible', 'owners', 'capabilities'
  ], 'W02 capability contract');
  if (contract.contractVersion !== '1.0.0' || contract.packageVersion !== '0.2.30' ||
      packageJson.version !== contract.packageVersion || contract.runtimeIntegration !== false ||
      contract.publicationEligible !== false) {
    fail('W02 capability contract must remain dev-only, non-publishing, and on package 0.2.30');
  }
  if (typeof contract.snapshotLockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(contract.snapshotLockSha256) ||
      contract.snapshotLockSha256 !== PINNED_LOCK_SHA256 || sha256(lockBytes) !== PINNED_LOCK_SHA256) {
    fail('owner snapshot lock SHA-256 does not match the fixed W02 capability pin');
  }
  assertExactKeys(contract.owners, ['source', 'web'], 'W02 owners');
  assertExactKeys(lock, ['lockVersion', 'owners'], 'owner snapshot lock');
  if (lock.lockVersion !== 1) fail('owner snapshot lock version is unsupported');
  assertExactKeys(contract.capabilities, [
    'knownDomains', 'knownFeatures', 'featureDependencies', 'runtime'
  ], 'W02 capabilities');
  assertExactKeys(contract.capabilities.runtime, [
    'requiredDomains', 'supportedDomains', 'domainDependencies'
  ], 'W01 runtime capabilities');
  assertUniqueStrings(contract.capabilities.knownDomains, 'knownDomains');
  assertUniqueStrings(contract.capabilities.knownFeatures, 'knownFeatures');
  assertUniqueStrings(contract.capabilities.runtime.requiredDomains, 'runtime requiredDomains');
  assertUniqueStrings(contract.capabilities.runtime.supportedDomains, 'runtime supportedDomains');
  if (!isRecord(contract.capabilities.featureDependencies) ||
      !isRecord(contract.capabilities.runtime.domainDependencies)) {
    fail('capability dependency maps must be closed objects');
  }
  if (contract.capabilities.runtime.requiredDomains.some(kind =>
    !contract.capabilities.runtime.supportedDomains.includes(kind))) {
    fail('every runtime-required domain must be supported');
  }
  const expectedOwners = {
    source: {
      repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
      commit: '15f285ec3ad9314435141a18125cabfc1b3d1d19',
      snapshot: SOURCE_SNAPSHOT
    },
    web: {
      repository: 'https://github.com/SyuanTsai/DarkTide-Web',
      commit: '2816042d4a7380288ac8e73d1058a8accfe5687b',
      snapshot: WEB_SNAPSHOT
    }
  };
  for (const ownerName of ['source', 'web']) {
    assertExactKeys(contract.owners[ownerName], ['repository', 'commit', 'snapshot'], 'contract owner ' + ownerName);
    assertExactKeys(lock.owners[ownerName], ['repository', 'commit', 'snapshot', 'files'], 'lock owner ' + ownerName);
    if (!sameObject(contract.owners[ownerName], expectedOwners[ownerName]) ||
        lock.owners[ownerName].repository !== expectedOwners[ownerName].repository ||
        lock.owners[ownerName].commit !== expectedOwners[ownerName].commit ||
        lock.owners[ownerName].snapshot !== expectedOwners[ownerName].snapshot) {
      fail('owner pin or snapshot directory differs from the fixed W02 revision: ' + ownerName);
    }
    if (!Array.isArray(lock.owners[ownerName].files) || lock.owners[ownerName].files.length === 0 ||
        lock.owners[ownerName].files.length > MAX_OWNER_FILES) {
      fail('owner snapshot file list is invalid: ' + ownerName);
    }
    const paths = new Set();
    let totalBytes = 0;
    for (const file of lock.owners[ownerName].files) {
      assertExactKeys(file, ['path', 'sizeBytes', 'sha256'], 'owner file pin');
      safeRelativePath(file.path, 'owner file path');
      if (paths.has(file.path) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 ||
          file.sizeBytes > MAX_OWNER_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        fail('owner file pin is invalid: ' + ownerName);
      }
      paths.add(file.path);
      totalBytes += file.sizeBytes;
    }
    if (totalBytes > MAX_OWNER_TOTAL_BYTES) fail('owner snapshot exceeds the bounded size');
    const expectedCount = ownerName === 'source' ? 3 : 21;
    if (lock.owners[ownerName].files.length !== expectedCount) {
      fail('owner snapshot file count is incomplete: ' + ownerName);
    }
  }
}

function assertSnapshotTree(snapshotRoot, owner, ownerName) {
  const expectedPaths = owner.files.map(file => file.path)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const actualPaths = collectRegularFiles(snapshotRoot, ownerName + ' owner snapshot');
  if (!sameArray(actualPaths, expectedPaths)) fail(ownerName + ' owner snapshot contains missing or unlisted files');
  let totalBytes = 0;
  for (const file of owner.files) {
    const bytes = readRegularFile(snapshotRoot, file.path, ownerName + ' snapshot file');
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {
      fail(ownerName + ' owner snapshot SHA-256 or size mismatch: ' + file.path);
    }
    totalBytes += bytes.length;
  }
  if (totalBytes > MAX_OWNER_TOTAL_BYTES) fail(ownerName + ' owner snapshot exceeds the bounded size');
  return { totalBytes };
}

function parseLiteralList(source, expression, label, identifiers = {}) {
  const match = source.match(expression);
  if (!match) fail('cannot read W01 runtime capability marker: ' + label);
  const tokens = match[1].split(',').map(value => value.trim()).filter(Boolean);
  return tokens.map(token => {
    if (token.length >= 2 && token[0] === "'" && token[token.length - 1] === "'") {
      return token.slice(1, -1);
    }
    if (Object.hasOwn(identifiers, token)) return identifiers[token];
    fail('unsupported token in W01 runtime capability marker: ' + label);
  });
}

function parseRuntimeDependencies(source) {
  const match = source.match(/const\s+DEPENDENCIES\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!match) fail('cannot read W01 runtime domain dependencies');
  const body = match[1];
  const entryPattern = /(?:'([^']+)'|([A-Za-z][A-Za-z0-9-]*))\s*:\s*\[([^\]]*)\]\s*,?/g;
  const dependencies = {};
  let entry;
  while ((entry = entryPattern.exec(body)) !== null) {
    const key = entry[1] || entry[2];
    if (Object.hasOwn(dependencies, key)) fail('duplicate W01 runtime dependency key: ' + key);
    dependencies[key] = parseLiteralList('[' + entry[3] + ']', /^\[([\s\S]*)\]$/, key);
  }
  const remainder = body.replace(entryPattern, '').replace(/[\s,]/g, '');
  if (remainder !== '') fail('unsupported W01 runtime dependency syntax');
  return dependencies;
}

function inspectRuntime(extensionRoot, contract) {
  const loaderPath = path.join(extensionRoot, 'extension/w01/loader-core.js');
  let loaderText;
  try {
    loaderText = fs.readFileSync(loaderPath, 'utf8');
  } catch {
    fail('W01 runtime loader is missing');
  }
  const loaderApi = require(loaderPath);
  const required = parseLiteralList(loaderText,
    /const\s+REQUIRED_KINDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/,
    'REQUIRED_KINDS');
  const supported = parseLiteralList(loaderText,
    /const\s+ALL_KINDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/,
    'ALL_KINDS');
  const tierFeatureMatch = loaderText.match(/const\s+BLESSING_TIER_FEATURE\s*=\s*'([^']+)'/);
  if (!tierFeatureMatch) fail('cannot read W01 blessing-tier feature marker');
  const tierFeature = tierFeatureMatch[1];
  const features = parseLiteralList(loaderText,
    /const\s+SUPPORTED_FEATURES\s*=\s*new Set\(\[([\s\S]*?)\]\);/,
    'SUPPORTED_FEATURES', { BLESSING_TIER_FEATURE: tierFeature });
  const dependencies = parseRuntimeDependencies(loaderText);
  const compactLoader = loaderText.replace(/\s+/g, '');
  if (!compactLoader.includes('if(featureSet.has(BLESSING_TIER_FEATURE)&&!featureSet.has(\'official-native-localizations-v1\'))')) {
    fail('W01 runtime native-localization tier dependency could not be confirmed');
  }
  if (!compactLoader.includes('for(constsnapshotRefofcompatibility.gameSnapshotRefs){if(!isNonEmptyString(snapshotRef)||!sourceIds.has(snapshotRef))')) {
    fail('W01 runtime gameSnapshotRefs owner binding could not be confirmed');
  }
  if (!compactLoader.includes('publishedpackageisnotacceptedbythisDEVloader') ||
      !compactLoader.includes('pending-previewpackageisdisabled')) {
    fail('W01 runtime DEV package restrictions could not be confirmed');
  }
  if (!sameArray(loaderApi.REQUIRED_KINDS, required) || !sameArray(loaderApi.ALL_KINDS, supported)) {
    fail('W01 runtime exported domain capabilities differ from their source markers');
  }
  const expectedRuntime = contract.capabilities.runtime;
  if (!sameArray(expectedRuntime.requiredDomains, required) ||
      !sameArray(expectedRuntime.supportedDomains, supported) ||
      !sameObject(expectedRuntime.domainDependencies, dependencies)) {
    fail('W02 runtime capability metadata differs from the existing W01 loader');
  }
  if (!sameArray(contract.capabilities.knownFeatures, features)) {
    fail('W02 feature metadata differs from the existing W01 loader');
  }
  return {
    requiredDomains: required,
    supportedDomains: supported,
    supportedFeatures: features,
    domainDependencies: dependencies,
    pendingPreviewRequiresExplicitOptIn: true,
    publishedPackagesAccepted: false
  };
}

function validateFeatureDependencyProbe(webValidator, manifest, contract) {
  const dependencies = contract.capabilities.featureDependencies;
  const keys = Object.keys(dependencies);
  if (keys.length !== 1 || keys[0] !== 'blessing-tier-presentations-v1' ||
      !sameArray(dependencies[keys[0]], ['official-native-localizations-v1'])) {
    fail('W02 feature dependency contract is incomplete or contains an unknown rule');
  }
  const native = structuredClone(manifest);
  native.compatibility.requiredFeatures = ['official-native-localizations-v1'];
  native.dataRevision = webValidator.computeDataRevision(native);
  webValidator.validateManifest(native);
  const tier = structuredClone(manifest);
  tier.compatibility.requiredFeatures = ['blessing-tier-presentations-v1'];
  tier.dataRevision = webValidator.computeDataRevision(tier);
  let rejected = false;
  try {
    webValidator.validateManifest(tier);
  } catch (error) {
    rejected = /requires official-native-localizations-v1/i.test(error.message);
  }
  if (!rejected) fail('pinned Web validator no longer enforces the native-localization tier dependency');
}

function validateSnapshotReferenceProbe(webValidator, manifest) {
  const invalid = structuredClone(manifest);
  invalid.compatibility.gameSnapshotRefs = [];
  invalid.dataRevision = webValidator.computeDataRevision(invalid);
  let rejected = false;
  try {
    webValidator.validateManifest(invalid);
  } catch (error) {
    rejected = /snapshot|reference/i.test(error.message);
  }
  if (!rejected) fail('pinned Web validator no longer rejects unbound gameSnapshotRefs');
}

async function verifyOwnerCheckout(ownerName, checkoutRoot, ownerLock) {
  let rootInfo;
  try {
    rootInfo = fs.lstatSync(checkoutRoot);
  } catch {
    fail(ownerName + ' checkout root is missing');
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail(ownerName + ' checkout root must be a real directory');
  const root = fs.realpathSync(checkoutRoot);
  let head;
  try {
    head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true
    }).trim();
  } catch {
    fail(ownerName + ' checkout HEAD could not be verified');
  }
  if (head !== ownerLock.commit) fail(ownerName + ' checkout HEAD differs from the fixed owner pin');
  for (const file of ownerLock.files) {
    const bytes = readRegularFile(root, file.path, ownerName + ' checkout file');
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {
      fail(ownerName + ' checkout file differs from the pinned Git blob: ' + file.path);
    }
  }
  return { verified: true, commit: head, fileCount: ownerLock.files.length };
}

async function runW02Conformance({
  extensionRoot = REPOSITORY_ROOT,
  sourceRoot = null,
  webRoot = null
} = {}) {
  const root = path.resolve(extensionRoot);
  const contractBytes = fs.readFileSync(safeChildPath(root, CONTRACT_RELATIVE, 'capability contract'));
  const lockBytes = fs.readFileSync(safeChildPath(root, LOCK_RELATIVE, 'owner snapshot lock'));
  const contract = parseJsonBytes(contractBytes, 'W02 capability contract');
  const lock = parseJsonBytes(lockBytes, 'owner snapshot lock');
  const packageJson = parseJsonBytes(fs.readFileSync(safeChildPath(root, 'package.json', 'package metadata')),
    'package.json');
  validateContract(contract, lock, packageJson, lockBytes);

  const sourceOwner = lock.owners.source;
  const webOwner = lock.owners.web;
  const sourceSnapshotRoot = safeChildPath(
    root, 'content/contracts/w02/' + sourceOwner.snapshot, 'Source snapshot root');
  const webSnapshotRoot = safeChildPath(
    root, 'content/contracts/w02/' + webOwner.snapshot, 'Web snapshot root');
  const sourceSnapshot = assertSnapshotTree(sourceSnapshotRoot, sourceOwner, 'source');
  const webSnapshot = assertSnapshotTree(webSnapshotRoot, webOwner, 'web');

  const sourceCheckout = sourceRoot === null ? null : await verifyOwnerCheckout('source', sourceRoot, sourceOwner);
  const webCheckout = webRoot === null ? null : await verifyOwnerCheckout('web', webRoot, webOwner);
  const runtime = inspectRuntime(root, contract);

  const sourceValidatorPath = safeChildPath(
    sourceSnapshotRoot, 'scripts/content/contract-validator.mjs', 'Source validator');
  const sourceValidator = await import(pathToFileURL(sourceValidatorPath).href);
  const sourceResult = await sourceValidator.validateSourceContractFromDisk(
    parseJsonBytes(readRegularFile(sourceSnapshotRoot, 'content/fixtures/v2/representative-source.json',
      'Source representative fixture'), 'Source representative fixture'),
    { sourceRoot: sourceSnapshotRoot }
  );
  if (!sourceResult.valid || sourceResult.publicationEligible !== false) {
    fail('pinned Source owner fixture is invalid or unexpectedly publication-eligible');
  }

  const sharedSourceBytes = [];
  for (const file of sourceOwner.files) {
    const topLevelBytes = readRegularFile(sourceSnapshotRoot, file.path, 'Source owner snapshot file');
    const nestedSourcePath = 'content/contracts/source-v2-snapshot/' + file.path;
    const nestedBytes = readRegularFile(webSnapshotRoot, nestedSourcePath, 'Web nested Source cache file');
    if (!topLevelBytes.equals(nestedBytes)) {
      fail('Web nested Source cache differs from the pinned Source owner bytes: ' + file.path);
    }
    sharedSourceBytes.push({ path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 });
  }

  const webValidatorPath = safeChildPath(
    webSnapshotRoot, 'scripts/content/contract-release.mjs', 'Web validator');
  const webValidator = await import(pathToFileURL(webValidatorPath).href);
  const webSchema = parseJsonBytes(readRegularFile(webSnapshotRoot,
    'content/schema/v2/shared-release.schema.json', 'Web shared-release schema'), 'Web shared-release schema');
  const webSchemaPath = safeChildPath(
    webSnapshotRoot, 'content/schema/v2/shared-release.schema.json', 'Web shared-release schema');
  if (webValidator.CONTRACT_SCHEMA_PATH !== webSchemaPath ||
      !sameArray(webSchema.definitions.domainKind.enum, webValidator.DOMAIN_KINDS) ||
      !sameArray(contract.capabilities.knownDomains, webValidator.DOMAIN_KINDS) ||
      !sameArray(contract.capabilities.knownFeatures, webValidator.REQUIRED_FEATURES)) {
    fail('W02 known domain or feature metadata differs from the pinned Web schema and validator');
  }

  const authoringSchema = parseJsonBytes(readRegularFile(webSnapshotRoot,
    'content/schema/v2/web-authoring.schema.json', 'Web authoring schema'), 'Web authoring schema');
  const authoringValidatorPath = safeChildPath(
    webSnapshotRoot, 'scripts/content/contract-authoring.mjs', 'Web authoring validator');
  const authoringValidator = await import(pathToFileURL(authoringValidatorPath).href);
  if (authoringValidator.assertWebAuthoringSchemaParity(authoringSchema) !== true) {
    fail('pinned Web authoring schema and validator are not in parity');
  }
  const authoringInputs = await authoringValidator.loadWebAuthoringInputs({ repoRoot: webSnapshotRoot });
  const sourceFilesByPath = Object.fromEntries(sourceOwner.files.map(file => [file.path, file]));
  const expectedSourceLockFiles = {
    schema: {
      path: 'content/schema/v2/source-contract.schema.json',
      sha256: sourceFilesByPath['content/schema/v2/source-contract.schema.json'].sha256
    },
    fixture: {
      path: 'content/fixtures/v2/representative-source.json',
      sha256: sourceFilesByPath['content/fixtures/v2/representative-source.json'].sha256
    },
    validator: {
      path: 'scripts/content/contract-validator.mjs',
      sha256: sourceFilesByPath['scripts/content/contract-validator.mjs'].sha256
    }
  };
  if (authoringInputs.sourceLock.repository !== sourceOwner.repository ||
      authoringInputs.sourceLock.commit !== sourceOwner.commit ||
      authoringInputs.sourceLock.schemaId !== sourceValidator.CONTRACT_SCHEMA_ID ||
      !sameObject(authoringInputs.sourceLock.files, expectedSourceLockFiles)) {
    fail('Web authoring Source lock does not match the fixed Source owner pins');
  }
  const expectedAuthoringSourcePin = {
    repository: sourceOwner.repository,
    commit: sourceOwner.commit,
    schemaId: sourceValidator.CONTRACT_SCHEMA_ID,
    schemaSha256: expectedSourceLockFiles.schema.sha256,
    fixtureSha256: expectedSourceLockFiles.fixture.sha256,
    validatorSha256: expectedSourceLockFiles.validator.sha256
  };
  if (!sameObject(authoringInputs.sourcePin, expectedAuthoringSourcePin)) {
    fail('Web authoring fixture Source pin does not match the fixed Source owner bytes');
  }
  if (authoringInputs.authoring.fixtureOnly !== true || authoringInputs.authoring.publicationEligible !== false) {
    fail('Web authoring representative fixture must remain synthetic and non-publishable');
  }
  const authoringResult = authoringValidator.validateWebAuthoring(authoringInputs.authoring, authoringInputs);
  if (!authoringResult.valid || authoringResult.publicationEligible !== false) {
    fail('pinned Web authoring fixture did not validate as non-publishable: ' +
      authoringResult.issues.map(item => item.path + ': ' + item.message).join('; '));
  }

  const validFixtureRoot = safeChildPath(
    webSnapshotRoot, 'content/fixtures/v2/shared-release/valid', 'Web valid release fixture');
  const validManifestPath = 'data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/manifest.json';
  const validManifest = parseJsonBytes(readRegularFile(validFixtureRoot, validManifestPath, 'Web valid manifest'),
    'Web valid manifest');
  validateFeatureDependencyProbe(webValidator, validManifest, contract);
  validateSnapshotReferenceProbe(webValidator, validManifest);

  const webFixtures = [];
  for (const name of ['valid', 'announcement-only']) {
    const fixtureRoot = safeChildPath(
      webSnapshotRoot, 'content/fixtures/v2/shared-release/' + name, 'Web fixture root');
    const marker = parseJsonBytes(readRegularFile(fixtureRoot, 'fixture.json', name + ' fixture marker'),
      name + ' fixture marker');
    if (marker.fixtureOnly !== true || marker.publicationEligible !== false) {
      fail(name + ' Web fixture must remain non-publishing');
    }
    const result = await webValidator.validateReleaseDirectory(fixtureRoot);
    if (!result.valid || !result.fixtureOnly) fail(name + ' Web fixture did not validate as fixture-only');
    const version = parseJsonBytes(readRegularFile(fixtureRoot, 'version.json', name + ' version'),
      name + ' version');
    const selected = webValidator.selectGameRelease(version, version.game_version);
    if (!selected) fail(name + ' Web fixture has no exact game-version pointer');
    webFixtures.push({
      name,
      fixtureOnly: true,
      publicationEligible: false,
      releasesChecked: result.releasesChecked,
      domainFilesChecked: result.domainFilesChecked,
      totalDomainBytes: result.totalDomainBytes
    });
  }

  const capabilities = {
    knownDomains: [...contract.capabilities.knownDomains],
    knownFeatures: [...contract.capabilities.knownFeatures],
    featureDependencies: sortObject(contract.capabilities.featureDependencies)
  };
  return {
    valid: true,
    contractVersion: contract.contractVersion,
    packageVersion: contract.packageVersion,
    runtimeIntegration: false,
    publicationEligible: false,
    snapshotLockSha256: sha256(lockBytes),
    owners: {
      source: { commit: sourceOwner.commit, files: sourceOwner.files.length, totalBytes: sourceSnapshot.totalBytes },
      web: { commit: webOwner.commit, files: webOwner.files.length, totalBytes: webSnapshot.totalBytes }
    },
    source: {
      valid: true,
      publicationEligible: false,
      recordCount: sourceResult.recordCount,
      releaseCount: sourceResult.releaseCount,
      sourceRefCount: sourceResult.sourceRefCount,
      schemaFileSha256: sourceOwner.files.find(file => file.path === 'content/schema/v2/source-contract.schema.json').sha256,
      fixtureFileSha256: sourceOwner.files.find(file => file.path === 'content/fixtures/v2/representative-source.json').sha256,
      validatorSha256: sourceOwner.files.find(file => file.path === 'scripts/content/contract-validator.mjs').sha256
    },
    web: {
      valid: true,
      domainValidation: 'owner-validator JSON-object, size, and SHA-256 checks',
      schemaSha256: webOwner.files.find(file => file.path === 'content/schema/v2/shared-release.schema.json').sha256,
      validatorSha256: webOwner.files.find(file => file.path === 'scripts/content/contract-release.mjs').sha256,
      authoring: {
        valid: true,
        fixtureOnly: true,
        publicationEligible: false,
        presentationCount: authoringInputs.authoring.presentations.length,
        termLocalizationCount: authoringInputs.authoring.termLocalizations.length,
        announcementCount: authoringInputs.authoring.announcements.length,
        gameChangeCount: authoringInputs.authoring.gameChanges.length,
        officialInputCount: authoringInputs.officialInputs.sources.length,
        sourcePin: authoringInputs.sourcePin,
        officialInputsSha256: authoringInputs.webLock.officialInputs.sha256,
        schemaSha256: webOwner.files.find(file => file.path === 'content/schema/v2/web-authoring.schema.json').sha256,
        validatorSha256: webOwner.files.find(file => file.path === 'scripts/content/contract-authoring.mjs').sha256,
        sourceCacheMatchesPinnedOwner: true,
        sharedSourceFileCount: sharedSourceBytes.length
      },
      fixtures: webFixtures
    },
    sharedSourceBytes,
    capabilities,
    runtime,
    checkoutPins: {
      source: sourceCheckout,
      web: webCheckout
    }
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name !== '--source-root' && name !== '--web-root') fail('unknown argument: ' + name);
    const key = name === '--source-root' ? 'sourceRoot' : 'webRoot';
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || Object.hasOwn(options, key)) {
      fail(name + ' requires one unique directory path');
    }
    options[key] = path.resolve(value);
    index += 1;
  }
  return options;
}

async function main(argv) {
  try {
    const result = await runW02Conformance(parseArguments(argv));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown conformance failure';
    process.stderr.write('W02 dev contract conformance failed: ' + message + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}

export {
  CONTRACT_RELATIVE,
  LOCK_RELATIVE,
  runW02Conformance,
  safeRelativePath
};
