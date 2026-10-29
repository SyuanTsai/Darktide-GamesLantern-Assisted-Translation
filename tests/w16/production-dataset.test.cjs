'use strict';

const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const loader = require('../../extension/shared/loader.js');
const contract = require('../../extension/shared/contract.js');
const presentation = require('../../extension/shared/presentation.js');
const { serializeNativeSnapshot } = require('../../extension/shared/content-entry.js');
const { createProductionDatasetResolver } = require('../../extension/shared/production-dataset.js');

const BASELINE_DIR = path.join(__dirname, '..', '..', 'extension', 'release-baseline', 'w15');
const GAME_LINE_PIN = Object.freeze({
  schema: 'w16-production-dataset-pin/1',
  gameVersion: '1.13.2',
  gameReleaseId: 'darktide:1.13.2',
  contentVersion: '1.13.2.3',
  dataRevision: 'f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f',
  manifestSha256: 'fcd7ff131ae55315fa0b9323355ed0e7b69788ffe03841de025723cec16e8642'
});

function sha256(raw) { return createHash('sha256').update(raw).digest('hex'); }

async function readBaselineSnapshot() {
  const versionBytes = fs.readFileSync(path.join(BASELINE_DIR, 'version.json'));
  const manifestBytes = fs.readFileSync(path.join(BASELINE_DIR, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const selected = await contract.selectConsumerFiles(manifest, {
    requiredKinds: ['skills', 'blessings', 'weapons', 'terms'],
    supportedKinds: ['skills', 'blessings', 'weapons', 'terms'], cryptoApi: webcrypto
  });
  assert.deepEqual(selected.map((row) => row.path).sort(), [
    'domains/blessings.json', 'domains/skills.json', 'domains/terms.json', 'domains/weapons.json'
  ], 'the W16 reader consumes the four supported core domains only');
  assert.ok(manifest.files.some((row) => row.path === 'domains/announcements.json'),
    'the original baseline manifest retains its optional announcements declaration');
  const files = new Map(selected.map((row) => [row.path,
    fs.readFileSync(path.join(BASELINE_DIR, ...row.path.split('/')))]));
  assert.equal(files.size, 4);
  assert.equal(files.has('domains/announcements.json'), false);
  const identity = { gameVersion: manifest.gameVersion, gameReleaseId: manifest.gameReleaseId };
  const snapshot = await loader.verifyStoredSnapshot({ versionBytes, manifestBytes, files, identity, cryptoApi: webcrypto });
  return { snapshot, versionBytes, manifestBytes, manifest, files, identity };
}

function resolverFor(snapshot, pin = GAME_LINE_PIN) {
  return createProductionDatasetResolver({ pin, loadSnapshot: async (identity) => ({
    status: 'ready', identity, snapshot
  }) });
}

function brainRuptureEvidence(description = 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.\n\nThis is an augmented version of Brain Burst dealing +50% Damage.') {
  return serializeNativeSnapshot({ pathname: '/abilities', patch: { status: 'absent' },
    skills: [{ structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description }], weapons: [] });
}

test('UnitT10_ProductionDatasetMatchesOnlyExactObservedW15SkillsAndWeapons', async () => {
  // Scenario: Given the actual W15 four-domain baseline and serialized native observations from Root's exact DOM evidence.
  // Purpose: Resolve the fixed local Source data line only when a unique approved skill or weapon item matches exactly.
  const { snapshot } = await readBaselineSnapshot();
  const resolver = resolverFor(snapshot);
  const skill = await resolver.resolve(brainRuptureEvidence());
  assert.equal(skill.status, 'verified');
  assert.deepEqual(skill.identity, { gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2' });

  const chainaxe = serializeNativeSnapshot({
    pathname: '/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe',
    patch: { status: 'absent' },
    skills: [],
    weapons: [{
      structure: 'gameslantern-weapon-detail-v1',
      href: 'https://darktide.gameslantern.com/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe',
      title: '\u00a0Orestes Mk IV Assault Chainaxe\u00a0',
      mirrorTitle: '\u00a0Orestes Mk IV Assault Chainaxe\u00a0',
      imageAlt: 'Header Image',
      imageSrc: 'https://darktide.gameslantern.com/storage/sites/darktide/weapons/VPoQRZKAlr4zEvg4uroy4gJ3z6IwTwyKS0MFKd4E.png'
    }]
  });
  assert.equal(JSON.parse(new TextDecoder().decode(chainaxe)).weapons[0].route,
    '/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe', 'native evidence uses the established normalized v1 route shape');
  assert.equal((await resolver.resolve(chainaxe)).status, 'verified');

  assert.equal((await resolver.resolve(brainRuptureEvidence('Charge up your Psychic Power, then do something different.'))).reason,
    'no-matching-presentation');
  assert.equal((await resolver.resolve(serializeNativeSnapshot({ pathname: '/abilities', patch: { status: 'absent' }, skills: [], weapons: [] }))).reason,
    'no-matching-presentation');
});

test('UnitT20_ProductionDatasetAcceptsNewContentOnThePinnedSourceReleaseAndRejectsAnotherRelease', async () => {
  // Scenario: Given a newer already-verified content snapshot on the same fixed Source gameReleaseId and a response for another Source release.
  // Purpose: Keep data-only upgrades on the supported Source line while rejecting a changed gameReleaseId.
  const baseline = await readBaselineSnapshot();
  const snapshot = { ...baseline.snapshot,
    manifest: { ...baseline.snapshot.manifest, contentVersion: '1.13.2.4', dataRevision: 'a'.repeat(64) },
    manifestSha256: 'b'.repeat(64) };
  const sameLine = await resolverFor(snapshot).resolve(brainRuptureEvidence());
  assert.equal(sameLine.status, 'verified');

  const wrongSnapshot = { ...baseline.snapshot,
    identity: { gameVersion: '1.13.1', gameReleaseId: 'darktide:1.13.1' },
    manifest: { ...baseline.snapshot.manifest, gameVersion: '1.13.1', gameReleaseId: 'darktide:1.13.1' } };
  assert.equal((await resolverFor(wrongSnapshot).resolve(brainRuptureEvidence())).reason,
    'no-matching-presentation');
});
