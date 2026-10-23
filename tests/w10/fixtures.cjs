'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const CORE_DOMAIN_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
const APPROVED_MANIFEST_SHA256 = 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7';

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort(compareUtf8)) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

function fixtureRevisionMaterial(manifest) {
  const files = manifest.files.map((file) => ({
    kind: file.kind,
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    dependencies: [...file.dependencies].sort(compareUtf8)
  })).sort((left, right) => compareUtf8(left.path, right.path));

  return canonicalize({
    source: manifest.source,
    web: manifest.web,
    compatibility: {
      dataContractMajor: manifest.compatibility.dataContractMajor,
      requiredFeatures: [...manifest.compatibility.requiredFeatures].sort(compareUtf8),
      gameSnapshotRefs: [...manifest.compatibility.gameSnapshotRefs].sort(compareUtf8)
    },
    files,
    changeIndexPath: manifest.changeIndexPath
  });
}

function resealManifest(manifest) {
  const canonical = JSON.stringify(fixtureRevisionMaterial(manifest));
  manifest.dataRevision = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
  return manifest;
}

function makeManifest() {
  return resealManifest({
    schemaVersion: '2.0.0',
    gameReleaseId: 'fixture:1.2.3',
    gameVersion: '1.2.3',
    contentVersion: '1.2.3.1',
    dataRevision: HASH_A,
    source: {
      repository: SOURCE_REPOSITORY,
      commit: '1'.repeat(40),
      sourceRevision: '2'.repeat(64),
      manifestSha256: '3'.repeat(64)
    },
    web: { authoringCommit: '4'.repeat(40), compilerCommit: '5'.repeat(40) },
    compatibility: {
      dataContractMajor: 2,
      requiredFeatures: ['official-native-localizations-v1', 'blessing-tier-presentations-v1'],
      gameSnapshotRefs: ['history-alpha', 'history-beta']
    },
    files: [
      { kind: 'skills', path: 'domains/skills.json', sizeBytes: 10, sha256: HASH_A,
        dependencies: ['domains/terms.json'] },
      { kind: 'blessings', path: 'domains/blessings.json', sizeBytes: 11, sha256: HASH_B,
        dependencies: ['domains/weapons.json'] },
      { kind: 'weapons', path: 'domains/weapons.json', sizeBytes: 12, sha256: HASH_C,
        dependencies: ['domains/terms.json'] },
      { kind: 'terms', path: 'domains/terms.json', sizeBytes: 13, sha256: 'd'.repeat(64),
        dependencies: [] }
    ],
    changeIndexPath: null
  });
}

function release(gameVersion, revision, dataRevision) {
  return {
    game_version: gameVersion,
    content_version: gameVersion + '.' + revision,
    data_revision: dataRevision,
    manifest_path: '/data/' + dataRevision + '/manifest.json',
    manifest_sha256: HASH_C
  };
}

function makeVersion() {
  const current = release('1.13.2', 7, HASH_A);
  const older = release('1.13.1', 4, HASH_B);
  return {
    schema_version: 2,
    data_revision: current.data_revision,
    build_id: HASH_C,
    game_version: current.game_version,
    package_kind: 'published',
    game_releases: [current, older]
  };
}

function makeSamePatchRollbackIndexes() {
  const previousPatchPointer = release('1.13.2', 7, HASH_A);
  const rollbackPointer = release('1.13.2', 3, HASH_B);
  const largerOtherPatchPointer = release('1.13.3', 9, HASH_C);
  const nextIndex = {
    schema_version: 2,
    data_revision: rollbackPointer.data_revision,
    build_id: 'd'.repeat(64),
    game_version: rollbackPointer.game_version,
    package_kind: 'published',
    game_releases: [rollbackPointer, largerOtherPatchPointer]
  };
  return { previousPatchPointer, rollbackPointer, largerOtherPatchPointer, nextIndex };
}

function makeVersionForManifest(manifest) {
  const current = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: manifest.dataRevision,
    manifest_path: '/data/' + manifest.dataRevision + '/manifest.json',
    manifest_sha256: HASH_C
  };
  const older = release('1.2.2', 4, HASH_B);
  return {
    schema_version: 2,
    data_revision: current.data_revision,
    build_id: HASH_C,
    game_version: current.game_version,
    package_kind: 'published',
    game_releases: [current, older]
  };
}

function readApprovedCandidateManifest() {
  // Raw manifest from Web PR15 b4b11ec; isolation-only candidate, not a selected or allocated release.
  // Its embedded 1.13.2.1 remains a proposal; this fixture creates no version pointer or allocation.
  const manifestPath = path.resolve(__dirname, 'fixtures/w09-approved-manifest.json');
  const bytes = require('node:fs').readFileSync(manifestPath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== APPROVED_MANIFEST_SHA256) {
    throw new Error('approved W09 manifest fixture SHA-256 mismatch: ' + actualSha256);
  }
  return JSON.parse(bytes.toString('utf8'));
}

module.exports = {
  CORE_DOMAIN_KINDS,
  makeManifest,
  makeSamePatchRollbackIndexes,
  makeVersion,
  makeVersionForManifest,
  readApprovedCandidateManifest,
  resealManifest
};
