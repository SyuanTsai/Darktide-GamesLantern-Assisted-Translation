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

  function buildSkillViewModels(snapshot) {
    if (!snapshot || !snapshot.identity || !(snapshot.domains instanceof Map)
      || !sharedViewApi || typeof sharedViewApi.createSharedViewModel !== 'function') return [];
    const gameReleaseId = snapshot.identity.gameReleaseId;
    const domains = [...snapshot.domains.values()].filter((domain) => domain
      && domain.gameReleaseId === gameReleaseId);
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

  function matchesSkillObservation(model, observation) {
    return !!model && !!observation
      && observation.structure === 'gameslantern-ability-card-v1'
      && visibleText(observation.name) === visibleText(model.nativeName)
      && visibleText(observation.description) === visibleText(model.nativeDescription);
  }

  return Object.freeze({ buildSkillViewModels, matchesSkillObservation, visibleText });
});
