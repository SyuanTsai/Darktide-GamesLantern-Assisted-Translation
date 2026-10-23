'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const { test } = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../../extension/shared/contract.js');
const { matchReleaseIdentity, selectConsumerFiles, selectGameRelease, validateManifest, validateVersion } = contract;
const {
  CORE_DOMAIN_KINDS,
  makeManifest,
  makeSamePatchRollbackIndexes,
  makeVersion,
  makeVersionForManifest,
  readApprovedCandidateManifest,
  resealManifest
} = require('./fixtures.cjs');

test('UnitT10_SelectExactPatchAndAllowValidOlderPointer', () => {
  // Scenario: Given a published index with two exact game patches and distinct content revisions.
  // Purpose: Select only the requested patch and keep a valid older pointer available for rollback.
  const version = makeVersion();

  // Given the index is structurally valid.
  assert.equal(validateVersion(version), version);

  // When each exact patch and an unknown patch are requested.
  const current = selectGameRelease(version, '1.13.2');
  const older = selectGameRelease(version, '1.13.1');
  const unknown = selectGameRelease(version, '1.13.0');

  // Then selection follows the exact patch, and the older valid pointer remains selectable.
  assert.equal(current.content_version, '1.13.2.7');
  assert.equal(older.content_version, '1.13.1.4');
  assert.ok(older.content_version < current.content_version);
  assert.equal(unknown, null);
});

test('UnitT15_RejectsMalformedVersionPointersAndDuplicatePatches', () => {
  // Scenario: Given a valid version index with an extra key, malformed pointer path, wrong content patch, or duplicate patch.
  // Purpose: Enforce the exact published pointer schema before any requested patch can be selected.
  const extraKey = makeVersion();
  extraKey.fixtureOnly = true;
  const wrongContentPatch = makeVersion();
  wrongContentPatch.game_releases[0].content_version = '1.13.1.7';
  const wrongManifestPath = makeVersion();
  wrongManifestPath.game_releases[0].manifest_path = 'https://example.invalid/manifest.json';
  const duplicatePatch = makeVersion();
  duplicatePatch.game_releases.push({ ...duplicatePatch.game_releases[0], content_version: '1.13.2.8' });

  // Given each index still looks like a plausible published pointer list.
  // When formal schema and pointer constraints are checked.

  // Then extra preview fields, contradictory version strings, unsafe paths, and duplicate patches fail.
  assert.throws(() => validateVersion(extraKey), /unexpected property: fixtureOnly/i);
  assert.throws(() => validateVersion(wrongContentPatch), /content_version.*matching gameVersion/i);
  assert.throws(() => validateVersion(wrongManifestPath), /same-origin path/i);
  assert.throws(() => validateVersion(duplicatePatch), /duplicate game_version/i);
});

test('UnitT17_SelectsADeclaredSamePatchRollbackBelowThePreviousRevisionAndOtherPatchMaximum', () => {
  // Scenario: Given the next valid index rolls 1.13.2 back below its prior revision while another patch has a larger revision.
  // Purpose: Select the declared patch pointer without applying a global contentVersion maximum rule.
  const { previousPatchPointer, rollbackPointer, largerOtherPatchPointer, nextIndex } = makeSamePatchRollbackIndexes();

  // Given the rollback pointer is older than the prior same-patch pointer and the other patch's content version.
  assert.ok(rollbackPointer.content_version < previousPatchPointer.content_version);
  assert.ok(largerOtherPatchPointer.content_version > previousPatchPointer.content_version);
  assert.equal(validateVersion(nextIndex), nextIndex);

  // When the requested patch is selected from the next index.
  const selected = selectGameRelease(nextIndex, '1.13.2');

  // Then the legal lower same-patch pointer is returned exactly.
  assert.equal(selected, rollbackPointer);
  assert.equal(selected.content_version, '1.13.2.3');
});

test('UnitT20_ExportsTheSameApiToBrowserGlobalAndCommonJs', () => {
  // Scenario: Given the contract source evaluated as a classic browser script and loaded through CommonJS.
  // Purpose: Keep one validator implementation available to the MV3 worker and the Node unit suite.
  const sourcePath = path.resolve(__dirname, '../../extension/shared/contract.js');
  const browserGlobal = { TextEncoder, Uint8Array };
  browserGlobal.globalThis = browserGlobal;

  // When the script is evaluated without a module object.
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), browserGlobal, { filename: 'contract.js' });

  // Then both environments expose the same public function names.
  assert.deepEqual(Object.keys(browserGlobal.W10SharedContract).sort(), Object.keys(contract).sort());
  for (const name of ['validateVersion', 'validateManifest', 'selectGameRelease', 'selectConsumerFiles', 'matchReleaseIdentity']) {
    assert.equal(typeof browserGlobal.W10SharedContract[name], 'function');
    assert.equal(typeof contract[name], 'function');
  }
});

