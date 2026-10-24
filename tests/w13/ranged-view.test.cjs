const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { buildWeaponFamilyViewModels } = require('../../extension/shared/presentation.js');
const { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot } = require('../w10/browser-runtime.cjs');

function makeRangedSnapshot() {
  const gameReleaseId = 'fixture:w13-ranged-view';
  const weaponRef = { gameReleaseId, kind: 'weapon', recordId: 'fixture:weapon:lasgun-p1-m1' };
  const hipRef = { gameReleaseId, kind: 'attack-profile', recordId: 'fixture:attack:hipfire' };
  const adsRef = { gameReleaseId, kind: 'attack-profile', recordId: 'fixture:attack:ads' };
  const definitionRef = { gameReleaseId, kind: 'stat-definition', recordId: 'fixture:stat:ammunition-clips' };
  const reserveDefinitionRef = { gameReleaseId, kind: 'stat-definition', recordId: 'fixture:stat:ammunition-reserve' };
  const curveRef = { gameReleaseId, kind: 'stat-curve', recordId: 'fixture:curve:ammunition-clips' };
  const reserveCurveRef = { gameReleaseId, kind: 'stat-curve', recordId: 'fixture:curve:ammunition-reserve' };
  const officialBase = {
    entityRef: weaponRef, origin: 'game-localization', resource: 'items', key: 'fixture.weapon_name',
    sourceHash: 'aabbccdd', occurrence: 1, sourceTextSha256: 'a'.repeat(64),
    segments: [{ segmentId: 'segment-1', kind: 'text', text: 'Infantry Lasgun', sha256: 'a'.repeat(64) }],
    params: [], resolvedTextSha256: 'a'.repeat(64),
  };
  const english = { ...officialBase, officialSourceId: 'fixture:official:en', sourceLocale: 'en', sourceText: 'Infantry Lasgun', resolvedText: 'Infantry Lasgun' };
  const chinese = { ...officialBase, officialSourceId: 'fixture:official:zh', sourceLocale: 'zh-TW', sourceText: '步兵鐳射槍', resolvedText: '步兵鐳射槍' };
  const sourceRows = [
    ['"semi_auto"', 'weapon_template.displayed_attacks.primary.fire_mode'],
    ['"hipfire"', 'weapon_template.displayed_attacks.primary.type'],
    ['"ads"', 'weapon_template.displayed_attacks.secondary.type'],
    ['"flashlight"', 'weapon_template.displayed_attacks.special.type'],
    ['3', 'weapon_template.actions.action_shoot_hip.ammunition_usage'],
    ['true', 'weapon_template.actions.action_shoot_hip.allow_shots_with_less_than_required_ammo'],
    ['0.5', 'weapon_template.actions.action_shoot_hip.total_time'],
    ['0.275', 'weapon_template.actions.action_shoot_hip.allowed_chain_actions.shoot_pressed.chain_time'],
    ['3', 'weapon_template.actions.action_shoot_zoomed.ammunition_usage'],
    ['true', 'weapon_template.actions.action_shoot_zoomed.allow_shots_with_less_than_required_ammo'],
    ['0.4', 'weapon_template.actions.action_shoot_zoomed.total_time'],
    ['0.275', 'weapon_template.actions.action_shoot_zoomed.allowed_chain_actions.zoom_shoot.chain_time'],
    ['0', 'weapon_template.actions.action_toggle_flashlight.activation_time'],
    ['100', 'hitscan_templates.fixture_alias_beam.range'],
    ['777', 'hitscan_templates.fixture_alias_beam.extra.range'],
    ['"<img src=x onerror=alert(1)>"', 'weapon_template.actions.action_shoot_hip.unmapped_source_value'],
  ].map(([rawValue, fieldPath]) => ({ rawValue, sourceLocator: { fieldPath } }));
  const records = [
    { ...weaponRef, reviewState: 'pending', dataCoverage: { status: 'partial', missing: [{ field: '/payload/actionProfileResolution', reasonCode: 'NOT_IMPORTED' }] }, payload: {
      familyId: 'lasgun_p1', markId: 'lasgun_p1_m1', templateKey: 'lasgun_p1_m1',
      statRefs: [definitionRef, reserveDefinitionRef],
      attackProfileRefs: [hipRef, adsRef], sourceRows,
      statTables: [
        { statKey: 'ammunition_clips', tableKey: 'weapon_ammo_templates.fixture.ammunition_clips', properties: [{
          property: 'ammunition_clips', unit: 'instance-count', orderedValues: [
            { key: 'lerp_basic', rawValue: '80', decimal: '80' }, { key: 'lerp_perfect', rawValue: '120', decimal: '120' },
          ],
        }] },
        { statKey: 'ammunition_reserve', tableKey: 'weapon_ammo_templates.fixture.ammunition_reserve', properties: [{
          property: 'ammunition_reserve', unit: 'instance-count', orderedValues: [
            { key: 'lerp_basic', rawValue: '480', decimal: '480' }, { key: 'lerp_perfect', rawValue: '960', decimal: '960' },
          ],
        }] },
        { statKey: 'dodge', tableKey: 'weapon_template.fixture.dodge', properties: [{
          property: 'dodge', unit: 'ratio', orderedValues: [{ key: 'value', rawValue: '1.15', decimal: '1.15' }],
        }] },
      ],
    } },
    { ...definitionRef, payload: {
      quantity: 'ammunition_clips', curveRef: { recordId: curveRef.recordId, gameReleaseId },
      theoreticalInputRange: { status: 'known', min: '0', max: '1', unit: 'ratio' },
      obtainableInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' },
    } },
    { ...reserveDefinitionRef, payload: {
      quantity: 'ammunition_reserve', curveRef: { recordId: reserveCurveRef.recordId, gameReleaseId },
      theoreticalInputRange: { status: 'known', min: '0', max: '1', unit: 'ratio' },
      obtainableInputRange: { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' },
    } },
    { ...curveRef, payload: { knots: [
      { input: '0', output: '80', sourceOrdinal: 1 }, { input: '1', output: '120', sourceOrdinal: 2 },
    ], inputUnit: 'ratio', outputUnit: 'instance-count' } },
    { ...reserveCurveRef, payload: { knots: [
      { input: '0', output: '480', sourceOrdinal: 1 }, { input: '1', output: '960', sourceOrdinal: 2 },
    ], inputUnit: 'ratio', outputUnit: 'instance-count' } },
    { ...hipRef, payload: { weaponRef, templateKey: 'lasgun_p1_m1', action: 'action_shoot_hip', mode: 'hipfire' } },
    { ...adsRef, payload: { weaponRef, templateKey: 'lasgun_p1_m1', action: 'action_shoot_zoomed', mode: 'ads' } },
  ];
  const empty = kind => ({ kind, gameReleaseId, source: { records: [] }, web: { presentations: [], officialInputs: { sources: [] }, termLocalizations: [] } });
  const weapons = empty('weapons');
  weapons.source.records = records;
  weapons.web.presentations.push({
    entityRef: weaponRef, locale: 'zh-TW', name: chinese.resolvedText, nameOfficialSourceId: chinese.officialSourceId,
    nameOfficialLocaleRefs: [
      { officialSourceId: english.officialSourceId, sourceLocale: 'en' },
      { officialSourceId: chinese.officialSourceId, sourceLocale: 'zh-TW' },
    ],
    official: { officialSourceId: chinese.officialSourceId },
    weaponView: { sourceWeaponRef: weaponRef, markLabel: '來源型號 lasgun_p1_m1', statSections: [], attackProfileRefs: [hipRef, adsRef] },
    detailSections: [], errata: [],
  });
  weapons.web.officialInputs.sources.push(english, chinese);
  return {
    identity: { gameReleaseId },
    domains: new Map([
      ['skills', empty('skills')], ['blessings', empty('blessings')], ['weapons', weapons], ['terms', empty('terms')],
    ]),
  };
}

// Scenario: A pending ranged weapon keeps ammo definitions outside statBindings and exposes direct Source rows.
// Purpose: Preserve definition/curve data, known raw rows, and NOT_IMPORTED coverage through the Extension presentation layer.
test('UnitT10_W13RangedViewResolvesAmmoDefinitionsAndSourceRows', () => {
  const family = buildWeaponFamilyViewModels(makeRangedSnapshot()).find(row => row.familyId === 'lasgun_p1');
  assert.ok(family);
  const [mark] = family.marks;
  assert.equal(mark.markId, 'lasgun_p1_m1');
  assert.ok(mark.source.sourceRows.some(row => row.rawValue === '3'));
  assert.equal(mark.source.statDefinitions.length, 2);
  assert.deepEqual(mark.source.statDefinitions[0].definition.payload.obtainableInputRange,
    { status: 'unknown', reasonCode: 'NOT_EXPOSED_BY_SOURCE' });
  assert.deepEqual(mark.source.statDefinitions.map(item => item.curve.payload.knots.map(row => [row.input, row.output])), [
    [['0', '80'], ['1', '120']], [['0', '480'], ['1', '960']],
  ]);
  assert.equal(mark.source.dataCoverage.missing[0].reasonCode, 'NOT_IMPORTED');
  assert.deepEqual(mark.attackProfiles.map(row => row.payload.mode), ['hipfire', 'ads']);
});

// Scenario: A typed ranged stat reference is missing or points to a record of another kind.
// Purpose: Keep both statRefs and curveRef projection fail-closed in the Extension view-model.
test('UnitT11_W13RangedViewRejectsMissingOrWrongKindStatReferences', () => {
  for (const mutation of ['missing-statrefs', 'empty-statrefs', 'missing-stat-definition', 'missing-curve-ref', 'wrong-kind-curve']) {
    const snapshot = makeRangedSnapshot();
    const weapons = snapshot.domains.get('weapons');
    const weapon = weapons.source.records.find(row => row.kind === 'weapon');
    if (mutation === 'missing-statrefs') {
      delete weapon.payload.statRefs;
    } else if (mutation === 'empty-statrefs') {
      weapon.payload.statRefs = [];
    } else if (mutation === 'missing-stat-definition') {
      weapon.payload.statRefs[0].recordId = 'fixture:stat:missing';
    } else {
      const definition = weapons.source.records.find(row => row.kind === 'stat-definition');
      if (mutation === 'missing-curve-ref') delete definition.payload.curveRef;
      else definition.payload.curveRef = { recordId: weapon.recordId, gameReleaseId: weapon.gameReleaseId };
    }
    assert.deepEqual(buildWeaponFamilyViewModels(snapshot), [], mutation);
  }
});

// Scenario: A declared exact synthetic native-page identity is used only to exercise the extension renderer in Chromium.
// Purpose: Verify readable ranged facts, template-versus-obtainable ranges, text-only output, and keyboard behavior without claiming this fixture is a real Games Lantern page identity.
test('InterT10_W13RangedExtensionRendererDisplaysSourceFactsWithoutInterpretingRawText', {
  skip: process.env.SYP_W10_CHROMIUM_EXE ? false : 'Set SYP_W10_CHROMIUM_EXE to run the isolated Chromium renderer check.',
  timeout: 60000
}, async () => {
  const runtime = loadRuntime();
  const profileRoot = createPrivateProfileRoot();
  let context;
  try {
    context = await runtime.playwright.chromium.launchPersistentContext(profileRoot, {
      executablePath: runtime.executablePath, headless: true, args: ['--disable-background-networking', '--no-first-run']
    });
    const page = await context.newPage({ viewport: { width: 390, height: 844 } });
    const family = buildWeaponFamilyViewModels(makeRangedSnapshot()).find(row => row.familyId === 'lasgun_p1');
    assert.ok(family);
    const [mark] = family.marks;
    const title = mark.markLabel + ' ' + mark.nativeName;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = 'https://darktide.gameslantern.com/weapons/' + mark.familySlug + '/' + slug + '/';
    const escapedTitle = title.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const image = 'https://darktide.gameslantern.com/storage/sites/darktide/weapons/w13-fixture.png';
    const html = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"></head><body><main>'
      + '<div class="relative" id="header-region"><img alt="Header Image" src="' + image + '">'
      + '<div class="relative flex justify-center pb-4 w-full"><h1><span>' + escapedTitle + '</span><br><span>合成測試標籤</span></h1>'
      + '<div class="outline-title"><span>' + escapedTitle + '</span><br><span>合成測試標籤</span></div></div></div>'
      + '<div id="native-details">原始網站文字保留</div></main></body></html>';
    await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.route('https://darktide.gameslantern.com/storage/**', route => route.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    for (const file of ['view-model.js', 'presentation.js', 'dom-adapter.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', file) });
    }
    await page.addStyleTag({ path: path.resolve(__dirname, '../../extension/shared/display.css') });
    const stripInternal = row => { const copy = { ...row }; delete copy.validatedView; return copy; };
    const familyInput = { ...family, marks: family.marks.map(stripInternal) };
    const markInput = stripInternal(mark);
    const rendered = await page.evaluate(input => {
      const adapter = W11DomAdapter.createDomAdapter({ document });
      const slots = adapter.collectWeaponSlots(document);
      if (slots.length !== 1) return { slotCount: slots.length };
      const slot = slots[0];
      const record = adapter.applyWeapon(slot, input.family, input.mark, input.family.marks);
      const panel = document.querySelector('[data-w11-owned="weapon"]');
      const details = panel?.querySelector('details');
      return {
        slotCount: slots.length,
        written: !!record,
        title: panel?.querySelector('[data-w11-weapon-view] h3')?.textContent,
        detailsText: details?.innerText,
        detailSummary: details?.querySelector('summary')?.textContent,
        panelImages: panel?.querySelectorAll('img').length,
        nativeStillPresent: !!document.querySelector('#native-details'),
        panelMarkupHasRawScript: /<script|onerror=/iu.test(panel?.innerHTML || ''),
      };
    }, { family: familyInput, mark: markInput });
    assert.equal(rendered.slotCount, 1, 'the fixture page presents one exact synthetic identity snapshot');
    assert.equal(rendered.written, true);
    assert.equal(rendered.title, '步兵鐳射槍');
    assert.equal(rendered.detailSummary, '其他來源數值、素質語意與射擊條件');
    assert.equal(rendered.nativeStillPresent, true, 'native page content stays intact');
    assert.equal(rendered.panelImages, 0);
    assert.equal(rendered.panelMarkupHasRawScript, false);
    const summary = page.locator('[data-w11-owned="weapon"] details > summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-w11-owned="weapon"] details').first().evaluate(element => element.open), true);
    const text = await page.locator('[data-w11-owned="weapon"] details').first().innerText();
    for (const phrase of [
      '腰射', '機瞄', '半自動', '每次射擊消耗：3 彈藥單位', '彈藥不足此動作需求時仍允許射擊：是',
      '特殊動作啟用時間：0 秒', '命中掃描範圍：100（來源未提供單位）', '動作總時長：0.5 秒', '動作銜接時間：0.275 秒',
      '80 彈藥單位', '120 彈藥單位', '480 彈藥單位', '960 彈藥單位', '來源未提供實際可取得範圍', '尚未匯入',
      '來源值：value 1.15',
    ]) assert.ok(text.includes(phrase), 'extension renderer includes: ' + phrase);
    assert.ok(!text.includes('命中掃描範圍：777'), 'a nested path cannot match the bounded hitscan template field');
    const scalarRow = await page.locator('[data-w11-owned="weapon"] .w11-extension-weapon-source li').evaluateAll(rows => rows
      .map(row => row.textContent).find(row => row.includes('dodge')));
    assert.ok(!scalarRow.includes('模板端點不代表實際可取得範圍'), 'a scalar source value is not mislabeled as an endpoint');
    assert.equal(text.includes('semi_auto'), false, 'known fire mode has a Chinese label');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      'the renderer fits a 390px viewport');

    const fixtureChainaxeUrl = 'https://darktide.gameslantern.com/weapons/fixture-chainaxe/mk-iv-assault-chainaxe/';
    const fixtureChainaxeTitle = 'Mk IV Assault Chainaxe';
    const fixtureChainaxeHtml = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"></head><body><main>'
      + '<div class="relative" id="header-region"><img alt="Header Image" src="https://darktide.gameslantern.com/storage/sites/darktide/weapons/fixture-chainaxe.png">'
      + '<div class="relative flex justify-center pb-4 w-full"><h1><span>' + fixtureChainaxeTitle + '</span><br><span>合成測試標籤</span></h1>'
      + '<div class="outline-title"><span>' + fixtureChainaxeTitle + '</span><br><span>合成測試標籤</span></div></div></div>'
      + '<div id="native-details">原始網站文字保留</div></main></body></html>';
    await page.route(fixtureChainaxeUrl, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureChainaxeHtml }));
    await page.goto(fixtureChainaxeUrl, { waitUntil: 'domcontentloaded' });
    for (const file of ['view-model.js', 'presentation.js', 'dom-adapter.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', file) });
    }
    await page.addStyleTag({ path: path.resolve(__dirname, '../../extension/shared/display.css') });
    const meleeMark = {
      familySlug: 'fixture-chainaxe', markId: 'chainaxe_p1_m1', markLabel: 'Mk IV',
      nativeName: 'Assault Chainaxe', nativeImagePathPrefix: '/storage/sites/darktide/weapons/',
      name: '突擊鏈斧', official: null, errata: [], sections: [], terms: [], statSections: [], attackProfiles: [],
      source: { dataCoverage: { missing: [] }, statTables: [], statDefinitions: [], statTableSemantics: [], displayedAttacks: [], sourceRows: [] },
    };
    const meleeFamily = { familySlug: 'fixture-chainaxe', translatedName: '突擊鏈斧', marks: [meleeMark] };
    const meleeSummary = await page.evaluate(input => {
      const adapter = W11DomAdapter.createDomAdapter({ document });
      const slots = adapter.collectWeaponSlots(document);
      if (slots.length !== 1 || !adapter.applyWeapon(slots[0], input.family, input.mark, input.family.marks)) return null;
      return document.querySelector('[data-w11-owned="weapon"] details > summary')?.textContent;
    }, { family: meleeFamily, mark: meleeMark });
    assert.equal(meleeSummary, '其他來源數值、素質語意與連段條件', 'a synthetic melee mark keeps its original detail summary wording');
  } finally {
    await context?.close();
    removePrivateProfileRoot(profileRoot);
  }
});
