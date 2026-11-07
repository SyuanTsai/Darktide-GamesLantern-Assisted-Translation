const fs = require('node:fs');
const path = require('node:path');
const names = ['current', 'skills', 'weapons', 'blessings', 'terms'];
function fixture(version) {
  const data = Object.fromEntries(names.map(name => [name, JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/source-data-v1', name + '.json'), 'utf8'))]));
  if (version) {
    for (const name of names) data[name].gameVersion = version;
    data.current.path = 'data/' + version;
    data.current.versions = [version];
  }
  return data;
}
module.exports = { fixture };
