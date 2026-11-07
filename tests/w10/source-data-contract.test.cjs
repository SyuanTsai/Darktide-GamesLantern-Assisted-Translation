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

// Scenario: every category in supported schema versions carries previous-version provenance. Purpose: accept valid metadata and reject malformed whole snapshots.
test('UnitT15_驗證各分類沿用來源', () => {
  for (const version of ['1.0.0', '1.1.0', '1.2.0']) {
    for (const category of ['skills', 'weapons', 'blessings', 'terms']) {
      const make = () => {
        const data = version === '1.0.0' ? fixture() : Object.fromEntries(['current', 'skills', 'weapons', 'blessings', 'terms'].map(name => [name, require('node:fs').readFileSync(require('node:path').join(__dirname, '../fixtures/source-data-v1-1', name + '.json'), 'utf8')]).map(([name, json]) => [name, JSON.parse(json)]));
        for (const doc of Object.values(data)) doc.schemaVersion = version;
        data[category].items[0].retainedFrom = { gameVersion: '9.8.7', sourceCommit: 'a'.repeat(40), textBatch: 'previous-batch' };
        return data;
      };
      const validate = data => { const { current, ...documents } = data; return contract.validateSnapshot({ current, documents }); };
      assert.doesNotThrow(() => validate(make()));
      for (const mutate of [x => delete x.sourceCommit, x => x.extra = true, x => x.gameVersion = '1', x => x.sourceCommit = 'bad', x => x.textBatch = 'bad/batch']) {
        const data = make(); mutate(data[category].items[0].retainedFrom);
        assert.throws(() => validate(data), { code: 'SOURCE_DATA_INVALID' });
      }
    }
  }
});

// Scenario: effect provenance is optional and restricted by schema and category.
test('UnitT16_驗證效果來源的版本分類及列舉', () => {
  const { fixture11 } = require('../helpers/source-data-fixture-11.cjs');
  const validate = data => { const { current, ...documents } = data; return contract.validateSnapshot({ current, documents }); };
  for (const version of ['1.1.0', '1.2.0']) for (const category of ['skills', 'blessings']) for (const origin of ['official', 'unofficial-translation']) {
    const data = fixture11(); for (const doc of Object.values(data)) doc.schemaVersion = version;
    data[category].items[0].explanation.effectOrigin = origin;
    assert.equal(validate(data).documents[category].items[0].explanation.effectOrigin, origin);
  }
  for (const make of [fixture, fixture11]) assert.doesNotThrow(() => validate(make()));
  for (const category of ['skills', 'blessings']) for (const origin of ['other', '', null, 1, true, {}]) {
    const data = fixture11(); data[category].items[0].explanation.effectOrigin = origin;
    assert.throws(() => validate(data), { code: 'SOURCE_DATA_INVALID' });
  }
  for (const category of ['weapons', 'terms']) {
    const data = fixture11(); data[category].items[0].explanation.effectOrigin = 'official';
    assert.throws(() => validate(data), { code: 'SOURCE_DATA_INVALID' });
  }
  for (const category of ['skills', 'blessings', 'weapons', 'terms']) {
    const data = fixture(); data[category].items[0].explanation.effectOrigin = 'official';
    assert.throws(() => validate(data), { code: 'SOURCE_DATA_INVALID' });
  }
});
