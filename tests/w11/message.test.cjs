'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const workerApi = require('../../extension/shared/service-worker.js');

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const GAME_ORIGIN = 'https://darktide.gameslantern.com';
const IDENTITY = Object.freeze({ gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2',
  snapshotId: 'psyker-skills-blessings-1.13.2-18-files' });

function gameSender(overrides = {}) {
  return {
    id: EXTENSION_ID,
    origin: GAME_ORIGIN,
    url: GAME_ORIGIN + '/abilities/brain-rupture',
    frameId: 0,
    tab: { id: 17 },
    ...overrides
  };
}

test('UnitT10_MessageHandlerAcceptsOnlyLocalExtensionOrTrustedTopFrameRoute', async () => {
  // Scenario: Given a worker message from an extension page or native top-level Games Lantern route.
  // Purpose: Accept only same-extension callers and constrained game-page callers with exact route/origin identity.
  const extensionSender = { id: EXTENSION_ID, origin: 'chrome-extension://' + EXTENSION_ID,
    url: 'chrome-extension://' + EXTENSION_ID + '/popup.html' };
  assert.equal(workerApi.trustedSender(extensionSender, EXTENSION_ID), true);
  assert.equal(workerApi.trustedSender(gameSender(), EXTENSION_ID), true);
  for (const sender of [
    gameSender({ id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }),
    gameSender({ url: 'https://darktide.gameslantern.com.evil/abilities/brain-rupture' }),
    gameSender({ origin: 'https://gameslantern.com' }),
    gameSender({ url: 'https://darktide.gameslantern.com:444/abilities/brain-rupture' }),
    gameSender({ url: 'https://darktide.gameslantern.com/settings' }),
    gameSender({ frameId: 2 }),
    gameSender({ tab: undefined }),
    gameSender({ url: 'https://user@darktide.gameslantern.com/abilities/brain-rupture' })
  ]) assert.equal(workerApi.trustedSender(sender, EXTENSION_ID), false);

  let received = null;
  const handler = workerApi.createMessageHandler({ runtime: { id: EXTENSION_ID }, coordinator: {
    async getSnapshot(identity, options) {
      received = { identity, options };
      return { status: 'original', source: 'original', identity, snapshot: null, reason: 'no-compatible-release' };
    }
  } });
  let response;
  const keepAlive = handler({ type: workerApi.MESSAGE_TYPE, identity: IDENTITY, active: true, manual: false },
    gameSender(), (value) => { response = value; });
  assert.equal(keepAlive, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.identity.snapshotId, IDENTITY.snapshotId);
  assert.deepEqual(received.options, { active: true, manual: false });
  assert.equal(response.ok, true);
  assert.equal(response.result.source, 'original');
});

test('UnitT20_MessageEnvelopeRejectsPageSuppliedURLProgramAndUnknownFields', () => {
  // Scenario: Given a trusted top-level sender but a malformed or executable caller envelope.
  // Purpose: Keep requests limited to fixed identity/activity controls, never caller URLs or executable instructions.
  const handler = workerApi.createMessageHandler({ runtime: { id: EXTENSION_ID }, coordinator: {
    async getSnapshot() { throw new Error('coordinator must not run for invalid messages'); }
  } });
  for (const message of [
    { type: workerApi.MESSAGE_TYPE, identity: IDENTITY, url: GAME_ORIGIN + '/data/version.json' },
    { type: workerApi.MESSAGE_TYPE, identity: IDENTITY, program: 'import("https://example.invalid/x.js")' },
    { type: 'UNKNOWN', identity: IDENTITY },
    { type: workerApi.MESSAGE_TYPE, identity: { ...IDENTITY, gameVersion: 'unknown' } }
  ]) {
    let response;
    assert.equal(handler(message, gameSender(), (value) => { response = value; }), false);
    assert.equal(response.ok, false);
  }
});
