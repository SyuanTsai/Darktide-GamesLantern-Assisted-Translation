'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PREVIEW_ORIGIN, buildDevExtension } = require('../../scripts/shared/build-dev-extension.cjs');

function removeBuild(result) {
  if (!result) return;
  const privateRoot = path.resolve(path.join(os.tmpdir(), 'syp-w10-builds'));
  const output = path.resolve(result.outputRoot);
  if (!output.startsWith(privateRoot + path.sep) || !path.basename(output).startsWith('build-')) {
    throw new Error('Refusing to remove a build outside the private W10 root');
  }
  fs.rmSync(output, { recursive: true, force: true, maxRetries: 3 });
}

test('UnitT10_DevManifestLoadsOnlyLocalW11ContentModulesOnSupportedGameRoutes', () => {
  // Scenario: Given normal and explicit test-harness W10 development builds.
  // Purpose: Load the W11 adapter only on exact supported Games Lantern routes, with synthetic proofs isolated to test builds.
  const priorCandidate = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  delete process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  let normal;
  let testBuild;
  try {
    normal = buildDevExtension();
    testBuild = buildDevExtension({ includeTestHarness: true });
    const expectedMatches = [
      'https://darktide.gameslantern.com/build-editor*',
      'https://darktide.gameslantern.com/abilities',
      'https://darktide.gameslantern.com/abilities/*',
      'https://darktide.gameslantern.com/weapon-blessing-traits*',
      'https://darktide.gameslantern.com/weapons/*'
    ];
    const expectedScripts = [
      'shared/contract.js', 'shared/domains.js', 'shared/loader.js',
      'shared/document-session.js', 'shared/client.js', 'shared/native-identity.js',
      'shared/view-model.js', 'shared/presentation.js', 'shared/production-dataset.js', 'shared/dom-adapter.js',
      'shared/dom-controller.js'
    ];

    for (const result of [normal, testBuild]) {
      assert.equal(result.selectedOrigin, PREVIEW_ORIGIN);
      assert.deepEqual(result.manifest.host_permissions, [PREVIEW_ORIGIN + '/*']);
      assert.deepEqual(result.manifest.permissions, []);
      assert.deepEqual(result.manifest.content_scripts[0], {
        matches: expectedMatches,
        js: expectedScripts.concat(result.includeTestHarness
          ? ['test-support/native-proof-registry.js', 'shared/content-entry.js']
          : ['shared/content-entry.js']),
        css: ['shared/display.css'],
        run_at: 'document_idle',
        all_frames: false
      });
      assert.equal(Object.hasOwn(result.manifest, 'externally_connectable'), false);
      assert.equal(Object.hasOwn(result.manifest, 'web_accessible_resources'), false);
      assert.equal(fs.existsSync(path.join(result.extensionPath, 'test-support/native-proof-registry.js')),
        result.includeTestHarness);
      assert.equal(fs.existsSync(path.join(result.extensionPath, 'shared', 'content-entry.js')), true);
      assert.equal(fs.existsSync(path.join(result.extensionPath, 'shared', 'display.css')), true);
      const manifest = JSON.parse(fs.readFileSync(path.join(result.extensionPath, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest, result.manifest);

      const packaged = [];
      const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(absolute);
          else packaged.push(path.relative(result.extensionPath, absolute).replaceAll(path.sep, '/'));
        }
      };
      visit(result.extensionPath);
      const allowed = new Set([
        'manifest.json',
        'shared/baseline-provider.js', 'shared/client.js', 'shared/contract.js', 'shared/document-session.js',
        'shared/dom-adapter.js', 'shared/dom-controller.js', 'shared/domains.js', 'shared/display.css',
        'shared/loader.js', 'shared/native-identity.js', 'shared/presentation.js', 'shared/production-dataset.js', 'shared/service-worker.js',
        'shared/snapshot-store.js', 'shared/update-coordinator.js', 'shared/view-model.js',
        'shared/content-entry.js', 'w10-harness.html', 'w10-harness.js'
      ]);
      if (!result.includeTestHarness) {
        allowed.delete('w10-harness.html');
        allowed.delete('w10-harness.js');
      } else {
        allowed.add('test-support/native-proof-registry.js');
      }
      assert.deepEqual(packaged.sort(), [...allowed].sort());
    }
  } finally {
    if (priorCandidate === undefined) delete process.env.SYP_W10_APPROVED_PACKAGE_DIR;
    else process.env.SYP_W10_APPROVED_PACKAGE_DIR = priorCandidate;
    removeBuild(testBuild);
    removeBuild(normal);
  }
});
