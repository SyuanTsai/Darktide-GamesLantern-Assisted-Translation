'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadRuntime() {
  const pathsFile = path.resolve(__dirname, '..', '..', '..', 'runtime-paths.json');
  let configured = {};
  if (fs.existsSync(pathsFile)) {
    try { configured = JSON.parse(fs.readFileSync(pathsFile, 'utf8')); } catch (_) { configured = {}; }
  }
  const explicitPlaywrightRoot = process.env.SYP_W10_PLAYWRIGHT_ROOT;
  const playwrightCandidates = explicitPlaywrightRoot
    ? [explicitPlaywrightRoot]
    : [configured.playwrightRoot, path.resolve(__dirname, '..', '..', 'node_modules')].filter(Boolean);
  let playwrightRoot;
  let playwrightPath;
  let packagePath;
  for (const candidate of playwrightCandidates) {
    if (typeof candidate !== 'string' || !fs.existsSync(candidate)) continue;
    try {
      packagePath = require.resolve('playwright/package.json', { paths: [candidate] });
      playwrightPath = require.resolve('playwright', { paths: [candidate] });
      playwrightRoot = candidate;
      break;
    } catch (_) {
      if (explicitPlaywrightRoot) throw new Error('Explicit W10 Playwright root does not resolve Playwright');
    }
  }
  if (!playwrightRoot) throw new Error('W10 Playwright is unavailable from explicit, repository-local, or optional runtime paths');
  const playwright = require(playwrightPath);
  const explicitChromium = process.env.SYP_W10_CHROMIUM_EXE;
  const chromiumCandidates = explicitChromium
    ? [explicitChromium]
    : [configured.chromium, playwright.chromium.executablePath()].filter(Boolean);
  const executablePath = chromiumCandidates.find((candidate) => typeof candidate === 'string' && fs.existsSync(candidate));
  if (!executablePath) throw new Error('W10 Chromium executable is unavailable from explicit, optional, or Playwright runtime paths');
  return {
    executablePath,
    playwright,
    playwrightRoot,
    playwrightVersion: require(packagePath).version
  };
}

function createPrivateProfileRoot() {
  const tempRoot = path.resolve(os.tmpdir());
  const profileRoot = fs.mkdtempSync(path.join(tempRoot, 'syp-w10-idb-'));
  const resolved = path.resolve(profileRoot);
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith('syp-w10-idb-')) {
    throw new Error('W10 browser profile escaped the private temporary root');
  }
  return resolved;
}

function removePrivateProfileRoot(profileRoot) {
  if (!profileRoot) return;
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(profileRoot);
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith('syp-w10-idb-')) {
    throw new Error('Refusing to remove a path outside the named W10 temporary profile');
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
}

module.exports = { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot };
