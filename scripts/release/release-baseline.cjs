'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
// W15 build index; the retained site Release carries the data revision but not this build's version.json.
const VERSION_SOURCE = path.join(REPOSITORY_ROOT, 'extension', 'release-baseline', 'w15', 'version.json');
const DEFAULT_CACHE_DIR = path.join(REPOSITORY_ROOT, '.cache', 'release-baseline', 'w15');
const W15_SOURCE = Object.freeze({
  repository: 'SyuanTsai/DarkTide-Web',
  tag: 'site-d391be777efe63b17b2d8a868a7fd459511d071b-41504020008-1',
  asset: 'static-site.tar.gz',
  sha256: 'aa8ea3ddd5cb47d5387586a6e0fceb8396f7679c3f8607ead4f0ad08884ce274',
  dataPrefix: 'data/f182e7b4ba6fb04c9713ebada2cdbc8aabdd31d5b52b30a754e188ecc3fb5b2f/'
});
const BASELINE_PINS = Object.freeze({
  'version.json': Object.freeze({ sizeBytes: 655, sha256: 'f259d3545dd5f80d4310a859a8e016df9fe42cc19ef5612431eaf8b055e13e0e' }),
  'manifest.json': Object.freeze({ sizeBytes: 2259, sha256: 'fcd7ff131ae55315fa0b9323355ed0e7b69788ffe03841de025723cec16e8642' }),
  'domains/blessings.json': Object.freeze({ sizeBytes: 113990, sha256: '3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5' }),
  'domains/skills.json': Object.freeze({ sizeBytes: 165051, sha256: '108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449' }),
  'domains/terms.json': Object.freeze({ sizeBytes: 124557, sha256: '602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6' }),
  'domains/weapons.json': Object.freeze({ sizeBytes: 6798596, sha256: '132ec16e830d4af560bd212095f4fa0209bc8f238eb17a26528e112e6ebd41a8' })
});

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function matchesPin(raw, relative) {
  const pin = BASELINE_PINS[relative];
  return raw.byteLength === pin.sizeBytes && sha256(raw) === pin.sha256;
}

function cacheIsComplete(directory) {
  return Object.keys(BASELINE_PINS).every((relative) => {
    const filePath = path.join(directory, ...relative.split('/'));
    return fs.existsSync(filePath) && matchesPin(fs.readFileSync(filePath), relative);
  });
}

function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  return block.toString('utf8', start, end === -1 || end > start + length ? start + length : end);
}

function tarSize(block) {
  if (block[124] & 0x80) return Number(block.readBigUInt64BE(128));
  return parseInt(tarString(block, 124, 12).trim() || '0', 8);
}

// Extracts only the wanted regular files from a ustar/pax/GNU archive.
function extractTarEntries(archive, wanted) {
  const result = new Map();
  let offset = 0;
  let overrideName = null;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarSize(header);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    const type = String.fromCharCode(header[156] || 48);
    if (type === 'L') overrideName = tarString(body, 0, body.length);
    else if (type === 'x') {
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (match) overrideName = match[1];
    } else {
      let name = overrideName;
      if (name === null) {
        const prefix = header.toString('ascii', 257, 262) === 'ustar' ? tarString(header, 345, 155) : '';
        name = (prefix ? prefix + '/' : '') + tarString(header, 0, 100);
      }
      overrideName = null;
      name = name.replace(/^\.\//, '');
      if (type === '0' && wanted.has(name)) result.set(name, Buffer.from(body));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

async function downloadAsset(fetchImpl) {
  const url = 'https://github.com/' + W15_SOURCE.repository + '/releases/download/'
    + encodeURIComponent(W15_SOURCE.tag) + '/' + W15_SOURCE.asset;
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error('W15 retained Release download failed: HTTP ' + response.status);
  const raw = Buffer.from(await response.arrayBuffer());
  if (sha256(raw) !== W15_SOURCE.sha256) throw new Error('W15 retained Release archive SHA-256 differs from the pin');
  return raw;
}

// Returns a directory holding the exact pinned W15 baseline, fetching it from the retained Web Release when needed.
async function ensureW15Baseline(options = {}) {
  const cacheDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (cacheIsComplete(cacheDir)) return cacheDir;

  const archive = zlib.gunzipSync(await downloadAsset(fetchImpl));
  const releaseFiles = Object.keys(BASELINE_PINS).filter((relative) => relative !== 'version.json');
  const entries = extractTarEntries(archive, new Set(releaseFiles.map((relative) => W15_SOURCE.dataPrefix + relative)));
  const staging = cacheDir + '.tmp-' + process.pid;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    const write = (relative, raw) => {
      if (!raw || !matchesPin(raw, relative)) throw new Error('W15 baseline ' + relative + ' is missing or differs from its pin');
      const target = path.join(staging, ...relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, raw, { flag: 'wx' });
    };
    write('version.json', fs.readFileSync(VERSION_SOURCE));
    for (const relative of releaseFiles) write(relative, entries.get(W15_SOURCE.dataPrefix + relative));
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
    fs.renameSync(staging, cacheDir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return cacheDir;
}

module.exports = { BASELINE_PINS, W15_SOURCE, ensureW15Baseline, extractTarEntries };
