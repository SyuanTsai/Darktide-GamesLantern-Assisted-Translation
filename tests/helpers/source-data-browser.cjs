const fs = require('node:fs'); const path = require('node:path');
const files = ['source-data-contract.js','loader.js','document-session.js','client.js','native-identity.js','view-model.js','presentation.js','production-dataset.js','dom-adapter.js','dom-controller.js','content-entry.js'];
function detailHtml(data) {
  const item = data.skills.items[0];
  const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return '<!doctype html><html><body><div class="shadow-md border max-w-sm"><div class="text-lg">' + escape(item.name.en) + '</div><div class="font-normal leading-5">' + item.official.en.split('\n\n').map(escape).join('<br><br>') + '</div></div></body></html>';
}
function source(file) { return fs.readFileSync(path.join(__dirname, '../../extension/shared', file), 'utf8'); }
module.exports = { files, detailHtml, source };
