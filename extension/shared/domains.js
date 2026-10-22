(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedDomains = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const DOMAIN_SCHEMA = 'w08-shared-domain/1.0.0';
  const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
  const CORE_DOMAIN_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
  const CORE_DOMAIN_SET = new Set(CORE_DOMAIN_KINDS);
  const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const GAME_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;
  const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const SHA1_PATTERN = /^[a-f0-9]{40}$/;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/;
  const REVIEW_STATES = new Set(['approved', 'pending', 'stale', 'rejected']);
  const ALLOWED_WEB_KEYS = new Set([
    'presentations', 'officialInputs', 'termLocalizations', 'termRules', 'announcements',
    'gameChanges', 'officialTextChanges', 'reviewTargets', 'reviewReceipts'
  ]);
  const REQUIRED_WEB_ARRAYS = Object.freeze([
    'presentations', 'termLocalizations', 'announcements', 'gameChanges',
    'officialTextChanges', 'reviewTargets', 'reviewReceipts'
  ]);
  const EXECUTABLE_KEYS = new Set([
    'js', 'javascript', 'wasm', 'html', 'htmltemplate', 'templatehtml', 'htmlprogram',
    'selector', 'selectors', 'selectorprogram', 'domselectorprogram', 'queryselectorprogram',
    'script', 'remotescript', 'remotejs', 'remotewasm', 'executable', 'executor', 'evaluator'
  ]);
  const SAFE_SOURCE_METADATA_KEYS = new Set(['publicurl', 'repository', 'path', 'commit']);
  const REMOTE_EXECUTABLE_PATTERN = /^(?:https?:)?\/\/[^\s?#]+\.(?:js|mjs|cjs|wasm|html?|xhtml)(?:[?#][^\s]*)?$/i;
  const ACTIVE_MARKUP_PATTERN = /<\/?(?:script|iframe|object|embed|template|html)\b/i;
  const ACTIVE_SCHEME_PATTERN = /(?:javascript\s*:|data\s*:\s*(?:text\/html|application\/(?:wasm|javascript)))/i;
  const FORMULA_EXECUTION_PATTERN = /(?:\beval\s*\(|\bnew\s+Function\s*\(|=>|\bimport\s*\(|\brequire\s*\()/i;

  function fail(message) {
    throw new Error(message);
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireRecord(value, label) {
    if (!isRecord(value)) fail(label + ' must be an object');
    return value;
  }

  function requireString(value, label) {
    if (typeof value !== 'string' || value.trim() === '') fail(label + ' must be a non-empty string');
    return value;
  }

  function requireExactKeys(value, keys, label) {
    requireRecord(value, label);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    const unexpected = actual.find((key) => !expected.includes(key));
    if (unexpected) fail(label + ' contains unexpected property: ' + unexpected);
    const missing = expected.find((key) => !actual.includes(key));
    if (missing) fail(label + ' is missing required property: ' + missing);
  }

  function sourceRecordKey(value) {
    return value.gameReleaseId + '\u0000' + value.recordId;
  }

  function sourceRefKey(value) {
    return value.gameReleaseId + '\u0000' + value.sourceId;
  }

  function sourceReviewTargetKey(value) {
    return [value.gameReleaseId, value.recordId, value.fieldPath, value.dimension].join('\u0000');
  }

  function collectTypedRecordPointers(value, pointers = []) {
    if (Array.isArray(value)) {
      for (const item of value) collectTypedRecordPointers(item, pointers);
      return pointers;
    }
    if (!isRecord(value)) return pointers;
    if (typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string') pointers.push(value);
    for (const child of Object.values(value)) collectTypedRecordPointers(child, pointers);
    return pointers;
  }

  function collectSourcePointers(value, pointers = []) {
    if (Array.isArray(value)) {
      for (const item of value) collectSourcePointers(item, pointers);
      return pointers;
    }
    if (!isRecord(value)) return pointers;
    if (typeof value.sourceId === 'string' && typeof value.gameReleaseId === 'string') pointers.push(value);
    for (const child of Object.values(value)) collectSourcePointers(child, pointers);
    return pointers;
  }

  function collectOfficialSourceIds(value, result = new Set()) {
    if (Array.isArray(value)) {
      for (const item of value) collectOfficialSourceIds(item, result);
      return result;
    }
    if (!isRecord(value)) return result;
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'officialSourceId' || key.endsWith('OfficialSourceId')) && typeof child === 'string') result.add(child);
      collectOfficialSourceIds(child, result);
    }
    return result;
  }

  function validateSafeData(value, label, parentKey = '', insideSource = false) {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) validateSafeData(value[index], label + '[' + index + ']', parentKey, insideSource);
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (EXECUTABLE_KEYS.has(normalized)) fail(label + '.' + key + ' contains executable instructions');
        if (normalized === 'formula' && typeof child !== 'string') fail(label + '.' + key + ' must remain inert formula text');
        if (['formulaexecutor', 'formulaevaluator', 'formulaprogram', 'selectorcode', 'selectorquery'].includes(normalized)) {
          fail(label + '.' + key + ' contains an executable program');
        }
        const metadata = insideSource && SAFE_SOURCE_METADATA_KEYS.has(normalized);
        validateSafeData(child, label + '.' + key, normalized, insideSource || normalized === 'source' || metadata);
      }
      return;
    }
    if (typeof value !== 'string') return;
    const metadataValue = insideSource && SAFE_SOURCE_METADATA_KEYS.has(parentKey);
    if (metadataValue) return;
    if (ACTIVE_SCHEME_PATTERN.test(value) || ACTIVE_MARKUP_PATTERN.test(value)) fail(label + ' contains active script or HTML content');
    if (REMOTE_EXECUTABLE_PATTERN.test(value.trim())) fail(label + ' references remote executable content');
    if (parentKey === 'formula' && FORMULA_EXECUTION_PATTERN.test(value)) fail(label + ' contains executable formula syntax');
  }

  function requireSnapshot(snapshot, label) {
    requireRecord(snapshot, label);
    requireString(snapshot.snapshotId, label + '.snapshotId');
    if (!SNAPSHOT_ID_PATTERN.test(snapshot.snapshotId)) fail(label + '.snapshotId is invalid');
    requireString(snapshot.commit, label + '.commit');
    if (!SHA1_PATTERN.test(snapshot.commit)) fail(label + '.commit must be a lowercase SHA-1');
    requireString(snapshot.contentSha256, label + '.contentSha256');
    if (!SHA256_PATTERN.test(snapshot.contentSha256)) fail(label + '.contentSha256 must be a lowercase SHA-256');
    requireString(snapshot.manifestSha256, label + '.manifestSha256');
    if (!SHA256_PATTERN.test(snapshot.manifestSha256)) fail(label + '.manifestSha256 must be a lowercase SHA-256');
  }

  function requireReleaseIdentity(release, label) {
    requireRecord(release, label);
    requireString(release.gameReleaseId, label + '.gameReleaseId');
    if (!RELEASE_ID_PATTERN.test(release.gameReleaseId) || release.gameReleaseId.includes('..')) fail(label + '.gameReleaseId is invalid');
    requireString(release.gameVersion, label + '.gameVersion');
    if (!GAME_VERSION_PATTERN.test(release.gameVersion)) fail(label + '.gameVersion is invalid');
    requireSnapshot(release.snapshot, label + '.snapshot');
  }

  function validateDomain(document, { kind, gameReleaseId } = {}) {
    requireExactKeys(document, ['schemaVersion', 'kind', 'gameReleaseId', 'source', 'web'], 'domain');
    requireString(kind, 'expected domain kind');
    requireString(gameReleaseId, 'expected gameReleaseId');
    if (!CORE_DOMAIN_SET.has(kind)) fail('domain kind is not a supported W10 core kind: ' + kind);
    if (document.schemaVersion !== DOMAIN_SCHEMA || document.kind !== kind || document.gameReleaseId !== gameReleaseId) {
      fail('domain file identity does not match the manifest');
    }

    requireExactKeys(document.source, ['repository', 'gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts'], 'domain.source');
    if (document.source.repository !== SOURCE_REPOSITORY) fail('domain Source repository is invalid');
    for (const field of ['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts']) {
      if (!Array.isArray(document.source[field])) fail('domain source.' + field + ' must be an array');
    }

    const releaseIds = new Set();
    for (const [index, release] of document.source.gameReleases.entries()) {
      requireReleaseIdentity(release, 'domain.source.gameReleases[' + index + ']');
      if (releaseIds.has(release.gameReleaseId)) fail('domain duplicates a Source game release: ' + release.gameReleaseId);
      releaseIds.add(release.gameReleaseId);
    }

    const snapshotKeys = new Set();
    for (const [index, row] of document.source.sourceSnapshots.entries()) {
      requireRecord(row, 'domain.source.sourceSnapshots[' + index + ']');
      requireString(row.gameReleaseId, 'domain.source.sourceSnapshots[' + index + '].gameReleaseId');
      requireSnapshot(row.snapshot, 'domain.source.sourceSnapshots[' + index + '].snapshot');
      if (snapshotKeys.has(row.gameReleaseId + '\u0000' + row.snapshot.snapshotId)) fail('domain duplicates a Source snapshot identity');
      snapshotKeys.add(row.gameReleaseId + '\u0000' + row.snapshot.snapshotId);
    }

    const records = new Map();
    for (const [index, record] of document.source.records.entries()) {
      requireRecord(record, 'domain.source.records[' + index + ']');
      requireString(record.recordId, 'domain Source record.recordId');
      requireString(record.gameReleaseId, 'domain Source record.gameReleaseId');
      requireString(record.kind, 'domain Source record.kind');
      if (!RELEASE_ID_PATTERN.test(record.gameReleaseId) || record.gameReleaseId.includes('..')) fail('domain Source record gameReleaseId is invalid');
      const key = sourceRecordKey(record);
      if (records.has(key)) fail('domain duplicates a Source record: ' + record.recordId);
      records.set(key, record);
    }
    for (const record of records.values()) {
      for (const ref of collectTypedRecordPointers(record)) {
        const target = records.get(sourceRecordKey(ref));
        if (!target) fail('domain Source typed closure is incomplete for ' + ref.recordId);
        if (ref.kind && ref.kind !== target.kind) fail('domain Source reference kind mismatch for ' + ref.recordId);
      }
    }

    const sourceRefs = new Map();
    for (const [index, ref] of document.source.sourceRefs.entries()) {
      requireRecord(ref, 'domain.source.sourceRefs[' + index + ']');
      requireString(ref.gameReleaseId, 'domain Source reference.gameReleaseId');
      requireString(ref.sourceId, 'domain Source reference.sourceId');
      if (!RELEASE_ID_PATTERN.test(ref.gameReleaseId) || ref.gameReleaseId.includes('..')) fail('domain Source reference gameReleaseId is invalid');
      const key = sourceRefKey(ref);
      if (sourceRefs.has(key)) fail('domain Source provenance has duplicate identities');
      sourceRefs.set(key, ref);
    }
    for (const ref of collectSourcePointers(document.source.records)) {
      if (!sourceRefs.has(sourceRefKey(ref))) fail('domain Source provenance closure is incomplete for ' + ref.sourceId);
    }

    const web = requireRecord(document.web, 'domain.web');
    if (Object.keys(web).some((key) => !ALLOWED_WEB_KEYS.has(key))) fail('domain Web projection contains unexpected properties');
    for (const key of REQUIRED_WEB_ARRAYS) if (!Array.isArray(web[key])) fail('domain Web projection is missing array ' + key);
    requireRecord(web.officialInputs, 'domain.web.officialInputs');
    if (!Array.isArray(web.officialInputs.sources)) fail('domain official inputs are missing');
    const officialIds = new Set();
    for (const source of web.officialInputs.sources) {
      requireRecord(source, 'domain official input');
      requireString(source.officialSourceId, 'domain official input.officialSourceId');
      if (officialIds.has(source.officialSourceId)) fail('domain official inputs contain duplicate source IDs');
      officialIds.add(source.officialSourceId);
    }
    for (const presentation of web.presentations) {
      requireRecord(presentation, 'domain presentation');
      if (presentation.locale !== 'zh-TW' || typeof presentation.name !== 'string' || presentation.name.trim() === '') {
        fail('domain presentation is missing required zh-TW content');
      }
      for (const sourceId of collectOfficialSourceIds(presentation)) {
        if (!officialIds.has(sourceId)) fail('domain official input closure is incomplete: ' + sourceId);
      }
    }

    const webItems = [
      ...web.presentations,
      ...web.termLocalizations,
      ...web.announcements,
      ...web.gameChanges,
      ...web.officialTextChanges
    ];
    for (const ref of collectTypedRecordPointers(webItems)) {
      const target = records.get(sourceRecordKey(ref));
      if (!target) fail('domain Web typed Source reference is unresolved: ' + ref.recordId);
      if (ref.kind && ref.kind !== target.kind) fail('domain Web typed Source reference kind mismatch: ' + ref.recordId);
    }
    for (const ref of collectSourcePointers(webItems)) {
      if (!sourceRefs.has(sourceRefKey(ref))) fail('domain Web provenance reference is unresolved: ' + ref.sourceId);
    }

    const targetKeys = new Set();
    for (const record of records.values()) {
      if (record.reviewTargets === undefined) continue;
      if (!Array.isArray(record.reviewTargets)) fail('domain Source record reviewTargets must be an array');
      for (const target of record.reviewTargets) {
        requireRecord(target, 'domain Source review target');
        requireString(target.fieldPath, 'domain Source review target.fieldPath');
        requireString(target.dimension, 'domain Source review target.dimension');
        targetKeys.add(sourceReviewTargetKey({
          gameReleaseId: record.gameReleaseId,
          recordId: record.recordId,
          fieldPath: target.fieldPath,
          dimension: target.dimension
        }));
      }
    }
    for (const receipt of document.source.reviewReceipts) {
      requireRecord(receipt, 'domain Source review receipt');
      requireRecord(receipt.target, 'domain Source review receipt.target');
      const target = receipt.target;
      requireString(target.gameReleaseId, 'domain Source receipt target.gameReleaseId');
      requireString(target.recordId, 'domain Source receipt target.recordId');
      requireString(target.fieldPath, 'domain Source receipt target.fieldPath');
      requireString(target.dimension, 'domain Source receipt target.dimension');
      if (!targetKeys.has(sourceReviewTargetKey(target))) fail('domain Source review receipt points outside its record closure');
    }
    const targetIds = new Set();
    for (const targetRow of web.reviewTargets) {
      if (!isRecord(targetRow) || typeof targetRow.mode !== 'string' || targetRow.mode.trim() === ''
        || !isRecord(targetRow.target) || typeof targetRow.target.targetId !== 'string' || targetRow.target.targetId.trim() === ''
        || !REVIEW_STATES.has(targetRow.state)) fail('domain review target is invalid');
      const targetKey = targetRow.mode + '\u0000' + targetRow.target.targetId;
      if (targetIds.has(targetKey)) fail('domain duplicates a review target: ' + targetRow.target.targetId);
      targetIds.add(targetKey);
    }

    validateSafeData(document, 'domain');
    return document;
  }

  function snapshotKey(gameReleaseId, snapshotId) {
    return gameReleaseId + '\u0000' + snapshotId;
  }

  function snapshotMaterial(snapshot) {
    return [snapshot.snapshotId, snapshot.commit, snapshot.contentSha256, snapshot.manifestSha256].join('\u0000');
  }

  function validateDomainSet(domains, manifest, identity) {
    if (!(domains instanceof Map)) fail('validated domains must be provided as a Map keyed by kind');
    requireRecord(manifest, 'manifest');
    requireRecord(identity, 'local game identity');
    requireString(identity.gameVersion, 'local game identity.gameVersion');
    requireString(identity.gameReleaseId, 'local game identity.gameReleaseId');
    if (!GAME_VERSION_PATTERN.test(identity.gameVersion) || !RELEASE_ID_PATTERN.test(identity.gameReleaseId)
      || identity.gameReleaseId.includes('..')) fail('local game identity is invalid');
    if (identity.snapshotId !== undefined && (typeof identity.snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(identity.snapshotId))) {
      fail('local game identity snapshotId is invalid');
    }
    if (identity.gameVersion !== manifest.gameVersion || identity.gameReleaseId !== manifest.gameReleaseId) {
      fail('local game identity does not match the manifest game release');
    }
    if (domains.size !== CORE_DOMAIN_KINDS.length || CORE_DOMAIN_KINDS.some((kind) => !domains.has(kind))) {
      fail('domain package must contain exactly the four W10 core kinds');
    }

    const releases = new Map();
    const releaseByVersion = new Map();
    const snapshots = new Map();
    const snapshotOwners = new Map();
    const pendingSnapshotRefs = [];
    for (const kind of CORE_DOMAIN_KINDS) {
      const document = validateDomain(domains.get(kind), { kind, gameReleaseId: manifest.gameReleaseId });
      for (const row of document.source.gameReleases) {
        const existing = releases.get(row.gameReleaseId);
        if (existing && existing.gameVersion !== row.gameVersion) fail('conflicting Source gameVersion for release ' + row.gameReleaseId);
        if (existing && existing.snapshot.snapshotId !== row.snapshot.snapshotId) fail('conflicting primary snapshot identity for release ' + row.gameReleaseId);
        const sameVersion = releaseByVersion.get(row.gameVersion);
        if (sameVersion && sameVersion !== row.gameReleaseId) fail('conflicting Source game release identity for gameVersion ' + row.gameVersion);
        releases.set(row.gameReleaseId, row);
        releaseByVersion.set(row.gameVersion, row.gameReleaseId);
        pendingSnapshotRefs.push({ gameReleaseId: row.gameReleaseId, snapshot: row.snapshot, label: 'primary snapshot' });
      }
      for (const row of document.source.sourceSnapshots) {
        pendingSnapshotRefs.push({ gameReleaseId: row.gameReleaseId, snapshot: row.snapshot, label: 'Source snapshot' });
      }
      for (const ref of document.source.sourceRefs) {
        if (ref.snapshot !== undefined) {
          requireSnapshot(ref.snapshot, 'domain Source reference snapshot');
          pendingSnapshotRefs.push({ gameReleaseId: ref.gameReleaseId, snapshot: ref.snapshot, label: 'Source provenance snapshot' });
        }
      }
    }

    for (const entry of pendingSnapshotRefs) {
      if (!releases.has(entry.gameReleaseId)) fail('Source ' + entry.label + ' has no game release registry entry');
      const key = snapshotKey(entry.gameReleaseId, entry.snapshot.snapshotId);
      const existing = snapshots.get(key);
      if (existing && snapshotMaterial(existing.snapshot) !== snapshotMaterial(entry.snapshot)) {
        fail('conflicting Source snapshot metadata for ' + entry.snapshot.snapshotId);
      }
      const otherOwner = snapshotOwners.get(entry.snapshot.snapshotId);
      if (otherOwner && otherOwner !== entry.gameReleaseId) fail('conflicting Source snapshot release identity for ' + entry.snapshot.snapshotId);
      snapshots.set(key, { gameReleaseId: entry.gameReleaseId, snapshot: entry.snapshot });
      snapshotOwners.set(entry.snapshot.snapshotId, entry.gameReleaseId);
    }

    const refs = manifest.compatibility?.gameSnapshotRefs;
    if (!Array.isArray(refs)) fail('manifest compatibility snapshot references are missing');
    for (const entry of pendingSnapshotRefs) {
      if (!refs.includes(entry.snapshot.snapshotId)) fail('manifest snapshot references omit Source snapshot ' + entry.snapshot.snapshotId);
    }

    const currentRelease = releases.get(identity.gameReleaseId);
    if (!currentRelease || currentRelease.gameVersion !== identity.gameVersion) {
      fail('local game identity is not present in the Source release registry');
    }
    const resolved = {
      gameVersion: identity.gameVersion,
      gameReleaseId: identity.gameReleaseId
    };
    if (identity.snapshotId !== undefined) {
      const match = snapshots.get(snapshotKey(identity.gameReleaseId, identity.snapshotId));
      if (!match || !refs.includes(identity.snapshotId)) fail('local snapshot identity does not belong to the exact game release');
      resolved.snapshotId = identity.snapshotId;
    }
    return Object.freeze({ identity: Object.freeze(resolved), domains, releases, snapshots });
  }

  return Object.freeze({
    collectOfficialSourceIds,
    collectSourcePointers,
    collectTypedRecordPointers,
    sourceRecordKey,
    sourceRefKey,
    sourceReviewTargetKey,
    validateDomain,
    validateDomainSet
  });
});