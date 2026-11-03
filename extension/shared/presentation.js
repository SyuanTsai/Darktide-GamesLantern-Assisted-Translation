(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(commonJs ? require('./view-model.js') : root.W11SharedViewModel);
  if (commonJs) module.exports = api;
  root.W11Presentation = api;
})(typeof globalThis === 'object' ? globalThis : this, function (sharedViewApi) {
  'use strict';

  function visibleText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function sameEntity(left, right) {
    return !!left && !!right && left.gameReleaseId === right.gameReleaseId
      && left.kind === right.kind && left.recordId === right.recordId;
  }

  function sourceForLocale(domain, presentation, refs, locale) {
    if (!domain || !domain.web || !domain.web.officialInputs
      || !Array.isArray(domain.web.officialInputs.sources) || !Array.isArray(refs)) return null;
    const ids = refs.filter((ref) => ref && ref.sourceLocale === locale
      && typeof ref.officialSourceId === 'string').map((ref) => ref.officialSourceId);
    if (ids.length !== 1) return null;
    const rows = domain.web.officialInputs.sources.filter((row) => row
      && row.officialSourceId === ids[0] && row.sourceLocale === locale
      && sameEntity(row.entityRef, presentation.entityRef)
      && row.entityRef.gameReleaseId === presentation.entityRef.gameReleaseId
      && typeof row.sourceText === 'string' && row.sourceText.trim()
      && typeof row.resolvedText === 'string' && row.resolvedText.trim());
    return rows.length === 1 ? rows[0] : null;
  }

  function zhOfficialSource(domain, presentation) {
    const officialSourceId = presentation.official && presentation.official.officialSourceId;
    if (typeof officialSourceId !== 'string' || !domain.web?.officialInputs
      || !Array.isArray(domain.web.officialInputs.sources)) return null;
    const rows = domain.web.officialInputs.sources.filter((row) => row
      && row.officialSourceId === officialSourceId && row.sourceLocale === 'zh-TW'
      && sameEntity(row.entityRef, presentation.entityRef));
    return rows.length === 1 ? rows[0] : null;
  }

  function itemText(item) {
    return item && typeof item.text === 'string' ? item.text : '';
  }

  function logicalKind(kind) {
    if (kind === 'weapons-index' || kind === 'weapon-family') return 'weapons';
    if (kind === 'blessings-index' || kind === 'blessing') return 'blessings';
    return kind;
  }

  function mergeRows(rows, identity) {
    const output = [];
    const positions = new Map();
    for (const row of rows) {
      const key = identity(row) || JSON.stringify(row);
      if (positions.has(key)) output[positions.get(key)] = row;
      else {
        positions.set(key, output.length);
        output.push(row);
      }
    }
    return output;
  }

  function typedIdentity(row) {
    return row && typeof row.gameReleaseId === 'string' && typeof row.recordId === 'string'
      ? row.gameReleaseId + '\u0000' + String(row.kind || '') + '\u0000' + row.recordId : null;
  }

  function entityIdentity(row) {
    const ref = row?.entityRef;
    return typedIdentity(ref) ? typedIdentity(ref) + '\u0000' + String(row.locale || '') : null;
  }

  function rowIdentity(key, row) {
    if (key === 'gameReleases') return row?.gameReleaseId || null;
    if (key === 'sourceSnapshots') return row?.gameReleaseId && row?.snapshot?.snapshotId
      ? row.gameReleaseId + '\u0000' + row.snapshot.snapshotId : null;
    if (key === 'sourceRefs') return row?.gameReleaseId && row?.sourceId
      ? row.gameReleaseId + '\u0000' + row.sourceId : null;
    if (key === 'records' || key === 'tombstones') return typedIdentity(row);
    if (key === 'presentations') return entityIdentity(row);
    if (key === 'termLocalizations') return typedIdentity(row?.termRef)
      ? typedIdentity(row.termRef) + '\u0000' + String(row.contextKey || '') + '\u0000' + String(row.locale || '') : null;
    if (key === 'termRules') return typeof row?.ruleId === 'string' ? row.ruleId : null;
    return null;
  }

  function mergeDomainGroup(group, kind, gameReleaseId) {
    if (group.length === 1 && group[0].kind === kind) return group[0];
    const first = group[0];
    if (!first || group.some((domain) => !domain || domain.gameReleaseId !== gameReleaseId
      || !domain.source || !domain.web || domain.source.repository !== first.source.repository)) return null;
    const sourceArrays = ['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts'];
    const webArrays = ['presentations', 'termLocalizations', 'termRules', 'announcements', 'gameChanges',
      'officialTextChanges', 'reviewTargets', 'reviewReceipts'];
    const source = { repository: first.source.repository };
    for (const key of sourceArrays) {
      source[key] = mergeRows(group.flatMap((domain) => Array.isArray(domain.source[key]) ? domain.source[key] : []),
        (row) => rowIdentity(key, row));
    }
    const web = {};
    for (const key of webArrays) {
      const present = group.some((domain) => Array.isArray(domain.web[key]));
      if (present) web[key] = mergeRows(group.flatMap((domain) => Array.isArray(domain.web[key]) ? domain.web[key] : []),
        (row) => rowIdentity(key, row));
    }
    web.officialInputs = { sources: mergeRows(group.flatMap((domain) =>
      Array.isArray(domain.web.officialInputs?.sources) ? domain.web.officialInputs.sources : []),
    (row) => typeof row?.officialSourceId === 'string' ? row.officialSourceId : null) };
    return { schemaVersion: first.schemaVersion, kind, gameReleaseId, source, web };
  }

  function logicalDomains(snapshot) {
    if (!snapshot || !snapshot.identity || !(snapshot.domains instanceof Map)) return null;
    const gameReleaseId = snapshot.identity.gameReleaseId;
    const groups = new Map();
    for (const domain of snapshot.domains.values()) {
      if (!domain || domain.gameReleaseId !== gameReleaseId || typeof domain.kind !== 'string') continue;
      const kind = logicalKind(domain.kind);
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(domain);
    }
    const domains = [];
    for (const [kind, group] of groups) {
      const merged = mergeDomainGroup(group, kind, gameReleaseId);
      if (!merged) return null;
      domains.push(merged);
    }
    return { gameReleaseId, domains };
  }

  function buildSkillViewModels(snapshot) {
    if (!snapshot || !snapshot.identity || !(snapshot.domains instanceof Map)
      || !sharedViewApi || typeof sharedViewApi.createSharedViewModel !== 'function') return [];
    const logical = logicalDomains(snapshot);
    if (!logical) return [];
    const { gameReleaseId, domains } = logical;
    const skillsDomains = domains.filter((domain) => domain.kind === 'skills');
    if (skillsDomains.length !== 1) return [];
    const skillsDomain = skillsDomains[0];
    if (!Array.isArray(skillsDomain.source?.records) || !Array.isArray(skillsDomain.web?.presentations)) return [];

    const sharedView = sharedViewApi.createSharedViewModel({ domains, gameReleaseId });
    const output = [];
    for (const record of skillsDomain.source.records) {
      if (!record || record.kind !== 'skill' || record.gameReleaseId !== gameReleaseId) continue;
      const skillRef = { gameReleaseId, kind: 'skill', recordId: record.recordId };
      const presentations = skillsDomain.web.presentations.filter((row) => row?.locale === 'zh-TW'
        && sameEntity(row.entityRef, skillRef));
      if (presentations.length !== 1) continue;
      const presentation = presentations[0];
      const view = sharedView.getSkill(skillRef);
      if (!view || view.status !== 'ready') continue;
      const nativeName = sourceForLocale(skillsDomain, presentation, presentation.nameOfficialLocaleRefs, 'en');
      const nativeDescription = sourceForLocale(skillsDomain, presentation, presentation.officialLocaleRefs, 'en');
      const localizedDescriptionSource = zhOfficialSource(skillsDomain, presentation);
      if (!nativeName || !nativeDescription || !localizedDescriptionSource) continue;

      const parameters = Object.fromEntries((Array.isArray(localizedDescriptionSource.params)
        ? localizedDescriptionSource.params : [])
        .filter((row) => row && typeof row.parameterId === 'string' && typeof row.value === 'string')
        .map((row) => [row.parameterId, row.value]));
      const detailSections = view.sections.map((section) => ({
        sectionId: section.sectionId,
        items: section.items.map(itemText).filter(Boolean)
      }));
      const terms = [
        ...view.terms.map((term) => ({
          text: term.label + '：' + term.definition,
          label: term.label,
          definition: term.definition,
          contextKey: term.contextKey,
          termRef: term.termRef
        })),
        ...view.termRules.map((term) => ({ text: term.text, ruleId: term.ruleId }))
      ];
      output.push(Object.freeze({
        entityRef: Object.freeze({ ...skillRef }),
        nativeName: nativeName.resolvedText,
        nativeDescription: nativeDescription.resolvedText,
        translatedName: view.name,
        translatedDescription: view.official.resolvedText,
        translationParams: Object.freeze(parameters),
        detailSections: Object.freeze(detailSections),
        errata: Object.freeze(view.errata.map((row) => row.text)),
        terms: Object.freeze(terms),
        validatedView: view
      }));
    }
    return output;
  }

  function verifiedDomains(snapshot) {
    return logicalDomains(snapshot);
  }

  function termRows(view) {
    return [
      ...view.terms.map((term) => ({
        text: term.label + '：' + term.definition,
        label: term.label,
        definition: term.definition,
        contextKey: term.contextKey,
        termRef: term.termRef
      })),
      ...view.termRules.map((term) => ({ text: term.text, ruleId: term.ruleId }))
    ];
  }

  function buildBlessingViewModels(snapshot, context = {}) {
    const verified = verifiedDomains(snapshot);
    if (!verified || !context || typeof context !== 'object' || Array.isArray(context)) return [];
    const domains = verified.domains;
    const blessingDomains = domains.filter((domain) => domain.kind === 'blessings');
    const weaponDomains = domains.filter((domain) => domain.kind === 'weapons');
    if (blessingDomains.length !== 1 || weaponDomains.length !== 1) return [];
    const blessingDomain = blessingDomains[0];
    const weaponDomain = weaponDomains[0];
    if (!Array.isArray(blessingDomain.source?.records) || !Array.isArray(blessingDomain.web?.presentations)) return [];
    const sharedView = sharedViewApi.createSharedViewModel({ domains, gameReleaseId: verified.gameReleaseId });
    const records = blessingDomain.source.records;
    const output = [];
    for (const parent of records) {
      if (parent?.kind !== 'blessing' || parent.gameReleaseId !== verified.gameReleaseId
        || !Array.isArray(parent.payload?.variantRefs)) continue;
      const blessingRef = { gameReleaseId: verified.gameReleaseId, kind: 'blessing', recordId: parent.recordId };
      const presentations = blessingDomain.web.presentations.filter((row) => row?.locale === 'zh-TW'
        && sameEntity(row.entityRef, blessingRef));
      if (presentations.length !== 1) continue;
      const presentation = presentations[0];
      const nativeName = sourceForLocale(blessingDomain, presentation, presentation.nameOfficialLocaleRefs, 'en');
      for (const reference of parent.payload.variantRefs) {
        if (!reference || reference.gameReleaseId !== verified.gameReleaseId
          || typeof reference.recordId !== 'string') continue;
        const variantRef = { gameReleaseId: verified.gameReleaseId, kind: 'blessing-variant', recordId: reference.recordId };
        const variantRows = records.filter((row) => row?.kind === 'blessing-variant'
          && row.gameReleaseId === verified.gameReleaseId && row.recordId === variantRef.recordId);
        if (variantRows.length !== 1) continue;
        const options = presentation.tierPresentations?.variantRef
          && sameEntity(presentation.tierPresentations.variantRef, variantRef)
          ? presentation.tierPresentations.options : [];
        if (!Array.isArray(options)) continue;
        const tiers = [...new Set(options.map((row) => row?.tier).filter((tier) => Number.isInteger(tier) && tier > 0))]
          .filter((tier) => context.tier === undefined || context.tier === tier);
        for (const tier of tiers) {
          const view = sharedView.getBlessing({
            blessingRef,
            variantRef,
            ...(context.familyId === undefined ? {} : { familyId: context.familyId }),
            ...(context.markId === undefined ? {} : { markId: context.markId }),
            tier
          });
          if (!view || view.status !== 'ready') continue;
          const option = options.filter((row) => row?.tier === tier);
          const nativeDescription = option.length === 1
            ? sourceForLocale(blessingDomain, presentation, option[0].officialLocaleRefs, 'en') : null;
          const nativeParameters = Object.fromEntries((nativeDescription?.params || [])
            .filter((row) => row && typeof row.parameterId === 'string' && typeof row.value === 'string')
            .map((row) => [row.parameterId, row.value]));
          output.push(Object.freeze({
            entityRef: Object.freeze({ ...blessingRef }),
            blessingRef: Object.freeze({ ...blessingRef }),
            variantRef: Object.freeze({ ...variantRef }),
            ...(context.familyId === undefined ? {} : { familyId: context.familyId }),
            ...(context.markId === undefined ? {} : { markId: context.markId }),
            nativeName: nativeName?.resolvedText || null,
            nativeDescription: nativeDescription?.resolvedText || null,
            nativeParameters: Object.freeze(nativeParameters),
            translatedName: view.name,
            translatedDescription: view.official.resolvedText,
            detailSections: Object.freeze(view.sections.map((section) => ({
              sectionId: section.sectionId,
              items: section.items.map(itemText).filter(Boolean)
            }))),
            errata: Object.freeze(view.errata.map((row) => row.text)),
            terms: Object.freeze(termRows(view)),
            tier: view.tier,
            definedTiers: Object.freeze(view.definedTiers.slice()),
            obtainableTiers: view.obtainableTiers,
            sourceTierValue: view.sourceTierValue,
            official: view.official,
            applicability: view.applicability,
            validatedView: view
          }));
        }
      }
    }
    return output;
  }

  function slugify(value) {
    return visibleText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function buildWeaponFamilyViewModels(snapshot) {
    const verified = verifiedDomains(snapshot);
    if (!verified) return [];
    const weaponDomains = verified.domains.filter((domain) => domain.kind === 'weapons');
    if (weaponDomains.length !== 1) return [];
    const weaponDomain = weaponDomains[0];
    if (!Array.isArray(weaponDomain.source?.records) || !Array.isArray(weaponDomain.web?.presentations)) return [];
    const sharedView = sharedViewApi.createSharedViewModel({ domains: verified.domains,
      gameReleaseId: verified.gameReleaseId });
    const familyIds = [...new Set(weaponDomain.source.records.filter((record) => record?.kind === 'weapon'
      && record.gameReleaseId === verified.gameReleaseId && typeof record.payload?.familyId === 'string')
      .map((record) => record.payload.familyId))];
    const output = [];
    for (const familyId of familyIds) {
      const family = sharedView.getWeaponFamily(familyId);
      if (!family || family.status !== 'ready' || !Array.isArray(family.marks)) continue;
      const marks = [];
      for (const mark of family.marks) {
        const weaponRef = { gameReleaseId: verified.gameReleaseId, kind: 'weapon',
          recordId: weaponDomain.source.records.find((record) => record?.kind === 'weapon'
            && record.gameReleaseId === verified.gameReleaseId && record.payload?.familyId === familyId
            && record.payload?.markId === mark.markId)?.recordId };
        if (!weaponRef.recordId) { marks.length = 0; break; }
        const presentations = weaponDomain.web.presentations.filter((row) => row?.locale === 'zh-TW'
          && sameEntity(row.entityRef, weaponRef));
        const nativeName = presentations.length === 1
          ? sourceForLocale(weaponDomain, presentations[0], presentations[0].nameOfficialLocaleRefs, 'en') : null;
        if (!nativeName) { marks.length = 0; break; }
        marks.push(Object.freeze({
          ...mark,
          entityRef: Object.freeze({ ...weaponRef }),
          nativeName: nativeName.resolvedText,
          familySlug: slugify(nativeName.resolvedText),
          nativeImagePathPrefix: '/storage/sites/darktide/weapons/',
          terms: Object.freeze(termRows(mark)),
          errata: Object.freeze((mark.errata || []).filter((row) => row && typeof row.text === 'string' && row.text.trim()))
        }));
      }
      const nativeNames = [...new Set(marks.map((mark) => mark.nativeName))];
      if (marks.length !== family.marks.length || nativeNames.length !== 1) continue;
      output.push(Object.freeze({
        familyId,
        nativeName: nativeNames[0],
        translatedName: family.marks[0].name,
        familySlug: slugify(nativeNames[0]),
        marks: Object.freeze(marks)
      }));
    }
    return output;
  }

  function matchesSkillObservation(model, observation) {
    return !!model && !!observation
      && ['gameslantern-ability-card-v1', 'gameslantern-ability-detail-v1'].includes(observation.structure)
      && visibleText(observation.name) === visibleText(model.nativeName)
      && visibleText(observation.description) === visibleText(model.nativeDescription);
  }

  function matchesBlessingObservation(model, observation) {
    const nativeName = visibleText(model?.nativeName);
    const nativeDescription = visibleText(model?.nativeDescription);
    const observedName = visibleText(observation?.name);
    const observedDescription = visibleText(observation?.description);
    const hasFamily = observation?.familyId !== undefined;
    const hasMark = observation?.markId !== undefined;
    if (!model || !observation || !nativeName || !nativeDescription || !observedName || !observedDescription
      || hasFamily !== hasMark) return false;
    return observation.structure === 'gameslantern-blessing-row-v1'
      && Number.isInteger(observation.tier) && observation.tier === model.tier
      && observedName === nativeName
      && observedDescription === nativeDescription
      && ((!hasFamily && !hasMark)
        ? model.applicability?.status === 'unknown'
        : observation.familyId === model.familyId && observation.markId === model.markId
          && model.applicability?.status === 'verified');
  }

  function matchesWeaponObservation(model, observation) {
    if (!model || !observation || observation.structure !== 'gameslantern-weapon-detail-v1'
      || typeof observation.href !== 'string' || typeof observation.title !== 'string'
      || typeof observation.mirrorTitle !== 'string'
      || observation.imageAlt !== 'Header Image' || typeof observation.imageSrc !== 'string') return false;
    try {
      const url = new URL(observation.href);
      const image = new URL(observation.imageSrc, url.origin);
      const segments = url.pathname.split('/').filter(Boolean);
      const title = visibleText(observation.title);
      const suffix = visibleText(model.markLabel + ' ' + model.nativeName);
      return url.protocol === 'https:' && url.hostname === 'darktide.gameslantern.com'
        && !url.port && !url.username && !url.password && !url.search && !url.hash
        && /^\/weapons\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(url.pathname)
        && segments.length === 3 && segments[1] === model.familySlug
        && segments[2] === slugify(title) && (title === suffix || title.endsWith(' ' + suffix))
        && visibleText(observation.mirrorTitle) === title
        && image.protocol === 'https:' && ['darktide.gameslantern.com', 'gameslantern.com'].includes(image.hostname)
        && !image.port && !image.username && !image.password
        && image.pathname.startsWith(model.nativeImagePathPrefix) && !image.search && !image.hash;
    } catch (_) {
      return false;
    }
  }

  return Object.freeze({ buildBlessingViewModels, buildSkillViewModels, buildWeaponFamilyViewModels,
    matchesBlessingObservation, matchesSkillObservation, matchesWeaponObservation, visibleText });
});
