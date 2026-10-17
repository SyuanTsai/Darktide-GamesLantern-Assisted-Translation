'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DEV_ORIGIN,buildDevExtension}=require('../../scripts/w01/build-dev-extension.cjs');

test('UnitT90_DevBuildIsTempScopedAndRequestsOnlyTheFixedPreviewOrigin',()=>{
  const built=buildDevExtension();
  const manifest=JSON.parse(fs.readFileSync(path.join(built.extensionPath,'manifest.json'),'utf8'));
  const tempRoot=path.resolve(os.tmpdir()),privateRoot=path.join(tempRoot,'syp-311-w01');
  assert.ok(path.resolve(built.outputRoot).startsWith(privateRoot+path.sep));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.host_permissions,[DEV_ORIGIN+'/*']);
  assert.deepEqual(manifest.permissions,[]);
  assert.deepEqual(manifest.background,{service_worker:'service-worker.js',type:'classic'});
  assert.equal(Object.hasOwn(manifest,'content_scripts'),false);
  assert.equal(fs.existsSync(path.join(built.extensionPath,'idb-harness.html')),false);
  assert.ok(fs.existsSync(path.join(built.extensionPath,'loader-core.js')));
  assert.ok(fs.existsSync(path.join(built.extensionPath,'service-worker.js')));
  assert.ok(fs.existsSync(path.join(built.extensionPath,'preview.html')));
  assert.ok(fs.existsSync(path.join(built.extensionPath,'preview.js')));
  assert.ok(fs.existsSync(path.join(built.extensionPath,'preview.css')));
  const page=fs.readFileSync(path.join(built.extensionPath,'preview.html'),'utf8');
  assert.match(page,/<script defer src="preview\.js"><\/script>/);
  assert.doesNotMatch(page,/<script\s+[^>]*src="https?:/i);
  assert.doesNotMatch(page,/<script\s*>/i);
});
