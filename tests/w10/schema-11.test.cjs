const test = require('node:test'); const assert = require('node:assert/strict');
const { fixture } = require('../helpers/source-data-fixture.cjs'); const {fixture11} = require('../helpers/source-data-fixture-11.cjs');
const contract = require('../../extension/shared/source-data-contract.js'); const {raw} = require('../helpers/source-data-server.cjs'); const loader = require('../../extension/shared/loader.js'); const {webcrypto}=require('node:crypto');
function validate(x) { const {current,...documents}=x; return contract.validateSnapshot({current,documents}); }
// Scenario: existing and announced releases are loaded. Purpose: retain backward compatibility and support 1.1.
test('UnitT10_接受一點零與一點一格式', () => { assert.doesNotThrow(()=>validate(fixture())); assert.doesNotThrow(()=>validate(fixture11())); });
// Scenario: version and new fields violate the contract. Purpose: reject the complete snapshot.
test('UnitT20_拒絕主版變更缺漏未知欄位及錯誤參照', async () => {
 for (const mutate of [x=>{for(const d of Object.values(x)) d.schemaVersion='2.0.0';},x=>delete x.weapons.items[0].values.curves,x=>delete x.weapons.items[0].values.attackCombos,x=>delete x.weapons.items[0].values.bars[0].stats[0].curveId,x=>x.weapons.items[0].values.bars[0].stats[0].curveId='missing',x=>x.weapons.items[0].values.curves[0].extra=1]) { const x=fixture11(); mutate(x); assert.throws(()=>validate(x)); await assert.rejects(loader.verifyStoredSnapshot({...raw(x),cryptoApi:webcrypto})); }
 const old=fixture(); old.weapons.items[0].values.curves=[]; assert.throws(()=>validate(old));
 const future=fixture11(); for(const d of Object.values(future)) d.schemaVersion='1.2.0'; assert.doesNotThrow(()=>validate(future));
});
