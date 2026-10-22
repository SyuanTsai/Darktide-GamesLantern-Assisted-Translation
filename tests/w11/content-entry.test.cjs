'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNativeEvidenceProvider, isSupportedPage, serializeNativeSnapshot } = require('../../extension/shared/content-entry.js');

const GAME_ORIGIN = 'https://darktide.gameslantern.com';

test('UnitT10_ContentEntryAcceptsOnlyExactSupportedGamesLanternRoutes', () => {
  // Scenario: Given top-level locations on supported Games Lantern routes and lookalike URLs.
  // Purpose: Keep the local adapter limited to the observed exact HTTPS origin and route shapes.
  for (const pathname of ['/build-editor', '/abilities', '/abilities/brain-rupture',
    '/weapon-blessing-traits', '/weapons/assault-chainaxe', '/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe']) {
    assert.equal(isSupportedPage({ origin: GAME_ORIGIN, pathname }), true, pathname);
  }
  for (const location of [
    { origin: 'https://gameslantern.com', pathname: '/abilities/brain-rupture' },
    { origin: 'https://darktide.gameslantern.com.evil', pathname: '/abilities/brain-rupture' },
    { origin: 'http://darktide.gameslantern.com', pathname: '/abilities/brain-rupture' },
    { origin: GAME_ORIGIN, pathname: '/settings' },
    { origin: GAME_ORIGIN, pathname: '/abilities/%2e%2e' },
    { origin: GAME_ORIGIN, pathname: '/weapons/one/two/three' }
  ]) assert.equal(isSupportedPage(location), false);
});

test('UnitT20_NativeEvidenceSerializesOnlyObservedPageFactsDeterministically', () => {
  // Scenario: Given only a supported path, patch consistency result, and native slot observations.
  // Purpose: Hash reproducible DOM evidence without deriving or accepting a caller-supplied game identity.
  const evidence = serializeNativeSnapshot({
    pathname: '/abilities/brain-rupture',
    patch: { status: 'absent' },
    skills: [{ structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description: 'Official description.' }],
    weapons: []
  });
  assert.equal(new TextDecoder().decode(evidence), JSON.stringify({
    schemaVersion: 'w11-native-dom-evidence/1',
    pathname: '/abilities/brain-rupture',
    patch: { status: 'absent' },
    skills: [{ structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description: 'Official description.' }],
    weapons: []
  }));
  assert.throws(() => serializeNativeSnapshot({
    pathname: '/abilities/brain-rupture', patch: { status: 'absent' }, skills: [], weapons: [],
    identity: { gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2' }
  }), /exact|unexpected/i);
});

test('UnitT30_EvidenceProviderWaitsForNativeSlotsThenPinsVerifiedPreWriteFacts', () => {
  // Scenario: Given an abilities page whose game card arrives after document_idle.
  // Purpose: Allow late native facts to resolve once, then retain the verified pre-write digest while rejecting patch or route changes.
  const document = { location: { pathname: '/abilities/brain-rupture' } };
  let patch = { status: 'absent' };
  let observation = { structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description: 'Original description.' };
  let slots = [];
  const adapter = {
    selectedPatchLabel: () => patch,
    collectSkillSlots: () => slots,
    observe: () => observation,
    collectWeaponSlots: () => [],
    observeWeapon: () => null
  };
  const getBytes = createNativeEvidenceProvider({ document, adapter });
  const empty = getBytes();
  slots = [{}];
  const initial = getBytes();
  assert.notDeepEqual(initial, empty, 'late native cards must be considered before a proof is pinned');
  assert.equal(getBytes.pin(initial), true, 'verified evidence can be pinned immediately before client initialization');
  observation = { ...observation, description: 'Extension translation.' };
  assert.deepEqual(getBytes(), initial, 'later scans must retain pre-write evidence for this document');
  assert.equal(getBytes.pin(initial), true, 'pinning the same verified document evidence is idempotent');
  patch = { status: 'selected', label: 'Old' };
  assert.notDeepEqual(getBytes(), initial, 'a changed native patch must stop matching the original local proof');
  patch = { status: 'absent' };
  document.location.pathname = '/weapons/other/other';
  assert.notDeepEqual(getBytes(), initial, 'a changed SPA route must stop matching the original local proof');
});
