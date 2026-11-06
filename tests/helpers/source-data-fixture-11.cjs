const fs = require('node:fs');
const path = require('node:path');
function fixture11() {
  return Object.fromEntries(['current', 'skills', 'weapons', 'blessings', 'terms'].map(name => [name, JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/source-data-v1-1', name + '.json'), 'utf8'))]));
}
module.exports = { fixture11 };
