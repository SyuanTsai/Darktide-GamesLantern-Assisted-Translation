import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB_AUTHORING_SCHEMA_ID = 'urn:darktide-web:web-authoring:2.0.0';
export const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
export const SOURCE_SCHEMA_ID = SOURCE_REPOSITORY + '/content/schema/v2/source-contract.schema.json';
export const PRESENTATION_KINDS = Object.freeze(['skill', 'blessing', 'weapon', 'catalog', 'curio', 'perk', 'classification']);
export const DETAIL_SECTION_ORDER = Object.freeze(['effects', 'conditions', 'calculation', 'notes', 'extra']);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_FILES = Object.freeze({
  schema: 'content/schema/v2/source-contract.schema.json',
  fixture: 'content/fixtures/v2/representative-source.json',
  validator: 'scripts/content/contract-validator.mjs',
});
const OFFICIAL_INPUT_PATH = 'content/fixtures/v2/web-authoring/official-inputs.json';
const WEB_FIXTURE_PATH = 'content/fixtures/v2/web-authoring/representative.json';
const SOURCE_LOCK_PATH = 'content/contracts/source-v2.lock.json';
const WEB_LOCK_PATH = 'content/contracts/web-authoring.lock.json';
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareLexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort(compareLexical).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex');
const keyOf = ref => String(ref.gameReleaseId) + '\u0000' + String(ref.recordId);
const issue = (issues, at, message, code = 'contract') => issues.push({ path: at || '/', code, message });
const pointerEscape = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');

function pointerGet(value, pointer) {
  if (pointer === '') return { exists: true, value };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { exists: false };
  let cursor = value;
  for (const part of pointer.slice(1).split('/').map(piece => piece.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!cursor || typeof cursor !== 'object' || !hasOwn(cursor, part)) return { exists: false };
    cursor = cursor[part];
  }
  return { exists: true, value: cursor };
}

function pointerResolve(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let cursor = root;
  for (const part of ref.slice(2).split('/').map(piece => piece.replaceAll('~1', '/').replaceAll('~0', '~'))) cursor = cursor?.[part];
  return cursor;
}

function validateSchemaValue(value, fragment, root, at, issues, depth = 0) {
  if (depth > 80) return issue(issues, at, 'schema recursion limit exceeded', 'schema-depth');
  if (fragment === true || fragment == null) return;
  if (fragment === false) return issue(issues, at, 'value is forbidden by schema', 'schema-false');
  if (!isObject(fragment)) return issue(issues, at, 'schema node is not an object', 'schema-shape');
  if (fragment.$ref) {
    const target = pointerResolve(root, fragment.$ref);
    if (!target) issue(issues, at, 'unresolved schema reference: ' + fragment.$ref, 'schema-ref');
    else validateSchemaValue(value, target, root, at, issues, depth + 1);
  }
  if (Array.isArray(fragment.allOf)) for (const part of fragment.allOf) validateSchemaValue(value, part, root, at, issues, depth + 1);
  if (Array.isArray(fragment.oneOf)) {
    const matches = fragment.oneOf.filter(part => {
      const branchIssues = [];
      validateSchemaValue(value, part, root, at, branchIssues, depth + 1);
      return branchIssues.length === 0;
    }).length;
    if (matches !== 1) issue(issues, at, 'value must match exactly one oneOf branch', 'schema-oneOf');
  }
  if (Array.isArray(fragment.anyOf)) {
    const matches = fragment.anyOf.some(part => {
      const branchIssues = [];
      validateSchemaValue(value, part, root, at, branchIssues, depth + 1);
      return branchIssues.length === 0;
    });
    if (!matches) issue(issues, at, 'value must match at least one anyOf branch', 'schema-anyOf');
  }
  if (fragment.not) {
    const forbidden = [];
    validateSchemaValue(value, fragment.not, root, at, forbidden, depth + 1);
    if (forbidden.length === 0) issue(issues, at, 'value matches a forbidden schema', 'schema-not');
  }
  if (fragment.if) {
    const conditionIssues = [];
    validateSchemaValue(value, fragment.if, root, at, conditionIssues, depth + 1);
    const branch = conditionIssues.length === 0 ? fragment.then : fragment.else;
    if (branch) validateSchemaValue(value, branch, root, at, issues, depth + 1);
  }
  if (fragment.const !== undefined && canonical(value) !== canonical(fragment.const)) issue(issues, at, 'value differs from required constant', 'schema-const');
  if (Array.isArray(fragment.enum) && !fragment.enum.some(item => canonical(item) === canonical(value))) issue(issues, at, 'value is not in the allowed set', 'schema-enum');
  if (fragment.type) {
    const types = { object: isObject(value), array: Array.isArray(value), string: typeof value === 'string', integer: Number.isInteger(value), number: typeof value === 'number' && Number.isFinite(value), boolean: typeof value === 'boolean', null: value === null };
    const wanted = Array.isArray(fragment.type) ? fragment.type : [fragment.type];
    if (!wanted.some(type => types[type] === true)) {
      issue(issues, at, 'value has the wrong JSON type', 'schema-type');
      return;
    }
  }
  if (typeof value === 'string') {
    if (fragment.minLength !== undefined && [...value].length < fragment.minLength) issue(issues, at, 'string is shorter than minLength', 'schema-minLength');
    if (fragment.maxLength !== undefined && [...value].length > fragment.maxLength) issue(issues, at, 'string exceeds maxLength', 'schema-maxLength');
    if (fragment.pattern && !new RegExp(fragment.pattern, 'u').test(value)) issue(issues, at, 'string does not match pattern', 'schema-pattern');
    if (fragment.format === 'uri') {
      try { new URL(value); } catch { issue(issues, at, 'string is not a URI', 'schema-format'); }
    }
  }
  if (typeof value === 'number') {
    if (fragment.minimum !== undefined && value < fragment.minimum) issue(issues, at, 'number is less than minimum', 'schema-minimum');
    if (fragment.maximum !== undefined && value > fragment.maximum) issue(issues, at, 'number is greater than maximum', 'schema-maximum');
  }
  if (Array.isArray(value)) {
    if (fragment.minItems !== undefined && value.length < fragment.minItems) issue(issues, at, 'array has fewer than minItems', 'schema-minItems');
    if (fragment.maxItems !== undefined && value.length > fragment.maxItems) issue(issues, at, 'array has more than maxItems', 'schema-maxItems');
    if (fragment.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const encoded = canonical(item);
        if (seen.has(encoded)) { issue(issues, at, 'array items are not unique', 'schema-uniqueItems'); break; }
        seen.add(encoded);
      }
    }
    if (fragment.items) value.forEach((item, index) => validateSchemaValue(item, fragment.items, root, at + '/' + index, issues, depth + 1));
  }
  if (isObject(value)) {
    for (const required of fragment.required ?? []) if (!hasOwn(value, required)) issue(issues, at + '/' + pointerEscape(required), 'required property is missing', 'schema-required');
    for (const [name, child] of Object.entries(value)) {
      if (fragment.properties && hasOwn(fragment.properties, name)) validateSchemaValue(child, fragment.properties[name], root, at + '/' + pointerEscape(name), issues, depth + 1);
      else if (fragment.additionalProperties === false) issue(issues, at + '/' + pointerEscape(name), 'unexpected property', 'schema-additionalProperties');
      else if (isObject(fragment.additionalProperties)) validateSchemaValue(child, fragment.additionalProperties, root, at + '/' + pointerEscape(name), issues, depth + 1);
    }
  }
}

