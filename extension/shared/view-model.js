(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W11SharedViewModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Local UMD packaging of Web shared-view.mjs at commit 1960fc207194cebfc8e895e4046c93c88beb18c9; no Web checkout is loaded at runtime.
const SECTION_ORDER = Object.freeze([
  ['effects', '效果'],
  ['conditions', '條件'],
  ['calculation', '計算'],
  ['notes', '補充說明'],
  ['extra', '額外說明'],
]);

const UNAVAILABLE_TEXT = Object.freeze({
  missing: '目前沒有可用的繁體中文資料。',
  identity: '目前無法確認這筆資料的遊戲版本或對應內容。',
  official: '目前缺少同版本的繁體中文官方來源文字。',
  variant: '目前無法確認這個祝福變體適用於所選武器。',
  tier: '目前沒有這個等級的資料。',
  weapon: '目前沒有這個武器家族與種類的繁體中文資料。',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refKey(ref, fallbackKind) {
  if (!isObject(ref)) return null;
  const gameReleaseId = ref.gameReleaseId;
  const kind = ref.kind ?? fallbackKind;
  const recordId = ref.recordId;
  if (typeof gameReleaseId !== 'string' || !gameReleaseId || typeof kind !== 'string' || !kind || typeof recordId !== 'string' || !recordId) {
    return null;
  }
  return `${gameReleaseId}\u0000${kind}\u0000${recordId}`;
}

function sameRef(left, right, fallbackKind) {
  const leftKey = refKey(left, fallbackKind);
  return leftKey !== null && leftKey === refKey(right, fallbackKind);
}

function isDisplayText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function unavailable(reason, category = 'missing') {
  return {
    status: 'unavailable',
    reason,
    statusText: UNAVAILABLE_TEXT[category] ?? UNAVAILABLE_TEXT.missing,
  };
}

function addTerms(target, refs, recordByKey, localizations, gameReleaseId) {
  if (!Array.isArray(refs)) return;
  for (const ref of refs) {
    const key = refKey(ref, 'term');
    if (!key || ref.gameReleaseId !== gameReleaseId) continue;
    const record = recordByKey.get(key);
    const contextKey = record?.payload?.contextKey;
    if (!record || !isDisplayText(contextKey)) continue;
    const localized = localizations.filter((row) => row?.locale === 'zh-TW'
      && row?.contextKey === contextKey
      && sameRef(row.termRef, ref, 'term')
      && isDisplayText(row.label)
      && isDisplayText(row.definition));
    if (localized.length !== 1) continue;
    const dedupeKey = `${key}\u0000${contextKey}`;
    if (target.has(dedupeKey)) continue;
    target.set(dedupeKey, {
      termRef: { gameReleaseId, kind: 'term', recordId: record.recordId },
      contextKey,
      label: localized[0].label,
      definition: localized[0].definition,
    });
  }
}

function orderedSections(sections, { resolveParts, terms, recordByKey, localizations, termRules, gameReleaseId } = {}) {
  if (!Array.isArray(sections)) return { ok: false, sections: [] };
  const byId = new Map();
  for (const section of sections) {
    if (!isObject(section) || typeof section.sectionId !== 'string' || !Array.isArray(section.items)) return { ok: false, sections: [] };
    if (!SECTION_ORDER.some(([sectionId]) => sectionId === section.sectionId) || byId.has(section.sectionId)) return { ok: false, sections: [] };
    byId.set(section.sectionId, section);
  }

  const result = [];
  for (const [sectionId, heading] of SECTION_ORDER) {
    const section = byId.get(sectionId);
    if (!section || section.items.length === 0) continue;
    const items = [];
    for (const item of section.items) {
      if (!isObject(item)) return { ok: false, sections: [] };
      const viewItem = {};
      if (typeof item.itemId === 'string') viewItem.itemId = item.itemId;
      if (typeof item.text === 'string') viewItem.text = item.text;
      if (Array.isArray(item.parts)) {
        const resolved = resolveParts ? resolveParts(item.parts) : item.parts.map((part) => ({ ...part }));
        if (!resolved) return { ok: false, sections: [] };
        viewItem.parts = resolved;
      }
      if (Array.isArray(item.claimRefs)) viewItem.claimRefs = item.claimRefs.map((ref) => ({ ...ref }));
      if (Array.isArray(item.termRefs)) {
        viewItem.termRefs = item.termRefs.map((ref) => ({ ...ref }));
        addTerms(terms, item.termRefs, recordByKey, localizations, gameReleaseId);
      }
      if (Array.isArray(item.termRuleRefs)) {
        viewItem.termRuleRefs = item.termRuleRefs.slice();
        for (const ruleId of item.termRuleRefs) {
          const rule = termRules.get(ruleId);
          if (rule) terms.set(`rule\u0000${ruleId}`, { ruleId, text: rule.targetText });
        }
      }
      items.push(viewItem);
    }
    result.push({ sectionId, heading, items });
  }
  return { ok: true, sections: result };
}

function findOfficial(officialSources, officialSourceId, entityRef, gameReleaseId, bindingContext) {
  if (!isDisplayText(officialSourceId)) return null;
  const matches = officialSources.filter((row) => row?.officialSourceId === officialSourceId
    && row?.sourceLocale === 'zh-TW'
    && sameRef(row.entityRef, entityRef)
    && row.entityRef?.gameReleaseId === gameReleaseId
    && isDisplayText(row.sourceText)
    && isDisplayText(row.resolvedText)
    && (!bindingContext || (row.bindingContext?.tier === bindingContext.tier
      && sameRef(row.bindingContext?.variantRef, bindingContext.variantRef, 'blessing-variant'))));
  return matches.length === 1 ? matches[0] : null;
}

function officialView(source) {
  return {
    sourceText: source.sourceText,
    resolvedText: source.resolvedText,
    sourceLocale: source.sourceLocale,
  };
}

function displayParts(parts, bindingRows, valueByBindingKey) {
  const result = [];
  for (const part of parts) {
    if (!isObject(part)) return null;
    if (part.kind === 'literal') {
      if (!isDisplayText(part.text) && part.text !== '') return null;
      result.push({ kind: 'text', text: part.text });
      continue;
    }
    const bindingKey = refKey(part.bindingRef, 'claim');
    const binding = bindingRows.find((row) => refKey(row.bindingRef, 'claim') === bindingKey);
    if (!bindingKey || !binding || !valueByBindingKey.has(bindingKey)) return null;
    result.push({
      kind: part.kind,
      name: binding.name ?? binding.parameterId,
      format: binding.format,
      value: valueByBindingKey.get(bindingKey),
    });
  }
  return result;
}

function resolveRecords(refs, expectedKind, gameReleaseId, recordByKey) {
  if (!Array.isArray(refs)) return null;
  const records = [];
  for (const ref of refs) {
    const key = refKey(ref, expectedKind);
    const record = key && ref.gameReleaseId === gameReleaseId ? recordByKey.get(key) : null;
    if (!record || record.kind !== expectedKind || record.gameReleaseId !== gameReleaseId) return null;
    records.push(record);
  }
  return records;
}

/**
 * Build a read-only consumer view over validated W08 shared-domain objects.
 * The caller supplies one already-validated game release; no source metadata is fetched or executed.
 */
function createSharedViewModel({ domains, gameReleaseId } = {}) {
  if (!Array.isArray(domains) || typeof gameReleaseId !== 'string' || !gameReleaseId) {
    throw new TypeError('domains and gameReleaseId are required');
  }

  const recordByKey = new Map();
  const presentations = [];
  const officialSources = [];
  const termLocalizations = [];
  const termRules = new Map();
  for (const domain of domains) {
    if (!isObject(domain) || domain.gameReleaseId !== gameReleaseId) continue;
    if (Array.isArray(domain.source?.records)) {
      for (const record of domain.source.records) {
        const key = refKey(record);
        if (!key || record.gameReleaseId !== gameReleaseId || !isObject(record.payload)) continue;
        const existing = recordByKey.get(key);
        if (!existing) recordByKey.set(key, record);
        else if (JSON.stringify(existing) !== JSON.stringify(record)) recordByKey.set(key, null);
      }
    }
    if (Array.isArray(domain.web?.presentations)) presentations.push(...domain.web.presentations);
    if (Array.isArray(domain.web?.officialInputs?.sources)) officialSources.push(...domain.web.officialInputs.sources);
    if (Array.isArray(domain.web?.termLocalizations)) termLocalizations.push(...domain.web.termLocalizations);
    const rules = domain.web?.termRules?.rules;
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        if (isDisplayText(rule?.ruleId) && isDisplayText(rule?.targetText)) termRules.set(rule.ruleId, rule);
      }
    }
  }

  const getRecord = (ref, expectedKind) => {
    const key = refKey(ref, expectedKind);
    const record = key && ref.gameReleaseId === gameReleaseId ? recordByKey.get(key) : null;
    return record && record.kind === (ref.kind ?? expectedKind) ? record : null;
  };

  const getPresentation = (ref) => {
    const rows = presentations.filter((row) => row?.locale === 'zh-TW' && sameRef(row.entityRef, ref)
      && row.entityRef?.gameReleaseId === gameReleaseId);
    return rows.length === 1 ? rows[0] : null;
  };

  const getSkill = (skillRef) => {
    const record = getRecord(skillRef, 'skill');
    if (!record) return unavailable('unknown-skill', 'identity');
    const presentation = getPresentation(skillRef);
    if (!presentation || !isDisplayText(presentation.name)) return unavailable('missing-zh-tw-skill', 'missing');
    const nameSource = findOfficial(officialSources, presentation.nameOfficialSourceId, skillRef, gameReleaseId);
    const descriptionSource = findOfficial(officialSources, presentation.official?.officialSourceId, skillRef, gameReleaseId);
    if (!nameSource || !descriptionSource) return unavailable('missing-zh-tw-official-skill-text', 'official');

    const termViews = new Map();
    addTerms(termViews, record.payload.termRefs, recordByKey, termLocalizations, gameReleaseId);
    const sectionsResult = orderedSections(presentation.detailSections, {
      terms: termViews,
      recordByKey,
      localizations: termLocalizations,
      termRules,
      gameReleaseId,
    });
    if (!sectionsResult.ok) return unavailable('invalid-skill-sections', 'missing');
    return {
      status: 'ready',
      name: presentation.name,
      official: officialView(descriptionSource),
      nameOfficial: officialView(nameSource),
      errata: exactErrata(presentation.errata, descriptionSource),
      sections: sectionsResult.sections,
      terms: [...termViews.values()].filter((term) => term.termRef),
      termRules: [...termViews.values()].filter((term) => term.ruleId),
    };
  };

  const getBlessing = ({ blessingRef, variantRef, familyId, markId, tier } = {}) => {
    const parent = getRecord(blessingRef, 'blessing');
    const variant = getRecord(variantRef, 'blessing-variant');
    if (!parent || !variant || !sameRef(variant.payload?.blessingRef, blessingRef, 'blessing')
      || !Array.isArray(parent.payload?.variantRefs)
      || !parent.payload.variantRefs.some((ref) => sameRef(ref, variantRef, 'blessing-variant'))) {
      return unavailable('unknown-blessing-variant', 'identity');
    }
    const presentation = getPresentation(blessingRef);
    if (!presentation || !isDisplayText(presentation.name)) return unavailable('missing-zh-tw-blessing', 'missing');
    const nameSource = findOfficial(officialSources, presentation.nameOfficialSourceId, blessingRef, gameReleaseId);
    if (!nameSource) return unavailable('missing-zh-tw-blessing-name', 'official');
    if (!Number.isInteger(tier) || tier < 1) return unavailable('unknown-tier', 'tier');

    const applicability = Array.isArray(presentation.tierApplicability)
      ? presentation.tierApplicability.find((row) => sameRef(row?.variantRef, variantRef, 'blessing-variant'))
      : null;
    const option = presentation.tierPresentations?.options?.filter((row) => row?.tier === tier) ?? [];
    const variantTiers = variant.payload?.definedTiers;
    if (!applicability || !Array.isArray(applicability.tiers) || !applicability.tiers.includes(tier)
      || !Array.isArray(variantTiers) || !variantTiers.includes(tier) || option.length !== 1) {
      return unavailable('unknown-tier', 'tier');
    }

    const hasFamilyContext = familyId !== undefined;
    const hasMarkContext = markId !== undefined;
    if (hasFamilyContext !== hasMarkContext
      || (hasFamilyContext && (!isDisplayText(familyId) || !isDisplayText(markId)))) {
      return unavailable('incomplete-weapon-context', 'variant');
    }
    const hasWeaponContext = hasFamilyContext && hasMarkContext;
    if (hasWeaponContext) {
      const weapons = [...recordByKey.values()].filter((record) => record?.kind === 'weapon'
        && record.gameReleaseId === gameReleaseId
        && record.payload?.familyId === familyId
        && record.payload?.markId === markId);
      if (weapons.length !== 1) return unavailable('family-mark-unverified', 'variant');
      const weapon = weapons[0];
      const weaponLink = Array.isArray(variant.payload?.weaponRefs)
        && variant.payload.weaponRefs.some((ref) => sameRef(ref, weapon, 'weapon'));
      if (!weaponLink) return unavailable('family-mark-unverified', 'variant');
    }

    const tierOption = option[0];
    const officialRef = Array.isArray(tierOption.officialLocaleRefs)
      ? tierOption.officialLocaleRefs.filter((row) => row?.sourceLocale === 'zh-TW')
      : [];
    if (officialRef.length !== 1) return unavailable('missing-zh-tw-tier-text', 'official');
    const officialSource = findOfficial(
      officialSources,
      officialRef[0].officialSourceId,
      blessingRef,
      gameReleaseId,
      { tier, variantRef },
    );
    if (!officialSource || !Array.isArray(tierOption.params) || !Array.isArray(officialSource.params)) {
      return unavailable('missing-zh-tw-tier-text', 'official');
    }
    const canonicalOfficialSource = presentation.official?.officialSourceId === officialSource.officialSourceId
      ? findOfficial(
        officialSources,
        presentation.official.officialSourceId,
        blessingRef,
        gameReleaseId,
        presentation.official.bindingContext,
      )
      : null;

    const valueByBindingKey = new Map();
    const displayedParams = [];
    for (const binding of tierOption.params) {
      const bindingKey = refKey(binding?.bindingRef, 'claim');
      const sourceKey = binding?.bindingRef?.recordId;
      const parameterId = binding?.parameterId ?? binding?.name;
      if (!bindingKey || !sourceKey || !parameterId) return unavailable('invalid-tier-binding', 'official');
      const parameterRows = officialSource.params.filter((row) => row?.sourceKey === sourceKey
        && row?.parameterId === parameterId && isDisplayText(row.value));
      if (parameterRows.length !== 1) return unavailable('missing-tier-parameter', 'official');
      valueByBindingKey.set(bindingKey, parameterRows[0].value);
      displayedParams.push({
        parameterId,
        name: binding.name ?? parameterId,
        format: binding.format,
        value: parameterRows[0].value,
      });
    }

    const termViews = new Map();
    const sectionsResult = orderedSections(tierOption.detailSections, {
      resolveParts: (parts) => displayParts(parts, tierOption.params, valueByBindingKey),
      terms: termViews,
      recordByKey,
      localizations: termLocalizations,
      termRules,
      gameReleaseId,
    });
    if (!sectionsResult.ok) return unavailable('invalid-blessing-sections', 'missing');
    const tierValueRows = Array.isArray(variant.payload.tierValues)
      ? variant.payload.tierValues.filter((row) => row?.tier === tier)
      : [];
    if (tierValueRows.length !== 1) return unavailable('missing-tier-source-value', 'missing');

    return {
      status: 'ready',
      name: presentation.name,
      nameOfficial: officialView(nameSource),
      ...(hasWeaponContext ? { familyId, markId } : {}),
      tier,
      variantRef: { ...variantRef },
      applicability: hasWeaponContext
        ? { status: 'verified', familyId, markId }
        : { status: 'unknown', verification: 'unverified', reason: 'weapon-context-not-selected' },
      definedTiers: variantTiers.slice(),
      obtainableTiers: variant.payload.obtainableTiers ?? { status: 'unknown' },
      official: { ...officialView(officialSource), params: displayedParams },
      sourceTierValue: tierValueRows[0].value,
      sections: sectionsResult.sections,
      errata: canonicalOfficialSource ? exactErrata(presentation.errata, canonicalOfficialSource) : [],
      terms: [...termViews.values()].filter((term) => term.termRef),
      termRules: [...termViews.values()].filter((term) => term.ruleId),
    };
  };

  const getWeapon = ({ familyId, markId } = {}) => {
    const weaponMatches = [...recordByKey.values()].filter((record) => record?.kind === 'weapon'
      && record.gameReleaseId === gameReleaseId
      && record.payload?.familyId === familyId
      && record.payload?.markId === markId);
    if (weaponMatches.length !== 1) return unavailable('unknown-weapon-mark', 'weapon');
    const weapon = weaponMatches[0];
    const weaponRef = { gameReleaseId, kind: 'weapon', recordId: weapon.recordId };
    const presentation = getPresentation(weaponRef);
    if (!presentation || !isDisplayText(presentation.name) || !isObject(presentation.weaponView)
      || !isDisplayText(presentation.weaponView.markLabel)
      || !sameRef(presentation.weaponView.sourceWeaponRef, weaponRef)) {
      return unavailable('missing-zh-tw-weapon-presentation', 'weapon');
    }
    const nameSource = findOfficial(officialSources, presentation.nameOfficialSourceId, weaponRef, gameReleaseId);
    if (!nameSource) return unavailable('missing-zh-tw-weapon-name', 'official');
    const view = presentation.weaponView;
    if (!Array.isArray(view.statSections) || !Array.isArray(view.attackProfileRefs)) return unavailable('invalid-weapon-presentation', 'weapon');
    const statSections = [];
    for (const section of view.statSections) {
      const claims = resolveRecords(section.claimRefs ?? [], 'claim', gameReleaseId, recordByKey);
      const curves = resolveRecords(section.curveRefs ?? [], 'stat-curve', gameReleaseId, recordByKey);
      const definitions = resolveRecords(section.statDefinitionRefs ?? [], 'stat-definition', gameReleaseId, recordByKey);
      if (!isDisplayText(section.label) || !claims || !curves || !definitions) return unavailable('incomplete-weapon-stat-bundle', 'weapon');
      statSections.push({
        label: section.label,
        sourceStat: section.sourceStat,
        claims,
        curves,
        statDefinitions: definitions,
      });
    }
    const attackProfiles = resolveRecords(view.attackProfileRefs, 'attack-profile', gameReleaseId, recordByKey);
    if (!attackProfiles) return unavailable('incomplete-weapon-attack-bundle', 'weapon');
    const sectionResult = orderedSections(presentation.detailSections ?? [], {
      terms: new Map(), recordByKey, localizations: termLocalizations, termRules, gameReleaseId,
    });
    if (!sectionResult.ok) return unavailable('invalid-weapon-sections', 'weapon');
    return {
      status: 'ready',
      name: presentation.name,
      official: officialView(nameSource),
      familyId,
      markId,
      markLabel: view.markLabel,
      attackHeading: view.attackHeading,
      comparisonHeading: view.comparisonHeading,
      note: view.note,
      sections: sectionResult.sections,
      statSections,
      attackProfiles,
      source: {
        displayedAttacks: weapon.payload.displayedAttacks,
        actionContinuations: weapon.payload.actionContinuations,
        statBindings: weapon.payload.statBindings,
        statTables: weapon.payload.statTables,
        statTableSemantics: weapon.payload.statTableSemantics,
        sourceRows: weapon.payload.sourceRows,
      },
    };
  };

  const getWeaponFamily = (familyId) => {
    const weaponRecords = [...recordByKey.values()].filter((record) => record?.kind === 'weapon'
      && record.gameReleaseId === gameReleaseId && record.payload?.familyId === familyId);
    const markIds = [...new Set(weaponRecords.map((record) => record.payload.markId).filter(isDisplayText))];
    if (markIds.length === 0) return unavailable('unknown-weapon-family', 'weapon');
    const marks = [];
    for (const markId of markIds) {
      const weapon = getWeapon({ familyId, markId });
      if (weapon.status !== 'ready') return weapon;
      marks.push(weapon);
    }
    return { status: 'ready', familyId, marks };
  };

  return Object.freeze({ gameReleaseId, getSkill, getBlessing, getWeapon, getWeaponFamily });
}

function exactErrata(errata, officialSource) {
  if (!Array.isArray(errata) || !Array.isArray(officialSource.segments)) return [];
  const result = [];
  for (const row of errata) {
    const anchor = row?.anchor;
    if (anchor?.officialSourceId !== officialSource.officialSourceId || !isDisplayText(anchor.segmentId)) continue;
    const segment = officialSource.segments.filter((candidate) => candidate?.segmentId === anchor.segmentId);
    if (segment.length !== 1) continue;
    const digest = segment[0].sha256 ?? segment[0].segmentSha256;
    if (typeof digest !== 'string' || digest !== anchor.segmentSha256 || !isDisplayText(row.text)) continue;
    result.push({
      errataId: row.errataId,
      text: row.text,
      sourceText: officialSource.sourceText,
      sourceSegmentText: segment[0].text ?? segment[0].token ?? null,
      context: {
        description: row.context?.description,
        refs: Array.isArray(row.context?.refs) ? row.context.refs.map((ref) => ({ ...ref })) : [],
      },
      anchor: {
        officialSourceId: anchor.officialSourceId,
        segmentId: anchor.segmentId,
        segmentSha256: anchor.segmentSha256,
      },
      claimRefs: Array.isArray(row.claimRefs) ? row.claimRefs.map((ref) => ({ ...ref })) : [],
      evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.map((ref) => ({ ...ref })) : [],
    });
  }
  return result;
}

  return Object.freeze({ createSharedViewModel });
});
