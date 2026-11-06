const http = require('node:http');
const { fixture } = require('./source-data-fixture.cjs');
const ORIGIN = 'https://darktide.tw-syuan.com';
async function localSource(data = fixture(), options = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = req.url.split('/').pop().replace('.json', '');
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
module.exports = { localSource, raw, ORIGIN };
