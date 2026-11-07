(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(commonJs ? require('./presentation.js') : root.W11Presentation);
  if (commonJs) module.exports = api;
  root.W16ProductionDataset = api;
})(typeof globalThis === 'object' ? globalThis : this, function (presentationApi) {
  'use strict';

  const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;

  function exactKeys(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be an object');
    const actual = Object.keys(value).sort();
    const keys = [...expected].sort();
    if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
      throw new TypeError(label + ' must contain exactly: ' + keys.join(', '));
    }
  }

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return Uint8Array.from(value);
    }
    throw new TypeError('native DOM evidence must be bytes');
  }

  function normalizePatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native patch evidence is invalid');
    if (value.status === 'selected') {
      exactKeys(value, ['status', 'label'], 'selected native patch');
      if (typeof value.label !== 'string' || !value.label.trim()) throw new TypeError('selected patch label is invalid');
      return Object.freeze({ status: 'selected', label: value.label });
    }
    exactKeys(value, ['status'], 'native patch');
    if (!['absent', 'ambiguous'].includes(value.status)) throw new TypeError('native patch status is invalid');
    return Object.freeze({ status: value.status });
  }

  function normalizeSkillObservation(value) {
    exactKeys(value, ['structure', 'name', 'description', ...(value.gameslanternId === undefined ? [] : ['gameslanternId'])], 'native skill observation');
    if (value.gameslanternId !== undefined && (typeof value.gameslanternId !== 'string' || !value.gameslanternId)) throw new TypeError('invalid observed ID');
    if (!['gameslantern-ability-card-v1', 'gameslantern-ability-detail-v1'].includes(value.structure)
      || typeof value.name !== 'string' || !value.name.trim()
      || typeof value.description !== 'string' || !value.description.trim()) {
      throw new TypeError('native skill observation is incomplete');
    }
    return Object.freeze({ structure: value.structure, name: value.name, description: value.description, ...(value.gameslanternId === undefined ? {} : {gameslanternId:value.gameslanternId}) });
  }

  function normalizeWeaponObservation(value) {
    exactKeys(value, ['structure', 'route', 'title', 'mirrorTitle', 'imageAlt', 'imagePath', ...(value.gameslanternId === undefined ? [] : ['gameslanternId'])], 'native weapon observation');
    if (value.gameslanternId !== undefined && (typeof value.gameslanternId !== 'string' || !value.gameslanternId)) throw new TypeError('invalid observed ID');
    if (value.structure !== 'gameslantern-weapon-detail-v1'
      || typeof value.route !== 'string' || typeof value.title !== 'string'
      || typeof value.mirrorTitle !== 'string' || value.imageAlt !== 'Header Image'
      || typeof value.imagePath !== 'string') throw new TypeError('native weapon observation is incomplete');
    if (!/^\/weapons\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(value.route)
      || !value.imagePath.startsWith('/storage/sites/darktide/weapons/')
      || !/\.(?:png|webp|jpe?g)$/i.test(value.imagePath)) {
      throw new TypeError('native weapon observation escaped its supported page or image path');
    }
    return Object.freeze({ structure: value.structure,
      href: 'https://darktide.gameslantern.com' + value.route,
      title: value.title, mirrorTitle: value.mirrorTitle, imageAlt: value.imageAlt,
      ...(value.gameslanternId === undefined ? {} : {gameslanternId:value.gameslanternId}),
      imageSrc: 'https://darktide.gameslantern.com' + value.imagePath });
  }

  function parseNativeEvidence(rawValue) {
    const bytes = toBytes(rawValue);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES) throw new TypeError('native DOM evidence size is invalid');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (_) { throw new TypeError('native DOM evidence is not valid UTF-8 JSON'); }
    exactKeys(value, ['schemaVersion', 'pathname', 'patch', 'skills', 'weapons'], 'native DOM evidence');
    if (value.schemaVersion !== 'w11-native-dom-evidence/1'
      || typeof value.pathname !== 'string'
      || !/^\/(?:build-editor|abilities(?:\/[a-z0-9-]+)?|weapon-blessing-traits|weapons(?:\/[a-z0-9-]+){1,2})\/?$/i.test(value.pathname)
      || !Array.isArray(value.skills) || !Array.isArray(value.weapons)) {
      throw new TypeError('native DOM evidence is invalid');
    }
    if (value.weapons.some((weapon) => weapon.route !== value.pathname)
      || (value.skills.some((skill) => skill.structure === 'gameslantern-ability-detail-v1')
        && !/^\/abilities\/[a-z0-9-]+\/?$/i.test(value.pathname))) {
      throw new TypeError('native DOM evidence does not match its observed page route');
    }
    return Object.freeze({ pathname: value.pathname, patch: normalizePatch(value.patch),
      skills: Object.freeze(value.skills.map(normalizeSkillObservation)),
      weapons: Object.freeze(value.weapons.map(normalizeWeaponObservation)) });
  }

  function createProductionDatasetResolver({ loadSnapshot, presentationApi: presentation = presentationApi } = {}) {
    if (typeof loadSnapshot !== 'function') throw new TypeError('production dataset resolver requires a verified snapshot loader');
    if (!presentation || typeof presentation.buildSkillViewModels !== 'function'
      || typeof presentation.buildWeaponFamilyViewModels !== 'function'
      || typeof presentation.matchesSkillObservation !== 'function'
      || typeof presentation.matchesWeaponObservation !== 'function') {
      throw new TypeError('production dataset presentation functions are unavailable');
    }
    let snapshotPromise = null;

    async function getPinnedSnapshot() {
      if (!snapshotPromise) {
        snapshotPromise = Promise.resolve().then(() => loadSnapshot()).then((result) =>
          result?.status === 'ready' && result.snapshot?.identity && result.snapshot.documents
            && ['schemaVersion','gameVersion','sourceCommit','textBatch'].every(k=>result.identity?.[k]===result.snapshot.identity[k]) ? result.snapshot : null, () => null);
      }
      return snapshotPromise;
    }

    async function resolve(rawEvidence) {
      let evidence;
      try { evidence = parseNativeEvidence(rawEvidence); }
      catch (_) { return Object.freeze({ status: 'unknown', reason: 'no-matching-presentation' }); }
      if (evidence.patch.status === 'ambiguous' || (evidence.skills.length === 0 && evidence.weapons.length === 0)) {
        return Object.freeze({ status: 'unknown', reason: 'no-matching-presentation' });
      }
      const snapshot = await getPinnedSnapshot();
      if (!snapshot) return Object.freeze({ status: 'unknown', reason: 'no-matching-presentation' });

      let skills = [];
      let families = [];
      try { skills = presentation.buildSkillViewModels(snapshot); } catch (_) { /* no applicable presentation */ }
      try { families = presentation.buildWeaponFamilyViewModels(snapshot); } catch (_) { /* no applicable weapon data */ }
      const skillModels = Array.isArray(skills) ? skills : [];
      const weaponModels = Array.isArray(families)
        ? families.flatMap((family) => Array.isArray(family.marks)
          ? family.marks.map((mark) => ({ family, mark })) : []) : [];
      const hasExactSkill = evidence.skills.some((observation) => presentation.findMatchingModels(skillModels,
        observation, presentation.matchesSkillObservation).length === 1);
      const hasExactWeapon = evidence.weapons.some((observation) => presentation.findMatchingModels(
        weaponModels.map(row => row.mark), observation, presentation.matchesWeaponObservation).length === 1);
      if (!hasExactSkill && !hasExactWeapon) {
        return Object.freeze({ status: 'unknown', reason: 'no-matching-presentation' });
      }
      return Object.freeze({ status: 'verified', identity: Object.freeze({ ...snapshot.identity }),
        ...(evidence.patch.status === 'selected' ? { patchLabel: evidence.patch.label } : {}) });
    }

    return Object.freeze({ resolve, loadPinnedSnapshotForReading: getPinnedSnapshot });
  }

  return Object.freeze({ createProductionDatasetResolver, parseNativeEvidence });
});
