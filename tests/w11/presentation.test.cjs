'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const test = require('node:test');
const loader = require('../../extension/shared/loader.js');
const {
  buildBlessingViewModels,
  buildSkillViewModels,
  buildWeaponFamilyViewModels,
  matchesBlessingObservation,
  matchesSkillObservation,
  matchesWeaponObservation
} = require('../../extension/shared/presentation.js');

const APPROVED_MANIFEST_SHA256 = 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7';
const APPROVED_DATA_REVISION = '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62';
const APPROVED_DOMAIN_BYTES = 7_065_789;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readApprovedCandidate(t) {
  const candidateRoot = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  if (!candidateRoot) {
    t.skip('SYP_W10_APPROVED_PACKAGE_DIR is not set; fixed approved candidate was not supplied');
    return null;
  }
  const manifestBytes = fs.readFileSync(path.join(candidateRoot, 'manifest.json'));
  assert.equal(sha256(manifestBytes), APPROVED_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.dataRevision, APPROVED_DATA_REVISION);
  const files = new Map();
  let rawTotal = 0;
  for (const row of manifest.files) {
    assert.match(row.path, /^domains\/(skills|blessings|weapons|terms)\.json$/);
    const bytes = fs.readFileSync(path.join(candidateRoot, ...row.path.split('/')));
    assert.equal(bytes.byteLength, row.sizeBytes, row.path + ' raw size changed');
    assert.equal(sha256(bytes), row.sha256, row.path + ' raw digest changed');
    rawTotal += bytes.byteLength;
    files.set(row.path, bytes);
  }
  assert.equal(rawTotal, APPROVED_DOMAIN_BYTES);
  const skills = JSON.parse(files.get('domains/skills.json').toString('utf8'));
  const sourceRelease = skills.source.gameReleases.find((row) => row.gameReleaseId === manifest.gameReleaseId
    && row.gameVersion === manifest.gameVersion);
  assert.ok(sourceRelease);
  const identity = {
    gameVersion: manifest.gameVersion,
    gameReleaseId: manifest.gameReleaseId,
    snapshotId: sourceRelease.snapshot.snapshotId
  };
  const versionBytes = Buffer.from(JSON.stringify({
    schema_version: 2,
    data_revision: manifest.dataRevision,
    build_id: APPROVED_MANIFEST_SHA256,
    game_version: manifest.gameVersion,
    package_kind: 'published',
    game_releases: [{
      game_version: manifest.gameVersion,
      content_version: manifest.contentVersion,
      data_revision: manifest.dataRevision,
      manifest_path: '/data/' + manifest.dataRevision + '/manifest.json',
      manifest_sha256: APPROVED_MANIFEST_SHA256
    }]
  }), 'utf8');
  return loader.verifyStoredSnapshot({
    versionBytes,
    manifestBytes,
    files,
    identity,
    cryptoApi: webcrypto
  });
}

function snapshot({ releaseId = 'darktide:1.13.2', skillReleaseId = releaseId } = {}) {
  const entityRef = { gameReleaseId: skillReleaseId, kind: 'skill', recordId: 'fixture:skill' };
  const skillRef = { gameReleaseId: releaseId, kind: 'skill', recordId: 'fixture:skill' };
  return {
    identity: { gameVersion: '1.13.2', gameReleaseId: releaseId, snapshotId: 'synthetic-snapshot' },
    domains: new Map([['skills', {
      gameReleaseId: releaseId,
      kind: 'skills',
      source: { records: [{ ...skillRef, payload: { termRefs: [] } }] },
      gameReleaseId: releaseId,
      web: {
        presentations: [{
          entityRef,
          locale: 'zh-TW',
          name: '繁中技能名',
          nameOfficialSourceId: 'official:name-zh',
          nameOfficialLocaleRefs: [{ officialSourceId: 'official:name-en', sourceLocale: 'en' }],
          officialLocaleRefs: [{ officialSourceId: 'official:description-en', sourceLocale: 'en' }],
          official: { entityRef, officialSourceId: 'official:description-zh' },
          detailSections: [{ sectionId: 'effects', items: [{ text: '繁中效果。' }] }],
          errata: []
        }],
        officialInputs: { sources: [
          { entityRef, officialSourceId: 'official:name-en', sourceLocale: 'en', sourceText: 'Official Skill', resolvedText: 'Official Skill', segments: [] },
          { entityRef, officialSourceId: 'official:name-zh', sourceLocale: 'zh-TW', sourceText: '技能名', resolvedText: '技能名', segments: [] },
          { entityRef, officialSourceId: 'official:description-en', sourceLocale: 'en', sourceText: 'Official exact description.', resolvedText: 'Official exact description.', segments: [] },
          { entityRef, officialSourceId: 'official:description-zh', sourceLocale: 'zh-TW', sourceText: '官方來源文字。', resolvedText: '繁中技能描述。', params: [], segments: [] }
        ] }
      }
    }]])
  };
}

