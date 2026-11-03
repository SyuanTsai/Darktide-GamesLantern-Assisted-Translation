'use strict';

const { createHash } = require('node:crypto');

function clone(value) { return structuredClone(value); }

function recordKey(value) {
  return value && typeof value.gameReleaseId === 'string' && typeof value.recordId === 'string'
    ? value.gameReleaseId + '\u0000' + value.recordId : null;
}

function visit(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  if (Array.isArray(value)) {
    for (const row of value) visit(row, callback);
  } else {
    for (const row of Object.values(value)) visit(row, callback);
  }
}

function referencedRecordKeys(value, known) {
  const keys = new Set();
  visit(value, (row) => {
    const key = recordKey(row);
    if (key && known.has(key)) keys.add(key);
  });
  return keys;
}

function referencedSourceIds(value) {
  const ids = new Set();
  visit(value, (row) => {
    if (typeof row.sourceId === 'string') ids.add(row.sourceId);
  });
  return ids;
}

function referencedOfficialIds(value) {
  const ids = new Set();
  visit(value, (row) => {
    if (typeof row.officialSourceId === 'string') ids.add(row.officialSourceId);
  });
  return ids;
}

function referencedTermRuleIds(value) {
  const ids = new Set();
  visit(value, (row) => {
    if (Array.isArray(row.termRuleRefs)) {
      for (const id of row.termRuleRefs) if (typeof id === 'string') ids.add(id);
    }
  });
  return ids;
}

function selectClosure(domain, roots, includeClosure) {
  const byKey = new Map(domain.source.records.map((record) => [recordKey(record), record]));
  const selected = new Map(roots.map((record) => [recordKey(record), record]));
  if (includeClosure) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const key of referencedRecordKeys([...selected.values()], byKey)) {
        if (!selected.has(key)) {
          selected.set(key, byKey.get(key));
          changed = true;
        }
      }
    }
  }
  return selected;
}

function rowsBelongingTo(keys, rows) {
  return rows.filter((row) => [...referencedRecordKeys(row, new Map([...keys].map((key) => [key, true])))].length > 0);
}

function projectDomain(domain, kind, roots, includeClosure) {
  const selected = selectClosure(domain, roots, includeClosure);
  const rootKeys = new Set(roots.map(recordKey));
  const selectedKeys = new Set(selected.keys());
  const presentations = domain.web.presentations.filter((row) => rootKeys.has(recordKey(row.entityRef)));
  const officialIds = referencedOfficialIds(presentations);
  const sourceIds = referencedSourceIds([...selected.values(), ...presentations]);
  const termRuleIds = referencedTermRuleIds(presentations);
  return {
    schemaVersion: domain.schemaVersion,
    kind,
    gameReleaseId: domain.gameReleaseId,
    source: {
      repository: domain.source.repository,
      gameReleases: clone(domain.source.gameReleases),
      sourceSnapshots: clone(domain.source.sourceSnapshots),
      sourceRefs: clone(domain.source.sourceRefs.filter((row) => sourceIds.has(row.sourceId))),
      records: clone([...selected.values()]),
      tombstones: [],
      reviewReceipts: clone(rowsBelongingTo(selectedKeys, domain.source.reviewReceipts))
    },
    web: {
      presentations: clone(presentations),
      officialInputs: { sources: clone(domain.web.officialInputs.sources
        .filter((row) => officialIds.has(row.officialSourceId))) },
      termLocalizations: clone(domain.web.termLocalizations.filter((row) => selectedKeys.has(recordKey(row.termRef)))),
      ...(Array.isArray(domain.web.termRules) ? {
        termRules: clone(domain.web.termRules.filter((row) => termRuleIds.has(row.ruleId)))
      } : {}),
      announcements: [],
      gameChanges: [],
      officialTextChanges: [],
      reviewTargets: clone(rowsBelongingTo(rootKeys, domain.web.reviewTargets)),
      reviewReceipts: clone(rowsBelongingTo(rootKeys, domain.web.reviewReceipts))
    }
  };
}

function blessingSlug(recordId) {
  return recordId.replace(/^darktide:blessing:/, '').replace(/[^A-Za-z0-9._-]/g, '-');
}

function sha256(raw) { return createHash('sha256').update(raw).digest('hex'); }

