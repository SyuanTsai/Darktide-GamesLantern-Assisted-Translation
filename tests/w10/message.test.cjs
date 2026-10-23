'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');
const workerApi = require('../../extension/shared/service-worker.js');
const clientApi = require('../../extension/shared/client.js');
const { BASELINE_PATHS, createBaselineProvider } = require('../../extension/shared/baseline-provider.js');
const { verifyStoredSnapshot } = require('../../extension/shared/loader.js');
const { makeResponse, makeSyntheticPackage } = require('./package-fixtures.cjs');

test('UnitT10_AcceptsOnlyExactLocalExtensionSenderAndMessageKeys', async () => {
  // Scenario: Given a W10 worker message protocol that receives local extension page requests.
  // Purpose: Reject foreign IDs, origin lookalikes, remote URL fields, and unknown message keys.
  assert.ok(workerApi && typeof workerApi.createMessageHandler === 'function',
    'W10 service-worker message protocol is not implemented');
  const runtime = { id: 'abcdefghijklmnopabcdefghijklmnop' };
  const calls = [];
  const handler = workerApi.createMessageHandler({
    runtime,
    coordinator: { async getSnapshot(identity, options) { calls.push({ identity, options }); return {
      status: 'original', source: 'original', snapshot: null, identity, updateStatus: 'no-compatible-release'
    }; } }
  });
  const identity = { gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2' };
  const accepted = [];
  const localSender = {
    id: runtime.id,
    origin: 'chrome-extension://' + runtime.id,
    url: 'chrome-extension://' + runtime.id + '/adapter.html'
  };

  // When valid and malformed messages arrive from local, foreign-ID, and lookalike extension senders.
  assert.equal(handler({ type: 'W10_GET_SNAPSHOT', identity, active: true, manual: false }, localSender,
    (value) => accepted.push(value)), true);
  assert.equal(handler({ type: 'W10_GET_SNAPSHOT', identity }, { ...localSender, id: 'other-id' },
    (value) => accepted.push(value)), false);
  assert.equal(handler({ type: 'W10_GET_SNAPSHOT', identity }, { ...localSender, origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop.evil' },
    (value) => accepted.push(value)), false);
  assert.equal(handler({ type: 'W10_GET_SNAPSHOT', identity, url: 'https://attacker.invalid/' }, localSender,
    (value) => accepted.push(value)), false);
  assert.equal(handler({ type: 'W10_GET_SNAPSHOT', identity: { gameVersion: '1.13.2', gameReleaseId: '../other' } }, localSender,
    (value) => accepted.push(value)), false);
  assert.equal(handler({ type: 'W10_UNKNOWN', identity }, localSender, (value) => accepted.push(value)), false);

  // Then only the exact local request reaches the coordinator and returns through the async response channel.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].identity, identity);
  assert.deepEqual(calls[0].options, { active: true, manual: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted.length, 6);
  assert.equal(accepted.filter((value) => value.ok === false).length, 5);
  assert.ok(accepted.some((value) => value.error && value.error.code === 'INVALID_IDENTITY'));
  assert.equal(accepted.find((value) => value.ok === true).result.source, 'original');
});

test('UnitT11_RoundTripsARealDomainSizedBase64MessageAndRevalidatesClientBytes', async () => {
  // Scenario: Given a four-domain package whose weapons raw bytes match the fixed W09 data size.
  // Purpose: Verify JSON base64 transport remains bounded and decodable at the 6.6 MiB production file size.
  const targetBytes = 6_662_191;
  const pack = makeSyntheticPackage({
    mutateFileBytes(filePath, bytes) {
      if (!filePath.endsWith('/weapons.json')) return bytes;
      return Buffer.concat([bytes, Buffer.alloc(targetBytes - bytes.byteLength, 0x20)]);
    }
  });
  const snapshot = await verifyStoredSnapshot({
    versionBytes: pack.versionBytes, manifestBytes: pack.manifestBytes,
    files: pack.rawFiles, identity: pack.identity, cryptoApi: webcrypto
  });
  const wire = workerApi.serializeResult({
    status: 'ready', source: 'active', identity: pack.identity,
    updateStatus: 'unchanged', snapshot
  });
  const weaponsWire = wire.snapshot.files.find(([filePath]) => filePath.endsWith('/weapons.json'))[1];
  assert.equal(weaponsWire.length, Math.ceil(targetBytes / 3) * 4);
  const client = clientApi.createW10Client({
    runtime: { async sendMessage() { return JSON.parse(JSON.stringify({ ok: true, result: wire })); } }
  });

  // When the serialized worker result crosses the JSON-only message boundary and the client restores it.
  const result = await client.initialize(pack.identity);

  // Then the client verifies all reconstructed raw bytes and accepts the exact large file size.
  assert.equal(result.source, 'active');
  assert.equal(result.snapshot.files.get('domains/weapons.json').byteLength, targetBytes);
  assert.equal(result.snapshot.manifestSha256, snapshot.manifestSha256);
  assert.match(result.statusText, /已驗證相容/);
});

test('UnitT12_ProvidesTraditionalChineseLocalAdapterStatusForOriginalAndFallbackStates', async () => {
  // Scenario: Given an unknown game identity and local ready/original result states.
  // Purpose: Give the local adapter explicit Traditional Chinese text, including the original-site fallback.
  const client = clientApi.createW10Client({ runtime: { async sendMessage() { throw new Error('must not send an invalid identity'); } } });

  // When identity validation fails or a known source is rendered, the client exposes a short localized message.
  const unknown = await client.initialize({ gameVersion: '1.13.2' });
  const baselineText = clientApi.getStatusText({ status: 'ready', source: 'baseline' });
  const previousText = clientApi.getStatusText({ status: 'ready', source: 'previous' });

  // Then the original-site state is clear and all fallback source labels are readable in Traditional Chinese.
  assert.equal(unknown.source, 'original');
  assert.match(unknown.statusText, /顯示原站內容/);
  assert.match(baselineText, /基礎資料/);
  assert.match(previousText, /上一份.*相容/);
});

test('UnitT13_ValidatesFixedLocalBaselineWithoutIsolationSidecar', async () => {
  // Scenario: Given the standard fixed extension-local raw files and no provenance sidecar.
  // Purpose: Keep the shared baseline contract defined by version, manifest, and four validated domain bytes alone.
  const pack = makeSyntheticPackage();
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const resources = new Map([
    ['baseline/version.json', pack.versionBytes],
    ['baseline/manifest.json', pack.manifestBytes],
    ...[...pack.rawFiles].map(([filePath, bytes]) => ['baseline/' + filePath, bytes])
  ]);
  const requests = [];
  const provider = createBaselineProvider({
    chromeApi: { runtime: {
      id: extensionId,
      getURL(relativePath) { return 'chrome-extension://' + extensionId + '/' + relativePath; }
    } },
    async fetchImpl(url) {
      const parsed = new URL(url);
      assert.equal(parsed.protocol, 'chrome-extension:');
      assert.equal(parsed.hostname, extensionId);
      const relativePath = parsed.pathname.slice(1);
      requests.push(relativePath);
      const bytes = resources.get(relativePath);
      if (!bytes) return makeResponse(url, { status: 404, bytes: Buffer.from('missing') });
      return makeResponse(url, { bytes, finalUrl: url });
    }
  });

  // When the provider reads only fixed local paths, the ordinary loader rechecks their hashes and identities.
  const raw = await provider({ url: 'https://attacker.invalid/ignored' });
  assert.ok(raw);
  const snapshot = await verifyStoredSnapshot({ ...raw, identity: pack.identity, cryptoApi: webcrypto });

  // Then the complete shared package is accepted without a sidecar, and no caller URL or provenance path is fetched.
  assert.equal(snapshot.manifestSha256, pack.manifestSha256);
  assert.deepEqual([...snapshot.files.keys()].sort(), [...pack.rawFiles.keys()].sort());
  assert.deepEqual(requests, BASELINE_PATHS);
  assert.equal(requests.includes('baseline/provenance.json'), false);
  assert.equal(requests.some((entry) => entry.includes('attacker.invalid')), false);
});