export function assertWebAuthoringSchemaParity(schema) {
  const errors = [];
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') errors.push('schema must declare JSON Schema 2020-12');
  if (schema?.$id !== WEB_AUTHORING_SCHEMA_ID) errors.push('schema id differs from the authoring validator');
  const contract = schema?.$defs?.contract;
  if (!contract || contract.properties?.contractKind?.const !== 'web-authoring' || contract.properties?.publicationEligible?.const !== false) errors.push('schema contract root does not match the non-publishable Web authoring contract');
  if (contract?.additionalProperties !== false) errors.push('schema contract root must reject unowned fields');
  if (canonical(schema?.$defs?.detailSection?.properties?.sectionId?.enum ?? []) !== canonical(DETAIL_SECTION_ORDER)) errors.push('schema detail section order vocabulary differs from the validator');
  const detailSections = schema?.$defs?.presentation?.properties?.detailSections;
  if (detailSections?.maxItems !== DETAIL_SECTION_ORDER.length || hasOwn(detailSections ?? {}, 'minItems')) errors.push('schema detail sections must permit an ordered subset of the fixed section vocabulary');
  for (const kind of ['list', 'table', 'image', 'spoiler']) {
    const blockSchema = schema?.$defs?.announcementBlock?.oneOf?.find(branch => branch.properties?.kind?.const === kind);
    if (!blockSchema) errors.push('schema announcement blocks omit the ' + kind + ' occurrence type');
  }
  const kinds = schema?.$defs?.presentationEntityRef?.properties?.kind?.enum ?? [];
  if (canonical([...kinds].sort(compareLexical)) !== canonical([...PRESENTATION_KINDS].sort(compareLexical))) errors.push('schema presentation kinds differ from the validated owner set');
  if (schema?.$defs?.officialInputSnapshot?.additionalProperties !== false) errors.push('official input snapshot must be closed');
  if (errors.length) throw new Error('Web schema/validator parity failure: ' + errors.join('; '));
  return true;
}

async function readJson(root, relativePath) {
  const bytes = await readFile(path.join(root, relativePath));
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(relativePath + ' contains invalid UTF-8 byte sequence'); }
  try { return { bytes, value: JSON.parse(text) }; }
  catch (error) { throw new Error(relativePath + ' is not valid UTF-8 JSON: ' + error.message); }
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(label + ' must be a lowercase SHA-256');
}

function expectedSourcePin(lock) {
  return {
    repository: lock.repository,
    commit: lock.commit,
    schemaId: lock.schemaId,
    schemaSha256: lock.files.schema.sha256,
    fixtureSha256: lock.files.fixture.sha256,
    validatorSha256: lock.files.validator.sha256,
  };
}

async function loadSourceContract({ repoRoot, snapshotRoot, sourceRoot }) {
  const lock = (await readJson(repoRoot, SOURCE_LOCK_PATH)).value;
  if (!isObject(lock) || lock.schemaVersion !== '1.0.0' || lock.repository !== SOURCE_REPOSITORY || lock.schemaId !== SOURCE_SCHEMA_ID || !COMMIT_RE.test(lock.commit ?? '')) {
    throw new Error('pinned Source contract lock has an invalid identity');
  }
  for (const name of Object.keys(SOURCE_FILES)) {
    const entry = lock.files?.[name];
    if (!isObject(entry) || entry.path !== SOURCE_FILES[name]) throw new Error('pinned Source contract lock has an unexpected ' + name + ' path');
    requireSha(entry.sha256, 'pinned Source ' + name + ' hash');
  }
  const sourceBytes = {};
  for (const [name, relativePath] of Object.entries(SOURCE_FILES)) {
    const bytes = await readFile(path.join(snapshotRoot, relativePath));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== lock.files[name].sha256) throw new Error('pinned Source snapshot hash mismatch: ' + relativePath);
    sourceBytes[name] = bytes;
  }
  let actualCommit = null;
  if (sourceRoot) {
    const actualRoot = await realpath(sourceRoot);
    for (const [name, relativePath] of Object.entries(SOURCE_FILES)) {
      const bytes = await readFile(path.join(actualRoot, relativePath));
      if (createHash('sha256').update(bytes).digest('hex') !== lock.files[name].sha256) {
        throw new Error('Source checkout differs from pinned bytes: ' + relativePath);
      }
    }
    try { actualCommit = execFileSync('git', ['-C', actualRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
    catch (error) { throw new Error('cannot read Source checkout commit: ' + error.message); }
    if (actualCommit !== lock.commit) throw new Error('Source checkout commit differs from the pinned Source lock');
  }
  const schema = JSON.parse(sourceBytes.schema.toString('utf8'));
  const sourceContract = JSON.parse(sourceBytes.fixture.toString('utf8'));
  const sourceValidator = await import(pathToFileURL(path.join(snapshotRoot, SOURCE_FILES.validator)).href);
  if (sourceValidator.CONTRACT_SCHEMA_ID !== lock.schemaId) throw new Error('Source validator schema id differs from the lock');
  sourceValidator.assertSchemaValidatorParity(schema);
  const sourceValidation = sourceValidator.validateSourceContract(sourceContract, { schema });
  if (!sourceValidation.valid) throw new Error('pinned Source representative fixture is invalid: ' + sourceValidation.issues.map(item => item.message).join('; '));
  if (sourceContract.fixtureOnly !== true || sourceContract.publicationEligible !== false) throw new Error('pinned Source fixture must remain synthetic and non-publishable');
  return {
    sourceLock: lock, sourceContract, sourceSchema: schema, sourceValidator, sourceValidation,
    sourceCheck: { matchesPinnedSnapshot: sourceRoot ? true : null, commit: actualCommit },
  };
}

export async function loadWebAuthoringInputs({ repoRoot = REPO_ROOT, sourceSnapshotRoot, sourceRoot } = {}) {
  const absoluteRoot = await realpath(repoRoot);
  const snapshotRoot = sourceSnapshotRoot ? await realpath(sourceSnapshotRoot) : path.join(absoluteRoot, 'content/contracts/source-v2-snapshot');
  const [schemaFile, authoringFile, officialFile, webLockFile, sourceInfo] = await Promise.all([
    readJson(absoluteRoot, 'content/schema/v2/web-authoring.schema.json'),
    readJson(absoluteRoot, WEB_FIXTURE_PATH),
    readJson(absoluteRoot, OFFICIAL_INPUT_PATH),
    readJson(absoluteRoot, WEB_LOCK_PATH),
    loadSourceContract({ repoRoot: absoluteRoot, snapshotRoot, sourceRoot }),
  ]);
  const schema = schemaFile.value;
  assertWebAuthoringSchemaParity(schema);
  const webLock = webLockFile.value;
  if (!isObject(webLock) || webLock.schemaVersion !== '1.0.0' || webLock.officialInputs?.path !== OFFICIAL_INPUT_PATH) {
    throw new Error('Web authoring lock has an invalid official-input identity');
  }
  requireSha(webLock.officialInputs.sha256, 'pinned official-input hash');
  const actualOfficialHash = createHash('sha256').update(officialFile.bytes).digest('hex');
  if (actualOfficialHash !== webLock.officialInputs.sha256) throw new Error('pinned official input snapshot hash mismatch');
  if (authoringFile.value.officialInputsSha256 !== webLock.officialInputs.sha256) throw new Error('authoring officialInputsSha256 differs from the pinned input snapshot');
  const officialIssues = [];
  validateSchemaValue(officialFile.value, schema, schema, '', officialIssues);
  if (officialIssues.length) throw new Error('pinned official input snapshot violates schema: ' + officialIssues.map(item => item.path + ' ' + item.message).join('; '));
  const sourcePin = expectedSourcePin(sourceInfo.sourceLock);
  if (canonical(authoringFile.value.sourcePin) !== canonical(sourcePin)) throw new Error('authoring Source pin differs from the fixed Source lock');
  return {
    repoRoot: absoluteRoot, schema, authoring: authoringFile.value, officialInputs: officialFile.value,
    officialInputsBytes: officialFile.bytes, webLock, sourcePin, ...sourceInfo,
    sourceRecordMap: new Map(sourceInfo.sourceContract.records.map(record => [keyOf(record), record])),
    sourceReleaseMap: new Map(sourceInfo.sourceContract.gameReleases.map(release => [release.gameReleaseId, release])),
  };
}

function textHashMatches(text, digest) {
  return typeof text === 'string' && digest === sha256(text);
}

function uniqueBy(items, keyOfItem, label, issues, at) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const key = keyOfItem(items[index]);
    if (seen.has(key)) issue(issues, at + '/' + index, 'duplicate ' + label + ': ' + key, 'duplicate-id');
    seen.add(key);
  }
}

