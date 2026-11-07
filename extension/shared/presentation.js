(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./view-model.js') : root.W11SharedViewModel,
    commonJs ? require('./native-identity.js') : root.W11NativeIdentity
  );
  if (commonJs) module.exports = api;
  root.W11Presentation = api;
})(typeof globalThis === 'object' ? globalThis : this, function (view, identity) {
  'use strict';

  function visibleText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function slugify(value) {
    return visibleText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function documents(snapshot) {
    return snapshot?.identity && snapshot.documents
      && ['skills', 'weapons', 'blessings', 'terms'].every(key => Array.isArray(snapshot.documents[key]?.items))
      ? snapshot.documents : null;
  }

  function buildSkillViewModels(snapshot) {
    const data = documents(snapshot);
    return data ? data.skills.items.map(item => view.projectItem(item, data)) : [];
  }

  function buildBlessingViewModels(snapshot, context = {}) {
    const data = documents(snapshot);
    if (!data || !context || typeof context !== 'object' || Array.isArray(context)
      || (context.familyId === undefined) !== (context.markId === undefined)) return [];
    return data.blessings.items.flatMap(item => {
      const weapons = data.weapons.items.filter(weapon => item.values.weapons.includes(weapon.id));
      const selected = context.familyId === undefined ? null : weapons.find(weapon =>
        weapon.values.family === context.familyId && weapon.values.mark === context.markId);
      if (context.familyId !== undefined && !selected) return [];
      const base = view.projectItem(item, data);
      const tierTable = item.values.tiers.map(tier => ({ tier: tier.tier, params: view.parameters(tier.params) }));
      return item.values.tiers.filter(tier => context.tier === undefined || tier.tier === context.tier)
        .map(tier => ({
          ...base,
          blessingRef: { recordId: item.id },
          // A single Source-Data item replaces the old variant-selection dimension.
          variantRef: { recordId: item.id },
          tier: tier.tier,
          definedTiers: item.values.tiers.map(row => row.tier),
          tierTable,
          ...(selected ? { familyId: context.familyId, markId: context.markId } : {}),
          applicability: {
            status: selected ? 'verified' : 'unknown',
            weapons: weapons.map(weapon => ({
              id: weapon.id, familyId: weapon.values.family, markId: weapon.values.mark,
              name: view.localizedName(weapon) || weapon.name.en || weapon.key
            })),
            ...(selected ? { familyId: context.familyId, markId: context.markId } : {})
          }
        }));
    });
  }

  function buildWeaponFamilyViewModels(snapshot) {
    const data = documents(snapshot);
    if (!data) return [];
    const groups = new Map();
    for (const item of data.weapons.items) {
      const base = view.projectItem(item, data);
      const familyId = item.values.family;
      const familySlug = slugify(base.nativeName);
      const mark = {
        ...base,
        familyId, familySlug, markId: item.values.mark, markLabel: item.values.mark,
        name: base.translatedName,
        official: { resolvedText: base.translatedDescription, sourceText: base.translatedDescription },
        nativeImagePathPrefix: '/storage/sites/darktide/weapons/',
        bars: item.values.bars,
        actions: item.values.actions,
        blessings: item.values.blessings.flatMap(id => {
          const blessing = data.blessings.items.find(row => row.id === id);
          return blessing ? [{ id, name: view.localizedName(blessing) || blessing.name.en || blessing.key }] : [];
        }),
        curves: view.projectWeaponCurves(item),
        attackCombos: view.projectWeaponAttackCombos(item)
      };
      if (!groups.has(familyId)) groups.set(familyId, {
        familyId, familySlug, nativeName: base.nativeName, translatedName: base.translatedName, marks: []
      });
      groups.get(familyId).marks.push(mark);
    }
    return [...groups.values()];
  }

  function matchesSkillObservation(model, observation) {
    if (!model || !observation
      || !['gameslantern-ability-card-v1', 'gameslantern-ability-detail-v1'].includes(observation.structure)) return false;
    const strong = identity.matchAlias(model.aliases, observation);
    if (strong !== null) return strong;
    return !!visibleText(model.nativeName) && !!visibleText(model.nativeDescription)
      && visibleText(observation.name) === visibleText(model.nativeName)
      && visibleText(observation.description) === visibleText(model.nativeDescription);
  }

  function matchesBlessingObservation(model, observation) {
    if (!model || !observation || observation.structure !== 'gameslantern-blessing-row-v1'
      || observation.tier !== model.tier) return false;
    const strong = identity.matchAlias(model.aliases, observation);
    const exact = !!visibleText(model.nativeName) && !!visibleText(model.nativeDescription)
      && visibleText(observation.name) === visibleText(model.nativeName)
      && visibleText(observation.description) === visibleText(model.nativeDescription);
    if (!(strong === null ? exact : strong)) return false;
    const hasFamily = observation.familyId !== undefined;
    const hasMark = observation.markId !== undefined;
    return hasFamily === hasMark && (!hasFamily || model.applicability.weapons.some(weapon =>
      weapon.familyId === observation.familyId && weapon.markId === observation.markId));
  }

  function matchesWeaponObservation(model, observation) {
    if (!model || !observation || observation.structure !== 'gameslantern-weapon-detail-v1') return false;
    const strong = identity.matchAlias(model.aliases, observation);
    if (strong !== null) return strong;
    try {
      const url = new URL(observation.href);
      const image = new URL(observation.imageSrc, url.origin);
      const segments = url.pathname.split('/').filter(Boolean);
      const title = visibleText(observation.title);
      const suffix = visibleText(model.markLabel + ' ' + model.nativeName);
      // A supplied alias path can constrain the existing route fallback without
      // deriving an internal ID or a display mark from source-only family/mark keys.
      const hasAliasPath = typeof model.aliases?.path === 'string' && model.aliases.path.startsWith('/weapons/');
      const routeMatches = hasAliasPath ? url.pathname.replace(/\/$/, '') === model.aliases.path.replace(/\/$/, '')
        : segments[1] === model.familySlug;
      const titleMatches = (hasAliasPath && title === visibleText(model.nativeName))
        || title === suffix || title.endsWith(' ' + suffix);
      return !!visibleText(model.nativeName) && url.protocol === 'https:'
        && url.hostname === 'darktide.gameslantern.com' && !url.port && !url.username && !url.password
        && !url.search && !url.hash && /^\/weapons\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(url.pathname)
        && routeMatches && segments[2] === slugify(title) && titleMatches
        && visibleText(observation.mirrorTitle) === title && observation.imageAlt === 'Header Image'
        && image.protocol === 'https:' && ['darktide.gameslantern.com', 'gameslantern.com'].includes(image.hostname)
        && !image.port && !image.username && !image.password
        && image.pathname.startsWith(model.nativeImagePathPrefix) && !image.search && !image.hash;
    } catch (_) {
      return false;
    }
  }

  function findMatchingModels(models, observation, matcher) {
    const matches = models.filter(model => matcher(model, observation));
    const strong = matches.filter(model => identity.matchAlias(model.aliases, observation) === true);
    return strong.length ? strong : matches;
  }

  return Object.freeze({ buildSkillViewModels, buildBlessingViewModels, buildWeaponFamilyViewModels,
    matchesSkillObservation, matchesBlessingObservation, matchesWeaponObservation, findMatchingModels, visibleText,
    locateErratum: view.locateErratum, projectWeaponCurves: view.projectWeaponCurves,
    projectWeaponAttackCombos: view.projectWeaponAttackCombos });
});
