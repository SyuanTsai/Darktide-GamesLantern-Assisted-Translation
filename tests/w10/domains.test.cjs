'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const domains = require('../../extension/shared/domains.js');
const {
  ALTERNATE_SNAPSHOT_ID,
  GAME_RELEASE_ID,
  GAME_VERSION,
  HISTORICAL_SNAPSHOT_ID,
  PRIMARY_SNAPSHOT_ID,
  makeDomain,
  makeSyntheticPackage
} = require('./package-fixtures.cjs');

function validIdentity(fixture) {
  return { gameVersion: fixture.identity.gameVersion, gameReleaseId: fixture.identity.gameReleaseId };
}

test('UnitT20_ValidatesW08DomainClosureAndExactCurrentReleaseSnapshotIdentity', () => {
  // Scenario: Given four W08 domain documents with complete source metadata and opaque primary/alternative snapshots.
  // Purpose: Validate formal domain closure and bind optional snapshot identity to the exact game release.
  const fixture = makeSyntheticPackage();
  const identity = { ...validIdentity(fixture), snapshotId: PRIMARY_SNAPSHOT_ID };

  // Given historical snapshot references remain present in the manifest for history.
  assert.ok(fixture.manifest.compatibility.gameSnapshotRefs.includes(HISTORICAL_SNAPSHOT_ID));

  // When the full set is checked against the current local game identity.
  const result = domains.validateDomainSet(fixture.domains, fixture.manifest, identity);

  // Then the exact current release resolves while historical snapshots cannot prove current compatibility.
  assert.equal(result.identity.gameVersion, GAME_VERSION);
  assert.equal(result.identity.gameReleaseId, GAME_RELEASE_ID);
  assert.equal(domains.validateDomainSet(fixture.domains, fixture.manifest, {
    ...validIdentity(fixture), snapshotId: ALTERNATE_SNAPSHOT_ID
  }).identity.snapshotId, ALTERNATE_SNAPSHOT_ID);
  assert.throws(() => domains.validateDomainSet(fixture.domains, fixture.manifest, {
    ...validIdentity(fixture), snapshotId: HISTORICAL_SNAPSHOT_ID
  }), /snapshot.*release|snapshot.*identity/i);
  assert.throws(() => domains.validateDomainSet(fixture.domains, fixture.manifest, {
    snapshotId: PRIMARY_SNAPSHOT_ID
  }), /gameVersion|required/i);
});

test('UnitT21_RejectsConflictingReleaseAndSnapshotRegistriesAcrossDomains', () => {
  // Scenario: Given domains that disagree about one release version or one opaque snapshot's pinned metadata.
  // Purpose: Prevent a joined registry from manufacturing a false game patch or source snapshot identity.
  const conflictingRelease = makeSyntheticPackage({ mutateDomains(kind, document) {
    if (kind === 'weapons') document.source.gameReleases.find((row) => row.gameReleaseId === GAME_RELEASE_ID).gameVersion = '9.8.8';
    return document;
  } });
  const conflictingSnapshot = makeSyntheticPackage({ mutateDomains(kind, document) {
    if (kind === 'weapons') document.source.sourceSnapshots[0].snapshot.commit = 'f'.repeat(40);
    return document;
  } });

  // Given each individual document still has the formal W08 outer shape.
  // When all four release registries are aggregated.

  // Then contradictory patch or snapshot records fail closed.
  assert.throws(() => domains.validateDomainSet(conflictingRelease.domains, conflictingRelease.manifest,
    validIdentity(conflictingRelease)), /conflicting.*gameVersion|release.*conflict/i);
  assert.throws(() => domains.validateDomainSet(conflictingSnapshot.domains, conflictingSnapshot.manifest,
    validIdentity(conflictingSnapshot)), /conflicting.*snapshot|snapshot.*conflict/i);
});