function splitManifestFor(legacySnapshot, domains) {
  const dependencies = {
    skills: ['domains/terms.json'], terms: [], 'weapons-index': [],
    'weapon-family': ['domains/weapons-index.json'], 'blessings-index': [],
    blessing: ['domains/blessings-index.json']
  };
  const splitRows = [...domains].map(([filePath, document]) => {
    const raw = Buffer.from(JSON.stringify(document), 'utf8');
    return { kind: document.kind, path: filePath, sizeBytes: raw.byteLength,
      sha256: sha256(raw), dependencies: dependencies[document.kind] };
  });
  const optionalRows = legacySnapshot.manifest.files.filter((row) =>
    !['skills', 'terms', 'weapons', 'blessings'].includes(row.kind));
  const manifest = clone(legacySnapshot.manifest);
  manifest.compatibility.requiredFeatures = [...manifest.compatibility.requiredFeatures,
    'split-weapon-blessing-domains-v1'];
  manifest.files = [...optionalRows, ...splitRows]
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return manifest;
}

function deriveSplitSnapshot(legacySnapshot) {
  const legacy = [...legacySnapshot.domains.values()];
  const weapons = legacy.find((domain) => domain.kind === 'weapons');
  const blessings = legacy.find((domain) => domain.kind === 'blessings');
  if (!weapons || !blessings) throw new Error('legacy fixture must contain weapons and blessings domains');
  const domains = new Map();
  for (const domain of legacy.filter((row) => !['weapons', 'blessings'].includes(row.kind))) {
    domains.set('domains/' + domain.kind + '.json', clone(domain));
  }

  const weaponRoots = weapons.source.records.filter((record) => record.kind === 'weapon');
  domains.set('domains/weapons-index.json', projectDomain(weapons, 'weapons-index', weaponRoots, false));
  const familyIds = [...new Set(weaponRoots.map((record) => record.payload?.familyId).filter((value) => typeof value === 'string'))];
  for (const familyId of familyIds) {
    const roots = weaponRoots.filter((record) => record.payload?.familyId === familyId);
    domains.set('domains/weapons/' + familyId + '.json', projectDomain(weapons, 'weapon-family', roots, true));
  }

  const blessingRoots = blessings.source.records.filter((record) => record.kind === 'blessing');
  domains.set('domains/blessings-index.json', projectDomain(blessings, 'blessings-index', blessingRoots, false));
  for (const root of blessingRoots) {
    domains.set('domains/blessings/' + blessingSlug(root.recordId) + '.json',
      projectDomain(blessings, 'blessing', [root], true));
  }
  return { ...legacySnapshot, domains };
}

function deriveRouteSplitSnapshot(legacySnapshot, pathname, { familyId } = {}) {
  const normalized = typeof pathname === 'string' ? pathname.replace(/\/$/, '') : '';
  if (!/^\/(?:build-editor|abilities(?:\/[a-z0-9-]+)?|weapon-blessing-traits|weapons(?:\/[a-z0-9-]+){1,2})$/i
    .test(normalized)) throw new Error('unsupported split fixture route: ' + pathname);
  const full = deriveSplitSnapshot(legacySnapshot);
  const selectedPaths = [];
  if (normalized === '/build-editor' || normalized === '/abilities' || normalized.startsWith('/abilities/')) {
    selectedPaths.push('domains/skills.json', 'domains/terms.json');
  } else if (normalized === '/weapon-blessing-traits') {
    selectedPaths.push('domains/blessings-index.json', 'domains/weapons-index.json',
      ...[...full.domains.keys()].filter((filePath) => filePath.startsWith('domains/blessings/')));
  } else {
    if (typeof familyId !== 'string' || !familyId) throw new Error('weapon route fixture requires familyId');
    selectedPaths.push('domains/blessings-index.json', 'domains/weapons-index.json',
      'domains/weapons/' + familyId + '.json');
  }
  selectedPaths.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const domains = new Map(selectedPaths.map((filePath) => [filePath, full.domains.get(filePath)]));
  if ([...domains.values()].some((document) => !document)) throw new Error('split fixture route closure is incomplete');
  const manifest = splitManifestFor(legacySnapshot, full.domains);
  const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8');
  const rawFiles = new Map([...domains].map(([filePath, document]) =>
    [filePath, Buffer.from(JSON.stringify(document), 'utf8')]));
  const counts = new Map();
  for (const document of domains.values()) counts.set(document.kind, (counts.get(document.kind) || 0) + 1);
  const fileBytes = [...rawFiles.values()].reduce((sum, raw) => sum + raw.byteLength, 0);
  const stats = {
    pathname: normalized,
    kinds: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, 'en'))),
    fileCount: rawFiles.size,
    fileBytes,
    manifestBytes,
    totalBytes: manifestBytes + fileBytes,
    maxFileBytes: Math.max(...[...rawFiles.values()].map((raw) => raw.byteLength))
  };
  return { snapshot: { ...full, manifest, files: rawFiles, domains }, stats };
}

module.exports = { deriveRouteSplitSnapshot, deriveSplitSnapshot };