function collectRecordRefs(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRecordRefs(item, output);
  } else if (isObject(value)) {
    if (typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string' && typeof value.kind === 'string') output.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'recordId' && key !== 'gameReleaseId' && key !== 'kind') collectRecordRefs(child, output);
    }
  }
  return output;
}

function resolveSourceRecord(ref, expectedKind, ownerRelease, inputs, issues, at) {
  const record = inputs.sourceRecordMap.get(keyOf(ref));
  if (!record) {
    issue(issues, at, 'Source record reference is unresolved: ' + ref.gameReleaseId + ':' + ref.recordId, 'dangling-ref');
    return null;
  }
  if (record.kind !== ref.kind || (expectedKind && record.kind !== expectedKind)) {
    issue(issues, at, 'Source record kind does not match the typed reference', 'wrong-kind-ref');
    return null;
  }
  if (ownerRelease && ref.gameReleaseId !== ownerRelease) {
    const compatibility = ref.compatibilityRef;
    const compatibilityRecord = compatibility && inputs.sourceRecordMap.get(keyOf(compatibility));
    if (!compatibilityRecord || compatibility.kind !== 'release-compatibility' || compatibilityRecord.kind !== 'release-compatibility') {
      issue(issues, at, 'cross-release reference requires a typed compatibility record', 'cross-release-ref');
      return null;
    }
    const relation = compatibilityRecord.payload;
    if (compatibility.gameReleaseId !== ownerRelease || relation.fromGameReleaseId !== ref.gameReleaseId || relation.toGameReleaseId !== ownerRelease) {
      issue(issues, at, 'compatibility record does not cover the referenced release pair', 'cross-release-ref');
      return null;
    }
  } else if (ref.compatibilityRef) {
    issue(issues, at, 'same-release reference must not carry compatibility evidence', 'unexpected-compatibility-ref');
    return null;
  }
  return record;
}

function validateOfficialInput(source, inputs, issues, at) {
  const params = new Map(source.params.map(param => [param.parameterId, param]));
  if (params.size !== source.params.length) issue(issues, at + '/params', 'official parameter ids must be unique', 'duplicate-id');
  uniqueBy(source.segments, segment => segment.segmentId, 'official segment id', issues, at + '/segments');
  const usedParams = new Set();
  const sourceParts = [];
  const renderedParts = [];
  for (let index = 0; index < source.segments.length; index += 1) {
    const segment = source.segments[index];
    const segmentAt = at + '/segments/' + index;
    const segmentBytes = segment.kind === 'text' ? segment.text : segment.token;
    if (!textHashMatches(segmentBytes, segment.sha256)) issue(issues, segmentAt + '/sha256', 'official segment bytes do not match their hash', 'hash-mismatch');
    if (segment.kind === 'text') {
      sourceParts.push(segment.text);
      renderedParts.push(segment.text);
    } else {
      const parameter = params.get(segment.parameterId);
      if (!parameter) {
        issue(issues, segmentAt + '/parameterId', 'official parameter binding is missing', 'parameter-binding');
        sourceParts.push(segment.token);
        renderedParts.push(segment.token);
      } else {
        usedParams.add(segment.parameterId);
        sourceParts.push(segment.token);
        renderedParts.push(parameter.value);
      }
    }
  }
  for (const param of source.params) if (!usedParams.has(param.parameterId)) issue(issues, at + '/params', 'official parameter has no ordered segment binding: ' + param.parameterId, 'parameter-binding');
  const expectedSourceText = sourceParts.join('');
  const expectedResolvedText = renderedParts.join('');
  if (source.sourceText !== expectedSourceText) issue(issues, at + '/sourceText', 'sourceText differs from ordered official segments', 'source-text');
  if (!textHashMatches(source.sourceText, source.sourceTextSha256)) issue(issues, at + '/sourceTextSha256', 'official sourceText hash mismatch', 'hash-mismatch');
  if (source.resolvedText !== expectedResolvedText) issue(issues, at + '/resolvedText', 'resolvedText differs from bound official parameters', 'parameter-binding');
  if (!textHashMatches(source.resolvedText, source.resolvedTextSha256)) issue(issues, at + '/resolvedTextSha256', 'official resolvedText hash mismatch', 'hash-mismatch');
  resolveSourceRecord(source.entityRef, source.entityRef.kind, source.entityRef.gameReleaseId, inputs, issues, at + '/entityRef');
  if (!inputs.sourceReleaseMap.has(source.entityRef.gameReleaseId)) issue(issues, at + '/entityRef/gameReleaseId', 'official input references an unknown game release', 'unknown-release');
}