test('UnitT10_BuildsOnlyExactSameReleaseSkillPresentationFromVerifiedOfficialInputs', () => {
  // Scenario: Given a W08-style skill view, its same-release official English inputs, and a zh-TW presentation.
  // Purpose: Keep native slot matching tied to the verified release and preserve a localized consumer view.
  const models = buildSkillViewModels(snapshot());

  // Given the official source text is the native DOM match and the resolved text is the translation.
  const model = models[0];

  // Then the model carries exact source/translated values and matches only the known DOM evidence.
  assert.equal(models.length, 1);
  assert.equal(model.nativeName, 'Official Skill');
  assert.equal(model.nativeDescription, 'Official exact description.');
  assert.equal(model.translatedName, '繁中技能名');
  assert.equal(model.translatedDescription, '繁中技能描述。');
  assert.equal(matchesSkillObservation(model, {
    structure: 'gameslantern-ability-card-v1',
    name: 'Official Skill',
    description: 'Official exact\n description.'
  }), true);
  assert.equal(matchesSkillObservation(model, {
    structure: 'unknown-card', name: 'Official Skill', description: 'Official exact description.'
  }), false);
  assert.equal(buildSkillViewModels(snapshot({ skillReleaseId: 'darktide:1.13.1' })).length, 0);
});

test('UnitT20_UsesExactErrataAnchorsAndKeepsContextSpecificTypedTerms', () => {
  // Scenario: Given a W08 skill with one exact and one stale errata anchor plus repeated typed term refs.
  // Purpose: Keep the Extension consumer aligned with the verified Web view-model semantics.
  const release = 'darktide:1.13.2';
  const skill = { gameReleaseId: release, kind: 'skill', recordId: 'fixture:skill' };
  const statsTerm = { gameReleaseId: release, kind: 'term', recordId: 'fixture:term:stats' };
  const conditionsTerm = { gameReleaseId: release, kind: 'term', recordId: 'fixture:term:conditions' };
  const segmentSha256 = 'a'.repeat(64);
  const presentation = {
    entityRef: skill,
    locale: 'zh-TW',
    name: '繁中技能名',
    nameOfficialSourceId: 'skill-name-zh',
    nameOfficialLocaleRefs: [{ officialSourceId: 'skill-name-en', sourceLocale: 'en' }],
    officialLocaleRefs: [{ officialSourceId: 'skill-description-en', sourceLocale: 'en' }],
    official: { entityRef: skill, officialSourceId: 'skill-description-zh' },
    detailSections: [
      { sectionId: 'conditions', items: [{ text: '條件。', termRefs: [statsTerm, conditionsTerm, statsTerm], termRuleRefs: [] }] },
      { sectionId: 'effects', items: [{ text: '效果。', termRefs: [statsTerm], termRuleRefs: [] }] },
      { sectionId: 'extra', items: [] },
      { sectionId: 'notes', items: [] },
      { sectionId: 'calculation', items: [] }
    ],
    errata: [
      { errataId: 'valid', anchor: { officialSourceId: 'skill-description-zh', segmentId: 'segment-1', segmentSha256 },
        context: { description: '有效錨點' }, text: '有效勘誤。' },
      { errataId: 'stale', anchor: { officialSourceId: 'skill-description-zh', segmentId: 'segment-1', segmentSha256: 'b'.repeat(64) },
        context: { description: '舊錨點' }, text: '不可顯示的舊勘誤。' }
    ]
  };
  const domain = {
    kind: 'skills',
    gameReleaseId: release,
    source: { records: [
      { ...skill, payload: { termRefs: [statsTerm, statsTerm, conditionsTerm] } },
      { ...statsTerm, payload: { contextKey: 'skill.stats' } },
      { ...conditionsTerm, payload: { contextKey: 'skill.conditions' } }
    ] },
    web: {
      presentations: [presentation],
      officialInputs: { sources: [
        { officialSourceId: 'skill-name-en', sourceLocale: 'en', entityRef: skill, sourceText: 'Official Skill', resolvedText: 'Official Skill', segments: [] },
        { officialSourceId: 'skill-name-zh', sourceLocale: 'zh-TW', entityRef: skill, sourceText: '技能名', resolvedText: '技能名', segments: [] },
        { officialSourceId: 'skill-description-en', sourceLocale: 'en', entityRef: skill, sourceText: 'Official description.', resolvedText: 'Official description.', segments: [] },
        { officialSourceId: 'skill-description-zh', sourceLocale: 'zh-TW', entityRef: skill, sourceText: '官方原句。', resolvedText: '繁中官方解析。', segments: [
          { segmentId: 'segment-1', sha256: segmentSha256, text: '官方原句。' }
        ] }
      ] },
      termLocalizations: [
        { termRef: statsTerm, contextKey: 'skill.stats', locale: 'zh-TW', label: '倍率', definition: '數值脈絡定義。' },
        { termRef: conditionsTerm, contextKey: 'skill.conditions', locale: 'zh-TW', label: '倍率', definition: '條件脈絡定義。' }
      ]
    }
  };
  const models = buildSkillViewModels({ identity: { gameVersion: '1.13.2', gameReleaseId: release }, domains: new Map([['skills', domain]]) });

  // Then only the official exact-anchor correction remains, and shared terms dedupe by typed ref and context.
  assert.equal(models.length, 1);
  assert.deepEqual(models[0].errata, ['有效勘誤。']);
  assert.deepEqual(models[0].terms.map((row) => [row.label, row.contextKey, row.definition]), [
    ['倍率', 'skill.stats', '數值脈絡定義。'],
    ['倍率', 'skill.conditions', '條件脈絡定義。']
  ]);
  assert.deepEqual(models[0].validatedView.errata.map((row) => row.anchor.segmentSha256), [segmentSha256]);
});

