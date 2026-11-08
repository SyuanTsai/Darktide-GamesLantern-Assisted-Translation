(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SourceDataContract = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const CATEGORIES = Object.freeze(['skills', 'weapons', 'blessings', 'terms']);
  const IDENTITY_KEYS = Object.freeze(['schemaVersion', 'gameVersion', 'sourceCommit', 'textBatch']);
  const VERSION = /^[0-9]+(\.[0-9]+){1,3}$/;
  const COMMIT = /^[0-9a-fA-F]{40}$/;
  const BATCH = /^[A-Za-z0-9._-]{1,128}$/;
  const ID = /^darktide:(skill|weapon|blessing|term):[a-z0-9_.:-]+$/;
  const ITEM_CATEGORY_BY_ID_TYPE = Object.freeze({ skill: 'skills', weapon: 'weapons', blessing: 'blessings', term: 'terms' });
  function categoryFromItemId(id) {
    const type = /^darktide:(skill|weapon|blessing|term):/.exec(id)?.[1];
    return ITEM_CATEGORY_BY_ID_TYPE[type];
  }
  // Copied from domains.js safety policy; apply to every string, including source metadata.
  const EXECUTABLE_KEYS = new Set(['js', 'javascript', 'wasm', 'html', 'htmltemplate', 'templatehtml', 'htmlprogram',
    'selector', 'selectors', 'selectorprogram', 'domselectorprogram', 'queryselectorprogram', 'script',
    'remotescript', 'remotejs', 'remotewasm', 'executable', 'executor', 'evaluator',
    'formulaexecutor', 'formulaevaluator', 'formulaprogram', 'selectorcode', 'selectorquery']);
  const REMOTE_EXECUTABLE_PATTERN = /^(?:https?:)?\/\/[^\s?#]+\.(?:js|mjs|cjs|wasm|html?|xhtml)(?:[?#][^\s]*)?$/i;
  const ACTIVE_MARKUP_PATTERN = /<\/?(?:script|iframe|object|embed|template|html)\b/i;
  const ACTIVE_SCHEME_PATTERN = /(?:javascript\s*:|data\s*:\s*(?:text\/html|application\/(?:wasm|javascript)))/i;
  const FORMULA_EXECUTION_PATTERN = /(?:\beval\s*\(|\bnew\s+Function\s*\(|=>|\bimport\s*\(|\brequire\s*\()/i;
  function fail(message, code = 'SOURCE_DATA_INVALID') { const error = new Error(message); error.code = code; throw error; }
  function check(ok, label) { if (!ok) fail(label + ' is invalid'); }
  function record(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)); }
  function object(v, required, optional = []) {
    check(record(v), 'object');
    check(required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k)), 'object keys');
  }
  function string(v, pattern, min = 0) { check(typeof v === 'string' && v.length >= min && (!pattern || pattern.test(v)), 'string'); }
  function nullable(v) { if (v !== null) string(v); }
  function integer(v, min, max = Infinity) { check(Number.isInteger(v) && v >= min && v <= max, 'integer'); }
  function enumeration(v, values) { check(values.includes(v), 'enum'); }
  function array(v, validate, { min = 0, unique = false } = {}) {
    check(Array.isArray(v) && v.length >= min, 'array');
    if (unique) check(new Set(v.map(x => JSON.stringify(x))).size === v.length, 'unique array');
    v.forEach(validate);
  }
  function safe(v, key = '', depth = 0) {
    check(depth <= 64, 'nesting depth');
    if (Array.isArray(v)) return v.forEach(x => safe(x, key, depth + 1));
    if (v && typeof v === 'object') {
      check(record(v), 'plain object');
      for (const [k, child] of Object.entries(v)) {
        const normalized = k.replace(/[^a-z0-9]/gi, '').toLowerCase();
        check(!['__proto__', 'constructor', 'prototype'].includes(k) && !EXECUTABLE_KEYS.has(normalized), 'unsafe key');
        if (normalized === 'formula') check(typeof child === 'string', 'formula');
        safe(child, normalized, depth + 1);
      }
    } else if (typeof v === 'string') {
      check(!ACTIVE_MARKUP_PATTERN.test(v) && !ACTIVE_SCHEME_PATTERN.test(v) && !REMOTE_EXECUTABLE_PATTERN.test(v.trim())
        && !(key === 'formula' && FORMULA_EXECUTION_PATTERN.test(v)), 'unsafe string');
    }
  }
  function freeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
    return v;
  }
  function identity(v) {
    enumeration(v.schemaVersion, ['1.0.0', '1.1.0', '1.2.0']); string(v.gameVersion, VERSION); string(v.sourceCommit, COMMIT); string(v.textBatch, BATCH);
  }
  function validateCurrent(v) {
    safe(v); object(v, [...IDENTITY_KEYS, 'path', 'versions']); identity(v); string(v.path);
    array(v.versions, x => string(x, VERSION), { unique: true });
    check(v.path === 'data/' + v.gameVersion && v.versions.includes(v.gameVersion), 'current pointer');
    return v;
  }
  function bilingual(v) { object(v, ['en', 'zh']); nullable(v.en); nullable(v.zh); }
  function params(v, keyPattern = /^[a-z][a-z0-9_]*$/) {
    check(record(v), 'params');
    for (const [k, p] of Object.entries(v)) {
      string(k, keyPattern); object(p, ['value'], ['unit', 'unknown']);
      const primitive = x => check(x === null || ['string', 'boolean'].includes(typeof x) || (typeof x === 'number' && Number.isFinite(x)), 'param value');
      if (Array.isArray(p.value)) p.value.forEach(primitive); else primitive(p.value);
      if (Object.hasOwn(p, 'unit')) string(p.unit, /^[a-z][a-z0-9-]*$/);
      if (p.value === null) { check(Object.hasOwn(p, 'unknown'), 'unknown required'); enumeration(p.unknown, ['NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE', 'DYNAMIC_VALUE']); }
      else check(!Object.hasOwn(p, 'unknown'), 'unknown forbidden');
    }
  }
  const pointer = /^(\/([^~\/]|~[01])*)+$/;
  const mechanicsPattern = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,7}$/;
  const codeRefPattern = /^[A-Za-z0-9_./-]+#[A-Za-z0-9_.:\[\]-]+$/;
  function location(x) { object(x, ['path', 'line']); string(x.path, null, 1); integer(x.line, 1); }
  function source(v, schemaVersion, category) {
    object(v, ['commit', 'files', 'scriptVersion'], ['glossary', 'text', ...(schemaVersion === '1.2.0' && ['skills', 'blessings'].includes(category) ? ['valueSources', 'codeRefs'] : [])]); string(v.commit, COMMIT);
    string(v.scriptVersion, /^(pipeline\/[a-z0-9-]+\.mjs@[0-9]+\.[0-9]+\.[0-9]+|legacy:[A-Za-z0-9._/-]+@[0-9a-f]{7,40})$/);
    array(v.files, f => { object(f, ['path'], ['line']); string(f.path, null, 1); if (Object.hasOwn(f, 'line')) integer(f.line, 1); }, { min: 1 });
    if (Object.hasOwn(v, 'valueSources')) { check(record(v.valueSources), 'valueSources'); for (const [key, entries] of Object.entries(v.valueSources)) { string(key, pointer); array(entries, location, { min: 1 }); } }
    if (Object.hasOwn(v, 'codeRefs')) { check(record(v.codeRefs), 'codeRefs'); for (const [key, entry] of Object.entries(v.codeRefs)) { string(key, codeRefPattern); object(entry, ['path', 'symbol', 'sha256']); const [path, symbol] = key.split('#'); check(entry.path === path && entry.symbol === symbol, 'codeRef identity'); string(entry.sha256, /^[a-f0-9]{64}$/); } }
    if (Object.hasOwn(v, 'glossary')) { const g = v.glossary; object(g, ['repo', 'commit', 'path', 'line']); string(g.repo, null, 1); string(g.commit, COMMIT); string(g.path, null, 1); integer(g.line, 1); }
    if (Object.hasOwn(v, 'text')) {
      object(v.text, ['batch', 'keys']); string(v.text.batch, BATCH); object(v.text.keys, [], ['name', 'description']); Object.values(v.text.keys).forEach(x => string(x));
    }
  }
  const ref = kind => new RegExp('^darktide:' + kind + ':[a-z0-9_.:-]+$');
  function values(v, category, schemaVersion) {
    const modern = schemaVersion !== '1.0.0' && Number(schemaVersion.split('.')[1]) >= 1;
    if (category === 'skills') {
      object(v, ['archetype', 'tree', 'nodeType', 'icon', 'parents', 'maxPoints', 'params'], schemaVersion === '1.2.0' ? ['mechanics'] : []);
      string(v.archetype, null, 1); string(v.tree, null, 1); nullable(v.icon); integer(v.maxPoints, 1);
      enumeration(v.nodeType, ['ability', 'ability_modifier', 'aura', 'keystone', 'keystone_modifier', 'tactical', 'tactical_modifier', 'stat', 'start', 'default', 'broker_stimm']);
      array(v.parents, x => string(x, ref('skill')), { unique: true });
    } else if (category === 'weapons') {
      object(v, ['family', 'mark', 'weaponType', 'archetypes', 'actions', 'bars', 'blessings', 'params', ...(modern ? ['curves', 'attackCombos'] : [])], modern ? ['damageProfiles'] : []);
      string(v.family, null, 1); string(v.mark, null, 1); string(v.weaponType, ref('term'));
      array(v.archetypes, x => string(x), { unique: true }); array(v.blessings, x => string(x, ref('blessing')), { unique: true });
      array(v.actions, a => { object(a, ['slot', 'id', 'type', 'name']); ['slot', 'id', 'type'].forEach(k => string(a[k])); bilingual(a.name); });
      array(v.bars, b => { object(b, ['id', 'name', 'stats']); string(b.id); bilingual(b.name);
        array(b.stats, s => { object(s, ['key', 'name', 'min', 'max', ...(modern ? ['curveId'] : [])]); if (modern) string(s.curveId); string(s.key); bilingual(s.name); ['min', 'max'].forEach(k => check(typeof s[k] === 'number' && Number.isFinite(s[k]), 'stat')); }); });
      if (modern) {
        const reasons = ['LERP_T_OUT_OF_RANGE','NONLINEAR_COMBINATION','NONLINEAR_LERP','CONDITIONAL_CHAIN','CHAIN_TARGET_NOT_FOUND','CHAIN_START_AMBIGUOUS','CHAIN_CYCLE_WITHOUT_ATTACK','DYNAMIC_VALUE','REFERENCE_NOT_FOUND','DAMAGE_PROFILE_BINDING_NOT_FOUND'];
        const location = x => { object(x, ['path', 'line']); string(x.path, null, 1); integer(x.line, 1); };
        const number = x => check(typeof x === 'number' && Number.isFinite(x), 'number');
        const unknownReasons = ['NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE', 'DYNAMIC_VALUE'];
        if (Object.hasOwn(v, 'damageProfiles')) {
          const rawPower = p => {
            object(p, ['kind', 'min', 'max', 'unknown', 'source']);
            enumeration(p.kind, ['fixed', 'lerp', 'unknown']); location(p.source);
            if (p.kind === 'unknown') { check(p.min === null && p.max === null, 'unknown power'); enumeration(p.unknown, unknownReasons); }
            else { number(p.min); number(p.max); check(p.unknown === null, 'known power'); }
          };
          array(v.damageProfiles, p => {
            object(p, ['id', 'distributions', 'bindings', 'unknown', 'source']); string(p.id, null, 1);
            enumeration(p.unknown, [null, ...unknownReasons]); location(p.source);
            array(p.distributions, d => {
              object(d, ['target', 'range', 'attack', 'impact']);
              if (d.target !== null && d.target !== 'default') integer(d.target, 1);
              enumeration(d.range, [null, 'near', 'far']); rawPower(d.attack); rawPower(d.impact);
            });
            array(p.bindings, b => {
              object(b, ['action', 'kind', 'template', 'source'], ['powerLevel']); string(b.action, null, 1);
              enumeration(b.kind, ['action', 'hitScan', 'projectile', 'shotshell', 'flamerGas', 'explosion']); nullable(b.template); location(b.source);
              if (b.kind === 'hitScan' || b.kind === 'projectile') {
                string(b.template, null, 1); object(b.powerLevel, ['value', 'unknown', 'source']); location(b.powerLevel.source);
                if (b.powerLevel.value === null) enumeration(b.powerLevel.unknown, unknownReasons);
                else { number(b.powerLevel.value); check(b.powerLevel.unknown === null, 'known power level'); }
              } else check(!Object.hasOwn(b, 'powerLevel'), 'power level forbidden');
            });
          });
          check(new Set(v.damageProfiles.map(p => p.id)).size === v.damageProfiles.length, 'damage profile ids');
        }
        array(v.curves, c => {
          object(c, ['id','bar','stat','name','input','interpolation','knots','outputUnit','unknown','source']);
          ['id','bar','stat'].forEach(k => string(c[k])); bilingual(c.name);
          object(c.input, ['source','unit','min','max']); check(c.input.source === 'base_stat_value' && c.input.unit === 'ratio' && c.input.min === 0 && c.input.max === 1, 'curve input');
          enumeration(c.interpolation, ['linear','unknown']); nullable(c.outputUnit); enumeration(c.unknown, [null, ...reasons]); location(c.source);
          array(c.knots, k => { object(k, ['input','output']); number(k.input); if (Array.isArray(k.output)) k.output.forEach(number); else if (k.output !== null) number(k.output); });
          check(c.knots.length === 2 && c.knots.every(k => k.input === 0 || k.input === 1), 'curve knots');
          if (c.interpolation === 'unknown') check(c.unknown !== null && c.knots.every(k => k.output === null), 'curve unknown');
          if (c.unknown === null) check(c.interpolation === 'linear' && c.knots.every(k => k.output !== null), 'curve known');
        });
        check(new Set(v.curves.map(c => c.id)).size === v.curves.length, 'curve ids');
        const stats = v.bars.flatMap(b => b.stats.map(stat => ({ bar: b.id, stat })));
        for (const c of v.curves) {
          check(stats.filter(x => x.stat.curveId === c.id && x.bar === c.bar).length === 1, 'curve reference');
        }
        for (const { bar, stat } of stats) check(v.curves.filter(c => c.id === stat.curveId && c.bar === bar).length === 1, 'stat reference');
        array(v.attackCombos, c => {
          object(c, ['id','kind','start','steps','loopsTo','unknown','source']); string(c.id); enumeration(c.kind, ['light','heavy']); string(c.start); enumeration(c.unknown, [null, ...reasons]); location(c.source);
          array(c.steps, step => { object(step, ['action','input','name','damageProfile','damageProfileUnknown']); string(step.action); string(step.input); bilingual(step.name); nullable(step.damageProfile); enumeration(step.damageProfileUnknown, [null, ...reasons]); check(step.damageProfile === null ? step.damageProfileUnknown !== null : step.damageProfileUnknown === null, 'damage profile unknown'); });
          if (c.loopsTo !== null) integer(c.loopsTo, 0);
        });
      }
    } else if (category === 'blessings') {
      object(v, ['weapons', 'tiers', 'params'], schemaVersion === '1.2.0' ? ['mechanics'] : []); array(v.weapons, x => string(x, ref('weapon')), { unique: true, min: 1 });
      array(v.tiers, t => { object(t, ['tier', 'params'], schemaVersion === '1.2.0' ? ['mechanics'] : []); integer(t.tier, 1, 4); params(t.params); if (Object.hasOwn(t, 'mechanics')) params(t.mechanics, mechanicsPattern); }, { min: 1 });
    } else {
      object(v, ['category', 'context', 'refs', 'params']); nullable(v.context);
      enumeration(v.category, ['keyword', 'class', 'skill-type', 'weapon-type', 'weapon-stat', 'weapon-perk', 'quality', 'curio', 'curio-perk', 'curio-trait', 'mortis-buff']);
      array(v.refs, x => string(x, ID), { unique: true });
    }
    params(v.params);
    if (Object.hasOwn(v, 'mechanics')) params(v.mechanics, mechanicsPattern);
  }
  function item(v, category, schemaVersion) {
    object(v, ['id', 'key', 'name', 'official', 'values', 'explanation', 'errata', 'source'], ['aliases', 'retainedFrom', ...(schemaVersion === '1.2.0' && ['skills', 'blessings'].includes(category) ? ['citations'] : [])]);
    if (Object.hasOwn(v, 'retainedFrom')) {
      const r = v.retainedFrom; object(r, ['gameVersion', 'sourceCommit', 'textBatch']);
      string(r.gameVersion, VERSION); string(r.sourceCommit, COMMIT); string(r.textBatch, BATCH);
    }
    string(v.id, ref({ skills: 'skill', weapons: 'weapon', blessings: 'blessing', terms: 'term' }[category])); string(v.key, null, 1);
    object(v.name, ['en', 'zh', 'origin']); nullable(v.name.en); nullable(v.name.zh); enumeration(v.name.origin, ['official', 'glossary', 'internal']);
    bilingual(v.official); source(v.source, schemaVersion, category);
    if (v.name.origin === 'glossary') check(Object.hasOwn(v.source, 'glossary'), 'glossary source');
    if (v.name.origin === 'official') string(v.name.en);
    if (v.name.origin === 'internal') { string(v.name.en, null, 1); check(v.name.zh === null, 'internal zh'); }
    const sections = ['effect', 'conditions', 'calculation', 'notes', 'extra'];
    const modern = schemaVersion !== '1.0.0' && Number(schemaVersion.split('.')[1]) >= 1;
    object(v.explanation, sections, modern && ['blessings', 'skills'].includes(category) ? ['effectOrigin'] : []);
    sections.forEach(k => string(v.explanation[k], null, k === 'effect' ? 1 : 0));
    if (Object.hasOwn(v.explanation, 'effectOrigin')) enumeration(v.explanation.effectOrigin, ['official', 'unofficial-translation']);
    if (Object.hasOwn(v, 'citations')) array(v.citations, c => {
      object(c, ['section', 'text', 'codeRefs', 'valueRefs']); enumeration(c.section, sections); string(c.text, null, 1);
      array(c.codeRefs, x => string(x, codeRefPattern), { unique: true }); array(c.valueRefs, x => string(x, pointer), { unique: true });
      check(c.codeRefs.length + c.valueRefs.length > 0, 'citation refs');
    });
    array(v.errata, e => {
      object(e, ['locale', 'official', 'corrected', 'valueRefs', 'sources'], ['anchor']); enumeration(e.locale, ['en', 'zh']); string(e.official); string(e.corrected);
      array(e.valueRefs, x => string(x, pointer), { min: 1 }); array(e.sources, location, { min: 1 });
      if (Object.hasOwn(e, 'anchor')) {
        const a = e.anchor; object(a, ['field', 'locale', 'text', 'occurrence'], ['itemId', 'param', 'tier']);
        enumeration(a.field, ['official', 'name', 'displayParameter']); enumeration(a.locale, ['en', 'zh']); check(a.locale === e.locale, 'anchor locale'); string(a.text, null, 1); integer(a.occurrence, 1);
        if (Object.hasOwn(a, 'itemId')) string(a.itemId, ID);
        if (a.field === 'displayParameter') { string(a.param, /^[a-z][a-z0-9_]*$/); const targetCategory = Object.hasOwn(a, 'itemId') ? categoryFromItemId(a.itemId) : category; if (targetCategory === 'blessings') check(Object.hasOwn(a, 'tier'), 'tier required'); if (Object.hasOwn(a, 'tier')) integer(a.tier, 1, 4); }
        else check(!Object.hasOwn(a, 'param') && !Object.hasOwn(a, 'tier'), 'anchor fields forbidden');
      }
    });
    if (Object.hasOwn(v, 'aliases')) {
      object(v.aliases, ['gameslantern']); object(v.aliases.gameslantern, ['ids'], ['path']);
      array(v.aliases.gameslantern.ids, x => string(x), { unique: true, min: 1 });
      if (Object.hasOwn(v.aliases.gameslantern, 'path')) string(v.aliases.gameslantern.path);
    }
    values(v.values, category, schemaVersion);
  }
  function validateCategoryDocument(v, { category, current } = {}) {
    enumeration(category, CATEGORIES); validateCurrent(current); safe(v); object(v, [...IDENTITY_KEYS, 'category', 'items']); identity(v);
    check(v.category === category && IDENTITY_KEYS.every(k => v[k] === current[k]), 'category identity');
    array(v.items, x => item(x, category, v.schemaVersion)); check(new Set(v.items.map(x => x.id)).size === v.items.length, 'unique ids'); return v;
  }
  function validateSnapshot({ current, documents } = {}) {
    validateCurrent(current); object(documents, CATEGORIES);
    CATEGORIES.forEach(category => validateCategoryDocument(documents[category], { category, current }));
    return freeze({ identity: Object.fromEntries(IDENTITY_KEYS.map(k => [k, current[k]])), current, documents });
  }
  return Object.freeze({ CATEGORIES, IDENTITY_KEYS, validateCurrent, validateCategoryDocument, validateSnapshot });
});
