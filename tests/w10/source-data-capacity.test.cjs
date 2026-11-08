const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const loader = require('../../extension/shared/loader.js');
const { fixture } = require('../helpers/source-data-fixture.cjs');
const { raw } = require('../helpers/source-data-server.cjs');
const MiB = 1024 * 1024, PART = 20 * MiB, FILE = 32 * MiB, TOTAL = 64 * MiB;
const hash = b => createHash('sha256').update(b).digest('hex');
function padded(value, size) { const json = Buffer.from(JSON.stringify(value)); assert.ok(size >= json.length); const b = Buffer.alloc(size, 32); json.copy(b); return b; }
function setup(sizes = {}) {
  const data = fixture(), base = raw(data), files = {};
  for (const k of loader.CATEGORIES) files[k] = sizes[k] ? padded(data[k], sizes[k]) : Buffer.from(base.files[k]);
  return { data, base, files };
}
function manifest(data, category, bytes, split = bytes.length > PART ? PART : 0) {
  const chunks = split ? [bytes.subarray(0, split), bytes.subarray(split)] : [bytes];
  let offset = 0; const sharded = !!split;
  const parts = chunks.map((b, i) => { const part = { index:i+1, path: sharded ? `${category}.part-${String(i+1).padStart(4,'0')}.bin` : `${category}.json`, offset, sizeBytes:b.length, sha256:hash(b) }; offset += b.length; return part; });
  return { transportSchemaVersion:'1.0.0', representation:sharded ? 'raw-byte-shards' : 'single', gameVersion:data.current.gameVersion, category, totalBytes:bytes.length, totalSha256:hash(bytes), parts };
}
function fake(routes) {
  const calls = [], stats = { reads:0, cancels:0 };
  return { calls, stats, fetchImpl: async url => {
    const name = url.split('/').pop(); calls.push(name); const entry = routes[name];
    if (!entry) return { status:404, redirected:false, url };
    const bytes = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body); let pos = 0;
    return { status:200, ok:true, redirected:false, url, headers:{ get: key => key === 'content-type' ? (entry.binary ? 'application/octet-stream' : 'application/json') : '1' }, body:{ getReader:() => ({ async read() { stats.reads++; if (pos >= bytes.length) return {done:true}; const value = bytes.subarray(pos, pos += 1024*1024); return {done:false,value}; }, async cancel() { stats.cancels++; }, releaseLock() {} }) } };
  } };
}
function routesFor(s, manifests = true) {
  const routes = {};
  for (const k of loader.CATEGORIES) {
    const bytes = s.files[k];
    if (!manifests) { routes[k+'.json'] = {body:bytes}; continue; }
    const m = manifest(s.data,k,bytes); routes[k+'.manifest.json'] = {body:JSON.stringify(m)};
    for (const p of m.parts) routes[p.path] = {body:bytes.subarray(p.offset,p.offset+p.sizeBytes), binary:m.representation !== 'single'};
  }
  return routes;
}
async function download(s, transport) { return loader.downloadSnapshot({currentBytes:s.base.currentBytes, fetchImpl:transport.fetchImpl, cryptoApi:webcrypto}); }
// Scenario: valid manifest padded to each size. Purpose: enforce actual manifest bytes and cancel an oversized stream.
test('UnitT70_manifest容量邊界與串流取消', async () => {
  const s = setup(), routes = routesFor(s), json = routes['skills.manifest.json'].body;
  for (const extra of [0,1]) {
    routes['skills.manifest.json'].body = json + ' '.repeat(64*1024 + extra - Buffer.byteLength(json));
    const t = fake(routes);
    if (!extra) await download(s,t); else { await assert.rejects(download(s,t), {message:'skills manifest exceeds the 64 KiB limit'}); assert.equal(t.stats.cancels,1); assert.equal(t.stats.reads,1); assert.deepEqual(t.calls,['skills.manifest.json']); }
  }
});
// Scenario: valid bytes at and beyond the per-category limit. Purpose: reject oversized declarations before payload.
test('UnitT71_單類容量邊界', async () => {
  for (const extra of [0,1]) {
    const s = setup({skills:FILE+extra}), t = fake(routesFor(s));
    if (!extra) await download(s,t); else { await assert.rejects(download(s,t), {message:'skills manifest is invalid'}); assert.deepEqual(t.calls,['skills.manifest.json']); }
  }
});
// Scenario: four valid files total exactly 64 MiB or one byte more. Purpose: protect declaration, streaming, and stored snapshot checks.
test('UnitT72_整組容量邊界', async () => {
  for (const extra of [0,1]) {
    const base = setup(); const small = base.base.currentBytes.length + base.files.blessings.length + base.files.terms.length;
    const s = setup({skills:FILE, weapons:TOTAL - FILE - small + extra});
    for (const manifests of [true,false]) {
      const t = fake(routesFor(s,manifests));
      if (!extra) await download(s,t); else { await assert.rejects(download(s,t), {message:'snapshot exceeds the 64 MiB total byte limit'}); if (manifests) assert.ok(!t.calls.includes('terms.json')); else assert.equal(t.stats.cancels,1); }
    }
    if (!extra) await loader.verifyStoredSnapshot({...s.base,files:s.files,cryptoApi:webcrypto});
    else await assert.rejects(loader.verifyStoredSnapshot({...s.base,files:s.files,cryptoApi:webcrypto}), {message:'snapshot exceeds 64 MiB'});
  }
});
// Scenario: structurally self-consistent manifests violate one representation rule each. Purpose: reject before any payload request.
test('UnitT73_manifest欄位與表示法邊界', async () => {
  const data = fixture();
  for (const kind of ['extra','part-size','single-over','shards-at']) {
    const size = kind === 'single-over' ? PART+1 : kind === 'shards-at' ? PART : kind === 'part-size' ? PART+1 : 1024;
    const s = setup({skills:size});
    const split = kind === 'part-size' ? 10*MiB : kind === 'shards-at' ? PART-1 : 0;
    const m = manifest(data,'skills',s.files.skills,split);
    if (kind === 'extra') m.parts[0].extra = true;
    const routes = routesFor(s); routes['skills.manifest.json'] = {body:JSON.stringify(m)}; for (const p of m.parts) routes[p.path] = {body:s.files.skills.subarray(p.offset,p.offset+p.sizeBytes), binary:m.representation !== 'single'}; const t = fake(routes);
    await assert.rejects(download(s,t), {message: kind === 'extra' || kind === 'part-size' ? 'skills manifest part is invalid' : 'skills manifest is invalid'});
    assert.deepEqual(t.calls,['skills.manifest.json']);
  }
  for (const size of [PART,PART+1]) { const s = setup({skills:size}), t = fake(routesFor(s)); await download(s,t); }
});

