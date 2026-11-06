const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { buildDevExtension, PREVIEW_ORIGIN } = require('../../scripts/shared/build-dev-extension.cjs');
const { buildProductionExtensionPackage } = require('../../scripts/release/build-production-extension.cjs');
const root = path.resolve(__dirname, '../..');
// Scenario: development build without remote data. Purpose: only fixed preview permission and source-data scripts.
test('UnitT10_dev建置使用新模組且不含baseline', () => {
  const built = buildDevExtension({ includeTestHarness: true });
  assert.ok(built.outputRoot.startsWith(root + path.sep));
  assert.deepEqual(built.manifest.host_permissions, [PREVIEW_ORIGIN + '/*']);
  assert.equal(built.manifest.content_scripts[0].all_frames, false);
  assert.equal(built.manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
  assert.ok(built.manifest.content_scripts[0].js.includes('shared/source-data-contract.js'));
  assert.ok(!fs.existsSync(path.join(built.extensionPath, 'baseline')));
  const loader = fs.readFileSync(path.join(built.extensionPath, 'shared/loader.js'), 'utf8'); assert.ok(loader.includes(PREVIEW_ORIGIN));
  for (const name of ['baseline-provider.js','contract.js','domains.js']) assert.ok(!fs.existsSync(path.join(built.extensionPath,'shared',name)));
});
// Scenario: production package built entirely offline. Purpose: ZIP via pwsh, unchanged permission, no bundled data.
test('InterT20_production建置離線封裝且不含baseline', async () => {
  const outputDir = path.join(root, '.cache', 'source-data-release-' + require('node:crypto').randomUUID());
  const built = await buildProductionExtensionPackage({ version: '0.2.30', outputDir });
  assert.deepEqual(built.manifest.host_permissions, ['https://darktide.tw-syuan.com/*']);
  assert.ok(fs.statSync(built.archivePath).size > 0);
  assert.ok(!built.receipt.packageFiles.some(x => x.path.startsWith('baseline/') || x.path.includes('baseline-provider')));
  assert.ok(built.manifest.content_scripts[0].js.includes('shared/source-data-contract.js'));
  assert.ok(built.receipt.packageFiles.some(x => x.path === 'shared/production-dataset-pin.js')); // spec2 retains display pin.
});
