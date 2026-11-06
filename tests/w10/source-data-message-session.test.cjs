const test = require('node:test'); const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { raw } = require('../helpers/source-data-server.cjs'); const { fixture } = require('../helpers/source-data-fixture.cjs');
const loader = require('../../extension/shared/loader.js');
const worker = require('../../extension/shared/service-worker.js');
const { createW10Client } = require('../../extension/shared/client.js');
const { createDocumentSession } = require('../../extension/shared/document-session.js');
const sender = { id: 'extension-id', origin: 'https://darktide.gameslantern.com', url: 'https://darktide.gameslantern.com/abilities', frameId: 0, tab: { id: 1 } };
async function ready(version) { const snapshot = await loader.verifyStoredSnapshot({ ...raw(fixture(version)), cryptoApi: webcrypto }); return { status: 'ready', source: 'active', identity: snapshot.identity, snapshot }; }
// Scenario: content requests bytes through guarded worker. Purpose: end-to-end serialization and client verification.
test('UnitT10_worker傳遞四檔且client複驗', async () => {
  const result = await ready('1.14'); let requested;
  const handler = worker.createMessageHandler({ runtime: { id: sender.id }, coordinator: { async getSnapshot(options) { requested = options; return result; } } });
  const runtime = { sendMessage: message => new Promise(resolve => handler(message, sender, resolve)) };
  const client = createW10Client({ runtime, cryptoApi: webcrypto });
  const verified = await client.initialize(); assert.equal(verified.status, 'ready'); assert.deepEqual(verified.identity, result.identity);
  assert.deepEqual(requested, { active: true, manual: false }); assert.deepEqual(Object.keys(verified.snapshot.files).sort(), ['blessings','skills','terms','weapons']);
});
// Scenario: hostile frames, routes or malformed requests call the worker. Purpose: preserve sender and request boundary.
test('UnitT20_拒絕不可信sender與任意欄位', () => {
  const handler = worker.createMessageHandler({ runtime: { id: sender.id }, coordinator: { getSnapshot() { throw new Error('must not run'); } } });
  for (const bad of [{ ...sender, frameId: 1 }, { ...sender, id: 'other' }, { ...sender, origin: 'https://evil.invalid' }, { ...sender, url: 'https://darktide.gameslantern.com/unsupported' }, { ...sender, tab: null }]) {
    let result; assert.equal(handler({ type: worker.MESSAGE_TYPE }, bad, x => result = x), false); assert.equal(result.error.code, 'UNTRUSTED_SENDER');
  }
  for (const message of [{ type: worker.MESSAGE_TYPE, identity: {} }, { type: worker.MESSAGE_TYPE, url: 'https://evil.invalid' }, { type: worker.MESSAGE_TYPE, active: 1 }, { type: 'other' }]) {
    let result; assert.equal(handler(message, sender, x => result = x), false); assert.equal(result.error.code, 'INVALID_MESSAGE');
  }
});
// Scenario: worker bytes or metadata are tampered. Purpose: client keeps original even when worker says ready.
test('UnitT30_拒絕識別不符及不完整payload', async () => {
  const valid = worker.serializeResult(await ready('1.14'));
  for (const change of [x => x.identity.textBatch = 'wrong', x => x.snapshot.currentBytes = '!!!!', x => delete x.snapshot.files.skills,
    x => x.snapshot.files.skills = Buffer.from('{}').toString('base64'), x => x.snapshot.files.extra = '', x => x.source = 'baseline']) {
    const result = structuredClone(valid); change(result);
    const client = createW10Client({ runtime: { async sendMessage() { return { ok: true, result }; } }, cryptoApi: webcrypto });
    assert.equal((await client.initialize()).source, 'original');
  }
});
// Scenario: manual check finds a new version after initialization. Purpose: current document never hot swaps.
test('UnitT40_一文件固定首次快照手動檢查僅回傳摘要', async () => {
  let result = await ready('1.14'); const client = createW10Client({ runtime: { async sendMessage() { return { ok: true, result: worker.serializeResult(result) }; } }, cryptoApi: webcrypto });
  const first = await client.initialize(); result = await ready('1.15'); const manual = await client.checkNow();
  assert.equal(manual.status, 'ready'); assert.equal(manual.snapshot, undefined);
  assert.equal((await client.initialize()).snapshot, first.snapshot); assert.equal((await client.initialize()).identity.gameVersion, '1.14');
});
// Scenario: first resolution fails or has mismatched identity. Purpose: original is also pinned and resolution happens once.
test('UnitT50_session固定失敗結果且拒絕識別不符', async () => {
  let calls = 0; const result = await ready('1.14'); const session = createDocumentSession({ resolveSnapshot() { calls++; return { ...result, identity: { ...result.identity, gameVersion: '1.15' } }; } });
  assert.equal((await session.initialize()).source, 'original'); await session.initialize(); assert.equal(calls, 1);
  const failed = createDocumentSession({ resolveSnapshot() { throw new Error('offline'); } }); assert.equal((await failed.initialize()).source, 'original');
});
