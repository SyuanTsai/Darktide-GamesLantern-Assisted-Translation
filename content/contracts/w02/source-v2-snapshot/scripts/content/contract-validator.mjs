import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTRACT_VERSION = '2.0.0';
export const CONTRACT_SCHEMA_ID = 'https://github.com/SyuanTsai/DarkTide-Source-Data/content/schema/v2/source-contract.schema.json';
export const CONTRACT_RECORD_KINDS = Object.freeze([
  'skill', 'blessing', 'blessing-variant', 'weapon', 'attack-profile', 'stat-definition', 'stat-curve',
  'damage-profile', 'armor-class', 'target-profile', 'modifier-rule', 'claim', 'evidence', 'term', 'catalog',
  'curio', 'perk', 'classification', 'game-change', 'release-compatibility'
]);
export const CONTRACT_UNITS = Object.freeze([
  'ratio', 'percent', 's', 'm', 'damage', 'impact', 'point', 'rating',
  'attack-power-point', 'stamina-point', 'stamina-point-per-second', 'dodge-count'
]);
export const CONTRACT_UNKNOWN_REASONS = Object.freeze([
  'NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE'
]);

const KIND_PAYLOADS = Object.freeze({
  skill: 'skillPayload', blessing: 'blessingPayload', 'blessing-variant': 'blessingVariantPayload',
  weapon: 'weaponPayload', 'attack-profile': 'attackProfilePayload', 'stat-definition': 'statDefinitionPayload',
  'stat-curve': 'statCurvePayload', 'damage-profile': 'damageProfilePayload', 'armor-class': 'armorClassPayload',
  'target-profile': 'targetProfilePayload', 'modifier-rule': 'modifierRulePayload', claim: 'claimPayload',
  evidence: 'evidencePayload', term: 'termPayload', catalog: 'catalogPayload', curio: 'curioPayload',
  perk: 'perkPayload', classification: 'classificationPayload', 'game-change': 'gameChangePayload',
  'release-compatibility': 'releaseCompatibilityPayload'
});
const REVIEW_DIMENSIONS = Object.freeze(['technical', 'evidence', 'context', 'identity', 'compatibility']);
const BACKLINK_FIELDS = new Set(['claimRefs', 'targetRef', 'blessingRef', 'weaponRefs']);
const DIGEST_BACKLINK_FIELDS = new Set(['claimRefs']);
const IDENTITY_REFERENCE_FIELDS = new Set(['targetRef', 'blessingRef', 'weaponRef', 'weaponRefs', 'entityRef', 'predecessorRef', 'parentRef', 'classificationRef']);
const IDENTITY_PAYLOAD_FIELDS = Object.freeze({
  skill: ['nameKey', 'applicability'],
  blessing: ['nameKey'],
  'blessing-variant': ['blessingRef', 'weaponRefs', 'definedTiers', 'obtainableTiers'],
  weapon: ['familyId', 'markId', 'templateKey'],
  'attack-profile': ['familyId', 'markId', 'itemKey', 'action', 'mode', 'charge', 'contexts'],
  'stat-definition': ['quantity', 'inputUnit', 'outputUnit'],
  'stat-curve': ['inputUnit', 'outputUnit', 'interpolation', 'edgePolicy'],
  'damage-profile': ['profileKey'],
  'armor-class': ['classKey', 'classificationRef'],
  'target-profile': ['profileKey'],
  'modifier-rule': ['ruleKey', 'triggerText', 'operation', 'stackingGroup', 'exclusions'],
  claim: ['property', 'targetRef', 'context', 'basis'],
  evidence: ['evidenceKind', 'sourceRef', 'safeSummary'],
  term: ['termKey', 'contextKey'],
  catalog: ['catalogKey'],
  curio: ['nameKey'],
  perk: ['nameKey'],
  classification: ['taxonomy', 'code', 'labelEn', 'parentRef'],
  'game-change': ['comparison', 'entityRef', 'operation'],
  'release-compatibility': ['fromGameReleaseId', 'toGameReleaseId']
});
const REF_EXPECTED_KINDS = Object.freeze({
  claimRefs: new Set(['claim']), evidenceRefs: new Set(['evidence']), termRefs: new Set(['term']),
  statRefs: new Set(['stat-definition']), attackProfileRefs: new Set(['attack-profile']),
  damageProfileRefs: new Set(['damage-profile']), targetProfileRefs: new Set(['target-profile']),
  armorRef: new Set(['armor-class']), classificationRef: new Set(['classification']),
  curveRef: new Set(['stat-curve']), ruleRef: new Set(['modifier-rule']), weaponRefs: new Set(['weapon']),
  blessingRef: new Set(['blessing']), variantRefs: new Set(['blessing-variant']), perkRefs: new Set(['perk']),
  predecessorRef: new Set(['weapon']), supersedesChangeRef: new Set(['game-change']), parentRef: new Set(['classification']),
  weaponRef: new Set(['weapon']), attackProfileRef: new Set(['attack-profile']), targetProfileRef: new Set(['target-profile']),
  armorClassRef: new Set(['armor-class']), variantRef: new Set(['blessing-variant']), talentRefs: new Set(['skill']),
  blessingVariantRefs: new Set(['blessing-variant']), modifierRuleRefs: new Set(['modifier-rule']), statRef: new Set(['stat-definition'])
});
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_RELATIVE = path.join('content', 'schema', 'v2', 'source-contract.schema.json');
const FIXTURE_RELATIVE = path.join('content', 'fixtures', 'v2', 'representative-source.json');

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex');
const compareLexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const pointerEscape = (value) => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const toPointer = (parts) => `/${parts.map(pointerEscape).join('/')}`;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const jsonEqual = (left, right) => canonical(left) === canonical(right);

export async function loadContractSchema({ sourceRoot = REPO_ROOT } = {}) {
  return JSON.parse(await readFile(path.join(sourceRoot, SCHEMA_RELATIVE), 'utf8'));
}

export async function loadRepresentativeFixture({ sourceRoot = REPO_ROOT } = {}) {
  return JSON.parse(await readFile(path.join(sourceRoot, FIXTURE_RELATIVE), 'utf8'));
}

function pointerGet(object, pointer) {
  if (pointer === '') return { exists: true, value: object };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { exists: false };
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let value = object;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !hasOwn(value, part)) return { exists: false };
    value = value[part];
  }
  return { exists: true, value };
}

function resolvePointer(root, ref) {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value?.[key], root);
}

function schemaMatches(value, fragment, root) {
  const issues = [];
  validateSchemaValue(value, fragment, root, '', issues, new Set());
  return issues.length === 0;
}