function ownerObject(contract, target) {
  const collection = {
    presentation: ['presentations', 'authoringId'],
    'term-localization': ['termLocalizations', 'authoringId'],
    announcement: ['announcements', 'announcementId'],
    'game-change': ['gameChanges', 'changeId'],
    'official-text-change': ['officialTextChanges', 'changeId'],
  }[target.ownerKind];
  if (!collection) return null;
  return contract[collection[0]].find(item => item[collection[1]] === target.ownerId) ?? null;
}

function validateReceiptAndTargetShapes(contract, issues) {
  uniqueBy(contract.reviewTargets, item => item.targetId, 'review target id', issues, '/reviewTargets');
  const targets = new Map(contract.reviewTargets.map(target => [target.targetId, target]));
  for (const [index, target] of contract.reviewTargets.entries()) {
    const at = '/reviewTargets/' + index;
    const owner = ownerObject(contract, target);
    if (!owner) {
      issue(issues, at + '/ownerId', 'review target owner does not exist', 'dangling-owner');
      continue;
    }
    if (!pointerGet(owner, target.fieldPath).exists) issue(issues, at + '/fieldPath', 'review field path does not exist on its owner', 'review-path');
    const allowed = {
      official: target.ownerKind === 'presentation' && target.fieldPath === '/official',
      translation: target.ownerKind === 'presentation' && target.fieldPath === '/faithfulTranslation',
      content: (target.ownerKind === 'presentation' && (
        ['/name', '/detailSections', '/errata', '/tierApplicability'].includes(target.fieldPath)
        || /^\/detailSections\/\d+\/items\/\d+\/text$/.test(target.fieldPath)
        || /^\/errata\/\d+\/text$/.test(target.fieldPath)
      )) || (target.ownerKind === 'term-localization' && ['/label', '/definition'].includes(target.fieldPath))
        || (target.ownerKind === 'game-change' && (target.fieldPath === '/fieldSummaries' || /^\/fieldSummaries\/\d+\/summary$/.test(target.fieldPath))),
      context: (target.ownerKind === 'presentation' && (target.fieldPath === '/tierApplicability' || /^\/errata\/\d+\/context(?:\/description)?$/.test(target.fieldPath)))
        || (target.ownerKind === 'term-localization' && target.fieldPath === '/contextKey'),
      errata: target.ownerKind === 'presentation' && target.fieldPath === '/errata',
      announcement: target.ownerKind === 'announcement' && target.fieldPath === '/blocks',
      'game-change': ['game-change', 'official-text-change'].includes(target.ownerKind) && target.fieldPath === '/summary',
      identity: (target.ownerKind === 'presentation' && target.fieldPath === '/entityRef') || (target.ownerKind === 'term-localization' && target.fieldPath === '/termRef'),
    }[target.dimension] ?? false;
    if (!allowed) issue(issues, at + '/dimension', 'review dimension does not match an allowed owner field', 'review-dimension');
  }
  const receiptKeys = new Set();
  for (const [index, receipt] of contract.reviewReceipts.entries()) {
    const at = '/reviewReceipts/' + index;
    if (!targets.has(receipt.targetId)) issue(issues, at + '/targetId', 'review receipt target does not exist', 'dangling-review');
    const key = [receipt.targetId, receipt.targetDigest, receipt.dependenciesDigest, receipt.reviewedAt].join('\u0000');
    if (receiptKeys.has(key)) issue(issues, at, 'duplicate review receipt entry', 'duplicate-review');
    receiptKeys.add(key);
    if (!Number.isFinite(Date.parse(receipt.reviewedAt))) issue(issues, at + '/reviewedAt', 'review timestamp is not a valid UTC date', 'review-time');
  }
}

function isForbiddenRemoteKey(value, at, issues) {
  const forbidden = new Set(['selector', 'selectorProgram', 'regex', 'matcherProgram', 'javascript', 'wasm', 'htmlTemplate', 'formula', 'expression', 'modImpact', 'checkedConsumers', 'matchedDependencies', 'actionRequired', 'suggestedActions', 'verificationChecklist']);
  const walk = (node, pointer) => {
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, pointer + '/' + index));
    else if (isObject(node)) for (const [key, child] of Object.entries(node)) {
      if (forbidden.has(key)) issue(issues, pointer + '/' + pointerEscape(key), 'remote selectors, executable fields, and MOD impact fields are outside this contract', 'forbidden-field');
      walk(child, pointer + '/' + pointerEscape(key));
    }
  };
  walk(value, at);
}

function collectAnnouncementOccurrences(blocks, blockIds, assetRefs, at) {
  for (const [index, block] of blocks.entries()) {
    const blockAt = at + '/' + index;
    blockIds.push({ blockId: block.blockId, path: blockAt + '/blockId' });
    if (block.kind === 'list') {
      for (const [itemIndex, item] of block.items.entries()) blockIds.push({ blockId: item.blockId, path: blockAt + '/items/' + itemIndex + '/blockId' });
    } else if (block.kind === 'table') {
      for (const [rowIndex, row] of block.rows.entries()) {
        for (const [cellIndex, cell] of row.cells.entries()) blockIds.push({ blockId: cell.blockId, path: blockAt + '/rows/' + rowIndex + '/cells/' + cellIndex + '/blockId' });
      }
    } else if (block.kind === 'image') {
      assetRefs.push({ assetId: block.assetRef.assetId, path: blockAt + '/assetRef/assetId' });
    } else if (block.kind === 'spoiler') {
      collectAnnouncementOccurrences(block.blocks, blockIds, assetRefs, blockAt + '/blocks');
    }
  }
}

function officialTextContent(source) {
  return {
    sourceText: source.sourceText,
    segments: source.segments.map(segment => segment.kind === 'text'
      ? { kind: 'text', text: segment.text }
      : { kind: 'parameter', parameterId: segment.parameterId, token: segment.token }),
    params: source.params.map(param => ({ parameterId: param.parameterId, sourceKey: param.sourceKey, value: param.value })),
    resolvedText: source.resolvedText,
  };
}

