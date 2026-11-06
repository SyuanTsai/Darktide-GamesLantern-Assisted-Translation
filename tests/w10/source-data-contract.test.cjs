const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../helpers/source-data-fixture.cjs');
const contract = require('../../extension/shared/source-data-contract.js');

// Scenario: optional anchors are supplied in a 1.x snapshot. Purpose: enforce the upstream anchor contract and safety policy.
test('UnitT05_驗證勘誤定位欄位', () => {
  for (const anchor of [undefined, { field: 'official', locale: 'zh', text: '文字', occurrence: 1 }]) {
    const { current, ...documents } = fixture();
    documents.skills.items[0].errata = [{ locale: 'zh', official: '文字', corrected: '修正', valueRef: '/x', ...(anchor ? { anchor } : {}) }];
    assert.doesNotThrow(() => contract.validateSnapshot({ current, documents }));
  }
  for (const change of [{extra: 1}, {field: 'bad'}, {locale: 'ja'}, {locale: 'en'}, {text: ''}, {occurrence: 0}, {occurrence: 1.5}, {text: '<script>'}]) {
    const { current, ...documents } = fixture();
    documents.skills.items[0].errata = [{ locale: 'zh', official: '文字', corrected: '修正', valueRef: '/x', anchor: { field: 'official', locale: 'zh', text: '文字', occurrence: 1, ...change } }];
    assert.throws(() => contract.validateSnapshot({ current, documents }), { code: 'SOURCE_DATA_INVALID' });
  }
});