function validateSchemaValue(value, schema, root, pointer, issues, refStack) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const target = resolvePointer(root, schema.$ref);
    if (!target) issues.push({ path: pointer || '/', code: 'schema-ref', message: `Unresolved schema reference ${schema.$ref}` });
    else if (!refStack.has(schema.$ref)) {
      const next = new Set(refStack); next.add(schema.$ref);
      validateSchemaValue(value, target, root, pointer, issues, next);
    }
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const valid = types.some((type) => type === 'null' ? value === null
      : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : type === 'array' ? Array.isArray(value)
          : type === 'integer' ? Number.isInteger(value)
            : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === type);
    if (!valid) { issues.push({ path: pointer || '/', code: 'schema-type', message: `Expected ${types.join('|')}` }); return; }
  }
  if (hasOwn(schema, 'const') && !jsonEqual(value, schema.const)) issues.push({ path: pointer || '/', code: 'schema-const', message: 'Value does not match const' });
  if (schema.enum && !schema.enum.some((item) => jsonEqual(value, item))) issues.push({ path: pointer || '/', code: 'schema-enum', message: 'Value is not in the allowed enum' });
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => schemaMatches(value, branch, root)).length;
    if (matches !== 1) issues.push({ path: pointer || '/', code: 'schema-oneOf', message: `Expected exactly one matching alternative; found ${matches}` });
  }
  for (const branch of schema.allOf ?? []) validateSchemaValue(value, branch, root, pointer, issues, refStack);
  if (schema.if) {
    const condition = schemaMatches(value, schema.if, root);
    if (condition && schema.then) validateSchemaValue(value, schema.then, root, pointer, issues, refStack);
    if (!condition && schema.else) validateSchemaValue(value, schema.else, root, pointer, issues, refStack);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) issues.push({ path: pointer || '/', code: 'schema-minLength', message: `String is shorter than ${schema.minLength}` });
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) issues.push({ path: pointer || '/', code: 'schema-maxLength', message: `String exceeds ${schema.maxLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) issues.push({ path: pointer || '/', code: 'schema-pattern', message: 'String does not match its required pattern' });
    if (schema.format === 'date-time' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) || Number.isNaN(Date.parse(value)))) {
      issues.push({ path: pointer || '/', code: 'schema-format', message: 'Expected ISO date-time with timezone' });
    }
    if (schema.format === 'uri' && !isHttpsUri(value)) issues.push({ path: pointer || '/', code: 'schema-format', message: 'Expected a safe HTTPS URI' });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path: pointer || '/', code: 'schema-minimum', message: `Value is below ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path: pointer || '/', code: 'schema-maximum', message: `Value is above ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path: pointer || '/', code: 'schema-minItems', message: `Array requires at least ${schema.minItems} entries` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path: pointer || '/', code: 'schema-maxItems', message: `Array allows at most ${schema.maxItems} entries` });
    if (schema.uniqueItems) {
      const values = value.map(canonical);
      if (new Set(values).size !== values.length) issues.push({ path: pointer || '/', code: 'schema-uniqueItems', message: 'Array entries must be unique' });
    }
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, root, `${pointer}/${index}`, issues, refStack));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!hasOwn(value, key)) issues.push({ path: pointer || '/', code: 'schema-required', message: `Missing required property ${key}` });
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (hasOwn(value, key)) validateSchemaValue(value[key], childSchema, root, `${pointer}/${pointerEscape(key)}`, issues, refStack);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push({ path: `${pointer}/${pointerEscape(key)}`, code: 'schema-additionalProperties', message: 'Property is not allowed here' });
    }
  }
}

function isHttpsUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function assertSchemaValidatorParity(schema) {
  const errors = [];
  if (schema.$id !== CONTRACT_SCHEMA_ID) errors.push('schema $id differs from the validator interface');
  if (schema.properties?.schemaVersion?.const !== CONTRACT_VERSION) errors.push('schema version differs from the validator interface');
  const record = schema.$defs?.record;
  const schemaKinds = record?.properties?.kind?.enum ?? [];
  if (!jsonEqual(schemaKinds, CONTRACT_RECORD_KINDS)) errors.push('record kind enum differs from semantic validator kinds');
  const schemaUnits = schema.$defs?.unit?.enum ?? [];
  if (!jsonEqual(schemaUnits, CONTRACT_UNITS)) errors.push('unit enum differs from semantic validator units');
  const unknownReasons = schema.$defs?.unknownValue?.properties?.reasonCode?.enum ?? [];
  if (!jsonEqual(unknownReasons, CONTRACT_UNKNOWN_REASONS)) errors.push('unknown reason enum differs from semantic validator reasons');
  const schemaBranches = new Map((record?.allOf ?? []).map((branch) => [
    branch.if?.properties?.kind?.const,
    branch.then?.properties?.payload?.$ref?.split('/').at(-1)
  ]));
  for (const [kind, payload] of Object.entries(KIND_PAYLOADS)) if (schemaBranches.get(kind) !== payload) errors.push(`schema payload branch for ${kind} differs from semantic validator`);
  if (Object.keys(KIND_PAYLOADS).length !== schemaBranches.size) errors.push('schema has missing or extra payload branches');
  const required = new Set(record?.required ?? []);
  for (const field of ['recordId', 'kind', 'owner', 'gameReleaseId', 'payload', 'sourceRefs', 'dataCoverage', 'reviewTargets', 'reviewState']) {
    if (!required.has(field)) errors.push(`record schema does not require ${field}`);
  }
  return errors;
}

function decimalParts(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, rawFraction = ''] = unsigned.split('.');
  const fraction = rawFraction.replace(/0+$/u, '');
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/u, '') || '0';
  return { negative: negative && digits !== '0', digits: BigInt(digits), scale: fraction.length };
}

function compareDecimal(left, right) {
  const a = decimalParts(left); const b = decimalParts(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const scale = Math.max(a.scale, b.scale);
  const av = a.digits * (10n ** BigInt(scale - a.scale)) * (a.negative ? -1n : 1n);
  const bv = b.digits * (10n ** BigInt(scale - b.scale)) * (b.negative ? -1n : 1n);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function typedValueEqual(left, right) {
  if (!left || !right || left.status !== right.status) return false;
  if (left.status !== 'known') return jsonEqual(left, right);
  const leftKeys = Object.keys(left).sort(); const rightKeys = Object.keys(right).sort();
  if (!jsonEqual(leftKeys, rightKeys)) return false;
  const decimalKeys = new Set(['decimal', 'min', 'max', 'step']);
  return leftKeys.every((key) => decimalKeys.has(key)
    ? compareDecimal(left[key], right[key]) === 0
    : jsonEqual(left[key], right[key]));
}

function releaseKey(releaseId) { return releaseId; }
function recordKey(recordId, releaseId) { return `${releaseId}\u0000${recordId}`; }
function receiptKey(target) { return `${recordKey(target.recordId, target.gameReleaseId)}\u0000${target.fieldPath}\u0000${target.dimension}`; }

function walkObjects(value, visit, parentKey = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) walkObjects(item, visit, parentKey); return; }
  visit(value, parentKey);
  for (const [key, child] of Object.entries(value)) walkObjects(child, visit, key);
}

function getAllRecordRefs(record) {
  const edges = [];
  walkObjects(record.payload, (item, parentKey) => {
    if (typeof item.recordId === 'string' && typeof item.gameReleaseId === 'string') edges.push({ ref: item, field: parentKey });
  });
  return edges;
}

function getRecordRefEdges(record) { return getAllRecordRefs(record).filter(({ field }) => !BACKLINK_FIELDS.has(field)); }

function reviewProjection(value, { omitClaimRefs = false } = {}) {
  if (Array.isArray(value)) return value.map((child) => reviewProjection(child, { omitClaimRefs }));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !omitClaimRefs || !DIGEST_BACKLINK_FIELDS.has(key))
    .map(([key, child]) => [key, reviewProjection(child, { omitClaimRefs })]));
}

function identityPayloadProjection(item) {
  const payload = item.payload ?? {};
  const fields = IDENTITY_PAYLOAD_FIELDS[item.kind] ?? [];
  const projected = Object.fromEntries(fields.filter((field) => hasOwn(payload, field)).map((field) => [field, payload[field]]));
  if (item.kind === 'target-profile' && Array.isArray(payload.hitZones)) {
    projected.hitZones = payload.hitZones.map(({ zoneId, armorRef, weakspot, critEligible }) => ({ zoneId, armorRef, weakspot, critEligible }));
  }
  if (item.kind === 'damage-profile' && Array.isArray(payload.segments)) {
    projected.segments = payload.segments.map(({ segmentId, quantity, hitZone, conditions }) => ({ segmentId, quantity, hitZone, conditions }));
  }
  return reviewProjection(projected, { omitClaimRefs: true });
}

function releaseReviewProjection(release) {
  if (!release) return null;
  const projected = structuredClone(release);
  delete projected.snapshot.commit;
  return projected;
}

function sourceReviewProjection(source) {
  const projected = structuredClone(source);
  delete projected.commit;
  delete projected.snapshot.commit;
  return projected;
}

function collectSourceLinks(record) {
  const links = [...(record.sourceRefs ?? [])];
  for (const missing of record.dataCoverage?.missing ?? []) if (missing.sourceRef) links.push(missing.sourceRef);
  walkObjects(record.payload, (item) => { if (typeof item.sourceId === 'string' && typeof item.gameReleaseId === 'string') links.push(item); });
  return links;
}

function expectedKindIssue(field, targetKind) {
  const allowed = REF_EXPECTED_KINDS[field];
  if (allowed && !allowed.has(targetKind)) return `Reference ${field} must point to ${[...allowed].join(' or ')}, not ${targetKind}`;
  if (field === 'targetRef' && ['claim', 'evidence', 'game-change', 'release-compatibility'].includes(targetKind)) return `Claim targetRef cannot point to ${targetKind}`;
  if (field === 'entityRef' && ['claim', 'evidence', 'game-change', 'release-compatibility'].includes(targetKind)) return `entityRef cannot point to ${targetKind}`;
  return null;
}

function getReviewNode(contract, target) {
  const record = contract.records.find((item) => item.recordId === target.recordId && item.gameReleaseId === target.gameReleaseId);
  if (record) return { item: record, listName: 'records' };
  const tombstone = contract.tombstones.find((item) => item.recordId === target.recordId && item.gameReleaseId === target.gameReleaseId);
  if (tombstone) return { item: tombstone, listName: 'tombstones' };
  return null;
}

function dependencyClosure(contract, rootItem, recordMap, sourceMap, releaseMap) {
  const visited = new Map();
  const rootKey = recordKey(rootItem.recordId, rootItem.gameReleaseId);
  const visitItem = (item, mode = 'full', isTombstone = false, followClaimRefs = mode === 'full') => {
    const key = recordKey(item.recordId, item.gameReleaseId);
    const modeRank = mode === 'full' ? 2 : 1;
    const expandsClaimRefs = mode === 'full' && (key === rootKey || followClaimRefs);
    const previous = visited.get(key);
    if (previous && previous.modeRank >= modeRank && (!expandsClaimRefs || previous.expandsClaimRefs)) return;
    const links = collectSourceLinks(item);
    const sourceRefs = links.map((link) => sourceMap.get(`${link.gameReleaseId}\u0000${link.sourceId}`)).filter(Boolean);
    const release = releaseMap.get(item.gameReleaseId);
    visited.set(key, {
      key: `${item.gameReleaseId}:${item.recordId}`,
      mode,
      modeRank,
      expandsClaimRefs,
      isRoot: key === rootKey,
      item,
      isTombstone,
      release,
      sourceRefs: sourceRefs.sort((a, b) => compareLexical(a.sourceId, b.sourceId))
    });
    for (const link of links) if (link.compatibilityRef) visit(recordMap.get(recordKey(link.compatibilityRef, item.gameReleaseId)), 'full');
    if (!isTombstone) for (const { ref, field } of getAllRecordRefs(item)) {
      const followsClaimDependency = expandsClaimRefs && DIGEST_BACKLINK_FIELDS.has(field);
      if (DIGEST_BACKLINK_FIELDS.has(field) && !followsClaimDependency) continue;
      const identityEdge = IDENTITY_REFERENCE_FIELDS.has(field);
      if (mode === 'identity' && identityEdge) {
        if (ref.compatibilityRef) visit(recordMap.get(recordKey(ref.compatibilityRef, item.gameReleaseId)), 'full');
        continue;
      }
      const targetMode = identityEdge ? 'identity' : 'full';
      // A comparison stat contributes its own typed value definition, but its claimRefs are
      // sibling claims. Other full entity/applicability refs keep their forward claim closure.
      const followsTargetClaims = expandsClaimRefs && targetMode === 'full' && field !== 'statRef';
      visit(recordMap.get(recordKey(ref.recordId, ref.gameReleaseId)), targetMode, followsTargetClaims);
      if (ref.compatibilityRef) visit(recordMap.get(recordKey(ref.compatibilityRef, item.gameReleaseId)), 'full');
    }
  };
  const visit = (record, mode = 'full', followClaimRefs = mode === 'full') => { if (record) visitItem(record, mode, false, followClaimRefs); };
  visitItem(rootItem, 'full', !rootItem.payload);
  return [...visited.values()].sort((a, b) => compareLexical(a.key, b.key));
}

export function computeReviewDigests(contract, target) {
  const found = getReviewNode(contract, target);
  if (!found) throw new Error(`Unknown review target ${target.gameReleaseId}:${target.recordId}`);
  const field = pointerGet(found.item, target.fieldPath);
  if (!field.exists) throw new Error(`Review field path does not exist: ${target.fieldPath}`);
  const recordMap = new Map(contract.records.map((item) => [recordKey(item.recordId, item.gameReleaseId), item]));
  const sourceMap = new Map(contract.sourceRefs.map((item) => [`${item.gameReleaseId}\u0000${item.sourceId}`, item]));
  const releaseMap = new Map(contract.gameReleases.map((release) => [release.gameReleaseId, release]));
  const deps = dependencyClosure(contract, found.item, recordMap, sourceMap, releaseMap);
  return {
    targetDigest: sha256(field.value),
    dependenciesDigest: sha256(deps.map(({ key, mode, expandsClaimRefs, item, isTombstone, release, sourceRefs }) => ({
      key,
      dependencyMode: mode,
      kind: isTombstone ? 'tombstone' : item.kind,
      owner: item.owner ?? 'source',
      payload: mode === 'identity' ? identityPayloadProjection(item) : reviewProjection(item.payload ?? null, { omitClaimRefs: !expandsClaimRefs }),
      aliases: item.aliases ?? [],
      sourceLinks: reviewProjection(item.sourceRefs ?? [], { omitClaimRefs: true }),
      dataCoverage: reviewProjection(item.dataCoverage ?? null, { omitClaimRefs: true }),
      reviewTargets: item.reviewTargets ?? [],
      tombstoneReason: item.reason ?? null,
      release: releaseReviewProjection(release),
      sourceRefs: sourceRefs.map(sourceReviewProjection)
    })))
  };
}

export function createReviewReceipt(contract, target, { decision = 'approved', reviewer, reviewedAt } = {}) {
  if (!reviewer || reviewer.kind !== 'human' || typeof reviewer.id !== 'string') throw new Error('A named human reviewer is required');
  if (!REVIEW_DIMENSIONS.includes(target.dimension)) throw new Error('Unsupported review dimension');
  const digests = computeReviewDigests(contract, target);
  return { target: structuredClone(target), ...digests, decision, reviewer: structuredClone(reviewer), reviewedAt };
}

function deriveReviewState(item, receiptsByKey, contract, issues, itemPath) {
  const targets = item.reviewTargets ?? [];
  const wanted = new Map(targets.map((target) => [receiptKey({ recordId: item.recordId, gameReleaseId: item.gameReleaseId, ...target }), target]));
  if (wanted.size !== targets.length) issues.push({ path: `${itemPath}/reviewTargets`, code: 'duplicate-review-target', message: 'Review target pairs must be unique' });
  let count = 0; let stale = false; let rejected = false; let allApproved = true;
  for (const [key, target] of wanted) {
    const receipt = receiptsByKey.get(key);
    if (!receipt) { allApproved = false; continue; }
    count += 1;
    try {
      const actual = computeReviewDigests(contract, { recordId: item.recordId, gameReleaseId: item.gameReleaseId, ...target });
      if (actual.targetDigest !== receipt.targetDigest || actual.dependenciesDigest !== receipt.dependenciesDigest) stale = true;
    } catch { stale = true; }
    if (receipt.decision === 'rejected') rejected = true;
    if (receipt.decision !== 'approved') allApproved = false;
  }
  let state = 'pending';
  if (stale) state = 'stale';
  else if (rejected) state = 'rejected';
  else if (targets.length > 0 && allApproved) state = 'approved';
  else if (count === 0 && item.reviewState === 'draft') state = 'draft';
  return state;
}

function validateProvenance(contract, releaseMap, issues) {
  const sourceMap = new Map();
  for (const [index, source] of contract.sourceRefs.entries()) {
    const base = `/sourceRefs/${index}`;
    const key = `${source.gameReleaseId}\u0000${source.sourceId}`;
    if (sourceMap.has(key)) issues.push({ path: base, code: 'duplicate-source', message: 'Source IDs must be unique within a game release' });
    sourceMap.set(key, source);
    const release = releaseMap.get(source.gameReleaseId);
    if (!release) issues.push({ path: `${base}/gameReleaseId`, code: 'unknown-release', message: 'Source refers to an undeclared game release' });
    else {
      if (source.gameBuild !== release.gameBuild) issues.push({ path: `${base}/gameBuild`, code: 'build-mismatch', message: 'Source build must match its declared game release' });
      if (!jsonEqual(source.snapshot, release.snapshot)) issues.push({ path: `${base}/snapshot`, code: 'snapshot-mismatch', message: 'Source snapshot must match its declared game release snapshot' });
    }
    if (source.sourceKind === 'private-derived' && ['repository', 'publicUrl', 'commit', 'path'].some((field) => hasOwn(source, field))) {
      issues.push({ path: base, code: 'private-locator', message: 'Private-derived provenance carries only safe IDs, digests, version/build, tool and summary; private locators are forbidden' });
    }
    if (source.repository && !isHttpsUri(source.repository)) issues.push({ path: `${base}/repository`, code: 'unsafe-uri', message: 'Repository locator must be public HTTPS' });
    if (source.publicUrl && !isHttpsUri(source.publicUrl)) issues.push({ path: `${base}/publicUrl`, code: 'unsafe-uri', message: 'Public source URL must be HTTPS without embedded credentials' });
    if (source.path && (source.path.startsWith('/') || source.path.includes('\\') || source.path.split('/').some((part) => part === '.' || part === '..'))) {
      issues.push({ path: `${base}/path`, code: 'unsafe-path', message: 'Source path must be repository-relative without dot segments or backslashes' });
    }
    if (source.commit && source.snapshot?.commit && source.commit !== source.snapshot.commit) issues.push({ path: `${base}/commit`, code: 'commit-mismatch', message: 'Source commit and snapshot commit must agree when both are supplied' });
  }
  return sourceMap;
}

function validateReleaseSet(contract, issues) {
  const releaseMap = new Map(); const orders = new Set(); const snapshots = new Set();
  for (const [index, release] of contract.gameReleases.entries()) {
    const base = `/gameReleases/${index}`;
    if (releaseMap.has(release.gameReleaseId)) issues.push({ path: `${base}/gameReleaseId`, code: 'duplicate-release', message: 'gameReleaseId must be unique' });
    if (orders.has(release.releaseOrder)) issues.push({ path: `${base}/releaseOrder`, code: 'duplicate-release-order', message: 'releaseOrder must be unique' });
    if (snapshots.has(release.snapshot.snapshotId)) issues.push({ path: `${base}/snapshot/snapshotId`, code: 'duplicate-snapshot', message: 'Snapshot IDs must be unique' });
    releaseMap.set(releaseKey(release.gameReleaseId), release);
    orders.add(release.releaseOrder); snapshots.add(release.snapshot.snapshotId);
  }
  return releaseMap;
}

function validateRecordIdentityAndCoverage(contract, releaseMap, sourceMap, issues) {
  const recordMap = new Map(); const idKinds = new Map(); const recordIds = new Set(); const aliases = new Map();
  const tombstoneKeys = new Set();
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    const key = recordKey(record.recordId, record.gameReleaseId);
    if (recordMap.has(key)) issues.push({ path: base, code: 'duplicate-record', message: 'Composite (recordId,gameReleaseId) must be unique' });
    recordMap.set(key, record); recordIds.add(record.recordId);
    if (!releaseMap.has(record.gameReleaseId)) issues.push({ path: `${base}/gameReleaseId`, code: 'unknown-release', message: 'Record release is not declared' });
    const oldKind = idKinds.get(record.recordId);
    if (oldKind && oldKind !== record.kind) issues.push({ path: `${base}/kind`, code: 'identity-kind-change', message: `Stable ID ${record.recordId} cannot change kind from ${oldKind} to ${record.kind}` });
    idKinds.set(record.recordId, record.kind);
    if (/(?:^|[.:_-])v?\d+\.\d+\.\d+(?:$|[.:_-])/iu.test(record.recordId)) issues.push({ path: `${base}/recordId`, code: 'versioned-id', message: 'Stable record IDs must not embed game-release versions' });
    for (const alias of record.aliases ?? []) {
      if (aliases.has(alias) && aliases.get(alias) !== record.recordId) issues.push({ path: `${base}/aliases`, code: 'duplicate-alias', message: `Alias ${alias} is already attached to another stable ID` });
      aliases.set(alias, record.recordId);
    }
    const expectedState = deriveReviewState(record, new Map(), contract, issues, base);
    void expectedState;
    const coverage = record.dataCoverage;
    const missingPaths = new Set();
    for (const [missingIndex, missing] of (coverage?.missing ?? []).entries()) {
      const p = `${base}/dataCoverage/missing/${missingIndex}`;
      if (missingPaths.has(missing.field)) issues.push({ path: `${p}/field`, code: 'duplicate-coverage', message: 'Coverage field paths must be unique' });
      missingPaths.add(missing.field);
      const value = pointerGet(record, missing.field);
      if (missing.reasonCode === 'NOT_IMPORTED') {
        if (value.exists && !(Array.isArray(value.value) && value.value.length === 0)) issues.push({ path: `${p}/reasonCode`, code: 'not-imported-present', message: 'NOT_IMPORTED is only valid for a missing or empty declared field, never a populated value' });
      } else if (value.exists && value.value && typeof value.value === 'object' && value.value.status === 'unknown') {
        if (value.value.reasonCode !== missing.reasonCode) issues.push({ path: `${p}/reasonCode`, code: 'coverage-unknown-mismatch', message: 'Unknown typed value reason must agree with its coverage entry' });
      }
    }
    if ((coverage?.status === 'complete') !== ((coverage?.missing?.length ?? 0) === 0)) issues.push({ path: `${base}/dataCoverage/status`, code: 'coverage-status', message: 'complete coverage requires no missing fields; incomplete coverage requires at least one' });
    for (const link of collectSourceLinks(record)) validateSourceLink(record, link, sourceMap, contract, releaseMap, issues, base);
  }
  for (const [index, record] of contract.records.entries()) {
    validateNumericPayload(record, `/records/${index}`, issues, recordMap);
  }
  for (const alias of aliases.keys()) if (recordIds.has(alias) && aliases.get(alias) !== alias) issues.push({ path: '/records', code: 'alias-record-id-collision', message: `Alias ${alias} collides with another stable record ID` });
  for (const [index, tombstone] of contract.tombstones.entries()) {
    const base = `/tombstones/${index}`; const key = recordKey(tombstone.recordId, tombstone.gameReleaseId);
    if (tombstoneKeys.has(key)) issues.push({ path: base, code: 'duplicate-tombstone', message: 'Tombstone composite identity must be unique' });
    tombstoneKeys.add(key);
    if (recordMap.has(key)) issues.push({ path: base, code: 'tombstone-record-conflict', message: 'A tombstoned ID cannot also have a record in the same release' });
    const previous = [...recordMap.values()].filter((record) => record.recordId === tombstone.recordId).sort((a, b) => releaseMap.get(a.gameReleaseId)?.releaseOrder - releaseMap.get(b.gameReleaseId)?.releaseOrder);
    const tombstoneRelease = releaseMap.get(tombstone.gameReleaseId);
    if (!tombstoneRelease || previous.length === 0 || !previous.some((record) => (releaseMap.get(record.gameReleaseId)?.releaseOrder ?? Infinity) < tombstoneRelease.releaseOrder)) {
      issues.push({ path: base, code: 'orphan-tombstone', message: 'A tombstone must follow a prior release containing the stable ID' });
    }
    if (previous.some((record) => (releaseMap.get(record.gameReleaseId)?.releaseOrder ?? -Infinity) > (tombstoneRelease?.releaseOrder ?? Infinity))) issues.push({ path: base, code: 'reused-id-after-tombstone', message: 'Stable ID cannot be reused after a tombstone' });
    for (const link of tombstone.sourceRefs ?? []) validateSourceLink(tombstone, link, sourceMap, contract, releaseMap, issues, base);
  }
  return { recordMap, idKinds, aliases };
}

function validateSourceLink(record, link, sourceMap, contract, releaseMap, issues, base) {
  const source = sourceMap.get(`${link.gameReleaseId}\u0000${link.sourceId}`);
  if (!source) { issues.push({ path: base, code: 'dangling-source', message: `Unknown sourceRef ${link.gameReleaseId}:${link.sourceId}` }); return; }
  const current = record.gameReleaseId;
  if (link.gameReleaseId === current) {
    if (link.compatibilityRef) issues.push({ path: base, code: 'unneeded-compatibility', message: 'Same-release source refs must not carry compatibilityRef' });
    return;
  }
  validateCompatibility(link.compatibilityRef, current, link.gameReleaseId, contract, releaseMap, issues, base);
}

function validateCompatibility(compatibilityRef, currentReleaseId, targetReleaseId, contract, releaseMap, issues, base) {
  if (!compatibilityRef) { issues.push({ path: base, code: 'cross-release-without-compatibility', message: 'Cross-release references require an explicit compatibility record' }); return; }
  const compatibility = contract.records.find((record) => record.recordId === compatibilityRef && record.gameReleaseId === currentReleaseId);
  if (!compatibility || compatibility.kind !== 'release-compatibility') { issues.push({ path: base, code: 'invalid-compatibility-ref', message: 'compatibilityRef must name a release-compatibility record in the referring release' }); return; }
  const { fromGameReleaseId, toGameReleaseId } = compatibility.payload;
  if (!releaseMap.has(targetReleaseId) || !releaseMap.has(currentReleaseId) || fromGameReleaseId !== targetReleaseId || toGameReleaseId !== currentReleaseId) {
    issues.push({ path: base, code: 'compatibility-pair-mismatch', message: 'Compatibility record must explicitly compare the referenced release to the referring release' });
  }
}

function validateNumericPayload(record, base, issues, recordMap) {
  const visit = (value, pointer) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${pointer}/${index}`)); return; }
    if (value.status === 'known' && value.decimal !== undefined) {
      if (!CONTRACT_UNITS.includes(value.unit)) issues.push({ path: `${pointer}/unit`, code: 'missing-unit', message: 'Known numeric values require a supported unit' });
    }
    if (value.min !== undefined && value.max !== undefined && value.unit && value.inclusive && value.step !== undefined) {
      if (compareDecimal(value.min, value.max) > 0) issues.push({ path: pointer, code: 'inverted-range', message: 'Range minimum cannot exceed maximum' });
      if (compareDecimal(value.step, '0') < 0) issues.push({ path: `${pointer}/step`, code: 'negative-step', message: 'Range step cannot be negative' });
      if (compareDecimal(value.min, value.max) === 0 && !(value.inclusive.min && value.inclusive.max)) issues.push({ path: pointer, code: 'empty-range', message: 'A point range must include both endpoints' });
    }
    if (value.reasonCode === 'NOT_IMPORTED') issues.push({ path: `${pointer}/reasonCode`, code: 'not-imported-as-unknown', message: 'NOT_IMPORTED is coverage-only and cannot be an unknown value reason' });
    for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${pointerEscape(key)}`);
  };
  visit(record.payload, `${base}/payload`);
  const payload = record.payload;
  if (record.kind === 'stat-curve') {
    for (let index = 1; index < payload.knots.length; index += 1) {
      if (compareDecimal(payload.knots[index - 1].input, payload.knots[index].input) >= 0) issues.push({ path: `${base}/payload/knots/${index}/input`, code: 'curve-order', message: 'Curve inputs must be strictly increasing' });
    }
  }
  if (record.kind === 'stat-definition') {
    const curve = payload.curveRef && recordMap.get(recordKey(payload.curveRef.recordId, payload.curveRef.gameReleaseId));
    for (const field of ['panelInputRange', 'theoreticalInputRange', 'obtainableInputRange']) {
      const range = payload[field];
      if (range.status === 'known' && range.unit !== payload.inputUnit) issues.push({ path: `${base}/payload/${field}/unit`, code: 'stat-input-unit', message: 'Known panel, theoretical and obtainable ranges must use inputUnit' });
    }
    if (curve && curve.kind === 'stat-curve' && (curve.payload.inputUnit !== payload.inputUnit || curve.payload.outputUnit !== payload.outputUnit)) issues.push({ path: `${base}/payload/curveRef`, code: 'curve-unit-mismatch', message: 'Stat definition and referenced curve units must agree' });
  }
  if (record.kind === 'armor-class') {
    payload.damageTypes.forEach((entry, index) => {
      if (entry.multiplier.status === 'known' && !['ratio', 'percent'].includes(entry.multiplier.unit)) issues.push({ path: `${base}/payload/damageTypes/${index}/multiplier/unit`, code: 'armor-multiplier-unit', message: 'Armor multipliers must use ratio or percent' });
    });
  }
  if (record.kind === 'blessing-variant') {
    const defined = new Set(payload.definedTiers);
    if (payload.obtainableTiers.status === 'known') {
      for (const tier of payload.obtainableTiers.tiers) if (!defined.has(tier)) issues.push({ path: `${base}/payload/obtainableTiers/tiers`, code: 'tier-not-defined', message: `Obtainable tier ${tier} must also be defined` });
    }
    const values = new Set();
    for (const [index, tierValue] of payload.tierValues.entries()) {
      if (!defined.has(tierValue.tier)) issues.push({ path: `${base}/payload/tierValues/${index}/tier`, code: 'tier-not-defined', message: `Tier value ${tierValue.tier} must be defined` });
      if (values.has(tierValue.tier)) issues.push({ path: `${base}/payload/tierValues/${index}/tier`, code: 'duplicate-tier-value', message: 'Each tier may have one value only' });
      values.add(tierValue.tier);
    }
  }
  if (record.kind === 'target-profile') {
    for (const [zoneIndex, zone] of payload.hitZones.entries()) {
      const pairs = new Set();
      for (const [multiplierIndex, multiplier] of zone.damageMultipliers.entries()) {
        const key = `${multiplier.critical}:${multiplier.weakspot}`;
        if (pairs.has(key)) issues.push({ path: `${base}/payload/hitZones/${zoneIndex}/damageMultipliers/${multiplierIndex}`, code: 'duplicate-hit-modifier', message: 'Each critical/weakspot modifier pair must be unique per hit zone' });
        pairs.add(key);
      }
    }
  }
}

function validateContextAndComparisonSemantics(contract, recordMap, issues) {
  const contextContainers = new Set(['context', 'contexts', 'conditions', 'applicability']);
  for (const [recordIndex, record] of contract.records.entries()) {
    if (!record || !record.payload || typeof record.payload !== 'object') continue;
    const base = `/records/${recordIndex}`;
    const targetRef = record.kind === 'claim' ? record.payload.targetRef : null;
    const inferredVariant = targetRef && typeof targetRef === 'object'
      ? recordMap.get(recordKey(targetRef.recordId, targetRef.gameReleaseId)) : null;
    const visit = (value, pointer, isContext = false) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${pointer}/${index}`, isContext)); return; }
      if (isContext && value.tier !== undefined) {
        const hasVariantRef = hasOwn(value, 'variantRef');
        const variantRef = hasVariantRef ? value.variantRef : null;
        const explicitVariant = variantRef && typeof variantRef === 'object'
          ? recordMap.get(recordKey(variantRef.recordId, variantRef.gameReleaseId)) : null;
        const mayInferFromClaim = !hasVariantRef && record.kind === 'claim' && inferredVariant?.kind === 'blessing-variant';
        const variant = hasVariantRef ? explicitVariant : (mayInferFromClaim ? inferredVariant : null);
        if (!hasVariantRef && !mayInferFromClaim) {
          issues.push({ path: `${pointer}/variantRef`, code: 'context-tier-needs-variant', message: 'A context tier requires a blessing variant reference or a claim targeting one' });
        } else if (variant?.kind === 'blessing-variant' && Array.isArray(variant.payload?.definedTiers) &&
          !variant.payload.definedTiers.includes(value.tier)) {
          issues.push({ path: `${pointer}/tier`, code: 'context-tier-not-defined', message: `Context tier ${value.tier} is not defined for its blessing variant` });
        }
      }
      if (Array.isArray(value.statComparisons)) {
        for (const [index, comparison] of value.statComparisons.entries()) {
          const statRef = comparison && typeof comparison === 'object' ? comparison.statRef : null;
          const stat = statRef && typeof statRef === 'object'
            ? recordMap.get(recordKey(statRef.recordId, statRef.gameReleaseId)) : null;
          if (stat?.kind === 'stat-definition' && comparison.inputUnit !== stat.payload?.inputUnit) {
            issues.push({ path: `${pointer}/statComparisons/${index}/inputUnit`, code: 'stat-comparison-unit', message: 'Stat comparison inputUnit must match the referenced stat definition' });
          }
        }
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${pointer}/${pointerEscape(key)}`, isContext || contextContainers.has(key));
      }
    };
    visit(record.payload, `${base}/payload`);
  }
}

function validateReferences(contract, releaseMap, recordMap, sourceMap, issues) {
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    for (const { ref, field } of getAllRecordRefs(record)) {
      const target = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
      if (!target) { issues.push({ path: base, code: 'dangling-record-ref', message: `Unknown record ref ${ref.gameReleaseId}:${ref.recordId}` }); continue; }
      const wrongKind = expectedKindIssue(field, target.kind);
      if (wrongKind) issues.push({ path: base, code: 'wrong-kind-ref', message: wrongKind });
      if (target.gameReleaseId !== record.gameReleaseId) validateCompatibility(ref.compatibilityRef, record.gameReleaseId, target.gameReleaseId, contract, releaseMap, issues, base);
      else if (ref.compatibilityRef) issues.push({ path: base, code: 'unneeded-compatibility', message: 'Same-release record refs must not carry compatibilityRef' });
    }
    const sourceLinks = collectSourceLinks(record);
    for (const link of sourceLinks) {
      if (link.gameReleaseId !== record.gameReleaseId && link.compatibilityRef) validateCompatibility(link.compatibilityRef, record.gameReleaseId, link.gameReleaseId, contract, releaseMap, issues, base);
    }
  }
  validateReferenceKinds(contract, recordMap, issues);
  validateReferenceCycles(contract, recordMap, issues);
}

function validateReferenceKinds(contract, recordMap, issues) {
  for (const [index, record] of contract.records.entries()) {
    walkObjects(record.payload, (item, field) => {
      if (typeof item.recordId !== 'string' || typeof item.gameReleaseId !== 'string') return;
      const target = recordMap.get(recordKey(item.recordId, item.gameReleaseId));
      if (!target) return;
      const wrong = expectedKindIssue(field, target.kind);
      if (wrong && !issues.some((issue) => issue.code === 'wrong-kind-ref' && issue.message === wrong)) issues.push({ path: `/records/${index}/payload`, code: 'wrong-kind-ref', message: wrong });
    });
  }
}

function validateReferenceCycles(contract, recordMap, issues) {
  const visiting = new Set(); const visited = new Set();
  const visit = (record) => {
    const key = recordKey(record.recordId, record.gameReleaseId);
    if (visiting.has(key)) { issues.push({ path: `/records`, code: 'reference-cycle', message: `Reference dependency cycle includes ${record.gameReleaseId}:${record.recordId}` }); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const { ref } of getRecordRefEdges(record)) {
      const target = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
      if (target) visit(target);
    }
    visiting.delete(key); visited.add(key);
  };
  for (const record of contract.records) visit(record);
}

function validateCompatibilityAndChanges(contract, releaseMap, recordMap, issues) {
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    if (record.kind === 'release-compatibility') {
      const { fromGameReleaseId, toGameReleaseId } = record.payload;
      const from = releaseMap.get(fromGameReleaseId); const to = releaseMap.get(toGameReleaseId);
      if (!from || !to || fromGameReleaseId === toGameReleaseId || toGameReleaseId !== record.gameReleaseId || from.releaseOrder >= to.releaseOrder) {
        issues.push({ path: `${base}/payload`, code: 'invalid-compatibility', message: 'Compatibility must compare a declared earlier release to this record release' });
      }
    }
    if (record.kind === 'game-change') {
      const compare = record.payload.comparison;
      const from = releaseMap.get(compare.fromGameReleaseId); const to = releaseMap.get(compare.toGameReleaseId);
      if (!from || !to || compare.fromGameReleaseId === compare.toGameReleaseId || to.gameReleaseId !== record.gameReleaseId || from.releaseOrder >= to.releaseOrder) {
        issues.push({ path: `${base}/payload/comparison`, code: 'invalid-change-release', message: 'Game change must compare a declared earlier release to its declared target release' });
      }
      else {
        for (const [key, actual] of [['fromGameVersion', from.gameVersion], ['toGameVersion', to.gameVersion], ['fromGameBuild', from.gameBuild], ['toGameBuild', to.gameBuild], ['fromSnapshotId', from.snapshot.snapshotId], ['toSnapshotId', to.snapshot.snapshotId]]) {
          if (compare[key] !== actual) issues.push({ path: `${base}/payload/comparison/${key}`, code: 'change-comparison-mismatch', message: `Comparison ${key} must match game release metadata` });
        }
        if (from.snapshot.snapshotId === to.snapshot.snapshotId
          || (from.snapshot.manifestSha256 === to.snapshot.manifestSha256 && from.snapshot.contentSha256 === to.snapshot.contentSha256)) {
          issues.push({ path: `${base}/payload/comparison`, code: 'invalid-change-snapshot', message: 'Game change must compare distinct snapshots with different manifest or content digests' });
        }
      }
      if (record.payload.operation === 'modified') for (const [fieldIndex, field] of record.payload.changedFields.entries()) {
        if (typedValueEqual(field.before, field.after)) issues.push({ path: `${base}/payload/changedFields/${fieldIndex}`, code: 'unchanged-game-change-field', message: 'A modified game-change field must have distinct before and after values' });
      }
      const entity = record.payload.entityRef && recordMap.get(recordKey(record.payload.entityRef.recordId, record.payload.entityRef.gameReleaseId));
      if (entity && entity.gameReleaseId !== compare.toGameReleaseId) issues.push({ path: `${base}/payload/entityRef`, code: 'change-entity-release', message: 'Game change entity must be resolved at the target game release' });
    }
  }
}

function validateGameTestEvidence(contract, recordMap, sourceMap, issues) {
  const hasGameTestEvidence = (record, releaseId) => (record.payload.evidenceRefs ?? []).some((ref) => {
    const evidence = recordMap.get(recordKey(ref.recordId, ref.gameReleaseId));
    if (!evidence || evidence.kind !== 'evidence' || evidence.gameReleaseId !== releaseId
      || evidence.payload.evidenceKind !== 'game-tested') return false;
    const sourceRef = evidence.payload.sourceRef;
    const source = sourceMap.get(`${sourceRef.gameReleaseId}\u0000${sourceRef.sourceId}`);
    return sourceRef.gameReleaseId === evidence.gameReleaseId && source?.sourceKind === 'game-test';
  });

  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    if (record.kind === 'evidence' && record.payload.evidenceKind === 'game-tested') {
      const sourceRef = record.payload.sourceRef;
      const source = sourceMap.get(`${sourceRef.gameReleaseId}\u0000${sourceRef.sourceId}`);
      if (source?.sourceKind !== 'game-test' || sourceRef.gameReleaseId !== record.gameReleaseId) {
        issues.push({ path: `${base}/payload/sourceRef`, code: 'game-test-source-required', message: 'Game-tested evidence must identify a game-test source for its own release' });
      }
    }
    const claimRequiresGameTest = record.kind === 'claim' && record.payload.basis === 'game-tested';
    const changeRequiresGameTest = record.kind === 'game-change' && record.payload.verificationMethod === 'game-tested';
    if (claimRequiresGameTest || changeRequiresGameTest) {
      const requiredReleaseId = changeRequiresGameTest ? record.payload.comparison.toGameReleaseId : record.gameReleaseId;
      if (!hasGameTestEvidence(record, requiredReleaseId)) {
        issues.push({ path: `${base}/payload/evidenceRefs`, code: 'game-test-evidence-required', message: 'Game-tested claims and changes require game-tested evidence backed by a same-release game-test source; code-only evidence cannot support that basis' });
      }
    }
  }
}

function validateCoverageAndEmptyCollections(contract, issues) {
  const requireWhenEmpty = new Map([
    ['payload.statRefs', 'stat data'], ['payload.attackProfileRefs', 'attack-profile data'],
    ['payload.damageProfileRefs', 'damage-profile data'], ['payload.targetProfileRefs', 'target-profile data'],
    ['payload.claimRefs', 'claim data'], ['payload.evidenceRefs', 'evidence data'], ['payload.variantRefs', 'variant data'],
    ['payload.perkRefs', 'perk data'], ['payload.entries', 'catalog entries'], ['payload.knots', 'curve table'],
    ['payload.segments', 'damage segments'], ['payload.hitZones', 'target hit zones'], ['payload.damageTypes', 'armor damage types'],
    ['payload.changedFields', 'game change fields'], ['payload.tierValues', 'tier values']
  ]);
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`;
    for (const [pathSuffix, label] of requireWhenEmpty) {
      const path = `/${pathSuffix.replaceAll('.', '/')}`;
      const found = pointerGet(record, path);
      if (found.exists && Array.isArray(found.value) && found.value.length === 0) {
        const covered = record.dataCoverage.missing.some((item) => item.field === path && item.reasonCode === 'NOT_IMPORTED');
        if (!covered) issues.push({ path: `${base}${path}`, code: 'empty-required-collection', message: `Empty ${label} must be explicitly marked NOT_IMPORTED in dataCoverage` });
      }
    }
  }
}