function validateWebSemantic(contract, inputs, issues) {
  inputs.sourceRecordMap = new Map(inputs.sourceContract.records.map(record => [keyOf(record), record]));
  inputs.sourceReleaseMap = new Map(inputs.sourceContract.gameReleases.map(release => [release.gameReleaseId, release]));
  const officialById = new Map(inputs.officialInputs.sources.map(source => [source.officialSourceId, source]));
  const officialIds = new Set();
  const officialLocators = new Set();
  for (const [index, source] of inputs.officialInputs.sources.entries()) {
    const at = '/official-inputs/sources/' + index;
    if (officialIds.has(source.officialSourceId)) issue(issues, at + '/officialSourceId', 'official source id must be unique', 'duplicate-id');
    officialIds.add(source.officialSourceId);
    const locator = [source.entityRef.gameReleaseId, source.entityRef.recordId, source.origin, source.sourceLocale, source.resource, source.key, source.occurrence].join('\u0000');
    if (officialLocators.has(locator)) issue(issues, at, 'official source locator occurrence is duplicated', 'duplicate-locator');
    officialLocators.add(locator);
    validateOfficialInput(source, inputs, issues, at);
  }

  uniqueBy(contract.presentations, item => item.authoringId, 'authoring id', issues, '/presentations');
  for (const [index, presentation] of contract.presentations.entries()) {
    const at = '/presentations/' + index;
    const entity = resolveSourceRecord(presentation.entityRef, presentation.entityRef.kind, presentation.entityRef.gameReleaseId, inputs, issues, at + '/entityRef');
    if (!PRESENTATION_KINDS.includes(presentation.entityRef.kind) || (entity && !PRESENTATION_KINDS.includes(entity.kind))) issue(issues, at + '/entityRef/kind', 'Source kind cannot be presented by this contract', 'wrong-kind-ref');
    const fixedOfficial = officialById.get(presentation.official.officialSourceId);
    if (!fixedOfficial || canonical(fixedOfficial) !== canonical(presentation.official)) issue(issues, at + '/official', 'official bytes differ from the fixed official input snapshot', 'fixed-official-input');
    if (presentation.official.entityRef.recordId !== presentation.entityRef.recordId || presentation.official.entityRef.gameReleaseId !== presentation.entityRef.gameReleaseId || presentation.official.entityRef.kind !== presentation.entityRef.kind) {
      issue(issues, at + '/official/entityRef', 'official input is bound to a different entity or release', 'official-owner');
    }
    if (presentation.faithfulTranslation.sourceId !== presentation.official.officialSourceId) issue(issues, at + '/faithfulTranslation/sourceId', 'faithful translation must name its official source input', 'translation-source');
    if (!textHashMatches(presentation.faithfulTranslation.text, presentation.faithfulTranslation.textSha256)) issue(issues, at + '/faithfulTranslation/textSha256', 'faithful translation hash mismatch', 'hash-mismatch');
    const sectionIds = presentation.detailSections.map(section => section.sectionId);
    let previousSectionIndex = -1;
    for (const [sectionIndex, sectionId] of sectionIds.entries()) {
      const declaredIndex = DETAIL_SECTION_ORDER.indexOf(sectionId);
      if (declaredIndex <= previousSectionIndex) {
        issue(issues, at + '/detailSections/' + sectionIndex + '/sectionId', 'detail sections must be a unique ordered subset of the five fixed sections', 'section-order');
        break;
      }
      previousSectionIndex = declaredIndex;
    }
    const itemIds = [];
    for (const [sectionIndex, section] of presentation.detailSections.entries()) {
      for (const [itemIndex, item] of section.items.entries()) {
        itemIds.push(item.itemId);
        for (const [refIndex, ref] of item.claimRefs.entries()) resolveSourceRecord(ref, 'claim', presentation.entityRef.gameReleaseId, inputs, issues, at + '/detailSections/' + sectionIndex + '/items/' + itemIndex + '/claimRefs/' + refIndex);
        for (const [refIndex, ref] of item.termRefs.entries()) resolveSourceRecord(ref, 'term', presentation.entityRef.gameReleaseId, inputs, issues, at + '/detailSections/' + sectionIndex + '/items/' + itemIndex + '/termRefs/' + refIndex);
      }
    }
    uniqueBy(itemIds.map(itemId => ({ itemId })), item => item.itemId, 'detail item id', issues, at + '/detailSections');
    const errataIds = [];
    for (const [errataIndex, erratum] of presentation.errata.entries()) {
      errataIds.push(erratum.errataId);
      const official = officialById.get(erratum.anchor.officialSourceId);
      const segment = official?.segments.find(item => item.segmentId === erratum.anchor.segmentId);
      if (erratum.anchor.officialSourceId !== presentation.official.officialSourceId
        || official?.entityRef.recordId !== presentation.entityRef.recordId
        || official?.entityRef.gameReleaseId !== presentation.entityRef.gameReleaseId
        || official?.entityRef.kind !== presentation.entityRef.kind) {
        issue(issues, at + '/errata/' + errataIndex + '/anchor', 'errata anchor must belong to this presentation official source, entity, and release', 'errata-owner');
      }
      if (!segment || segment.sha256 !== erratum.anchor.segmentSha256) issue(issues, at + '/errata/' + errataIndex + '/anchor', 'errata anchor does not match an exact official source segment', 'errata-anchor');
      for (const [refIndex, ref] of erratum.claimRefs.entries()) resolveSourceRecord(ref, 'claim', presentation.entityRef.gameReleaseId, inputs, issues, at + '/errata/' + errataIndex + '/claimRefs/' + refIndex);
      for (const [refIndex, ref] of erratum.evidenceRefs.entries()) resolveSourceRecord(ref, 'evidence', presentation.entityRef.gameReleaseId, inputs, issues, at + '/errata/' + errataIndex + '/evidenceRefs/' + refIndex);
      for (const [refIndex, ref] of erratum.context.refs.entries()) resolveSourceRecord(ref, ref.kind, presentation.entityRef.gameReleaseId, inputs, issues, at + '/errata/' + errataIndex + '/context/refs/' + refIndex);
    }
    uniqueBy(errataIds.map(errataId => ({ errataId })), item => item.errataId, 'errata id', issues, at + '/errata');
    if (presentation.tierApplicability.length && presentation.entityRef.kind !== 'blessing') issue(issues, at + '/tierApplicability', 'tier applicability is only valid for blessing presentations', 'tier-owner');
    for (const [tierIndex, entry] of presentation.tierApplicability.entries()) {
      const variant = resolveSourceRecord(entry.variantRef, 'blessing-variant', presentation.entityRef.gameReleaseId, inputs, issues, at + '/tierApplicability/' + tierIndex + '/variantRef');
      if (variant) {
        const defined = variant.payload.definedTiers;
        if (variant.payload.blessingRef.recordId !== presentation.entityRef.recordId || variant.payload.blessingRef.gameReleaseId !== presentation.entityRef.gameReleaseId) issue(issues, at + '/tierApplicability/' + tierIndex + '/variantRef', 'blessing variant belongs to another blessing', 'tier-owner');
        for (const tier of entry.tiers) if (!defined.includes(tier)) issue(issues, at + '/tierApplicability/' + tierIndex + '/tiers', 'tier is not defined by the referenced Source variant: ' + tier, 'tier-range');
      }
    }
  }

  uniqueBy(contract.termLocalizations, item => item.authoringId, 'term localization id', issues, '/termLocalizations');
  for (const [index, localization] of contract.termLocalizations.entries()) {
    const term = resolveSourceRecord(localization.termRef, 'term', localization.termRef.gameReleaseId, inputs, issues, '/termLocalizations/' + index + '/termRef');
    if (term && term.payload.contextKey !== localization.contextKey) issue(issues, '/termLocalizations/' + index + '/contextKey', 'localized term context differs from its Source term', 'term-context');
  }

  uniqueBy(contract.announcements, item => item.announcementId, 'announcement id', issues, '/announcements');
  for (const [index, announcement] of contract.announcements.entries()) {
    const at = '/announcements/' + index;
    if (announcement.scope === 'site' && announcement.source.kind !== 'site-owner') issue(issues, at + '/source/kind', 'site announcements must use the Web site-owner source', 'announcement-owner');
    if (announcement.scope === 'gameplay') {
      if (announcement.source.kind !== 'official-game-source') issue(issues, at + '/source/kind', 'gameplay announcements must cite an official game source', 'announcement-owner');
      if (!inputs.sourceReleaseMap.has(announcement.gameReleaseId)) issue(issues, at + '/gameReleaseId', 'gameplay announcement references an unknown release', 'unknown-release');
    }
    if (!Number.isFinite(Date.parse(announcement.publishedOn + 'T00:00:00Z'))) issue(issues, at + '/publishedOn', 'announcement date is invalid', 'announcement-date');
    uniqueBy(announcement.assets, asset => asset.assetId, 'announcement asset id', issues, at + '/assets');
    const nestedBlockIds = [];
    const assetRefs = [];
    collectAnnouncementOccurrences(announcement.blocks, nestedBlockIds, assetRefs, at + '/blocks');
    uniqueBy(nestedBlockIds, item => item.blockId, 'announcement block id', issues, at + '/blocks');
    const assetIds = new Set(announcement.assets.map(asset => asset.assetId));
    for (const ref of assetRefs) if (!assetIds.has(ref.assetId)) issue(issues, ref.path, 'announcement image references an undeclared asset', 'dangling-asset');
  }

  const sourceChangeIds = new Set();
  uniqueBy(contract.gameChanges, item => item.changeId, 'Source game change id', issues, '/gameChanges');
  for (const [index, change] of contract.gameChanges.entries()) {
    const at = '/gameChanges/' + index;
    const sourceChange = resolveSourceRecord(change.sourceRef, 'game-change', change.sourceRef.gameReleaseId, inputs, issues, at + '/sourceRef');
    if (sourceChange) {
      if (change.changeId !== sourceChange.recordId) issue(issues, at + '/changeId', 'Web summary must reuse the Source game-change id', 'game-change-id');
      if (change.sourceRef.gameReleaseId !== sourceChange.gameReleaseId) issue(issues, at + '/sourceRef/gameReleaseId', 'game-change summary points to a different Source release', 'game-change-owner');
      sourceChangeIds.add(sourceChange.recordId);
      const sourceFields = new Set((sourceChange.payload.changedFields ?? []).map(item => item.field));
      for (const [fieldIndex, fieldSummary] of change.fieldSummaries.entries()) {
        if (!sourceFields.has(fieldSummary.field)) issue(issues, at + '/fieldSummaries/' + fieldIndex + '/field', 'field summary must name a field present in the referenced Source game change', 'game-change-field');
      }
    }
    if (!textHashMatches(change.summary.text, change.summary.textSha256)) issue(issues, at + '/summary/textSha256', 'game-change summary hash mismatch', 'hash-mismatch');
    uniqueBy(change.fieldSummaries, item => item.field, 'game-change field summary', issues, at + '/fieldSummaries');
  }

  uniqueBy(contract.officialTextChanges, item => item.changeId, 'official text change id', issues, '/officialTextChanges');
  const officialChangeIds = new Set();
  for (const [index, change] of contract.officialTextChanges.entries()) {
    const at = '/officialTextChanges/' + index;
    officialChangeIds.add(change.changeId);
    if (sourceChangeIds.has(change.changeId)) issue(issues, at + '/changeId', 'Web official-text id collides with a Source game-change id', 'change-id-collision');
    const fromRelease = inputs.sourceReleaseMap.get(change.fromGameReleaseId);
    const toRelease = inputs.sourceReleaseMap.get(change.toGameReleaseId);
    if (!fromRelease || !toRelease) issue(issues, at, 'official text change references an unknown Source release', 'unknown-release');
    else if (fromRelease.releaseOrder >= toRelease.releaseOrder) issue(issues, at, 'official text comparison must move forward across releases', 'release-order');
    else if (fromRelease.gameVersion === toRelease.gameVersion && fromRelease.gameBuild === toRelease.gameBuild) issue(issues, at, 'same-version/build source revisions cannot be presented as a game update', 'same-source-update');
    else if (canonical(fromRelease.snapshot) === canonical(toRelease.snapshot)) issue(issues, at, 'the compared releases must have distinct verified source snapshots', 'same-source-update');
    const from = officialById.get(change.fromOfficialSourceId);
    const to = officialById.get(change.toOfficialSourceId);
    if (!from || !to) issue(issues, at, 'official text change must cite two fixed official input records', 'official-change-source');
    else {
      if (from.entityRef.gameReleaseId !== change.fromGameReleaseId || to.entityRef.gameReleaseId !== change.toGameReleaseId) issue(issues, at, 'official input releases do not match the declared comparison', 'official-change-release');
      if (from.entityRef.recordId !== change.entityRef.recordId || to.entityRef.recordId !== change.entityRef.recordId || from.entityRef.kind !== change.entityRef.kind || to.entityRef.kind !== change.entityRef.kind) issue(issues, at + '/entityRef', 'official comparison must follow the same stable entity across both releases', 'official-change-entity');
      if (canonical(officialTextContent(from)) === canonical(officialTextContent(to))) issue(issues, at, 'unchanged official text and parameter bindings cannot be presented as an official text change', 'same-official-text');
    }
    if (!textHashMatches(change.summary.text, change.summary.textSha256)) issue(issues, at + '/summary/textSha256', 'official text change summary hash mismatch', 'hash-mismatch');
    if (change.operation === 'correction' && !change.supersedesChangeId) issue(issues, at + '/supersedesChangeId', 'official-text correction must link its prior change', 'correction-chain');
  }
  const allChangeIds = new Set([...sourceChangeIds, ...officialChangeIds]);
  const edges = new Map();
  for (const change of [...contract.gameChanges, ...contract.officialTextChanges]) if (change.supersedesChangeId) {
    if (!allChangeIds.has(change.supersedesChangeId)) issue(issues, '/change', 'supersedesChangeId must resolve to a change in this contract', 'dangling-change');
    edges.set(change.changeId, change.supersedesChangeId);
  }
  for (const start of edges.keys()) {
    const seen = new Set([start]);
    let current = edges.get(start);
    while (current) {
      if (seen.has(current)) { issue(issues, '/change', 'change correction chain contains a cycle', 'change-cycle'); break; }
      seen.add(current);
      current = edges.get(current);
    }
  }

  validateReceiptAndTargetShapes(contract, issues);
  isForbiddenRemoteKey(contract, '', issues);
}