test('UnitT30_BuildsOnlyExplicitBlessingVariantAndTierChoices', async (t) => {
  // Scenario: Given the fixed approved W08 domains, a blessing whose applicability is not verified, and a tiered official source.
  // Purpose: Keep all known tiers readable while requiring explicit native tier evidence and refusing unverified weapon binding.
  const candidate = await readApprovedCandidate(t);
  if (!candidate) return;
  const models = buildBlessingViewModels(candidate);
  const revItUp = models.filter((model) => model.nativeName === 'Rev it Up');
  const tier1 = revItUp.find((model) => model.tier === 1);
  const tier4 = revItUp.find((model) => model.tier === 4);

  // When each exact tier is selected, the shared Web view supplies the matching localized values and sections.
  assert.deepEqual(revItUp.map((model) => model.tier), [1, 2, 3, 4]);
  assert.ok(tier1 && tier4);
  assert.equal(tier1.applicability.status, 'unknown');
  assert.deepEqual(tier1.definedTiers, [1, 2, 3, 4]);
  assert.equal(tier1.obtainableTiers.status, 'unknown');
  assert.notEqual(tier1.official.resolvedText, tier4.official.resolvedText);
  assert.notDeepEqual(tier1.sourceTierValue, tier4.sourceTierValue);
  assert.equal(matchesBlessingObservation(tier1, {
    structure: 'gameslantern-blessing-row-v1', name: tier1.nativeName,
    description: tier1.nativeDescription, tier: 1
  }), true);
  assert.equal(matchesBlessingObservation(tier1, {
    structure: 'gameslantern-blessing-row-v1', name: tier1.nativeName,
    description: tier1.nativeDescription, tier: 4
  }), false);
  assert.equal(matchesBlessingObservation({ ...tier1, nativeName: null }, {
    structure: 'gameslantern-blessing-row-v1', name: '', description: tier1.nativeDescription, tier: 1
  }), false, 'empty official names must never authorize a native row');
  assert.equal(matchesBlessingObservation(tier1, {
    structure: 'gameslantern-blessing-row-v1', name: tier1.nativeName,
    description: '  ', tier: 1
  }), false, 'empty official descriptions must never authorize a native row');
  assert.equal(matchesBlessingObservation(tier1, {
    structure: 'gameslantern-blessing-row-v1', name: tier1.nativeName,
    description: tier1.nativeDescription, tier: 1, familyId: 'chainaxe_p1'
  }), false, 'partial applicability context must stay unmatched');
  assert.equal(matchesBlessingObservation(tier1, {
    structure: 'gameslantern-blessing-row-v1', name: tier1.nativeName,
    description: tier1.nativeDescription
  }), false, 'a row without an explicit visible tier must stay unknown');

  // Then a native family/mark query cannot claim the candidate blessing applies when Source has no weapon refs.
  assert.deepEqual(buildBlessingViewModels(candidate, { familyId: 'chainaxe_p1', markId: 'chainaxe_p1_m1' }), []);
  assert.deepEqual(buildBlessingViewModels(candidate, { familyId: 'chainaxe_p1' }), []);
  assert.deepEqual(buildBlessingViewModels(candidate, { tier: 9 }), []);
});