test('UnitT30_RejectsIncompleteTypedAndProvenanceClosuresAndUnresolvedOfficialRefs', () => {
  // Scenario: Given a Source record, Web presentation, or official source pointer with a dangling identity.
  // Purpose: Enforce same-domain typed closure and provenance/official-source closure without reviewing approval history.
  const missingTyped = makeDomain('skills', (document) => {
    document.source.records.push({ recordId: 'fixture:record-a', gameReleaseId: GAME_RELEASE_ID, kind: 'skill', refs: [
      { recordId: 'fixture:missing-record', gameReleaseId: GAME_RELEASE_ID, kind: 'term' }
    ] });
    return document;
  });
  const missingProvenance = makeDomain('skills', (document) => {
    document.source.records.push({ recordId: 'fixture:record-b', gameReleaseId: GAME_RELEASE_ID, kind: 'skill', sourceRefs: [
      { sourceId: 'fixture:missing-source', gameReleaseId: GAME_RELEASE_ID }
    ] });
    return document;
  });
  const missingOfficial = makeDomain('skills', (document) => {
    document.web.presentations.push({ locale: 'zh-TW', name: '測試', officialSourceId: 'fixture:missing-official' });
    return document;
  });

  // Given the broken pointers use valid-looking, isolated identities.
  // When each W08 document is validated.

  // Then typed, provenance, and official source references must resolve locally.
  assert.throws(() => domains.validateDomain(missingTyped, { kind: 'skills', gameReleaseId: GAME_RELEASE_ID }), /typed.*closure|closure.*incomplete/i);
  assert.throws(() => domains.validateDomain(missingProvenance, { kind: 'skills', gameReleaseId: GAME_RELEASE_ID }), /provenance.*closure/i);
  assert.throws(() => domains.validateDomain(missingOfficial, { kind: 'skills', gameReleaseId: GAME_RELEASE_ID }), /official input closure/i);
});

test('UnitT40_RejectsUnsafeExecutableFieldsAndMalformedReviewRowsButKeepsLiteralFormulaData', () => {
  // Scenario: Given otherwise valid W08 documents containing executable instructions or invalid review target rows.
  // Purpose: Keep the shared package pure data while retaining informational Source formula strings without evaluating them.
  const unsafeProgram = makeDomain('weapons', (document) => {
    document.source.records.push({ recordId: 'fixture:weapon', gameReleaseId: GAME_RELEASE_ID, kind: 'weapon', payload: {
      selectorProgram: 'document.querySelector("*")'
    } });
    return document;
  });
  const unsafeRemoteScript = makeDomain('weapons', (document) => {
    document.source.records.push({ recordId: 'fixture:weapon', gameReleaseId: GAME_RELEASE_ID, kind: 'weapon', payload: {
      remoteScript: 'https://example.invalid/runtime.js'
    } });
    return document;
  });
  const badReview = makeDomain('skills', (document) => {
    document.web.reviewTargets.push({ mode: 'w10', target: {}, state: 'pending' });
    return document;
  });
  const informationalFormula = makeDomain('weapons', (document) => {
    document.source.records.push({ recordId: 'fixture:weapon', gameReleaseId: GAME_RELEASE_ID, kind: 'weapon', payload: {
      formula: 'fraction = min(value / 100, 1); value = min(value, 100)'
    } });
    return document;
  });

  // Given ordinary formula metadata is only stored and never interpreted by this validator.
  // When the pure-data and review-shape checks run.

  // Then active code/selector instructions fail, while descriptive math remains inert string data.
  assert.throws(() => domains.validateDomain(unsafeProgram, { kind: 'weapons', gameReleaseId: GAME_RELEASE_ID }), /selector|executable|unsafe/i);
  assert.throws(() => domains.validateDomain(unsafeRemoteScript, { kind: 'weapons', gameReleaseId: GAME_RELEASE_ID }), /remote.*executable|script|unsafe/i);
  assert.throws(() => domains.validateDomain(badReview, { kind: 'skills', gameReleaseId: GAME_RELEASE_ID }), /review target.*invalid/i);
  assert.equal(domains.validateDomain(informationalFormula, { kind: 'weapons', gameReleaseId: GAME_RELEASE_ID }), informationalFormula);
});

test('UnitT50_RejectsDomainIdentityAndDuplicateRecordKeysAndExportsBrowserGlobal', () => {
  // Scenario: Given a domain with a mismatched manifest identity or duplicate Source record key.
  // Purpose: Keep W08 schema/version identity exact in both the service worker and Node.
  const badIdentity = makeDomain('skills', (document) => { document.gameReleaseId = 'fixture:other-release'; return document; });
  const duplicateRecords = makeDomain('skills', (document) => {
    const row = { recordId: 'fixture:duplicate', gameReleaseId: GAME_RELEASE_ID, kind: 'skill' };
    document.source.records.push(row, structuredClone(row));
    return document;
  });
  const sourcePath = path.resolve(__dirname, '../../extension/shared/domains.js');
  const browserGlobal = {};
  browserGlobal.globalThis = browserGlobal;

  // Given the script is loaded as a classic browser file without CommonJS.
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), browserGlobal, { filename: 'domains.js' });

  // Then invalid identities are rejected and both exports expose the same API.
  assert.throws(() => domains.validateDomain(badIdentity, { kind: 'skills', gameReleaseId: GAME_RELEASE_ID }), /identity/i);
  assert.throws(() => domains.validateDomain(duplicateRecords, { kind: 'skills', gameReleaseId: GAME_RELEASE_ID }), /duplicates a Source record/i);
  assert.deepEqual(Object.keys(browserGlobal.W10SharedDomains).sort(), Object.keys(domains).sort());
});