export function validateWebAuthoring(contract, inputs) {
  const issues = [];
  if (!inputs?.schema || !inputs?.sourceContract || !inputs?.officialInputs) {
    return { valid: false, issues: [{ path: '/', code: 'missing-inputs', message: 'fixed Web, Source, and official inputs are required' }], publicationEligible: false };
  }
  validateSchemaValue(contract, inputs.schema, inputs.schema, '', issues);
  if (issues.length) return { valid: false, issues, publicationEligible: false };
  if (contract.publicationEligible !== false) issue(issues, '/publicationEligible', 'contract validation never grants publication eligibility', 'publication-guard');
  if (inputs.sourceValidation?.valid !== true) issue(issues, '/sourcePin', 'fixed Source contract is not valid', 'source-contract');
  const pin = expectedSourcePin(inputs.sourceLock);
  if (canonical(contract.sourcePin) !== canonical(pin)) issue(issues, '/sourcePin', 'Source technical owner pin differs from the verified lock', 'source-pin');
  if (contract.officialInputsSha256 !== inputs.webLock.officialInputs.sha256) issue(issues, '/officialInputsSha256', 'official input digest differs from the fixed safe snapshot', 'official-input-pin');
  validateWebSemantic(contract, inputs, issues);
  return { valid: issues.length === 0, issues, publicationEligible: false };
}

