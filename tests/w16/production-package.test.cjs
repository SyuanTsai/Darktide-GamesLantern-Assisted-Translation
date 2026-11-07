const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {buildProductionExtensionPackage,SHARED_FILES,validateVersion}=require('../../scripts/release/build-production-extension.cjs');
// Scenario: release packages are built locally with existing icons. Purpose: no dataset pin, bundled old data or expanded permissions survives.
test('UnitT10_正式封裝以新資料契約載入且無固定版pin',async()=>{
 const outputDir=path.resolve('.cache','spec2-release-'+randomUUID());
 const result=await buildProductionExtensionPackage({version:'0.2.30',outputDir});const m=result.manifest;
 assert.deepEqual(m.permissions,[]);assert.deepEqual(m.host_permissions,['https://darktide.tw-syuan.com/*']);
 assert.equal(Object.hasOwn(result.receipt,'displayDatasetPin'),false);
 assert.equal(result.receipt.packageFiles.some(f=>f.path.includes('dataset-pin')||f.path.startsWith('baseline/')),false);
 for(const file of SHARED_FILES)assert.ok(fs.existsSync(path.join(result.packageDirectory,'shared',file)));
 assert.ok(fs.statSync(result.archivePath).size>0);
 for(const script of m.content_scripts[0].js)assert.ok(fs.existsSync(path.join(result.packageDirectory,script)));
 assert.equal(m.content_scripts[0].js.at(-1),'shared/content-entry.js');
 await assert.rejects(buildProductionExtensionPackage({version:'0.2.30',outputDir}));
});
// Scenario: malformed Chrome versions are submitted. Purpose: preserve release validation after removing dataset selection.
test('UnitT20_版本格式仍檢查',()=>{for(const v of ['','1.2.3.4.5','1.70000','01.2'])assert.throws(()=>validateVersion(v));assert.equal(validateVersion('0.2.30'),'0.2.30');});
