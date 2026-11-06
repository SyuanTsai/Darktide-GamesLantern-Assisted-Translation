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
    check(v.schemaVersion === '1.0.0', 'schemaVersion'); string(v.gameVersion, VERSION); string(v.sourceCommit, COMMIT); string(v.textBatch, BATCH);
  }
  function validateCurrent(v) {
    safe(v); object(v, [...IDENTITY_KEYS, 'path', 'versions']); identity(v); string(v.path);
    array(v.versions, x => string(x, VERSION), { unique: true });
    check(v.path === 'data/' + v.gameVersion && v.versions.includes(v.gameVersion), 'current pointer');
    return v;
  }
  function bilingual(v) { object(v, ['en', 'zh']); nullable(v.en); nullable(v.zh); }
  function params(v) {
    check(record(v), 'params');
    for (const [k, p] of Object.entries(v)) {
      string(k, /^[a-z][a-z0-9_]*$/); object(p, ['value'], ['unit', 'unknown']);
      const primitive = x => check(x === null || ['string', 'boolean'].includes(typeof x) || (typeof x === 'number' && Number.isFinite(x)), 'param value');
      if (Array.isArray(p.value)) p.value.forEach(primitive); else primitive(p.value);
      if (Object.hasOwn(p, 'unit')) string(p.unit, /^[a-z][a-z0-9-]*$/);
      if (p.value === null) { check(Object.hasOwn(p, 'unknown'), 'unknown required'); enumeration(p.unknown, ['NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE', 'DYNAMIC_VALUE']); }
      else check(!Object.hasOwn(p, 'unknown'), 'unknown forbidden');
    }
  }
  function source(v) {
    object(v, ['commit', 'files', 'scriptVersion'], ['glossary', 'text']); string(v.commit, COMMIT);
    string(v.scriptVersion, /^(pipeline\/[a-z0-9-]+\.mjs@[0-9]+\.[0-9]+\.[0-9]+|legacy:[A-Za-z0-9._/-]+@[0-9a-f]{7,40})$/);
    array(v.files, f => { object(f, ['path'], ['line']); string(f.path, null, 1); if (Object.hasOwn(f, 'line')) integer(f.line, 1); }, { min: 1 });
    if (Object.hasOwn(v, 'glossary')) { const g = v.glossary; object(g, ['repo', 'commit', 'path', 'line']); string(g.repo, null, 1); string(g.commit, COMMIT); string(g.path, null, 1); integer(g.line, 1); }
    if (Object.hasOwn(v, 'text')) {
      object(v.text, ['batch', 'keys']); string(v.text.batch, BATCH); object(v.text.keys, [], ['name', 'description']); Object.values(v.text.keys).forEach(x => string(x));
    }
  }
  const ref = kind => new RegExp('^darktide:' + kind + ':[a-z0-9_.:-]+$');
  function values(v, category) {
    if (category === 'skills') {
      object(v, ['archetype', 'tree', 'nodeType', 'icon', 'parents', 'maxPoints', 'params']);
      string(v.archetype, null, 1); string(v.tree, null, 1); nullable(v.icon); integer(v.maxPoints, 1);
      enumeration(v.nodeType, ['ability', 'ability_modifier', 'aura', 'keystone', 'keystone_modifier', 'tactical', 'tactical_modifier', 'stat', 'start', 'default', 'broker_stimm']);
      array(v.parents, x => string(x, ref('skill')), { unique: true });
    } else if (category === 'weapons') {
      object(v, ['family', 'mark', 'weaponType', 'archetypes', 'actions', 'bars', 'blessings', 'params']);
      string(v.family, null, 1); string(v.mark, null, 1); string(v.weaponType, ref('term'));
      array(v.archetypes, x => string(x), { unique: true }); array(v.blessings, x => string(x, ref('blessing')), { unique: true });
      array(v.actions, a => { object(a, ['slot', 'id', 'type', 'name']); ['slot', 'id', 'type'].forEach(k => string(a[k])); bilingual(a.name); });
      array(v.bars, b => { object(b, ['id', 'name', 'stats']); string(b.id); bilingual(b.name);
        array(b.stats, s => { object(s, ['key', 'name', 'min', 'max']); string(s.key); bilingual(s.name); ['min', 'max'].forEach(k => check(typeof s[k] === 'number' && Number.isFinite(s[k]), 'stat')); }); });
    } else if (category === 'blessings') {
      object(v, ['weapons', 'tiers', 'params']); array(v.weapons, x => string(x, ref('weapon')), { unique: true, min: 1 });
      array(v.tiers, t => { object(t, ['tier', 'params']); integer(t.tier, 1, 4); params(t.params); }, { min: 1 });
    } else {
      object(v, ['category', 'context', 'refs', 'params']); nullable(v.context);
      enumeration(v.category, ['keyword', 'class', 'skill-type', 'weapon-type', 'weapon-stat', 'weapon-perk', 'quality', 'curio', 'curio-perk', 'curio-trait', 'mortis-buff']);
      array(v.refs, x => string(x, ID), { unique: true });
    }
    params(v.params);
  }
  function item(v, category) {
    object(v, ['id', 'key', 'name', 'official', 'values', 'explanation', 'errata', 'source'], ['aliases']);
    string(v.id, ref({ skills: 'skill', weapons: 'weapon', blessings: 'blessing', terms: 'term' }[category])); string(v.key, null, 1);
    object(v.name, ['en', 'zh', 'origin']); nullable(v.name.en); nullable(v.name.zh); enumeration(v.name.origin, ['official', 'glossary', 'internal']);
    bilingual(v.official); source(v.source);
    if (v.name.origin === 'glossary') check(Object.hasOwn(v.source, 'glossary'), 'glossary source');
    if (v.name.origin === 'official') string(v.name.en);
    if (v.name.origin === 'internal') { string(v.name.en, null, 1); check(v.name.zh === null, 'internal zh'); }
    object(v.explanation, ['effect', 'conditions', 'calculation', 'notes', 'extra']);
    Object.entries(v.explanation).forEach(([k, x]) => string(x, null, k === 'effect' ? 1 : 0));
    array(v.errata, e => { object(e, ['locale', 'official', 'corrected', 'valueRef']); enumeration(e.locale, ['en', 'zh']); string(e.official); string(e.corrected); string(e.valueRef, /^(\/([^~\/]|~[01])*)+$/); });
    if (Object.hasOwn(v, 'aliases')) {
      object(v.aliases, ['gameslantern']); object(v.aliases.gameslantern, ['ids'], ['path']);
      array(v.aliases.gameslantern.ids, x => string(x), { unique: true, min: 1 });
      if (Object.hasOwn(v.aliases.gameslantern, 'path')) string(v.aliases.gameslantern.path);
    }
    values(v.values, category);
  }
  function validateCategoryDocument(v, { category, current } = {}) {
    enumeration(category, CATEGORIES); validateCurrent(current); safe(v); object(v, [...IDENTITY_KEYS, 'category', 'items']); identity(v);
    check(v.category === category && IDENTITY_KEYS.every(k => v[k] === current[k]), 'category identity');
    array(v.items, x => item(x, category)); check(new Set(v.items.map(x => x.id)).size === v.items.length, 'unique ids'); return v;
  }
  function validateSnapshot({ current, documents } = {}) {
    validateCurrent(current); object(documents, CATEGORIES);
    CATEGORIES.forEach(category => validateCategoryDocument(documents[category], { category, current }));
    return freeze({ identity: Object.fromEntries(IDENTITY_KEYS.map(k => [k, current[k]])), current, documents });
  }
  return Object.freeze({ CATEGORIES, IDENTITY_KEYS, validateCurrent, validateCategoryDocument, validateSnapshot });
});