function targetOwner(contract, target) {
  const owner = ownerObject(contract, target);
  if (!owner) throw new Error('Unknown review target owner: ' + target.ownerId);
  const field = pointerGet(owner, target.fieldPath);
  if (!field.exists) throw new Error('Review field path does not exist: ' + target.fieldPath);
  return { owner, value: field.value };
}

function reviewSourceValue(target, owner, value) {
  if (target.ownerKind === 'presentation') {
    const itemMatch = target.fieldPath.match(/^\/detailSections\/(\d+)\/items\/(\d+)\/text$/);
    if (itemMatch) {
      const item = owner.detailSections[Number(itemMatch[1])]?.items[Number(itemMatch[2])];
      return item ? { claimRefs: item.claimRefs, termRefs: item.termRefs } : value;
    }
    const errataMatch = target.fieldPath.match(/^\/errata\/(\d+)\/(?:text|context(?:\/description)?)$/);
    if (errataMatch) return owner.errata[Number(errataMatch[1])] ?? value;
  }
  return value;
}

function reviewDependencyRefs(target, owner, value) {
  const refs = collectRecordRefs(reviewSourceValue(target, owner, value), []);
  if (target.ownerKind === 'game-change') refs.push(owner.sourceRef);
  if (target.ownerKind === 'presentation') {
    const ownerKey = keyOf(owner.entityRef);
    for (let index = refs.length - 1; index >= 0; index -= 1) if (keyOf(refs[index]) === ownerKey) refs.splice(index, 1);
  }
  const unique = new Map();
  for (const ref of refs) unique.set(keyOf(ref), ref);
  return [...unique.values()].sort((left, right) => compareLexical(keyOf(left), keyOf(right)));
}

function releaseReviewProjection(sourceContract, gameReleaseId) {
  const release = sourceContract.gameReleases.find(item => item.gameReleaseId === gameReleaseId);
  if (!release) throw new Error('Review dependency release does not resolve: ' + gameReleaseId);
  return {
    gameReleaseId: release.gameReleaseId,
    gameVersion: release.gameVersion,
    gameBuild: release.gameBuild,
    releaseOrder: release.releaseOrder,
    snapshot: {
      snapshotId: release.snapshot.snapshotId,
      manifestSha256: release.snapshot.manifestSha256,
      contentSha256: release.snapshot.contentSha256,
    },
  };
}

function presentationUsesOfficialInput(target) {
  return target.ownerKind === 'presentation' && (
    ['official', 'translation', 'errata'].includes(target.dimension)
    || target.fieldPath === '/detailSections'
    || target.fieldPath.startsWith('/detailSections/')
    || target.fieldPath === '/errata'
    || target.fieldPath.startsWith('/errata/')
  );
}

function announcementAssetOccurrences(blocks, assets, output = []) {
  const assetMap = new Map(assets.map(asset => [asset.assetId, asset]));
  for (const block of blocks) {
    if (block.kind === 'image') output.push(assetMap.get(block.assetRef.assetId) ?? { assetId: block.assetRef.assetId });
    else if (block.kind === 'spoiler') announcementAssetOccurrences(block.blocks, assets, output);
  }
  return output;
}

