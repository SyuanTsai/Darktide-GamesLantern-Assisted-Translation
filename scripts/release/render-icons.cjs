'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ICON_DIRECTORY = path.join(ROOT, 'extension', 'icons');
const SOURCE_PATH = path.join(ICON_DIRECTORY, 'source.svg');
const SIZES = Object.freeze([16, 32, 48, 128]);

function readPngSize(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)
    || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('rendered icon is not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function renderIcons() {
  const { chromium } = require('playwright');
  const executablePath = process.env.W16_CHROME_EXE || process.env.SYP_W10_CHROMIUM_EXE || chromium.executablePath();
  if (!fs.existsSync(executablePath)) throw new Error('a local Chrome/Chromium executable is required to render owned icons');
  const svg = fs.readFileSync(SOURCE_PATH, 'utf8');
  if (!svg.includes('<svg ') || /(?:https?:)?\/\//i.test(svg.replace('http://www.w3.org/2000/svg', ''))) {
    throw new Error('icon source must be a self-contained local SVG');
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
    for (const size of SIZES) {
      const sizedSvg = svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ');
      await page.setContent('<!doctype html><html><head><style>html,body{margin:0;width:' + size
        + 'px;height:' + size + 'px;background:transparent}svg{display:block}</style></head><body>'
        + sizedSvg + '</body></html>');
      const output = path.join(ICON_DIRECTORY, 'icon' + size + '.png');
      await page.locator('svg').screenshot({ path: output, omitBackground: true, animations: 'disabled' });
      const dimensions = readPngSize(fs.readFileSync(output));
      if (dimensions.width !== size || dimensions.height !== size) {
        throw new Error('rendered icon dimensions do not match icon' + size + '.png');
      }
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  renderIcons().then(() => process.stdout.write('Rendered owned SVG icon at 16, 32, 48 and 128 pixels.\n'), (error) => {
    process.stderr.write(String(error && error.message || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { renderIcons, readPngSize, SIZES };