test('UnitT40_BuildsExactWeaponFamilyMarksAndCanonicalDetailMatch', async (t) => {
  // Scenario: Given the fixed approved Source weapon records and an observed canonical Mk IV detail route.
  // Purpose: Keep family/mark selection and native title matching tied to the same release's official name and mark label.
  const candidate = await readApprovedCandidate(t);
  if (!candidate) return;
  const family = buildWeaponFamilyViewModels(candidate).find((row) => row.familyId === 'chainaxe_p1');
  assert.ok(family);
  assert.equal(family.nativeName, 'Assault Chainaxe');
  assert.deepEqual(family.marks.map((mark) => [mark.markId, mark.markLabel]), [
    ['chainaxe_p1_m1', 'Mk IV'],
    ['chainaxe_p1_m2', 'Mk XII']
  ]);
  const mk4 = family.marks.find((mark) => mark.markLabel === 'Mk IV');
  const observation = {
    structure: 'gameslantern-weapon-detail-v1',
    href: 'https://darktide.gameslantern.com/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe',
    title: 'Orestes\u00a0Mk IV Assault Chainaxe',
    mirrorTitle: 'Orestes\u00a0Mk IV Assault Chainaxe',
    imageAlt: 'Header Image',
    imageSrc: 'https://darktide.gameslantern.com/storage/sites/darktide/weapons/assault-chainaxe/header.webp'
  };

  // When the exact observed route/title pair is checked, it resolves only the Source Mk IV row and retains full bundles.
  assert.equal(matchesWeaponObservation(mk4, observation), true);
  assert.equal(matchesWeaponObservation(family.marks.find((mark) => mark.markLabel === 'Mk XII'), observation), false);
  assert.equal(matchesWeaponObservation(mk4, { ...observation, href: observation.href.replace('assault-chainaxe/', 'other/') }), false);
  assert.ok(mk4.statSections.some((section) => section.claims.length && section.curves.length));
  assert.ok(mk4.source.displayedAttacks.length);
  assert.ok(mk4.source.actionContinuations.some((row) => row.fromAction && row.toAction));
  assert.ok(mk4.attackProfiles.some((row) => row.payload.action));
  assert.ok(mk4.source.statTables.some((row) => row.properties.length));
  assert.ok(mk4.source.statTableSemantics.some((row) => row.bindings.length));
});