test('UnitT30_AcceptsThePinnedFourCoreCandidateAndRejectsAChangedCanonicalDigest', async () => {
  // Scenario: Given the frozen approved-but-unselected W09 candidate and a tampered copy.
  // Purpose: Verify the official canonical digest, four core kinds, and null change index without promoting the candidate.
  const candidate = readApprovedCandidateManifest();

  // Given the fixed manifest bytes have the pinned W08 shape.
  assert.deepEqual(candidate.files.map((file) => file.kind).sort(), [...CORE_DOMAIN_KINDS].sort());
  assert.equal(candidate.changeIndexPath, null);

  // When the unchanged candidate and a digest-tampered copy are validated.
  assert.equal(await validateManifest(candidate, { cryptoApi: webcrypto }), candidate);
  const tampered = structuredClone(candidate);
  tampered.dataRevision = '0'.repeat(64);

  // Then only the canonical candidate is accepted.
  await assert.rejects(() => validateManifest(tampered, { cryptoApi: webcrypto }), /dataRevision.*canonical/i);
});

test('UnitT40_RejectsUnpinnedManifestIdentityAndLegacyFixtureFlags', async () => {
  // Scenario: Given a syntactically valid manifest with a changed Source repository or a W01 fixture-only field.
  // Purpose: Bind Source identity to the fixed owner and prevent old preview flags from entering the formal contract.
  const wrongRepository = makeManifest();
  wrongRepository.source.repository = 'https://example.invalid/source';
  resealManifest(wrongRepository);
  const legacyFixture = makeManifest();
  legacyFixture.fixtureOnly = true;

  // Given both candidates have internally consistent content-index digests.
  // When their Source pin or formal manifest shape is checked.

  // Then the owner repository and exact formal keys remain mandatory.
  await assert.rejects(() => validateManifest(wrongRepository, { cryptoApi: webcrypto }), /fixed public Source repository/i);
  await assert.rejects(() => validateManifest(legacyFixture, { cryptoApi: webcrypto }), /unexpected property: fixtureOnly/i);
});

test('UnitT50_RejectsMissingAndCyclicFileDependencies', async () => {
  // Scenario: Given a formal manifest with either a dangling file dependency or a dependency cycle.
  // Purpose: Prevent partial consumer packages and recursive closure from accepting incomplete graphs.
  const missing = makeManifest();
  missing.files[0].dependencies.push('domains/missing.json');
  resealManifest(missing);
  const cyclic = makeManifest();
  cyclic.files.find((file) => file.kind === 'skills').dependencies = ['domains/blessings.json'];
  cyclic.files.find((file) => file.kind === 'blessings').dependencies = ['domains/skills.json'];
  resealManifest(cyclic);

  // Given the file records and canonical revisions are otherwise valid.
  // When each graph is validated.

  // Then missing targets and cycles are both rejected.
  await assert.rejects(() => validateManifest(missing, { cryptoApi: webcrypto }), /dependency points to missing path/i);
  await assert.rejects(() => validateManifest(cyclic, { cryptoApi: webcrypto }), /dependency cycle/i);
});

test('UnitT60_RejectsUnknownFeaturesInvalidTierRequirementsAndUnsafePaths', async () => {
  // Scenario: Given feature lists and manifest paths with unsupported, contradictory, traversal, encoded, or colliding values.
  // Purpose: Keep the closed compatibility contract and same-origin file namespace free of ambiguous path aliases.
  const unknownFeature = makeManifest();
  unknownFeature.compatibility.requiredFeatures.push('arbitrary-runtime-v1');
  resealManifest(unknownFeature);
  const tierWithoutNative = makeManifest();
  tierWithoutNative.compatibility.requiredFeatures = ['blessing-tier-presentations-v1'];
  resealManifest(tierWithoutNative);
  const invalidContentVersion = makeManifest();
  invalidContentVersion.contentVersion = '1.2.3.0';
  resealManifest(invalidContentVersion);

  // Given the feature lists are otherwise canonical.
  // When unsupported features and unsafe paths are checked.

  // Then only known, dependency-complete features and unambiguous relative JSON paths are accepted.
  await assert.rejects(() => validateManifest(unknownFeature, { cryptoApi: webcrypto }), /unknown required feature/i);
  await assert.rejects(() => validateManifest(tierWithoutNative, { cryptoApi: webcrypto }), /requires official-native-localizations-v1/i);
  await assert.rejects(() => validateManifest(invalidContentVersion, { cryptoApi: webcrypto }), /positive revision/i);

  const invalidPaths = [
    { path: '../outside.json', expected: /safe relative JSON path|traversal/i },
    { path: 'domains/%2e%2e/escape.json', expected: /safe relative JSON path|encoded/i },
    { path: 'https://example.invalid/escape.json', expected: /safe relative JSON path|path/i },
    { path: 'domains\\escape.json', expected: /safe relative JSON path|backslash/i }
  ];
  for (const invalid of invalidPaths) {
    const manifest = makeManifest();
    manifest.files[0].path = invalid.path;
    resealManifest(manifest);
    await assert.rejects(() => validateManifest(manifest, { cryptoApi: webcrypto }), invalid.expected, invalid.path);
  }

  const duplicate = makeManifest();
  duplicate.files[1].path = duplicate.files[0].path;
  resealManifest(duplicate);
  await assert.rejects(() => validateManifest(duplicate, { cryptoApi: webcrypto }), /duplicate file path/i);

  const caseCollision = makeManifest();
  caseCollision.files[1].path = 'DOMAINS/skills.json';
  resealManifest(caseCollision);
  await assert.rejects(() => validateManifest(caseCollision, { cryptoApi: webcrypto }), /case-insensitive collision/i);
});

