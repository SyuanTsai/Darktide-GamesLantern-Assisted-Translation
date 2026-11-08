const http = require('node:http');
const { createHash } = require('node:crypto');
const { fixture } = require('./source-data-fixture.cjs');
const ORIGIN = 'https://darktide.tw-syuan.com';
async function localSource(data = fixture(), options = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const filename = req.url.split('/').pop();
    const name = filename.replace('.json', '');
    const route = options.routes && options.routes[filename];
    if (route) { res.writeHead(route.status || 200, { 'content-type': route.mime || (filename.endsWith('.bin') ? 'application/octet-stream' : 'application/json; charset=utf-8'), ...(route.headers || {}) }); res.end(route.body); return; }
    if (filename.endsWith('.manifest.json') || filename.endsWith('.bin')) { res.writeHead(404); res.end(); return; }
    const body = options.body ? options.body(name) : JSON.stringify(data[name]);
    res.writeHead(options.status || 200, { 'content-type': options.mime || 'application/json; charset=utf-8',
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD',
      'cache-control': name === 'current' ? 'no-cache, must-revalidate' : 'public, max-age=31536000, immutable' });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
    async fetchImpl(url, init) {
      requests.push({ url, init });
      if (options.error) throw new Error('offline');
      const response = await fetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, init);
      return { status: response.status, ok: response.ok, redirected: false, url: options.finalUrl || url,
        headers: response.headers, body: response.body };
    } };
}
function raw(data = fixture()) {
  const encode = x => new TextEncoder().encode(JSON.stringify(x));
  return { currentBytes: encode(data.current), files: Object.fromEntries(['skills', 'weapons', 'blessings', 'terms'].map(k => [k, encode(data[k])])) };
}
function transport(data = fixture(), category = 'skills', sharded = false) {
  let bytes = Buffer.from(JSON.stringify(data[category]));
  if (sharded) bytes = Buffer.concat([bytes, Buffer.alloc(20 * 1024 * 1024 + 1 - bytes.length, 32)]);
  const hash = b => createHash('sha256').update(b).digest('hex');
  const chunks = sharded ? [bytes.subarray(0, 20 * 1024 * 1024), bytes.subarray(20 * 1024 * 1024)] : [bytes];
  let offset = 0; const routes = {};
  const parts = chunks.map((chunk, i) => {
    const path = sharded ? category + '.part-' + String(i + 1).padStart(4, '0') + '.bin' : category + '.json';
    routes[path] = { body: chunk }; const part = { index: i + 1, path, offset, sizeBytes: chunk.length, sha256: hash(chunk) };
    offset += chunk.length; return part;
  });
  const manifest = { transportSchemaVersion: '1.0.0', representation: sharded ? 'raw-byte-shards' : 'single', gameVersion: data.current.gameVersion,
    category, totalBytes: bytes.length, totalSha256: hash(bytes), parts };
  routes[category + '.manifest.json'] = { body: JSON.stringify(manifest) };
  return { routes, manifest, bytes };
}
module.exports = { localSource, raw, transport, ORIGIN };
