'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSkillViewModels, matchesSkillObservation } = require('../../extension/shared/presentation.js');

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