function validateReceipts(contract, releaseMap, recordMap, issues) {
  const receiptsByKey = new Map();
  for (const [index, receipt] of contract.reviewReceipts.entries()) {
    const base = `/reviewReceipts/${index}`; const key = receiptKey(receipt.target);
    if (receiptsByKey.has(key)) issues.push({ path: base, code: 'duplicate-review-receipt', message: 'Only one current receipt is allowed for each target and dimension' });
    receiptsByKey.set(key, receipt);
    if (!releaseMap.has(receipt.target.gameReleaseId)) issues.push({ path: `${base}/target/gameReleaseId`, code: 'unknown-review-release', message: 'Review target release is not declared' });
    if (!getReviewNode(contract, receipt.target)) issues.push({ path: `${base}/target`, code: 'unknown-review-target', message: 'Review receipt target does not exist' });
    const targetItem = getReviewNode(contract, receipt.target)?.item;
    const declared = targetItem?.reviewTargets?.some((target) => target.fieldPath === receipt.target.fieldPath && target.dimension === receipt.target.dimension);
    if (!declared) issues.push({ path: `${base}/target`, code: 'undeclared-review-target', message: 'Receipt must match a required field-and-dimension target' });
    const node = getReviewNode(contract, receipt.target);
    if (node) {
      const field = pointerGet(node.item, receipt.target.fieldPath);
      if (!field.exists) issues.push({ path: `${base}/target/fieldPath`, code: 'missing-review-field', message: 'Review fieldPath must resolve within the target' });
      else {
        try {
          const expected = computeReviewDigests(contract, receipt.target);
          if (receipt.targetDigest !== expected.targetDigest || receipt.dependenciesDigest !== expected.dependenciesDigest) {
            // Staleness is a state transition, not an invalid receipt shape.
          }
        } catch (error) { issues.push({ path: base, code: 'receipt-digest', message: `Cannot compute deterministic receipt digest: ${error.message}` }); }
      }
    }
    if (receipt.reviewer.kind !== 'human' || /^(?:system|automation|fixture|ai|assistant)$/iu.test(receipt.reviewer.id)) issues.push({ path: `${base}/reviewer`, code: 'non-human-reviewer', message: 'Review receipts must identify a human reviewer, not a service or fixture' });
  }
  for (const [index, record] of contract.records.entries()) {
    const base = `/records/${index}`; const derived = deriveReviewState(record, receiptsByKey, contract, issues, base);
    if (record.reviewState !== derived) issues.push({ path: `${base}/reviewState`, code: 'review-state-mismatch', message: `reviewState must be derived as ${derived} from current field/dimension receipts` });
  }
  for (const [index, tombstone] of contract.tombstones.entries()) {
    const base = `/tombstones/${index}`; const derived = deriveReviewState(tombstone, receiptsByKey, contract, issues, base);
    if (tombstone.reviewState !== derived) issues.push({ path: `${base}/reviewState`, code: 'review-state-mismatch', message: `tombstone reviewState must be derived as ${derived} from current receipts` });
  }
  return receiptsByKey;
}

