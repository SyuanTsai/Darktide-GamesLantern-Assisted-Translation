'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PREVIEW_ORIGIN, buildDevExtension } = require('../../scripts/shared/build-dev-extension.cjs');

function removeBuild(result) {
  if (!result) return;
  const root = path.resolve(path.join(os.tmpdir(), 'syp-w10-builds'));
  const target = path.resolve(result.outputRoot);
  if (!target.startsWith(root + path.sep) || !path.basename(target).startsWith('build-')) {
    throw new Error('Refusing to remove a path outside the private W10 build root');
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
}

test('UnitT20_IsolatedBuildPinsPreviewAndIncludesOnlyOptInLocalHarness', () => {
  // Scenario: Given a private W10 development build with and without the explicit harness option.
  // Purpose: Keep origin, permissions, CSP, copied modules, and test-only files inside the fixed build boundary.
  let normal;
  let withHarness;
  try {
    normal = buildDevExtension();
    withHarness = buildDevExtension({ includeTestHarness: true });

    // When both builds are produced, their packaged manifest and local files are inspected.
    for (const result of [normal, withHarness]) {
      assert.equal(result.selectedOrigin, PREVIEW_ORIGIN);
      assert.equal(result.manifest.manifest_version, 3);
      assert.deepEqual(result.manifest.permissions, []);
      assert.deepEqual(result.manifest.host_permissions, [PREVIEW_ORIGIN + '/*']);
      assert.deepEqual(result.manifest.background, { service_worker: 'shared/service-worker.js', type: 'classic' });
      assert.deepEqual(result.manifest.content_security_policy, { extension_pages: "script-src 'self'; object-src 'self'" });
      assert.equal(Object.hasOwn(result.manifest, 'externally_connectable'), false);
      const manifest = JSON.parse(fs.readFileSync(path.join(result.extensionPath, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest, result.manifest);
      const packagedLoader = fs.readFileSync(path.join(result.extensionPath, 'shared', 'loader.js'), 'utf8');
      assert.ok(packagedLoader.includes(PREVIEW_ORIGIN));
      assert.equal(packagedLoader.includes('https://darktide.tw-syuan.com'), false);
      assert.ok(fs.existsSync(path.join(result.extensionPath, 'shared', 'service-worker.js')));
      assert.ok(fs.existsSync(path.join(result.extensionPath, 'shared', 'client.js')));
      assert.equal(fs.existsSync(path.join(result.extensionPath, 'baseline', 'manifest.json')),
        !!process.env.SYP_W10_APPROVED_PACKAGE_DIR);
    }
    assert.equal(normal.includeTestHarness, false);
    assert.equal(fs.existsSync(path.join(normal.extensionPath, 'w10-harness.html')), false);
    assert.equal(withHarness.includeTestHarness, true);
    assert.equal(fs.existsSync(path.join(withHarness.extensionPath, 'w10-harness.html')), true);
    assert.equal(fs.existsSync(path.join(withHarness.extensionPath, 'w10-harness.js')), true);
    assert.throws(() => buildDevExtension({ origin: 'https://attacker.invalid' }), /only the includeTestHarness option/i);

    const buildRoot = path.resolve(path.join(os.tmpdir(), 'syp-w10-builds'));
    for (const result of [normal, withHarness]) {
      assert.ok(path.resolve(result.outputRoot).startsWith(buildRoot + path.sep));
      const packagedFiles = [];
      const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(entryPath);
          else packagedFiles.push(path.relative(result.extensionPath, entryPath).replaceAll(path.sep, '/'));
        }
      };
      visit(result.extensionPath);
      const allowedFiles = new Set([
        'manifest.json',
        'shared/contract.js', 'shared/domains.js', 'shared/loader.js', 'shared/snapshot-store.js',
        'shared/update-coordinator.js', 'shared/document-session.js', 'shared/baseline-provider.js',
        'shared/client.js', 'shared/service-worker.js'
      ]);
      if (result.includeTestHarness) {
        allowedFiles.add('w10-harness.html');
        allowedFiles.add('w10-harness.js');
      }
      if (process.env.SYP_W10_APPROVED_PACKAGE_DIR) {
        for (const file of [
          'baseline/version.json', 'baseline/manifest.json', 'baseline/provenance.json',
          'baseline/domains/skills.json', 'baseline/domains/blessings.json',
          'baseline/domains/weapons.json', 'baseline/domains/terms.json'
        ]) allowedFiles.add(file);
      }
      assert.deepEqual(packagedFiles.sort(), [...allowedFiles].sort());
    }

    // Then the normal development build contains no private candidate package or broad extension permission.
  } finally {
    removeBuild(withHarness);
    removeBuild(normal);
  }
});

test('UnitT21_OptInCandidateIsCopiedByPinnedRawManifestBytes', async (t) => {
  // Scenario: Given an explicitly configured approved but unselected local candidate directory.
  // Purpose: Verify only its pinned manifest and four raw domain files enter an isolated baseline build.
  if (!process.env.SYP_W10_APPROVED_PACKAGE_DIR) {
    t.skip('SYP_W10_APPROVED_PACKAGE_DIR is not set; the isolated candidate input was not supplied');
    return;
  }
  const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syp-w10-candidate-'));
  const isolatedInput = path.join(inputRoot, 'candidate');
  fs.mkdirSync(path.join(isolatedInput, 'domains'), { recursive: true });
  const sourceDirectory = path.resolve(process.env.SYP_W10_APPROVED_PACKAGE_DIR);
  const originalEnvironment = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  let result;
  try {
    for (const file of ['manifest.json', 'domains/skills.json', 'domains/blessings.json',
      'domains/weapons.json', 'domains/terms.json']) {
      fs.copyFileSync(path.join(sourceDirectory, file), path.join(isolatedInput, file));
    }
    assert.equal(fs.existsSync(path.join(inputRoot, 'input-lock.json')), false);
    process.env.SYP_W10_APPROVED_PACKAGE_DIR = isolatedInput;
    // Given only the local manifest and four raw domains in a separate directory, When the builder runs, Then it needs no repository sibling lock and retains every pinned hash.
    result = buildDevExtension({ includeTestHarness: true });
    assert.equal(result.approvedBaseline.included, true);
    assert.equal(result.approvedBaseline.provenance.manifestSha256,
      'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7');
    assert.equal(result.approvedBaseline.provenance.dataRevision,
      '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62');
    assert.equal(result.approvedBaseline.provenance.selected, false);
    assert.equal(result.approvedBaseline.provenance.allocationReserved, false);
    assert.equal(result.approvedBaseline.provenance.publicationEligible, false);
    assert.equal(result.approvedBaseline.copied.length, 4);
    assert.equal(fs.readFileSync(path.join(result.extensionPath, 'baseline', 'manifest.json')).byteLength, 1993);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.extensionPath, 'baseline', 'provenance.json'), 'utf8')),
      result.approvedBaseline.provenance);
    const manifest = JSON.parse(fs.readFileSync(path.join(result.extensionPath, 'baseline', 'manifest.json'), 'utf8'));
    for (const row of manifest.files) {
      const copied = fs.readFileSync(path.join(result.extensionPath, 'baseline', ...row.path.split('/')));
      assert.equal(copied.byteLength, row.sizeBytes);
      assert.equal(require('node:crypto').createHash('sha256').update(copied).digest('hex'), row.sha256);
    }
  } finally {
    process.env.SYP_W10_APPROVED_PACKAGE_DIR = originalEnvironment;
    removeBuild(result);
    const tempRoot = path.resolve(os.tmpdir());
    const candidateRoot = path.resolve(inputRoot);
    if (!candidateRoot.startsWith(tempRoot + path.sep) || !path.basename(candidateRoot).startsWith('syp-w10-candidate-')) {
      throw new Error('Refusing to remove a path outside the private W10 candidate test root');
    }
    fs.rmSync(candidateRoot, { recursive: true, force: true, maxRetries: 3 });
  }
});