test('UnitT50_WeaponViewKeepsTypedTermsAndCanonicalOfficialErrata', () => {
  // Scenario: A weapon record and its details cite context-specific terms, while errata anchor to the canonical official description.
  // Purpose: Keep Extension weapon views aligned with Web's typed-context terms and exact-source correction rules.
  // Given one valid and one stale canonical segment anchor, When a weapon family view is built, Then all valid terms and only the exact erratum remain.
  const release = 'fixture:w11-weapon-view';
  const weaponRef = { gameReleaseId: release, kind: 'weapon', recordId: 'fixture:chainaxe:iv' };
  const statDefinitionRef = { gameReleaseId: release, kind: 'stat-definition', recordId: 'fixture:chainaxe:iv-stamina' };
  const statCurveRef = { gameReleaseId: release, kind: 'stat-curve', recordId: 'fixture:chainaxe:iv-stamina-curve' };
  const recordTerm = { gameReleaseId: release, kind: 'term', recordId: 'fixture:weapon-record-term' };
  const sectionTerm = { gameReleaseId: release, kind: 'term', recordId: 'fixture:weapon-section-term' };
  const digest = 'a'.repeat(64);
  const emptyDomain = (kind) => ({
    kind, gameReleaseId: release, source: { records: [] },
    web: { presentations: [], officialInputs: { sources: [] }, termLocalizations: [] }
  });
  const skills = emptyDomain('skills');
  const blessings = emptyDomain('blessings');
  const terms = emptyDomain('terms');
  terms.source.records.push(
    { ...recordTerm, payload: { contextKey: 'weapon.record' } },
    { ...sectionTerm, payload: { contextKey: 'weapon.details' } }
  );
  terms.web.termLocalizations.push(
    { termRef: recordTerm, contextKey: 'weapon.record', locale: 'zh-TW', label: '型號倍率', definition: '型號脈絡說明。' },
    { termRef: sectionTerm, contextKey: 'weapon.details', locale: 'zh-TW', label: '攻擊對象', definition: '攻擊目標脈絡說明。' }
  );
  terms.web.termRules = { rules: [{ ruleId: 'weapon-rule', targetText: '連段依來源資料列示。' }] };

  const nameEnglish = { officialSourceId: 'weapon-name-en', sourceLocale: 'en', entityRef: weaponRef,
    sourceText: 'Assault Chainaxe', resolvedText: 'Assault Chainaxe', segments: [] };
  const nameChinese = { officialSourceId: 'weapon-name-zh', sourceLocale: 'zh-TW', entityRef: weaponRef,
    sourceText: '突擊鏈斧', resolvedText: '突擊鏈斧', segments: [] };
  const officialDescription = { officialSourceId: 'weapon-official-zh', sourceLocale: 'zh-TW', entityRef: weaponRef,
    sourceText: '官方武器描述原句。', resolvedText: '同版官方武器描述。',
    segments: [{ segmentId: 'official-segment', sha256: digest, text: '官方武器描述原句。' }] };
  const presentation = {
    entityRef: weaponRef,
    locale: 'zh-TW',
    name: '突擊鏈斧',
    nameOfficialSourceId: nameChinese.officialSourceId,
    nameOfficialLocaleRefs: [{ officialSourceId: nameEnglish.officialSourceId, sourceLocale: 'en' }],
    official: { entityRef: weaponRef, officialSourceId: officialDescription.officialSourceId },
    detailSections: [{ sectionId: 'effects', items: [{ text: '武器攻擊資料。', termRefs: [sectionTerm, sectionTerm], termRuleRefs: ['weapon-rule'] }] }],
    errata: [
      { errataId: 'valid', anchor: { officialSourceId: officialDescription.officialSourceId,
        segmentId: 'official-segment', segmentSha256: digest }, context: { description: '有效範圍' }, text: '有效武器勘誤。' },
      { errataId: 'stale', anchor: { officialSourceId: officialDescription.officialSourceId,
        segmentId: 'official-segment', segmentSha256: 'b'.repeat(64) }, context: { description: '舊錨點' }, text: '不可顯示的舊勘誤。' }
    ],
    weaponView: { sourceWeaponRef: weaponRef, markLabel: 'Mk IV', attackHeading: '連段',
      statSections: [{ label: '素質', claimRefs: [], curveRefs: [], statDefinitionRefs: [] }], attackProfileRefs: [] }
  };
  const weapons = emptyDomain('weapons');
  weapons.source.records.push(
    { ...weaponRef, payload: { familyId: 'chainaxe-p1', markId: 'mark-iv', statRefs: [statDefinitionRef],
      termRefs: [recordTerm], displayedAttacks: [], actionContinuations: [], statBindings: [], statTables: [],
      statTableSemantics: [], sourceRows: [] } },
    { ...statDefinitionRef, payload: { quantity: 'stamina', curveRef: statCurveRef } },
    { ...statCurveRef, payload: { inputUnit: 'ratio', outputUnit: 'ratio', knots: [
      { input: '0', output: '1', sourceOrdinal: 1 }, { input: '1', output: '2', sourceOrdinal: 2 },
    ] } },
  );
  weapons.web.presentations.push(presentation);
  weapons.web.officialInputs.sources.push(nameEnglish, nameChinese, officialDescription);

  const snapshot = { identity: { gameVersion: '1.13.2', gameReleaseId: release },
    domains: new Map([['skills', skills], ['blessings', blessings], ['weapons', weapons], ['terms', terms]]) };
  const family = buildWeaponFamilyViewModels(snapshot)[0];
  assert.ok(family);
  const mark = family.marks[0];
  assert.equal(mark.official.resolvedText, officialDescription.resolvedText);
  assert.deepEqual(mark.terms.filter((row) => row.termRef).map((row) => [row.label, row.contextKey, row.definition]), [
    ['型號倍率', 'weapon.record', '型號脈絡說明。'],
    ['攻擊對象', 'weapon.details', '攻擊目標脈絡說明。']
  ]);
  assert.deepEqual(mark.terms.filter((row) => row.ruleId), [{ text: '連段依來源資料列示。', ruleId: 'weapon-rule' }]);
  assert.deepEqual(mark.errata.map((row) => ({ text: row.text, context: row.context.description })), [
    { text: '有效武器勘誤。', context: '有效範圍' }
  ]);
  assert.equal(mark.source.statDefinitions.length, 1);
  assert.deepEqual(mark.source.statDefinitions[0].curve.payload.knots.map(row => row.output), ['1', '2']);
});