test('UnitT70_SelectsOnlyTheRequiredSupportedDependencyClosure', async () => {
  // Scenario: Given the four core W10 kinds where skills depends on terms and blessings depends on weapons.
  // Purpose: Select the complete supported closure without inheriting W01's legacy five-domain contract.
  const manifest = makeManifest();

  // Given a validated formal manifest and a consumer that supports the four core kinds.
  // When only skills are required.
  const selected = await selectConsumerFiles(manifest, {
    requiredKinds: ['skills'],
    supportedKinds: CORE_DOMAIN_KINDS,
    cryptoApi: webcrypto
  });

  // Then the required file and its terms dependency are selected, while unsupported closures fail closed.
  assert.deepEqual(selected.map((file) => file.path), ['domains/skills.json', 'domains/terms.json']);
  await assert.rejects(() => selectConsumerFiles(manifest, {
    requiredKinds: ['skills'],
    supportedKinds: ['skills'],
    cryptoApi: webcrypto
  }), /dependency kind is not supported/i);
  await assert.rejects(() => selectConsumerFiles(manifest, {
    requiredKinds: ['announcements'],
    supportedKinds: CORE_DOMAIN_KINDS,
    cryptoApi: webcrypto
  }), /required kind is not in the consumer supported set/i);
  await assert.rejects(() => selectConsumerFiles(manifest, {
    requiredKinds: ['catalog'],
    supportedKinds: [...CORE_DOMAIN_KINDS, 'catalog'],
    cryptoApi: webcrypto
  }), /required kind is missing from manifest.files/i);
});

test('UnitT80_MatchesTheExactManifestReleaseAndNeverUsesSnapshotRefsAsPatchEvidence', async () => {
  // Scenario: Given an index, manifest, and local identity with matching or contradictory game release fields.
  // Purpose: Require gameVersion, gameReleaseId, and the exact content pointer before any release can be selected.
  const manifest = makeManifest();
  const version = makeVersionForManifest(manifest);
  const identity = { gameVersion: manifest.gameVersion, gameReleaseId: manifest.gameReleaseId };

  // Given the exact identity matches the index pointer and manifest.
  // When the identity matcher is asked to resolve it.
  const selected = await matchReleaseIdentity(version, manifest, identity, { cryptoApi: webcrypto });

  // Then contradictory and snapshot-only identities cannot select a release.
  assert.equal(selected.content_version, manifest.contentVersion);
  assert.equal(await matchReleaseIdentity(version, manifest,
    { gameVersion: '1.2.2', gameReleaseId: manifest.gameReleaseId }, { cryptoApi: webcrypto }), null);
  assert.equal(await matchReleaseIdentity(version, manifest,
    { gameVersion: manifest.gameVersion, gameReleaseId: 'fixture:1.2.2' }, { cryptoApi: webcrypto }), null);
  const pointerMismatch = structuredClone(version);
  pointerMismatch.game_releases[0].content_version = '1.2.3.2';
  assert.equal(await matchReleaseIdentity(pointerMismatch, manifest, identity, { cryptoApi: webcrypto }), null);
  await assert.rejects(() => matchReleaseIdentity(version, manifest,
    { snapshotRef: manifest.compatibility.gameSnapshotRefs[0] }, { cryptoApi: webcrypto }), /gameVersion.*gameReleaseId|required/i);
});