export function computeReviewDigests(contract, target, inputs) {
  const { owner, value } = targetOwner(contract, target);
  const dependencies = [];
  const sourceContract = inputs.sourceContract;
  const sourceRecordMap = inputs.sourceRecordMap ?? new Map(sourceContract.records.map(record => [keyOf(record), record]));
  if (presentationUsesOfficialInput(target)) {
    const officialId = target.dimension === 'translation' ? owner.faithfulTranslation.sourceId : owner.official.officialSourceId;
    const fixed = inputs.officialInputs.sources.find(source => source.officialSourceId === officialId);
    if (!fixed) throw new Error('Fixed official source is missing for review target ' + target.targetId);
    dependencies.push({ kind: 'official-input', value: fixed });
  }
  if (target.ownerKind === 'presentation' && target.dimension !== 'translation') {
    dependencies.push({ kind: 'presentation-identity', value: owner.entityRef });
  }
  if (target.ownerKind === 'term-localization') {
    const term = sourceRecordMap.get(keyOf(owner.termRef));
    if (!term || term.kind !== 'term') throw new Error('Review dependency term does not resolve: ' + owner.termRef.gameReleaseId + ':' + owner.termRef.recordId);
    dependencies.push({
      kind: 'term-identity-context',
      value: {
        recordId: term.recordId,
        gameReleaseId: term.gameReleaseId,
        kind: term.kind,
        termKey: term.payload.termKey,
        contextKey: term.payload.contextKey,
      },
    });
    if (target.fieldPath === '/definition') {
      const digest = inputs.sourceValidator.computeReviewDigests(sourceContract, {
        recordId: term.recordId,
        gameReleaseId: term.gameReleaseId,
        fieldPath: '/payload/technicalDefinitionEn',
      });
      dependencies.push({
        kind: 'source-term-definition',
        recordId: term.recordId,
        gameReleaseId: term.gameReleaseId,
        targetDigest: digest.targetDigest,
        dependenciesDigest: digest.dependenciesDigest,
      });
    }
  }
  if (target.ownerKind === 'announcement') {
    dependencies.push({ kind: 'announcement-source', scope: owner.scope, source: owner.source });
    if (owner.scope === 'gameplay') dependencies.push({ kind: 'game-release', value: releaseReviewProjection(sourceContract, owner.gameReleaseId) });
    if (target.fieldPath === '/blocks') dependencies.push({ kind: 'announcement-assets', value: announcementAssetOccurrences(owner.blocks, owner.assets) });
  }
  if (target.ownerKind === 'official-text-change') {
    const from = inputs.officialInputs.sources.find(source => source.officialSourceId === owner.fromOfficialSourceId);
    const to = inputs.officialInputs.sources.find(source => source.officialSourceId === owner.toOfficialSourceId);
    if (!from || !to) throw new Error('Fixed official comparison source is missing for review target ' + target.targetId);
    dependencies.push({ kind: 'official-text-comparison', entityRef: owner.entityRef, operation: owner.operation, fromOfficialSourceId: owner.fromOfficialSourceId, toOfficialSourceId: owner.toOfficialSourceId, fromGameReleaseId: owner.fromGameReleaseId, toGameReleaseId: owner.toGameReleaseId, supersedesChangeId: owner.supersedesChangeId ?? null });
    dependencies.push({ kind: 'official-input', side: 'from', value: from });
    dependencies.push({ kind: 'official-input', side: 'to', value: to });
    dependencies.push({ kind: 'game-release', side: 'from', value: releaseReviewProjection(sourceContract, owner.fromGameReleaseId) });
    dependencies.push({ kind: 'game-release', side: 'to', value: releaseReviewProjection(sourceContract, owner.toGameReleaseId) });
  }
  const refs = reviewDependencyRefs(target, owner, value);
  for (const ref of refs) {
    const sourceRecord = sourceRecordMap.get(keyOf(ref));
    if (!sourceRecord || sourceRecord.kind !== ref.kind) throw new Error('Review dependency does not resolve: ' + ref.gameReleaseId + ':' + ref.recordId);
    const digest = inputs.sourceValidator.computeReviewDigests(sourceContract, {
      recordId: ref.recordId, gameReleaseId: ref.gameReleaseId, fieldPath: '/payload',
    });
    dependencies.push({ kind: 'source-record', recordId: ref.recordId, gameReleaseId: ref.gameReleaseId, recordKind: ref.kind, targetDigest: digest.targetDigest, dependenciesDigest: digest.dependenciesDigest });
    if (ref.compatibilityRef) {
      const compatibility = sourceRecordMap.get(keyOf(ref.compatibilityRef));
      if (!compatibility) throw new Error('Review dependency compatibility record is missing');
      const compatibilityDigest = inputs.sourceValidator.computeReviewDigests(sourceContract, {
        recordId: compatibility.recordId, gameReleaseId: compatibility.gameReleaseId, fieldPath: '/payload',
      });
      dependencies.push({ kind: 'source-record', recordId: compatibility.recordId, gameReleaseId: compatibility.gameReleaseId, recordKind: compatibility.kind, targetDigest: compatibilityDigest.targetDigest, dependenciesDigest: compatibilityDigest.dependenciesDigest });
    }
  }
  dependencies.sort((left, right) => compareLexical(canonical(left), canonical(right)));
  return {
    targetDigest: sha256({
      targetId: target.targetId,
      ownerKind: target.ownerKind,
      ownerId: target.ownerId,
      fieldPath: target.fieldPath,
      dimension: target.dimension,
      value,
    }),
    dependenciesDigest: sha256(dependencies),
  };
}

export function createReviewReceipt(contract, target, { sourceContract, officialInputs, sourceValidator, sourceRecordMap, reviewer, reviewedAt } = {}) {
  if (!reviewer || reviewer.kind !== 'human' || typeof reviewer.id !== 'string' || reviewer.id.trim() === '') throw new Error('A named human reviewer is required');
  if (typeof reviewedAt !== 'string' || !Number.isFinite(Date.parse(reviewedAt)) || !reviewedAt.endsWith('Z')) throw new Error('reviewedAt must be a valid UTC timestamp');
  if (!contract.reviewTargets.some(item => canonical(item) === canonical(target))) throw new Error('Review receipt target must exactly match a registered target');
  const inputs = { sourceContract, officialInputs, sourceValidator, sourceRecordMap };
  const { targetDigest, dependenciesDigest } = computeReviewDigests(contract, target, inputs);
  return { targetId: target.targetId, targetDigest, dependenciesDigest, decision: 'approved', reviewer: structuredClone(reviewer), reviewedAt };
}

export function getReviewState(contract, targetId, inputs) {
  const target = contract.reviewTargets.find(item => item.targetId === targetId);
  if (!target) throw new Error('Unknown review target: ' + targetId);
  const current = computeReviewDigests(contract, target, inputs);
  const receipts = contract.reviewReceipts.filter(item => item.targetId === targetId);
  if (!receipts.length) return 'pending';
  const matching = receipts.filter(item => item.targetDigest === current.targetDigest && item.dependenciesDigest === current.dependenciesDigest)
    .sort((left, right) => compareLexical(left.reviewedAt, right.reviewedAt));
  if (!matching.length) return 'stale';
  return matching.at(-1).decision;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let sourceRoot;
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== '--source-root' || !args[index + 1] || args[index + 1].startsWith('--') || sourceRoot) {
        throw new Error('usage: node scripts/content/contract-authoring.mjs [--source-root <Source-checkout>]');
      }
      sourceRoot = path.resolve(args[index + 1]);
      index += 1;
    }
    const inputs = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT, sourceRoot });
    const result = validateWebAuthoring(inputs.authoring, inputs);
    if (!result.valid) throw new Error(result.issues.map(item => item.path + ': ' + item.message).join('\n'));
    process.stdout.write('Web authoring contract validation passed: presentations=' + inputs.authoring.presentations.length + ' sourceRecords=' + inputs.sourceContract.records.length + ' fixtureOnly=' + String(inputs.authoring.fixtureOnly) + ' publicationEligible=false. No runtime/compiler integration is implied.\n');
  } catch (error) {
    process.stderr.write('Web authoring contract validation failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
