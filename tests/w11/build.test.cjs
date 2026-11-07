const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const dev=require('../../scripts/shared/build-dev-extension.cjs');const prod=require('../../scripts/release/build-production-extension.cjs');
// Scenario: both builders package display code. Purpose: preserve dependency order, permissions and local-only executable assets.
test('UnitT10_開發正式建置共用檔案與載入順序',()=>{
 assert.deepEqual([...dev.SHARED_FILES].sort(),[...prod.SHARED_FILES].sort());
 const built=dev.buildDevExtension();const m=built.manifest;assert.deepEqual(m.permissions,[]);
 assert.deepEqual(m.host_permissions,[dev.PREVIEW_ORIGIN+'/*']);
 const js=m.content_scripts[0].js;for(const [a,b] of [['source-data-contract.js','loader.js'],['native-identity.js','presentation.js'],['view-model.js','presentation.js'],['presentation.js','dom-adapter.js'],['dom-adapter.js','dom-controller.js'],['dom-controller.js','content-entry.js']])assert.ok(js.indexOf('shared/'+a)<js.indexOf('shared/'+b));
 for(const file of dev.SHARED_FILES)assert.ok(fs.existsSync(path.join(built.extensionPath,'shared',file)));
 assert.equal(js.some(x=>x.includes('dataset-pin')),false);
});