// Scenario: validate the upstream examples with supported version lengths.
// Purpose: preserve the source-data contract without a hard-coded game version.
test('UnitT10_接受完整快照與不同版本長度', () => {
  for (const version of ['1.13.4', '1.14', '1.13.4.1']) {
    const { current, ...documents } = fixture(version);
    assert.equal(contract.validateSnapshot({ current, documents }).identity.gameVersion, version);
  }
});
// Scenario: a category identity differs from the current pointer.
// Purpose: prevent a mixed snapshot from being adopted.
test('UnitT20_拒絕跨檔識別不一致', () => {
  const { current, ...documents } = fixture('1.14');
  documents.skills.textBatch = 'different';
  assert.throws(() => contract.validateSnapshot({ current, documents }), { code: 'SOURCE_DATA_INVALID' });
});
// Scenario: schema fields, conditional origins and nested structures are mutated.
// Purpose: enforce every upstream constraint family and reject unsafe strings/keys.
test('UnitT30_拒絕schema與安全規則違規', () => {
  const mutations = [
    x => x.current.extra = true, x => delete x.current.sourceCommit,
    x => x.current.gameVersion = '1', x => x.current.sourceCommit = 'abc', x => x.current.textBatch = 'a/b',
    x => x.current.path = 'data/else', x => x.current.versions = [], x => x.current.versions.push(x.current.gameVersion),
    x => x.skills.extra = true, x => delete x.skills.items[0].official,
    x => x.skills.items.push(structuredClone(x.skills.items[0])), x => x.skills.items[0].id = 'darktide:weapon:wrong',
    x => x.skills.items[0].key = '', x => x.skills.items[0].name.origin = 'unknown',
    x => { x.skills.items[0].name.origin = 'official'; x.skills.items[0].name.en = null; },
    x => { x.skills.items[0].name.origin = 'internal'; x.skills.items[0].name.zh = '不得存在'; },
    x => { x.skills.items[0].name.origin = 'glossary'; delete x.skills.items[0].source.glossary; },
    x => x.skills.items[0].aliases = { gameslantern: { ids: [] } },
    x => x.skills.items[0].aliases = { gameslantern: { ids: ['a','a'] } },
    x => x.skills.items[0].aliases = { gameslantern: { ids: ['a'], extra: 1 } },
    x => x.skills.items[0].errata = [{ locale: 'ja', official: '', corrected: '', valueRef: '/x' }],
    x => x.skills.items[0].errata = [{ locale: 'en', official: '', corrected: '', valueRef: '/x~2' }],
    x => delete x.skills.items[0].explanation.notes, x => x.skills.items[0].explanation.effect = '',
    x => x.skills.items[0].source.files = [], x => x.skills.items[0].source.files[0].line = 0,
    x => x.skills.items[0].source.files[0].extra = 1, x => x.skills.items[0].source.scriptVersion = 'script',
    x => x.skills.items[0].source.glossary = { repo: '', commit: 'a'.repeat(40), path: 'x', line: 1 },
    x => x.skills.items[0].source.text = { batch: 'x', keys: { invalid: 'x' } },
    x => x.skills.items[0].values.params = { bad: { value: null } },
    x => x.skills.items[0].values.params = { bad: { value: 1, unknown: 'NOT_VERIFIED' } },
    x => x.skills.items[0].values.params = { bad: { value: null, unknown: 'no' } },
    x => x.skills.items[0].values.params = { 'bad-key': { value: 1 } },
    x => x.skills.items[0].values.params = { bad: { value: {}, unit: '1' } },
    x => x.skills.items[0].values.params = { bad: { value: 1, unit: '1' } },
    x => x.skills.items[0].values.nodeType = 'no', x => x.skills.items[0].values.parents = ['darktide:weapon:wrong'],
    x => x.skills.items[0].values.maxPoints = 0,
    x => x.weapons.items[0].values.actions = [{ slot: '', id: '', type: '', name: { en: '', zh: '', extra: '' } }],
    x => x.weapons.items[0].values.bars = [{ id: '', name: { en: null, zh: null }, stats: [{ key: '', name: { en: null, zh: null }, min: '0', max: 1 }] }],
    x => x.weapons.items[0].values.weaponType = 'bad', x => x.weapons.items[0].values.family = '',
    x => x.blessings.items[0].values.tiers = [], x => x.blessings.items[0].values.tiers[0].tier = 5,
    x => x.blessings.items[0].values.weapons = [], x => x.terms.items[0].values.category = 'invalid',
    x => x.terms.items[0].values.refs = ['bad'],
    ...['<script>x</script>', 'javascript:alert(1)', 'https://x.invalid/run.js'].map(value => x => x.skills.items[0].explanation.notes = value),
    x => x.skills.items[0].values.params = { formula: { value: 'eval(1)' } },
    x => x.skills.items[0].source.files[0].path = '<iframe>',
    ...['__proto__','constructor','prototype','selector_code','script'].map(key => x => Object.defineProperty(x.skills.items[0], key, { value: 'x', enumerable: true }))
  ];
  for (const [index, mutate] of mutations.entries()) {
    const { current, ...documents } = (() => { const x = fixture(); mutate(x); return x; })();
    assert.throws(() => contract.validateSnapshot({ current, documents }), { code: 'SOURCE_DATA_INVALID' }, 'mutation ' + index);
  }
});
// Scenario: optional fields and nullable text meet the exact schema.
// Purpose: preserve null without imposing display or approval policy.
test('UnitT40_保存null與合法巢狀欄位並深凍結', () => {
  const { current, ...documents } = fixture(); const item = documents.skills.items[0];
  item.name.origin = 'internal'; item.name.en = 'internal'; item.name.zh = null; item.official = { en: null, zh: null };
  item.aliases = { gameslantern: { ids: [''], path: '' } };
  item.values.params = { unknown: { value: null, unknown: 'DYNAMIC_VALUE', unit: 'percent' }, list: { value: [1, 'x', false, null] } };
  item.errata = [{ locale: 'zh', official: '', corrected: '', valueRef: '/values/a~1b/~0' }];
  const snapshot = contract.validateSnapshot({ current, documents });
  assert.equal(snapshot.documents.skills.items[0].name.zh, null); assert.ok(Object.isFrozen(item.values.params));
});
