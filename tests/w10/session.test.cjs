'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDocumentSession } = require('../../extension/shared/document-session.js');

const R1_IDENTITY = Object.freeze({ gameVersion: '9.8.7', gameReleaseId: 'fixture:w10-loader', snapshotId: 'snapshot-r1' });
const R2_IDENTITY = Object.freeze({ ...R1_IDENTITY });
const OTHER_PATCH = Object.freeze({ ...R1_IDENTITY, gameVersion: '9.8.8' });

test('UnitT10_PinsOneSnapshotForTheLifetimeOfADocument', async () => {
  // Scenario: Given document initialization resolves to R1 and a background update later exposes R2.
  // Purpose: Keep repeated calls and SPA navigation on this document bound to its first validated snapshot.
  const r1 = { marker: 'R1' };
  const r2 = { marker: 'R2' };
  let current = r1;
  let calls = 0;
  const session = createDocumentSession({
    async resolveSnapshot(identity) {
      calls += 1;
      return { status: 'ready', source: 'active', snapshot: current, identity };
    }
  });

  // When the document first initializes, then later reads after a background update.
  const first = await session.initialize(R1_IDENTITY);
  current = r2;
  const repeated = await session.getSnapshot(R2_IDENTITY);

  // Then the existing document remains on R1 while a new document session can resolve R2.
  assert.equal(first.snapshot, r1);
  assert.equal(repeated.snapshot, r1);
  assert.equal(repeated, first);
  const nextDocument = await createDocumentSession({ resolveSnapshot: async (identity) => ({
    status: 'ready', source: 'active', snapshot: current, identity
  }) }).initialize(R2_IDENTITY);
  assert.equal(nextDocument.snapshot, r2);
  assert.equal(calls, 1);
});

test('UnitT11_StopsTranslationForUnknownOrChangedIdentityWithoutMixingPackages', async () => {
  // Scenario: Given a trusted patch/snapshot changes after the session is initialized.
  // Purpose: Stop using old domains once the current document no longer matches its original game identity.
  let calls = 0;
  const session = createDocumentSession({
    async resolveSnapshot(identity) {
      calls += 1;
      return { status: 'ready', source: 'active', snapshot: { marker: 'R1' }, identity };
    }
  });
  const first = await session.initialize(R1_IDENTITY);
  const changedPatch = await session.initialize(OTHER_PATCH);
  const changedSnapshot = await session.initialize({ ...R1_IDENTITY, snapshotId: 'snapshot-r2' });
  const unknown = await session.initialize({ gameVersion: 'not-a-patch', gameReleaseId: 'fixture:w10-loader' });

  assert.equal(first.source, 'active');
  assert.equal(changedPatch.source, 'original');
  assert.equal(changedPatch.snapshot, null);
  assert.equal(changedPatch.status, 'original');
  assert.equal(changedPatch.reason, 'identity-changed');
  assert.equal(changedSnapshot.source, 'original');
  assert.equal(changedSnapshot.snapshot, null);
  assert.equal(unknown.source, 'original');
  assert.equal(unknown.snapshot, null);
  assert.equal(unknown.reason, 'unknown-identity');
  assert.equal(calls, 1, 'session fetched a second package after identity changed');
});

test('UnitT12_UsesOriginalWhenNoCompatibleVerifiedSnapshotExists', async () => {
  // Scenario: Given the coordinator reports no compatible cached, baseline, or published package.
  // Purpose: Let the document render original text with a clear null snapshot instead of mixing domains.
  const session = createDocumentSession({ resolveSnapshot: async (identity) => ({
    status: 'original', source: 'original', snapshot: null, identity, updateStatus: 'no-compatible-release'
  }) });
  const result = await session.initialize(R1_IDENTITY);
  assert.equal(result.status, 'original');
  assert.equal(result.updateStatus, 'no-compatible-release');
  assert.equal(result.source, 'original');
  assert.equal(result.snapshot, null);
});
