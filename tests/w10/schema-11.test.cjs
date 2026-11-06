const test = require('node:test'); const assert = require('node:assert/strict');
const { fixture } = require('../helpers/source-data-fixture.cjs'); const {fixture11} = require('../helpers/source-data-fixture-11.cjs');
const contract = require('../../extension/shared/source-data-contract.js'); const {raw} = require('../helpers/source-data-server.cjs'); const loader = require('../../extension/shared/loader.js'); const {webcrypto}=require('node:crypto');
function validate(x) { const {current,...documents}=x; return contract.validateSnapshot({current,documents}); }
// Scenario: existing and announced releases are loaded. Purpose: retain backward compatibility and support 1.1.
test('UnitT10_接受一點零與一點一格式', () => { assert.doesNotThrow(()=>validate(fixture())); assert.doesNotThrow(()=>validate(fixture11())); });
// Scenario: version and new fields violate the contract. Purpose: reject the complete snapshot.
test('UnitT20_拒絕主版變更缺漏未知欄位及錯誤參照', async () => {
 for (const mutate of [x=>{for(const d of Object.values(x)) d.schemaVersion='2.0.0';},x=>delete x.weapons.items[0].values.curves,x=>delete x.weapons.items[0].values.attackCombos,x=>delete x.weapons.items[0].values.bars[0].stats[0].curveId,x=>x.weapons.items[0].values.bars[0].stats[0].curveId='missing',x=>x.weapons.items[0].values.curves[0].extra=1]) { const x=fixture11(); mutate(x); assert.throws(()=>validate(x)); await assert.rejects(loader.verifyStoredSnapshot({...raw(x),cryptoApi:webcrypto})); }
 for (const mutate of [v=>v.curves=[], v=>v.attackCombos=[], v=>v.bars[0].stats[0].curveId='x']) { const old=fixture(); mutate(old.weapons.items[0].values); assert.throws(()=>validate(old)); }
 const future=fixture11(); for(const d of Object.values(future)) d.schemaVersion='1.2.0'; assert.doesNotThrow(()=>validate(future));
});
// Scenario: curves and stats have inconsistent identities or cardinality. Purpose: reject the entire snapshot in both directions.
test('UnitT30_拒絕曲線與屬性非一一對應', () => {
 const cases = [
  v => v.curves.push({...structuredClone(v.curves[0]), id: 'extra.stat', bar: 'extra', stat: 'stat'}),
  v => v.curves.push({...structuredClone(v.curves[0]), id: v.curves[0].id + '.extra'}),
  v => { v.curves[0].bar = 'other'; },
  v => v.bars[0].stats.push(structuredClone(v.bars[0].stats[0]))
 ];
 for (const mutate of cases) { const x=fixture11(); mutate(x.weapons.items[0].values); assert.throws(()=>validate(x)); }
});

// Scenario: WP2b examples and schema boundary variants are validated. Purpose: enforce published conditions without invented ID rules.
test('UnitT40_WP2b範例與條件驗證', () => {
 const fs=require('node:fs'), path=require('node:path'); const dir=path.join(__dirname,'../fixtures/source-data-v1-1');
 const x=Object.fromEntries(['current','skills','weapons','blessings','terms'].map(k=>[k,JSON.parse(fs.readFileSync(path.join(dir,k+'.json')))]));
 assert.doesNotThrow(()=>validate(structuredClone(x)));
 const arbitrary=structuredClone(x); arbitrary.weapons.items[0].values.curves[0].id='arbitrary'; arbitrary.weapons.items[0].values.bars[0].stats[0].curveId='arbitrary'; assert.doesNotThrow(()=>validate(arbitrary));
 for(const mutate of [
  v=>v.curves[0].unknown='BAD', v=>{v.curves[0].interpolation='unknown'; v.curves[0].unknown='DYNAMIC_VALUE';},
  v=>{v.curves[0].unknown=null; v.curves[0].knots[0].output=null;},
  v=>v.attackCombos[0].unknown='BAD', v=>v.attackCombos[0].steps[0].damageProfileUnknown='DYNAMIC_VALUE',
  v=>{v.attackCombos[0].steps[0].damageProfile=null; v.attackCombos[0].steps[0].damageProfileUnknown=null;},
  v=>v.attackCombos[0].source.path='', v=>v.attackCombos[0].steps[0].extra=1, v=>v.attackCombos[0].loopsTo=-1, v=>v.curves[0].knots[0].extra=1
 ]) {const copy=structuredClone(x); mutate(copy.weapons.items[0].values); assert.throws(()=>validate(copy));}
});

// Scenario: legal WP2b values do not impose ordering, matching array lengths, or a loop target bound. Purpose: avoid rejecting schema-valid payloads.
test('UnitT50_允許schema未限制的節點與連段', () => {
 const x=fixture11(), v=x.weapons.items[0].values; v.curves[0].knots=[{input:1,output:[1]},{input:1,output:[2,3]}]; v.attackCombos[0].loopsTo=99; assert.doesNotThrow(()=>validate(x));
});
