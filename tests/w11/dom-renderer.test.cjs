const test = require('node:test'); const assert = require('node:assert/strict');
const { snapshot } = require('../helpers/source-data-display.cjs');
const { createDocument, descendants } = require('../helpers/display-dom.cjs');
const p = require('../../extension/shared/presentation.js'); const a = require('../../extension/shared/dom-adapter.js');
// Scenario: a skill anchor matches, misses, exceeds its occurrence, or its translation is unavailable. Purpose: show each correction once and remove marks on restore.
test('UnitT05_勘誤標示與獨立區塊及還原', () => {
 const {displayFixture}=require('../helpers/source-data-display.cjs');
 for (const mode of ['match','missing','range','null']) {
  const data=displayFixture(), item=data.skills.items[0];
  item.errata=[{locale:'zh',official:'中文',corrected:'修正',valueRef:'/x',anchor:{field:'official',locale:'zh',text:mode==='missing'?'不存在':'中文',occurrence:mode==='range'?2:1}}];
  if(mode==='null') item.official.zh=null;
  const model=p.buildSkillViewModels(snapshot(data))[0], document=createDocument(), dom=a.createDomAdapter({document});
  const parent=document.createElement('main'), anchor=document.createElement('div'), nameElement=document.createElement('div'), descriptionElement=document.createElement('div');
  nameElement.textContent=model.nativeName;
  for(const [i,paragraph] of model.nativeDescription.split('\n\n').entries()) { if(i) descriptionElement.append(document.createElement('br'),document.createElement('br')); descriptionElement.append(document.createTextNode(paragraph)); }
  anchor.append(nameElement,descriptionElement); parent.append(anchor);
  const record=dom.applySkill({anchor,nameElement,descriptionElement,detail:true,identityKey:'x'},model);
  assert.equal(descendants(parent,n=>n.tagName==='MARK').length,mode==='match'?1:0);
  assert.equal(record.details.textContent.includes('中文 → 修正'),mode!=='match');
  assert.equal(dom.observe({nameElement,descriptionElement,detail:true},record).description,model.nativeDescription);
  dom.restore(record); assert.equal(descendants(parent,n=>n.tagName==='MARK').length,0); assert.equal(descriptionElement.textContent,model.nativeDescription.replaceAll('\n',''));
 }
});
// Scenario: schema 1.0.0 has no curve/combo data, then a future projection is injected. Purpose: never fabricate curves, preserve future node rendering and literal text.
test('UnitT10_武器區塊null隱藏與非空投影渲染', () => {
  const document = createDocument(), [family] = p.buildWeaponFamilyViewModels(snapshot()), mark = family.marks[0];
  const panel = a.makeWeaponPanel(document, family, mark);
  assert.doesNotMatch(panel.textContent, /屬性曲線|攻擊組合|來源曲線節點/);
  assert.match(panel.textContent, /傷害：10～20/); assert.match(panel.textContent, /斬擊/); assert.match(panel.textContent, /範例祝福/);
  const future = { ...mark, curves: [{ label: '<curve>', inputUnit: 'ratio', outputUnit: 'count', knots: [{ input: 0, output: 12 }] }], attackCombos: [{ label: '輕擊', steps: [{ label: '<step>', kind: 'light' }] }] };
  const rendered = a.makeWeaponPanel(document, { ...family, marks: [future] }, future);
  assert.match(rendered.textContent, /屬性曲線<curve>來源曲線節點：輸入 0 比例，輸出 12 次/);
  assert.match(rendered.textContent, /攻擊組合輕擊：<step>（light）/);
  assert.equal(descendants(rendered, n => n.tagName === 'CURVE' || n.tagName === 'STEP').length, 0);
});
// Scenario: a blessing is selected in the reader. Purpose: original official text, ordered details, independent zh errata, tier matrix and exact weapons all render.
test('UnitT20_祝福原文五節勘誤與完整階級表', () => {
  const document = createDocument(), models = p.buildBlessingViewModels(snapshot());
  const reader = a.createDomAdapter({ document }).createBlessingReader(models);
  const select = descendants(reader.element, n => n.tagName === 'SELECT')[0]; select.value = '0'; select.fire('change');
  assert.match(reader.element.textContent, /祝福原文（勘誤：修正）。/); assert.equal(descendants(reader.element,n=>n.tagName==='MARK').length,1); assert.match(reader.element.textContent, /等級 × 數值/);
  for (const tier of [1, 2, 3, 4]) assert.match(reader.element.textContent, new RegExp('LV' + tier));
  assert.match(reader.element.textContent, /原始碼未公開/); assert.match(reader.element.textContent, /適用武器：範例劍／Mk I、範例劍／Mk II/);
  const detail = a.makeDetails(document, p.buildSkillViewModels(snapshot())[0]);
  assert.match(detail.textContent, /勘誤原說明 → 修正說明/); assert.doesNotMatch(detail.textContent, /old|new|計算|\/values\//);
  assert.ok(detail.textContent.indexOf('效果內容') < detail.textContent.indexOf('條件內容'));
  reader.dispose();
});
// Scenario: matching skills have a null name, null description or unsafe translated text. Purpose: each original field survives independently and restore uses recorded original nodes.
test('UnitT30_技能部分覆寫與還原', () => {
  const document = createDocument(), dom = a.createDomAdapter({ document });
  for (const model of p.buildSkillViewModels(snapshot())) {
    const parent = document.createElement('main'), anchor = document.createElement('div'), nameElement = document.createElement('div'), descriptionElement = document.createElement('div');
    nameElement.textContent = model.nativeName; for (const [index, paragraph] of model.nativeDescription.split('\n\n').entries()) { if (index) descriptionElement.append(document.createElement('br'), document.createElement('br')); descriptionElement.append(document.createTextNode(paragraph)); } anchor.append(nameElement, descriptionElement); parent.append(anchor);
    const slot = { anchor, nameElement, descriptionElement, detail: true, identityKey: 'fixture' };
    const record = dom.applySkill(slot, model); assert.ok(record);
    assert.equal(nameElement.textContent, model.translatedName || model.nativeName); assert.equal(dom.observe(slot, record).description, model.nativeDescription); assert.equal(descriptionElement.textContent, (model.translatedDescription || model.nativeDescription).replaceAll('\n', ''));
    dom.restore(record); assert.equal(nameElement.textContent, model.nativeName); assert.equal(dom.observe(slot).description, model.nativeDescription);
    const unmatched = { ...model, nativeDescription: 'not observed' }; assert.equal(dom.applySkill(slot, unmatched), null);
  }
});
// Scenario: a validated 1.1 weapon has curves and combos, then marks them unknown. Purpose: render known values and unavailable states using text nodes.
test('UnitT40_一點一曲線與連段渲染且unknown顯示無法取得', () => {
 const {fixture11}=require('../helpers/source-data-fixture-11.cjs'); const contract=require('../../extension/shared/source-data-contract.js');
 const x=fixture11(); x.weapons.items[0].values.attackCombos[0].steps[0].name.zh='斬擊'; const {current,...documents}=x; const verified=contract.validateSnapshot({current,documents});
 const [family]=p.buildWeaponFamilyViewModels(verified), mark=family.marks[0]; const document=createDocument();
 const panel=a.makeWeaponPanel(document,family,mark); assert.match(panel.textContent,/屬性曲線/); assert.match(panel.textContent,/來源曲線節點：輸入 0/); assert.match(panel.textContent,/攻擊組合輕擊連段：斬擊/);
 const y=fixture11(); for(const w of y.weapons.items) { for(const c of w.values.curves) {c.interpolation='unknown'; c.unknown='DYNAMIC_VALUE'; for(const k of c.knots) k.output=null;} for(const c of w.values.attackCombos) c.unknown='DYNAMIC_VALUE'; }
 const {current:cur,...docs}=y; const [f]=p.buildWeaponFamilyViewModels(contract.validateSnapshot({current:cur,documents:docs})); const hidden=a.makeWeaponPanel(document,f,f.marks[0]); assert.match(hidden.textContent,/無法取得/); assert.doesNotMatch(hidden.textContent,/來源曲線節點|斬擊/);
});
// Scenario: valid array endpoints are empty and a known combo has no steps. Purpose: accept the snapshot while hiding sections with no displayable data.
test('UnitT50_空曲線輸出與空連段不渲染', () => {
 const {fixture11}=require('../helpers/source-data-fixture-11.cjs'); const contract=require('../../extension/shared/source-data-contract.js');
 const x=fixture11(); for(const w of x.weapons.items) { for(const c of w.values.curves) for(const k of c.knots) k.output=[]; for(const c of w.values.attackCombos) {c.steps=[]; c.loopsTo=null;} }
 const {current,...documents}=x; const verified=contract.validateSnapshot({current,documents});
 const [family]=p.buildWeaponFamilyViewModels(verified), mark=family.marks[0]; const panel=a.makeWeaponPanel(createDocument(),family,mark);
 assert.equal(mark.curves,null); assert.equal(mark.attackCombos,null); assert.doesNotMatch(panel.textContent,/屬性曲線|攻擊組合/);
});
// Scenario: a known combo has no attack steps. Purpose: hide its section when no combo remains.
test('UnitT60_空步驟連段不渲染', () => {
 const {fixture11}=require('../helpers/source-data-fixture-11.cjs'); const contract=require('../../extension/shared/source-data-contract.js');
 const x=fixture11(); for(const w of x.weapons.items) for(const c of w.values.attackCombos) {c.steps=[]; c.loopsTo=null; c.unknown='DYNAMIC_VALUE';}
 const {current,...documents}=x; const [family]=p.buildWeaponFamilyViewModels(contract.validateSnapshot({current,documents}));
 assert.equal(family.marks[0].attackCombos,null); assert.doesNotMatch(a.makeWeaponPanel(createDocument(),family,family.marks[0]).textContent,/攻擊組合/);
});

// Scenario: tier values have known, unknown, empty units and an undisclosed value. Purpose: display website labels and preserve fallback formatting.
test('UnitT70_參數單位顯示網站標籤與未知代碼', () => {
  const table = a.makeTierTable(createDocument(), [{ tier: 1, params: [
    { key: 'ratio', value: '0.5', unit: 'ratio' }, { key: 'percent', value: '20', unit: 'percent' },
    { key: 'other', value: '3', unit: 'custom-unit' }, { key: 'none', value: '4', unit: '' },
    { key: 'hidden', value: '原始碼未公開', unit: 'percent' }
  ] }]);
  const cells = descendants(table, n => n.tagName === 'TD').map(n => n.textContent);
  assert.deepEqual(cells, ['0.5 比例', '20 %', '3 custom-unit', '4', '原始碼未公開']);
});
