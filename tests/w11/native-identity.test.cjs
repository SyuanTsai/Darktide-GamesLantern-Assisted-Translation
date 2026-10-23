'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash, webcrypto } = require('node:crypto');
const { createNativeIdentityResolver } = require('../../extension/shared/native-identity.js');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('UnitT10_UnknownNativeSnapshotDoesNotInferIdentityFromPatchLabel', async () => {
  // Scenario: Given a rendered patch label with no locally registered snapshot proof.
  // Purpose: Prevent a familiar patch name or Live badge from being treated as a game-version identity.
  const bytes = Buffer.from('isolated native snapshot without a trusted mapping', 'utf8');
  const resolver = createNativeIdentityResolver({ cryptoApi: webcrypto });

  // Given no proof registry entry exists for these native bytes.
  const result = await resolver.resolve(bytes);

  // Then identity remains unknown; display names are not an input to this decision.
  assert.deepEqual(result, { status: 'unknown', reason: 'native-proof-not-found' });
});

test('UnitT20_ResolvesOnlyExactLocallyRegisteredSnapshotDigestAndTuple', async () => {
  // Scenario: Given one reproducible native snapshot digest pinned to a complete local W08 tuple.
  // Purpose: Allow test-controlled evidence while rejecting changed bytes or incomplete/contradictory identity.
  const bytes = Buffer.from('explicit isolated snapshot proof', 'utf8');
  const identity = { gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2', snapshotId: 'synthetic-primary' };
  const resolver = createNativeIdentityResolver({
    cryptoApi: webcrypto,
    proofs: [{ evidenceId: 'isolated-test-only', sha256: sha256(bytes), identity, patchLabel: 'Depths of the Damned' }]
  });

  // Given the exact proof bytes and a one-byte-changed lookalike.
  const result = await resolver.resolve(bytes);
  const changed = await resolver.resolve(Buffer.from('explicit isolated snapshot proof!', 'utf8'));

  // Then only the exact digest resolves to the immutable trusted tuple.
  assert.deepEqual(result, { status: 'verified', identity, patchLabel: 'Depths of the Damned' });
  assert.deepEqual(changed, { status: 'unknown', reason: 'native-proof-not-found' });
  assert.throws(() => createNativeIdentityResolver({
    cryptoApi: webcrypto,
    proofs: [{ evidenceId: 'incomplete', sha256: sha256(bytes), identity: { gameVersion: '1.13.2' } }]
  }), /identity|tuple/i);
  assert.throws(() => createNativeIdentityResolver({
    cryptoApi: webcrypto,
    proofs: [
      { evidenceId: 'first', sha256: sha256(bytes), identity },
      { evidenceId: 'contradiction', sha256: sha256(bytes), identity: { ...identity, gameVersion: '1.13.1' } }
    ]
  }), /duplicate|conflict/i);
});