export function validateSourceContract(contract, { schema, sourceRoot = REPO_ROOT } = {}) {
  const issues = [];
  let loadedSchema = schema;
  try { loadedSchema ??= JSON.parse(requireSchemaText(sourceRoot)); }
  catch (error) { return { valid: false, issues: [{ path: '/', code: 'schema-load', message: error.message }], publicationEligible: false, recordCount: 0 }; }
  validateSchemaValue(contract, loadedSchema, loadedSchema, '', issues, new Set());
  for (const message of assertSchemaValidatorParity(loadedSchema)) issues.push({ path: '/content/schema/v2/source-contract.schema.json', code: 'schema-validator-parity', message });
  if (!contract || typeof contract !== 'object') return { valid: false, issues, publicationEligible: false, recordCount: 0 };
  if (issues.some((issue) => issue.code.startsWith('schema-'))) {
    const schemaSha256 = sha256(loadedSchema); const contractSha256 = sha256(contract);
    const receiptCore = { schemaId: loadedSchema.$id, schemaVersion: contract.schemaVersion ?? null, contractSha256, result: 'invalid', publicationEligible: false };
    return {
      valid: false, issues, recordCount: Array.isArray(contract.records) ? contract.records.length : 0,
      releaseCount: Array.isArray(contract.gameReleases) ? contract.gameReleases.length : 0,
      sourceRefCount: Array.isArray(contract.sourceRefs) ? contract.sourceRefs.length : 0,
      publicationEligible: false, contractSha256, schemaSha256,
      validationReceipt: { ...receiptCore, algorithm: 'sha256', receiptSha256: sha256(receiptCore) }
    };
  }
  const releaseMap = validateReleaseSet(contract, issues);
  const sourceMap = validateProvenance(contract, releaseMap, issues);
  const { recordMap } = validateRecordIdentityAndCoverage(contract, releaseMap, sourceMap, issues);
  validateReferences(contract, releaseMap, recordMap, sourceMap, issues);
  validateContextAndComparisonSemantics(contract, recordMap, issues);
  validateGameTestEvidence(contract, recordMap, sourceMap, issues);
  validateCompatibilityAndChanges(contract, releaseMap, recordMap, issues);
  validateCoverageAndEmptyCollections(contract, issues);
  validateReceipts(contract, releaseMap, recordMap, issues);
  const derivedPublicationEligible = issues.length === 0 && !contract.fixtureOnly
    && contract.records.every((record) => record.reviewState === 'approved')
    && contract.tombstones.every((item) => item.reviewState === 'approved');
  if (contract.publicationEligible !== derivedPublicationEligible) issues.push({ path: '/publicationEligible', code: 'publication-state-mismatch', message: `publicationEligible must be ${derivedPublicationEligible} based on fixture and review state` });
  const contractSha256 = sha256(contract);
  const schemaSha256 = sha256(loadedSchema);
  const receiptCore = {
    schemaId: loadedSchema.$id,
    schemaVersion: contract.schemaVersion,
    contractSha256,
    result: issues.length === 0 ? 'valid' : 'invalid',
    publicationEligible: derivedPublicationEligible
  };
  const validationReceipt = { ...receiptCore, algorithm: 'sha256', receiptSha256: sha256(receiptCore) };
  return {
    valid: issues.length === 0,
    issues,
    recordCount: contract.records.length,
    releaseCount: contract.gameReleases.length,
    sourceRefCount: contract.sourceRefs.length,
    publicationEligible: derivedPublicationEligible,
    contractSha256,
    schemaSha256,
    validationReceipt
  };
}

