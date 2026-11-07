const test = require('node:test'); const assert = require('node:assert/strict');
const { displayFixture, snapshot } = require('../helpers/source-data-display.cjs');
const { buildWeaponFamilyViewModels } = require('../../extension/shared/presentation.js');
const { makeWeaponPanel } = require('../../extension/shared/dom-adapter.js');
const { createDocument } = require('../helpers/display-dom.cjs');
// Scenario: ranged values use only the new schema bars and actions. Purpose: old attack-profile/raw-source structures are replaced without inventing hidden curves or combos.
test('UnitT10_遠程武器投影屬性條與動作', () => {
  const data = displayFixture(), weapon = data.weapons.items[0];
  weapon.values.actions = [{slot:'primary',id:'hipfire',type:'hipfire',name:{en:'Hipfire',zh:'腰射'}}, {slot:'secondary',id:'ads',type:'ads',name:{en:'ADS',zh:'機瞄'}}];
  weapon.values.bars = [{id:'ammunition',name:{en:'Ammunition',zh:'彈藥'},stats:[{key:'reserve',name:{en:'Reserve',zh:'備彈'},min:480,max:960}]}];
  const family = buildWeaponFamilyViewModels(snapshot(data))[0], mark = family.marks[0];
  assert.deepEqual(mark.actions.map(row=>row.type),['hipfire','ads']); assert.equal(mark.curves,null); assert.equal(mark.attackCombos,null);
  const panel = makeWeaponPanel(createDocument(),family,mark);
  assert.match(panel.textContent,/備彈：480～960/); assert.match(panel.textContent,/腰射/); assert.match(panel.textContent,/機瞄/);
  assert.doesNotMatch(panel.textContent,/屬性曲線|攻擊組合|來源曲線節點/);
});
