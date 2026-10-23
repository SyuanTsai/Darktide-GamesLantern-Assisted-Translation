(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W11NativeIdentity = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const VERSION = /^\d+(?:\.\d+){1,3}$/;
  const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
  const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const SHA256 = /^[a-f0-9]{64}$/;

  function fail(message) {
    throw new TypeError(message);
  }

  function exactKeys(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object');
    const actual = Object.keys(value).sort();
    const expected = [...allowed].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      fail(label + ' must contain exactly: ' + expected.join(', '));
    }
  }

  function normalizeIdentity(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['gameVersion', 'gameReleaseId', 'snapshotId'].includes(key))
      || typeof value.gameVersion !== 'string' || !VERSION.test(value.gameVersion)
      || typeof value.gameReleaseId !== 'string' || !RELEASE_ID.test(value.gameReleaseId)
      || (value.snapshotId !== undefined
        && (typeof value.snapshotId !== 'string' || !SNAPSHOT_ID.test(value.snapshotId)))) {
      fail('native proof identity must contain a complete supported game tuple');
    }
    return Object.freeze({
      gameVersion: value.gameVersion,
      gameReleaseId: value.gameReleaseId,
      ...(value.snapshotId === undefined ? {} : { snapshotId: value.snapshotId })
    });
  }

  function asBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return Uint8Array.from(value);
    }
    fail('native snapshot evidence must be raw bytes');
  }

  function createNativeIdentityResolver({ proofs = [], cryptoApi = globalThis.crypto } = {}) {
    if (!Array.isArray(proofs)) fail('native proof registry must be an array');
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      fail('Web Crypto SHA-256 is unavailable');
    }
    const byDigest = new Map();
    for (const [index, proof] of proofs.entries()) {
      if (!proof || typeof proof !== 'object' || Array.isArray(proof)) fail('native proof[' + index + '] must be an object');
      const actualKeys = Object.keys(proof).sort();
      const requiredKeys = ['evidenceId', 'identity', 'sha256'];
      const allowedKeys = [...requiredKeys, 'patchLabel'].sort();
      if (actualKeys.length !== requiredKeys.length && actualKeys.length !== allowedKeys.length) {
        fail('native proof[' + index + '] must contain a local evidence ID, digest, tuple, and optional consistency label');
      }
      if (actualKeys.some((key, keyIndex) => key !== (actualKeys.length === requiredKeys.length ? requiredKeys : allowedKeys)[keyIndex])) {
        fail('native proof[' + index + '] contains unexpected evidence fields');
      }
      if (typeof proof.evidenceId !== 'string' || !proof.evidenceId.trim()
        || typeof proof.sha256 !== 'string' || !SHA256.test(proof.sha256)) {
        fail('native proof evidence ID or SHA-256 is invalid');
      }
      if (proof.patchLabel !== undefined && (typeof proof.patchLabel !== 'string' || !proof.patchLabel.trim())) {
        fail('native proof patch consistency label is invalid');
      }
      const identity = normalizeIdentity(proof.identity);
      if (byDigest.has(proof.sha256)) fail('native proof registry contains a duplicate or conflicting digest');
      byDigest.set(proof.sha256, Object.freeze({ evidenceId: proof.evidenceId, identity,
        ...(proof.patchLabel === undefined ? {} : { patchLabel: proof.patchLabel }) }));
    }

    async function resolve(snapshotBytes) {
      const bytes = asBytes(snapshotBytes);
      if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) {
        return Object.freeze({ status: 'unknown', reason: 'native-proof-not-found' });
      }
      const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
      let hex = '';
      for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
      const proof = byDigest.get(hex);
      if (!proof) return Object.freeze({ status: 'unknown', reason: 'native-proof-not-found' });
      return Object.freeze({ status: 'verified', identity: proof.identity,
        ...(proof.patchLabel === undefined ? {} : { patchLabel: proof.patchLabel }) });
    }

    return Object.freeze({ resolve });
  }

  return Object.freeze({ createNativeIdentityResolver });
});