function requireSchemaText(sourceRoot) {
  return readFileSync(path.join(sourceRoot, SCHEMA_RELATIVE), 'utf8');
}

export async function validateSourceContractFromDisk(contract, { sourceRoot = REPO_ROOT } = {}) {
  const schema = await loadContractSchema({ sourceRoot });
  return validateSourceContract(contract, { schema, sourceRoot });
}

async function runCli(argv) {
  if (!argv.includes('--check')) throw new Error('Usage: node scripts/content/contract-validator.mjs --check [--source-root <repo-root>]');
  let sourceRoot = REPO_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--source-root requires a directory');
      sourceRoot = path.resolve(value); index += 1;
    } else if (!['--check'].includes(argv[index])) throw new Error(`Unknown argument: ${argv[index]}`);
  }
  const schemaBytes = await readFile(path.join(sourceRoot, SCHEMA_RELATIVE));
  const fixtureBytes = await readFile(path.join(sourceRoot, FIXTURE_RELATIVE));
  const schema = JSON.parse(schemaBytes.toString('utf8'));
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const result = validateSourceContract(fixture, { schema, sourceRoot });
  const output = {
    schemaId: schema.$id,
    schemaFileSha256: sha256(schemaBytes.toString('utf8')),
    fixturePath: FIXTURE_RELATIVE.replaceAll('\\', '/'),
    fixtureFileSha256: sha256(fixtureBytes.toString('utf8')),
    ...result
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
