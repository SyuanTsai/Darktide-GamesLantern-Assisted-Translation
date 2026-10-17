import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runW02Conformance, safeRelativePath } from '../../scripts/w02/contract-conformance.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contractsRoot = path.join(repositoryRoot, 'content/contracts/w02');
const sourceRoot = path.join(contractsRoot, 'source-v2-snapshot');
const webRoot = path.join(contractsRoot, 'web-v2-snapshot');
const require = createRequire(import.meta.url);
const loader = require(path.join(repositoryRoot, 'extension/w01/loader-core.js'));
const expectedKnownDomains = [
  'skills', 'blessings', 'weapons', 'terms', 'catalog',
  'curios', 'perks', 'classifications', 'announcements', 'game-changes'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createRepoCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syp-311-w02-c1-'));
  fs.mkdirSync(path.join(root, 'content/contracts'), { recursive: true });
  fs.cpSync(contractsRoot, path.join(root, 'content/contracts/w02'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extension/w01'), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, 'extension/w01/loader-core.js'),
    path.join(root, 'extension/w01/loader-core.js'));
  fs.copyFileSync(path.join(repositoryRoot, 'package.json'), path.join(root, 'package.json'));
  return root;
}

function removeRepoCopy(root) {
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  const target = path.resolve(root);
  assert.ok(target.startsWith(tempRoot), 'temporary test cleanup must remain under os.tmpdir()');
  assert.ok(path.basename(target).startsWith('syp-311-w02-c1-'));
  fs.rmSync(target, { recursive: true, force: true });
}

async function importWebOwner() {
  const validator = path.join(webRoot, 'scripts/content/contract-release.mjs');
  return import(pathToFileURL(validator).href);
}

function webFixturePath(name) {
  return path.join(webRoot, 'content/fixtures/v2/shared-release', name);
}

test('UnitT00_ValidatesPinnedOwnerContractsWithoutGrantingRuntimeOrPublication', async () => {
  // Scenario: Given the exact Source and Web owner snapshots pinned for W02-C1.
  // Purpose: Validate the real owner contracts while keeping renderer integration and publication disabled.
  const result = await runW02Conformance({ extensionRoot: repositoryRoot });
  assert.equal(result.valid, true);
  assert.equal(result.publicationEligible, false);
  assert.equal(result.runtimeIntegration, false);
  assert.equal(result.packageVersion, '0.2.30');
  assert.equal(result.source.valid, true);
  assert.equal(result.source.publicationEligible, false);
  assert.equal(result.source.recordCount, 32);
  assert.equal(result.web.fixtures.length, 2);
  assert.deepEqual(result.capabilities.knownDomains, expectedKnownDomains);
  assert.deepEqual(result.runtime.supportedDomains, loader.ALL_KINDS);
  assert.deepEqual(result.runtime.requiredDomains, loader.REQUIRED_KINDS);
  assert.deepEqual(result.runtime.supportedDomains, ['skills', 'blessings', 'weapons', 'terms', 'game-changes']);
  assert.deepEqual(result.runtime.supportedFeatures, [
    'official-errata-details-v1',
    'official-native-localizations-v1',
    'blessing-tier-presentations-v1'
  ]);
  assert.equal(result.web.fixtures.find((fixture) => fixture.name === 'valid').domainFilesChecked, 3);
  assert.equal(result.web.fixtures.find((fixture) => fixture.name === 'announcement-only').domainFilesChecked, 1);
});

test('UnitT10_RejectsTamperedPinnedSchemasValidatorsFixturesAndMixedOwnerBytes', async () => {
  // Scenario: Given a private test copy with one pinned owner artifact or pointer changed.
  // Purpose: Refuse mixed revisions and altered schema, validator, manifest, fixture, or domain bytes before conformance.
  const cases = [
    ['Source schema', 'source-v2-snapshot/content/schema/v2/source-contract.schema.json'],
    ['Source fixture', 'source-v2-snapshot/content/fixtures/v2/representative-source.json'],
    ['Source validator', 'source-v2-snapshot/scripts/content/contract-validator.mjs'],
    ['Web schema', 'web-v2-snapshot/content/schema/v2/shared-release.schema.json'],
    ['Web validator', 'web-v2-snapshot/scripts/content/contract-release.mjs'],
    ['Web manifest', 'web-v2-snapshot/content/fixtures/v2/shared-release/valid/data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/manifest.json'],
    ['Web domain', 'web-v2-snapshot/content/fixtures/v2/shared-release/valid/data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/skills.json']
  ];
  for (const [label, relativePath] of cases) {
    const root = createRepoCopy();
    try {
      const target = path.join(root, 'content/contracts/w02', relativePath);
      const bytes = fs.readFileSync(target);
      bytes[0] ^= 1;
      fs.writeFileSync(target, bytes);
      await assert.rejects(() => runW02Conformance({ extensionRoot: root }), /sha-256|sha256|snapshot|pinned/i, label);
    } finally {
      removeRepoCopy(root);
    }
  }

  const mixedRoot = createRepoCopy();
  try {
    const contractPath = path.join(mixedRoot, 'content/contracts/w02/dev-capability.json');
    const contract = readJson(contractPath);
    contract.owners.source.commit = contract.owners.web.commit;
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
    await assert.rejects(() => runW02Conformance({ extensionRoot: mixedRoot }), /owner pin|commit|lock/i);
  } finally {
    removeRepoCopy(mixedRoot);
  }
});

test('UnitT20_RejectsMissingExtraAndOutOfBoundsSnapshotFiles', async () => {
  // Scenario: Given a pinned tree with a removed file, an unlisted file, or a traversal path in its lock.
  // Purpose: Keep snapshot reads bounded to the exact allowlisted owner files.
  const missingRoot = createRepoCopy();
  try {
    fs.unlinkSync(path.join(missingRoot,
      'content/contracts/w02/source-v2-snapshot/scripts/content/contract-validator.mjs'));
    await assert.rejects(() => runW02Conformance({ extensionRoot: missingRoot }), /missing pinned file|snapshot/i);
  } finally {
    removeRepoCopy(missingRoot);
  }

  const extraRoot = createRepoCopy();
  try {
    fs.writeFileSync(path.join(extraRoot, 'content/contracts/w02/source-v2-snapshot/extra.json'), '{}\n');
    await assert.rejects(() => runW02Conformance({ extensionRoot: extraRoot }), /unlisted|extra|snapshot/i);
  } finally {
    removeRepoCopy(extraRoot);
  }

  assert.throws(() => safeRelativePath('../../outside.json', 'test path'), /safe relative path/i);
  assert.throws(() => safeRelativePath('data\\outside.json', 'test path'), /safe relative path/i);

  const rehashedRoot = createRepoCopy();
  try {
    const lockPath = path.join(rehashedRoot, 'content/contracts/w02/owner-snapshot.lock.json');
    const contractPath = path.join(rehashedRoot, 'content/contracts/w02/dev-capability.json');
    const lock = readJson(lockPath);
    lock.owners.source.files[0].sha256 = 'a'.repeat(64);
    const lockBytes = Buffer.from(JSON.stringify(lock, null, 2) + '\n');
    fs.writeFileSync(lockPath, lockBytes);
    const contract = readJson(contractPath);
    contract.snapshotLockSha256 = sha256(lockBytes);
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
    await assert.rejects(() => runW02Conformance({ extensionRoot: rehashedRoot }), /pinned|lock SHA-256/i);
  } finally {
    removeRepoCopy(rehashedRoot);
  }
});

test('UnitT30_RejectsIncompleteCapabilityMetadataAndUnknownRuntimeFeature', async () => {
  // Scenario: Given capability metadata that omits an owner domain or invents a feature.
  // Purpose: Derive completeness from the pinned Web API and actual W01 loader rather than trusting copied constants.
  for (const mutate of [
    (contract) => contract.capabilities.knownDomains.pop(),
    (contract) => contract.capabilities.knownFeatures.push('unregistered-feature-v1')
  ]) {
    const root = createRepoCopy();
    try {
      const contractPath = path.join(root, 'content/contracts/w02/dev-capability.json');
      const contract = readJson(contractPath);
      mutate(contract);
      fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
      await assert.rejects(() => runW02Conformance({ extensionRoot: root }), /capability|domain|feature/i);
    } finally {
      removeRepoCopy(root);
    }
  }
});

test('UnitT40_WebOwnerRejectsUnknownFeaturesUnboundSnapshotsAndTierWithoutNativeSupport', async () => {
  // Scenario: Given a valid Web manifest altered with an unknown feature, a dangling snapshot ref, or a tier feature alone.
  // Purpose: Exercise the pinned owner validator's real closed feature and gameSnapshotRefs rules.
  const web = await importWebOwner();
  const baseManifest = readJson(path.join(webFixturePath('valid'),
    'data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/manifest.json'));
  assert.doesNotThrow(() => web.validateManifest(baseManifest));

  const unknownFeature = structuredClone(baseManifest);
  unknownFeature.compatibility.requiredFeatures = ['unregistered-feature-v1'];
  unknownFeature.dataRevision = web.computeDataRevision(unknownFeature);
  assert.throws(() => web.validateManifest(unknownFeature), /unknown required feature/i);

  const tierWithoutNative = structuredClone(baseManifest);
  tierWithoutNative.compatibility.requiredFeatures = ['blessing-tier-presentations-v1'];
  tierWithoutNative.dataRevision = web.computeDataRevision(tierWithoutNative);
  assert.throws(() => web.validateManifest(tierWithoutNative), /requires official-native-localizations-v1/i);

  const danglingSnapshot = structuredClone(baseManifest);
  danglingSnapshot.compatibility.gameSnapshotRefs = [];
  danglingSnapshot.dataRevision = web.computeDataRevision(danglingSnapshot);
  assert.throws(() => web.validateManifest(danglingSnapshot), /gameSnapshotRefs.*at least one/i);

  const validTierFeatures = structuredClone(baseManifest);
  validTierFeatures.compatibility.requiredFeatures = [
    'official-native-localizations-v1', 'blessing-tier-presentations-v1'
  ];
  validTierFeatures.dataRevision = web.computeDataRevision(validTierFeatures);
  assert.doesNotThrow(() => web.validateManifest(validTierFeatures));
});

test('UnitT50_SelectsExactPatchPointersAndAllowsAnOlderRollbackTarget', async () => {
  // Scenario: Given a valid version pointer plus a declared earlier patch with distinct content and data revisions.
  // Purpose: Select an exact game patch and keep a valid older release reachable without choosing a global maximum.
  const web = await importWebOwner();
  const version = readJson(path.join(webFixturePath('valid'), 'version.json'));
  const current = version.game_releases.find((release) => release.game_version === version.game_version);
  const older = {
    game_version: '1.13.1',
    content_version: '1.13.1.9',
    data_revision: 'a'.repeat(64),
    manifest_path: web.buildManifestPath('a'.repeat(64)),
    manifest_sha256: 'b'.repeat(64)
  };
  version.game_releases.unshift(older);
  assert.equal(web.selectGameRelease(version, '1.13.2').data_revision, current.data_revision);
  assert.equal(web.selectGameRelease(version, '1.13.1').data_revision, older.data_revision);
  assert.equal(web.selectGameRelease(version, '1.13.0'), null);
});

test('UnitT60_UsesOnlyAClosedConsumerDependencyClosure', async () => {
  // Scenario: Given a Web skills file that depends on terms and the five actual W01 runtime kinds.
  // Purpose: Verify the owner API closes dependencies but does not imply renderer support for the ten known Web domains.
  const web = await importWebOwner();
  const manifest = readJson(path.join(webFixturePath('valid'),
    'data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/manifest.json'));
  const selected = web.selectConsumerFiles(manifest, {
    requiredKinds: ['skills'],
    supportedKinds: loader.ALL_KINDS
  });
  assert.deepEqual(selected.map((file) => file.kind), ['skills', 'terms']);
  assert.throws(() => web.selectConsumerFiles(manifest, {
    requiredKinds: ['skills'],
    supportedKinds: ['skills']
  }), /dependency kind is not supported/i);
  assert.throws(() => web.selectConsumerFiles(manifest, {
    requiredKinds: ['announcements'],
    supportedKinds: loader.ALL_KINDS
  }), /unknown consumer kind|not in the consumer supported set/i);
});

test('UnitT70_WebOwnerRejectsMissingFilesAndUnsafeDomainPaths', async () => {
  // Scenario: Given a fixture package missing a listed file or a manifest with a traversal path.
  // Purpose: Refuse incomplete packages and paths that could escape the release directory.
  const web = await importWebOwner();
  const packageRoot = webFixturePath('valid');
  const manifest = readJson(path.join(packageRoot,
    'data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/manifest.json'));
  const unsafe = structuredClone(manifest);
  unsafe.files[0].path = '../outside.json';
  unsafe.dataRevision = web.computeDataRevision(unsafe);
  assert.throws(() => web.validateManifest(unsafe), /path|unsafe/i);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syp-311-w02-web-package-'));
  try {
    fs.cpSync(packageRoot, tempRoot, { recursive: true });
    fs.unlinkSync(path.join(tempRoot,
      'data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/terms.json'));
    await assert.rejects(() => web.validateReleaseDirectory(tempRoot), /missing file|ENOENT/i);
  } finally {
    const tmp = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(tempRoot).startsWith(tmp));
    assert.ok(path.basename(tempRoot).startsWith('syp-311-w02-web-package-'));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UnitT80_WebOwnerRejectsChangedDomainBytesAndMixedVersionPointer', async () => {
  // Scenario: Given a fixture package whose data file or release identity no longer matches its pinned manifest.
  // Purpose: Verify real byte integrity and version-to-manifest identity checks rather than only metadata assertions.
  const web = await importWebOwner();
  const packageRoot = webFixturePath('valid');

  const domainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syp-311-w02-web-domain-'));
  try {
    fs.cpSync(packageRoot, domainRoot, { recursive: true });
    const domainPath = path.join(domainRoot,
      'data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/skills.json');
    fs.appendFileSync(domainPath, ' ');
    await assert.rejects(() => web.validateReleaseDirectory(domainRoot), /size mismatch|SHA-256 mismatch/i);
  } finally {
    const tmp = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(domainRoot).startsWith(tmp));
    assert.ok(path.basename(domainRoot).startsWith('syp-311-w02-web-domain-'));
    fs.rmSync(domainRoot, { recursive: true, force: true });
  }

  const mixedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syp-311-w02-web-mixed-'));
  try {
    fs.cpSync(packageRoot, mixedRoot, { recursive: true });
    const versionPath = path.join(mixedRoot, 'version.json');
    const version = readJson(versionPath);
    version.game_releases[0].content_version = '1.13.1.9';
    fs.writeFileSync(versionPath, JSON.stringify(version, null, 2) + '\n');
    await assert.rejects(() => web.validateReleaseDirectory(mixedRoot), /version|content version|identity/i);
  } finally {
    const tmp = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(mixedRoot).startsWith(tmp));
    assert.ok(path.basename(mixedRoot).startsWith('syp-311-w02-web-mixed-'));
    fs.rmSync(mixedRoot, { recursive: true, force: true });
  }
});
