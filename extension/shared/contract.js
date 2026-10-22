(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W10SharedContract = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const DOMAIN_KINDS = Object.freeze([
    'skills', 'blessings', 'weapons', 'terms', 'catalog', 'curios', 'perks',
    'classifications', 'announcements', 'game-changes'
  ]);
  const CORE_DOMAIN_KINDS = Object.freeze(['skills', 'blessings', 'weapons', 'terms']);
  const REQUIRED_FEATURES = Object.freeze([
    'official-errata-details-v1',
    'official-native-localizations-v1',
    'blessing-tier-presentations-v1'
  ]);
  const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';

  const DOMAIN_KIND_SET = new Set(DOMAIN_KINDS);
  const REQUIRED_FEATURE_SET = new Set(REQUIRED_FEATURES);
  const SHA1_PATTERN = /^[a-f0-9]{40}$/;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/;
  const GAME_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const CONTENT_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.([1-9][0-9]*)$/;
  const RELATIVE_JSON_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/;
  const GAME_RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
  const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const encoder = new TextEncoder();

  function fail(message) {
    throw new Error(message);
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireRecord(value, label) {
    if (!isRecord(value)) fail(label + ' must be an object');
  }

  function requireExactKeys(value, requiredKeys, label) {
    requireRecord(value, label);
    for (const key of requiredKeys) {
      if (!Object.hasOwn(value, key)) fail(label + ' is missing required property: ' + key);
    }
    const allowed = new Set(requiredKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) fail(label + ' contains unexpected property: ' + key);
    }
  }

  function requireSha1(value, label) {
    if (typeof value !== 'string' || !SHA1_PATTERN.test(value)) {
      fail(label + ' must be a 40-character lowercase SHA-1');
    }
  }

  function requireSha256(value, label) {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
      fail(label + ' must be a 64-character lowercase SHA-256');
    }
  }

  function requireGameVersion(value, label) {
    if (typeof value !== 'string' || !GAME_VERSION_PATTERN.test(value)) {
      fail(label + ' must be a canonical three-part game version');
    }
  }

  function requireContentVersion(value, gameVersion, label) {
    if (typeof value !== 'string') {
      fail(label + ' must be a four-part contentVersion with a positive revision');
    }
    const match = CONTENT_VERSION_PATTERN.exec(value);
    if (!match || value.slice(0, value.lastIndexOf('.')) !== gameVersion) {
      fail(label + ' must be a four-part contentVersion matching gameVersion with a positive revision');
    }
  }

  function manifestPath(dataRevision) {
    return '/data/' + dataRevision + '/manifest.json';
  }

  function validateVersion(version) {
    const keys = [
      'schema_version', 'data_revision', 'build_id', 'game_version', 'package_kind', 'game_releases'
    ];
    requireExactKeys(version, keys, 'version');
    if (version.schema_version !== 2) fail('version.schema_version must equal 2');
    requireSha256(version.data_revision, 'version.data_revision');
    requireSha256(version.build_id, 'version.build_id');
    requireGameVersion(version.game_version, 'version.game_version');
    if (version.package_kind !== 'published') fail('version.package_kind must equal "published"');
    if (!Array.isArray(version.game_releases) || version.game_releases.length === 0) {
      fail('version.game_releases must contain at least one release pointer');
    }

    const seenGameVersions = new Set();
    const seenManifestPaths = new Set();
    let selectedRelease = null;
    for (let index = 0; index < version.game_releases.length; index += 1) {
      const release = version.game_releases[index];
      const label = 'version.game_releases[' + index + ']';
      requireExactKeys(release, [
        'game_version', 'content_version', 'data_revision', 'manifest_path', 'manifest_sha256'
      ], label);
      requireGameVersion(release.game_version, label + '.game_version');
      requireContentVersion(release.content_version, release.game_version, label + '.content_version');
      requireSha256(release.data_revision, label + '.data_revision');
      requireSha256(release.manifest_sha256, label + '.manifest_sha256');
      if (release.manifest_path !== manifestPath(release.data_revision)) {
        fail(label + '.manifest_path must be the same-origin path for its dataRevision');
      }
      if (seenGameVersions.has(release.game_version)) {
        fail('duplicate game_version in version.game_releases: ' + release.game_version);
      }
      seenGameVersions.add(release.game_version);
      if (seenManifestPaths.has(release.manifest_path)) {
        fail('duplicate manifest_path in version.game_releases: ' + release.manifest_path);
      }
      seenManifestPaths.add(release.manifest_path);
      if (release.game_version === version.game_version) selectedRelease = release;
    }

    if (!selectedRelease) fail('version.game_version must have one matching entry in game_releases');
    if (version.data_revision !== selectedRelease.data_revision) {
      fail('version.data_revision must match the selected game_releases pointer');
    }
    return version;
  }

  function validateRelativeJsonPath(value, label) {
    if (typeof value !== 'string' || !RELATIVE_JSON_PATH_PATTERN.test(value)) {
      fail(label + ' must be a safe relative JSON path');
    }
    const segments = value.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
      fail(label + ' must not contain empty or traversal path segments');
    }
    if (value.includes('%') || value.includes('\\') || value.startsWith('/')) {
      fail(label + ' must not contain encoded, backslash, or absolute path syntax');
    }
    return value;
  }

  function assertUniqueStrings(values, label) {
    if (new Set(values).size !== values.length) fail(label + ' must not contain duplicates');
  }

  function compareUtf8(left, right) {
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    const sharedLength = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < sharedLength; index += 1) {
      if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
    }
    return leftBytes.length - rightBytes.length;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isRecord(value)) {
      const output = {};
      for (const key of Object.keys(value).sort(compareUtf8)) output[key] = canonicalize(value[key]);
      return output;
    }
    return value;
  }

  function dataRevisionMaterial(manifest) {
    const files = manifest.files.map((file) => ({
      kind: file.kind,
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      dependencies: [...file.dependencies].sort(compareUtf8)
    })).sort((left, right) => compareUtf8(left.path, right.path));

    return canonicalize({
      source: manifest.source,
      web: manifest.web,
      compatibility: {
        dataContractMajor: manifest.compatibility.dataContractMajor,
        requiredFeatures: [...manifest.compatibility.requiredFeatures].sort(compareUtf8),
        gameSnapshotRefs: [...manifest.compatibility.gameSnapshotRefs].sort(compareUtf8)
      },
      files,
      changeIndexPath: manifest.changeIndexPath
    });
  }

  async function computeDataRevision(manifest, cryptoApi) {
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      fail('Web Crypto SHA-256 is required to validate manifest.dataRevision');
    }
    const canonical = JSON.stringify(dataRevisionMaterial(manifest));
    const digest = await cryptoApi.subtle.digest('SHA-256', encoder.encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function validateDependencyGraph(filesByPath) {
    for (const file of filesByPath.values()) {
      for (const dependency of file.dependencies) {
        if (!filesByPath.has(dependency)) {
          fail('file dependency points to missing path: ' + dependency);
        }
      }
    }

    const visiting = new Set();
    const visited = new Set();
    const visit = (filePath) => {
      if (visiting.has(filePath)) fail('file dependency cycle includes: ' + filePath);
      if (visited.has(filePath)) return;
      visiting.add(filePath);
      for (const dependency of filesByPath.get(filePath).dependencies) visit(dependency);
      visiting.delete(filePath);
      visited.add(filePath);
    };
    for (const filePath of filesByPath.keys()) visit(filePath);
  }

  async function validateManifest(manifest, { cryptoApi = globalThis.crypto } = {}) {
    requireExactKeys(manifest, [
      'schemaVersion', 'gameReleaseId', 'gameVersion', 'contentVersion', 'dataRevision',
      'source', 'web', 'compatibility', 'files', 'changeIndexPath'
    ], 'manifest');
    if (manifest.schemaVersion !== '2.0.0') fail('manifest.schemaVersion must equal "2.0.0"');
    if (typeof manifest.gameReleaseId !== 'string' || !GAME_RELEASE_ID_PATTERN.test(manifest.gameReleaseId)) {
      fail('manifest.gameReleaseId must be a stable release identifier');
    }
    requireGameVersion(manifest.gameVersion, 'manifest.gameVersion');
    requireContentVersion(manifest.contentVersion, manifest.gameVersion, 'manifest.contentVersion');
    requireSha256(manifest.dataRevision, 'manifest.dataRevision');

    requireExactKeys(manifest.source, ['repository', 'commit', 'sourceRevision', 'manifestSha256'], 'manifest.source');
    if (manifest.source.repository !== SOURCE_REPOSITORY) {
      fail('manifest.source.repository must be the fixed public Source repository');
    }
    requireSha1(manifest.source.commit, 'source.commit');
    requireSha256(manifest.source.sourceRevision, 'source.sourceRevision');
    requireSha256(manifest.source.manifestSha256, 'source.manifestSha256');

    requireExactKeys(manifest.web, ['authoringCommit', 'compilerCommit'], 'manifest.web');
    requireSha1(manifest.web.authoringCommit, 'web.authoringCommit');
    requireSha1(manifest.web.compilerCommit, 'web.compilerCommit');

    requireExactKeys(manifest.compatibility, [
      'dataContractMajor', 'requiredFeatures', 'gameSnapshotRefs'
    ], 'manifest.compatibility');
    if (manifest.compatibility.dataContractMajor !== 2) {
      fail('compatibility.dataContractMajor must equal 2');
    }
    const features = manifest.compatibility.requiredFeatures;
    if (!Array.isArray(features)) fail('compatibility.requiredFeatures must be an array');
    assertUniqueStrings(features, 'compatibility.requiredFeatures');
    for (const feature of features) {
      if (typeof feature !== 'string' || !REQUIRED_FEATURE_SET.has(feature)) {
        fail('compatibility.requiredFeatures contains unknown required feature: ' + String(feature));
      }
    }
    if (features.includes('blessing-tier-presentations-v1')
        && !features.includes('official-native-localizations-v1')) {
      fail('compatibility.requiredFeatures blessing-tier-presentations-v1 requires official-native-localizations-v1');
    }

    const snapshots = manifest.compatibility.gameSnapshotRefs;
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      fail('compatibility.gameSnapshotRefs must contain at least one snapshot reference');
    }
    assertUniqueStrings(snapshots, 'compatibility.gameSnapshotRefs');
    for (const snapshot of snapshots) {
      if (typeof snapshot !== 'string' || !SNAPSHOT_ID_PATTERN.test(snapshot)) {
        fail('compatibility.gameSnapshotRefs contains an invalid snapshot reference');
      }
    }

    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      fail('manifest.files must contain at least one domain file');
    }
    const filesByPath = new Map();
    const lowerPaths = new Set();
    for (let index = 0; index < manifest.files.length; index += 1) {
      const file = manifest.files[index];
      const label = 'manifest.files[' + index + ']';
      requireExactKeys(file, ['kind', 'path', 'sizeBytes', 'sha256', 'dependencies'], label);
      if (typeof file.kind !== 'string' || !DOMAIN_KIND_SET.has(file.kind)) {
        fail(label + '.kind is not a known shared domain kind');
      }
      validateRelativeJsonPath(file.path, label + '.path');
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) {
        fail(label + '.sizeBytes must be a positive safe integer');
      }
      requireSha256(file.sha256, label + '.sha256');
      if (!Array.isArray(file.dependencies)) fail(label + '.dependencies must be an array');
      assertUniqueStrings(file.dependencies, label + '.dependencies');
      for (const dependency of file.dependencies) {
        validateRelativeJsonPath(dependency, label + '.dependencies');
      }
      const lowerPath = file.path.toLowerCase();
      if (filesByPath.has(file.path)) fail('duplicate file path: ' + file.path);
      if (lowerPaths.has(lowerPath)) fail('file paths have a case-insensitive collision: ' + file.path);
      filesByPath.set(file.path, file);
      lowerPaths.add(lowerPath);
    }

    validateDependencyGraph(filesByPath);
    if (manifest.changeIndexPath !== null) {
      validateRelativeJsonPath(manifest.changeIndexPath, 'manifest.changeIndexPath');
      const changeIndex = filesByPath.get(manifest.changeIndexPath);
      if (!changeIndex) fail('manifest.changeIndexPath must reference a listed file');
      if (changeIndex.kind !== 'game-changes') {
        fail('manifest.changeIndexPath must identify a game-changes file');
      }
    }

    if (manifest.dataRevision !== await computeDataRevision(manifest, cryptoApi)) {
      fail('manifest.dataRevision does not match the canonical content index');
    }
    return manifest;
  }

  function selectGameRelease(version, gameVersion) {
    validateVersion(version);
    requireGameVersion(gameVersion, 'requested gameVersion');
    return version.game_releases.find((release) => release.game_version === gameVersion) ?? null;
  }

  async function selectConsumerFiles(manifest, {
    requiredKinds,
    supportedKinds,
    cryptoApi = globalThis.crypto
  } = {}) {
    await validateManifest(manifest, { cryptoApi });
    if (!Array.isArray(requiredKinds) || !Array.isArray(supportedKinds)) {
      fail('consumer requiredKinds and supportedKinds must be arrays');
    }
    for (const [label, kinds] of [['requiredKinds', requiredKinds], ['supportedKinds', supportedKinds]]) {
      assertUniqueStrings(kinds, 'consumer ' + label);
      for (const kind of kinds) {
        if (typeof kind !== 'string' || !DOMAIN_KIND_SET.has(kind)) {
          fail('unknown consumer kind: ' + String(kind));
        }
      }
    }
    const supported = new Set(supportedKinds);
    for (const kind of requiredKinds) {
      if (!supported.has(kind)) fail('required kind is not in the consumer supported set: ' + kind);
    }

    const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
    const selected = new Map();
    const addFile = (file) => {
      if (!supported.has(file.kind)) {
        fail('dependency kind is not supported by the consumer: ' + file.kind);
      }
      if (selected.has(file.path)) return;
      selected.set(file.path, file);
      for (const dependency of file.dependencies) addFile(filesByPath.get(dependency));
    };
    for (const kind of requiredKinds) {
      const matchingFiles = manifest.files.filter((file) => file.kind === kind);
      if (matchingFiles.length === 0) fail('required kind is missing from manifest.files: ' + kind);
      for (const file of matchingFiles) addFile(file);
    }
    return [...selected.values()].sort((left, right) => compareUtf8(left.path, right.path));
  }

  async function matchReleaseIdentity(version, manifest, identity, { cryptoApi = globalThis.crypto } = {}) {
    requireExactKeys(identity, ['gameVersion', 'gameReleaseId'], 'release identity');
    requireGameVersion(identity.gameVersion, 'release identity.gameVersion');
    if (typeof identity.gameReleaseId !== 'string' || !GAME_RELEASE_ID_PATTERN.test(identity.gameReleaseId)) {
      fail('release identity.gameReleaseId must be a stable release identifier');
    }

    await validateManifest(manifest, { cryptoApi });
    const release = selectGameRelease(version, identity.gameVersion);
    if (!release) return null;
    if (manifest.gameVersion !== identity.gameVersion || manifest.gameReleaseId !== identity.gameReleaseId) return null;
    if (release.content_version !== manifest.contentVersion || release.data_revision !== manifest.dataRevision) return null;

    // Snapshot refs are opaque and may include historical values; phase 1 does not infer patch identity from them.
    return release;
  }

  return Object.freeze({
    CORE_DOMAIN_KINDS,
    DOMAIN_KINDS,
    REQUIRED_FEATURES,
    SOURCE_REPOSITORY,
    matchReleaseIdentity,
    selectConsumerFiles,
    selectGameRelease,
    validateManifest,
    validateVersion
  });
});
