const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../helpers/source-data-fixture.cjs');
const { fixture11 } = require('../helpers/source-data-fixture-11.cjs');
const examples = require('../fixtures/damage-profiles-examples.json');
const contract = require('../../extension/shared/source-data-contract.js');
const validate = data => { const { current, ...documents } = data; return contract.validateSnapshot({ current, documents }); };
const make = (index = 0) => { const data = fixture11(); data.weapons.items[0].values.damageProfiles = structuredClone(examples[index].values.damageProfiles); return data; };

// Scenario: upstream melee and ranged examples and permitted boundary values are loaded. Purpose: accept the exact optional contract without imposing references or extra constraints.
test('UnitT10_接受契約範例與合法邊界', () => {
  for (const index of [0, 1]) for (const version of ['1.1.0', '1.2.0']) {
    const data = make(index); for (const doc of Object.values(data)) doc.schemaVersion = version;
    assert.deepEqual(validate(data).documents.weapons.items[0].values.damageProfiles, examples[index].values.damageProfiles);
  }
  const data = make(); const p = data.weapons.items[0].values.damageProfiles[0];
  p.distributions = [{ target: null, range: 'near', attack: { kind: 'unknown', min: null, max: null, unknown: 'NOT_VERIFIED', source: p.source }, impact: { kind: 'fixed', min: 9, max: 2, unknown: null, source: p.source } }];
  p.bindings = ['action','shotshell','flamerGas','explosion'].map(kind => ({ action: 'x', kind, template: '', source: p.source }));
  p.bindings.push({ action: 'x', kind: 'projectile', template: 'x', powerLevel: { value: null, unknown: 'DYNAMIC_VALUE', source: p.source }, source: p.source });
  assert.doesNotThrow(() => validate(data));
  const empty = make(); empty.weapons.items[0].values.damageProfiles = [{ id: 'x', distributions: [], bindings: [], unknown: null, source: p.source }]; assert.doesNotThrow(() => validate(empty));
  for (const data of [fixture(), fixture11()]) assert.doesNotThrow(() => validate(data));
});

// Scenario: mutate each nested contract constraint in a valid example. Purpose: reject malformed profiles without accepting extra fields.
test('UnitT20_拒絕不符合巢狀契約的資料', () => {
  const mutations = [
    p => delete p.id, p => p.id = '', p => p.extra = 1, p => delete p.distributions, p => p.distributions = {}, p => delete p.bindings, p => p.bindings = {}, p => delete p.unknown, p => p.unknown = 'bad', p => delete p.source, p => p.source.path = '', p => p.source.line = 0, p => p.source.extra = 1,
    p => p.distributions[0].target = 0, p => p.distributions[0].target = 1.5, p => p.distributions[0].target = 'other', p => p.distributions[0].range = 'middle', p => delete p.distributions[0].range, p => p.distributions[0].extra = 1,
    ...['attack','impact'].flatMap(k => [p => delete p.distributions[0][k], p => p.distributions[0][k].kind = 'bad', p => p.distributions[0][k].min = null, p => p.distributions[0][k].max = null, p => p.distributions[0][k].unknown = 'NOT_VERIFIED', p => { p.distributions[0][k].kind = 'unknown'; p.distributions[0][k].min = null; p.distributions[0][k].max = null; p.distributions[0][k].unknown = null; }, p => { p.distributions[0][k].kind = 'unknown'; p.distributions[0][k].unknown = 'DYNAMIC_VALUE'; }, p => delete p.distributions[0][k].source, p => p.distributions[0][k].extra = 1]),
    p => p.bindings[0].action = '', p => p.bindings[0].kind = 'bad', p => delete p.bindings[0].template, p => p.bindings[0].template = 4, p => delete p.bindings[0].source, p => p.bindings[0].extra = 1, p => p.bindings[0].powerLevel = { value: 1, unknown: null, source: p.source },
    p => { p.bindings[0].kind = 'hitScan'; p.bindings[0].powerLevel = { value: 1, unknown: null, source: p.source }; }, p => { p.bindings[0].kind = 'hitScan'; p.bindings[0].template = 'x'; },
    p => { p.bindings[0] = { action: 'x', kind: 'projectile', template: 'x', source: p.source, powerLevel: { value: null, unknown: null, source: p.source } }; },
    p => { p.bindings[0] = { action: 'x', kind: 'projectile', template: 'x', source: p.source, powerLevel: { value: 1, unknown: 'DYNAMIC_VALUE', source: p.source } }; },
    p => { p.bindings[0] = { action: 'x', kind: 'projectile', template: 'x', source: p.source, powerLevel: { value: 1, unknown: null } }; }
  ];
  for (const [i, mutate] of mutations.entries()) { const data = make(); mutate(data.weapons.items[0].values.damageProfiles[0]); assert.throws(() => validate(data), { code: 'SOURCE_DATA_INVALID' }, `mutation ${i}`); }
  const duplicate = make(); duplicate.weapons.items[0].values.damageProfiles.push(structuredClone(duplicate.weapons.items[0].values.damageProfiles[0])); assert.throws(() => validate(duplicate), { code: 'SOURCE_DATA_INVALID' });
});

// Scenario: the field appears outside modern weapon values. Purpose: keep category and version boundaries strict.
test('UnitT30_拒絕舊版與非武器欄位', () => {
  const old = fixture(); old.weapons.items[0].values.damageProfiles = []; assert.throws(() => validate(old), { code: 'SOURCE_DATA_INVALID' });
  for (const category of ['skills','blessings','terms']) { const data = fixture11(); data[category].items[0].values.damageProfiles = []; assert.throws(() => validate(data), { code: 'SOURCE_DATA_INVALID' }); }
});
