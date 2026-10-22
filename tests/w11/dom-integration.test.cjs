'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const test = require('node:test');
const loader = require('../../extension/shared/loader.js');
const presentation = require('../../extension/shared/presentation.js');
const { createPrivateProfileRoot, loadRuntime, removePrivateProfileRoot } = require('../w10/browser-runtime.cjs');
const { createDomController } = require('../../extension/shared/dom-controller.js');

const APPROVED_MANIFEST_SHA256 = 'bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7';
const APPROVED_DATA_REVISION = '808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62';
const APPROVED_DOMAIN_BYTES = 7065789;
const SYNTHETIC_EVIDENCE = 'W11 isolated synthetic proof; not a live Games Lantern identity';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inside(root, filename) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('approved candidate path escaped its explicit local input directory');
  }
  return path.resolve(filename);
}

async function readVerifiedCandidate() {
  const candidateRoot = process.env.SYP_W10_APPROVED_PACKAGE_DIR;
  if (!candidateRoot || !path.isAbsolute(candidateRoot)) {
    throw new Error('SYP_W10_APPROVED_PACKAGE_DIR must name the fixed local candidate input');
  }
  const manifestBytes = fs.readFileSync(inside(candidateRoot, path.join(candidateRoot, 'manifest.json')));
  assert.equal(sha256(manifestBytes), APPROVED_MANIFEST_SHA256, 'candidate manifest raw SHA changed');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.dataRevision, APPROVED_DATA_REVISION);

  const files = new Map();
  let domainBytes = 0;
  for (const row of manifest.files) {
    const raw = fs.readFileSync(inside(candidateRoot, path.join(candidateRoot, ...row.path.split('/'))));
    assert.equal(raw.byteLength, row.sizeBytes, row.path + ' raw size differs from manifest');
    assert.equal(sha256(raw), row.sha256, row.path + ' raw SHA differs from manifest');
    files.set(row.path, raw);
    domainBytes += raw.byteLength;
  }
  assert.equal(domainBytes, APPROVED_DOMAIN_BYTES, 'candidate four-domain raw byte total changed');

  const skills = JSON.parse(files.get(manifest.files.find((row) => row.kind === 'skills').path).toString('utf8'));
  const sourceRelease = skills.source.gameReleases.find((row) => row.gameReleaseId === manifest.gameReleaseId
    && row.gameVersion === manifest.gameVersion);
  assert.ok(sourceRelease, 'candidate Source registry must contain its exact release');
  const identity = {
    gameVersion: manifest.gameVersion,
    gameReleaseId: manifest.gameReleaseId,
    snapshotId: sourceRelease.snapshot.snapshotId
  };

  // This exact in-memory pointer exists only to run W10 raw verification for an isolated candidate.
  // It does not create a published version index, selected pointer, or allocated content version.
  const manifestSha256 = sha256(manifestBytes);
  const version = {
    schema_version: 2,
    data_revision: manifest.dataRevision,
    build_id: manifestSha256,
    game_version: manifest.gameVersion,
    package_kind: 'published',
    game_releases: [{
      game_version: manifest.gameVersion,
      content_version: manifest.contentVersion,
      data_revision: manifest.dataRevision,
      manifest_path: '/data/' + manifest.dataRevision + '/manifest.json',
      manifest_sha256: manifestSha256
    }]
  };
  const snapshot = await loader.verifyStoredSnapshot({
    versionBytes: Buffer.from(JSON.stringify(version), 'utf8'),
    manifestBytes,
    files,
    identity,
    cryptoApi: webcrypto
  });
  return { snapshot, manifestSha256, domainBytes };
}

function makeErrataFixtureModel() {
  const release = 'darktide:w11-errata-fixture';
  const skill = { gameReleaseId: release, kind: 'skill', recordId: 'fixture:skill' };
  const officialSegmentText = '官方原句。';
  const segmentSha256 = sha256(Buffer.from(officialSegmentText, 'utf8'));
  const domain = {
    kind: 'skills',
    gameReleaseId: release,
    source: { records: [{ ...skill, payload: { termRefs: [] } }] },
    web: {
      presentations: [{
        entityRef: skill,
        locale: 'zh-TW',
        name: '繁中技能名',
        nameOfficialSourceId: 'skill-name-zh',
        nameOfficialLocaleRefs: [{ officialSourceId: 'skill-name-en', sourceLocale: 'en' }],
        officialLocaleRefs: [{ officialSourceId: 'skill-description-en', sourceLocale: 'en' }],
        official: { entityRef: skill, officialSourceId: 'skill-description-zh' },
        detailSections: [{ sectionId: 'effects', items: [{ text: '繁中效果。', termRefs: [], termRuleRefs: [] }] }],
        errata: [
          { errataId: 'valid', anchor: { officialSourceId: 'skill-description-zh', segmentId: 'segment-1', segmentSha256 }, text: '有效勘誤。' },
          { errataId: 'stale', anchor: { officialSourceId: 'skill-description-zh', segmentId: 'segment-1', segmentSha256: 'f'.repeat(64) }, text: '舊勘誤不可見。' }
        ]
      }],
      officialInputs: { sources: [
        { officialSourceId: 'skill-name-en', sourceLocale: 'en', entityRef: skill, sourceText: 'Official Skill', resolvedText: 'Official Skill', segments: [] },
        { officialSourceId: 'skill-name-zh', sourceLocale: 'zh-TW', entityRef: skill, sourceText: '技能名', resolvedText: '技能名', segments: [] },
        { officialSourceId: 'skill-description-en', sourceLocale: 'en', entityRef: skill, sourceText: 'Official first.\n\nOfficial second.', resolvedText: 'Official first.\n\nOfficial second.', segments: [] },
        { officialSourceId: 'skill-description-zh', sourceLocale: 'zh-TW', entityRef: skill, sourceText: officialSegmentText, resolvedText: '繁中第一段。\n\n繁中第二段。', params: [], segments: [
          { segmentId: 'segment-1', sha256: segmentSha256, text: officialSegmentText }
        ] }
      ] },
      termLocalizations: []
    }
  };
  const models = presentation.buildSkillViewModels({
    identity: { gameVersion: '1.13.2', gameReleaseId: release },
    domains: new Map([['skills', domain]])
  });
  assert.equal(models.length, 1);
  assert.deepEqual(models[0].errata, ['有效勘誤。']);
  return models[0];
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function makeCardMarkup(model, id, tagName = 'div', href = 'https://darktide.gameslantern.com/abilities/brain-rupture') {
  const parts = model.nativeDescription.split('\n\n');
  if (parts.length !== 2) throw new Error('candidate skill official source no longer has the observed two-paragraph card shape');
  const parameter = Object.values(model.translationParams).find((value) => value && parts[1].includes(value));
  if (!parameter) throw new Error('candidate skill has no parameter matching the observed styled native text span');
  const parameterIndex = parts[1].indexOf(parameter);
  const before = parts[1].slice(0, parameterIndex);
  const after = parts[1].slice(parameterIndex + parameter.length);
  return `<${tagName} id="${esc(id)}"><a class="flex items-center gap-2" title="${esc(model.nativeName)}" href="${esc(href)}"><img alt=""><div><div class="font-teko">${esc(model.nativeName)}</div><div class="text-xs">${esc(parts[0])}<br><br>${esc(before)}<span class="native-parameter">${esc(parameter)}</span>${esc(after)}</div></div></a></${tagName}>`;
}

test('InterT10_VerifiedCandidateAndSyntheticProofPreserveNativeDOMAndRestoreSafely', async () => {
  // Scenario: Given the fixed approved four-domain candidate and an exact synthetic local identity proof, render one known Games Lantern ability card in Chromium.
  // Purpose: Verify reversible text-node writing, native DOM behavior, observer rescans, protected editor prose, and fail-closed identity changes without claiming live-site identity.
  const { snapshot, manifestSha256, domainBytes } = await readVerifiedCandidate();
  const models = presentation.buildSkillViewModels(snapshot);
  const model = models.find((row) => row.nativeName === 'Brain Rupture');
  assert.ok(model, 'fixed candidate must contain the observed Brain Rupture source/presentation');
  assert.deepEqual(model.errata, [], 'candidate without a visible exact erratum must not reserve an empty errata section');
  assert.equal(manifestSha256, APPROVED_MANIFEST_SHA256);
  assert.equal(domainBytes, APPROVED_DOMAIN_BYTES);

  const appHtml = makeCardMarkup(model, 'positive-card');
  const protectedHtml = makeCardMarkup(model, 'editor-card');
  const articleHtml = makeCardMarkup(model, 'article-card', 'article');
  const guideHtml = '<section class="build-guide">' + makeCardMarkup(model, 'guide-card') + '</section>';
  const foreignRouteHtml = makeCardMarkup(model, 'foreign-route-card', 'div', 'https://example.invalid/abilities/brain-rupture');
  const runtime = loadRuntime();
  const profileRoot = createPrivateProfileRoot();
  const html = `<main id="app"><div id="darktide-build-editor" data-game-version="1.13.2"><section id="patch-selector"><h2>Talent Tree Patch</h2><button id="patch-live" class="bg-primary/20">Depths of the Damned<span>Live</span></button><button id="patch-old" class="bg-primary">Skitarii Class</button></section><section id="editor">${protectedHtml}</section></div><button id="unrelated-filter" class="bg-primary/20">Selected filter</button>${appHtml}${articleHtml}${guideHtml}${foreignRouteHtml}<div id="user-prose" class="ck-content" contenteditable="true">${esc(model.nativeName)} ${esc(model.nativeDescription)}</div><input id="user-input" value="keep me"></main>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>');
  });
  let context;
  let serverListening = false;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    serverListening = true;
    const address = server.address();
    context = await runtime.playwright.chromium.launchPersistentContext(profileRoot, {
      executablePath: runtime.executablePath,
      headless: true,
      args: ['--disable-background-networking', '--no-first-run']
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + address.port + '/');
    assert.equal(await page.evaluate(() => window.isSecureContext && !!window.crypto.subtle), true,
      'loopback browser document must provide Web Crypto for digest verification');
    for (const file of [
      'native-identity.js', 'view-model.js', 'presentation.js', 'dom-adapter.js', 'dom-controller.js'
    ]) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', file) });
    }
    const userInput = {
      identity: snapshot.identity,
      evidence: SYNTHETIC_EVIDENCE,
      digest: sha256(Buffer.from(SYNTHETIC_EVIDENCE, 'utf8')),
      rows: [...snapshot.domains.entries()].filter(([kind]) => kind === 'skills' || kind === 'terms'),
      cardMarkup: makeCardMarkup(model, 'popup-card')
    };
    await page.evaluate((input) => {
      const app = document.querySelector('#app');
      const anchor = document.querySelector('#positive-card a');
      const description = anchor.querySelector('.text-xs');
      const titleNode = anchor.querySelector('.font-teko').firstChild;
      const span = description.querySelector('span.native-parameter');
      const breaks = [...description.querySelectorAll('br')];
      const textNodes = [];
      const walker = document.createTreeWalker(description, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      const activity = { click: 0, input: 0, change: 0, initializes: [] };
      anchor.addEventListener('click', (event) => event.preventDefault(), { capture: true });
      anchor.addEventListener('click', () => { activity.click += 1; });
      description.addEventListener('input', () => { activity.input += 1; });
      description.addEventListener('change', () => { activity.change += 1; });
      anchor.focus();

      const verifiedSnapshot = {
        identity: input.identity,
        domains: new Map(input.rows)
      };
      const identityB = { gameVersion: '1.13.1', gameReleaseId: 'darktide:1.13.1', snapshotId: 'synthetic-old-proof' };
      const bytesB = new TextEncoder().encode('different isolated native evidence');
      const resolver = W11NativeIdentity.createNativeIdentityResolver({ proofs: [
        { evidenceId: 'synthetic-isolated-A', sha256: input.digest, identity: input.identity, patchLabel: 'Depths of the Damned' },
        { evidenceId: 'synthetic-isolated-B', sha256: input.secondDigest, identity: identityB, patchLabel: 'Depths of the Damned' }
      ] });
      const client = {
        async initialize(identity) {
          activity.initializes.push(identity);
          return { status: 'ready', source: 'baseline', identity, snapshot: verifiedSnapshot };
        }
      };
      window.__w11 = {
        activity, anchor, app, breaks, bytesB, client, description, identityB, span, textNodes, titleNode,
        resolver, verifiedSnapshot,
        setEvidence(value) { window.__nativeEvidence = value; }
      };
      window.__nativeEvidence = new TextEncoder().encode(input.evidence);
      const unknownClient = { async initialize() { activity.unknownInitializes = (activity.unknownInitializes || 0) + 1; return null; } };
      window.__w11.unknownController = W11DomController.createDomController({
        document,
        root: document,
        identityResolver: W11NativeIdentity.createNativeIdentityResolver({ proofs: [] }),
        getNativeSnapshotBytes: () => window.__w11.pendingEvidence || window.__nativeEvidence,
        client: unknownClient
      });
      const controller = W11DomController.createDomController({
        document,
        root: document,
        identityResolver: resolver,
        getNativeSnapshotBytes: () => window.__w11.pendingEvidence || window.__nativeEvidence,
        client
      });
      window.__w11.controller = controller;
    }, { ...userInput, secondDigest: sha256(Buffer.from('different isolated native evidence', 'utf8')) });
    await page.evaluate(() => window.__w11.unknownController.start());
    const unknownState = await page.evaluate(() => ({
      name: document.querySelector('#positive-card .font-teko').textContent,
      details: document.querySelectorAll('#positive-card [data-w11-owned]').length,
      reason: window.__w11.unknownController.getState().reason,
      clientCalls: window.__w11.activity.unknownInitializes || 0
    }));
    assert.deepEqual(unknownState, {
      name: model.nativeName,
      details: 0,
      reason: 'unknown-identity',
      clientCalls: 0
    });
    await page.evaluate(() => window.__w11.unknownController.dispose());
    await page.evaluate(() => window.__w11.controller.start());

    const firstPass = await page.evaluate(async () => {
      const state = window.__w11;
      await state.controller.scan();
      const originalTitleNode = state.titleNode;
      const originalBreaks = state.breaks;
      const originalSpan = state.span;
      const originalTextNodes = state.textNodes;
      const card = document.querySelector('#positive-card');
      const details = card.querySelectorAll('[data-w11-owned="details"]');
      const description = state.description;
      const renderedDescription = (() => {
        let value = '';
        const walker = document.createTreeWalker(description, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.nodeType === Node.TEXT_NODE) value += node.nodeValue;
          else if (node.tagName === 'BR') value += '\n';
        }
        return value;
      })();
      state.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      description.dispatchEvent(new Event('input', { bubbles: true }));
      description.dispatchEvent(new Event('change', { bubbles: true }));
      const summary = card.querySelector('[data-w11-owned="details"] summary');
      summary && summary.click();
      await state.controller.scan();
      return {
        activeElementKept: document.activeElement === state.anchor,
        breaksKept: originalBreaks.every((node) => node.isConnected && node.parentNode === description),
        spanKept: originalSpan.isConnected && originalSpan.textContent === '+50%',
        titleNodeKept: originalTitleNode === state.anchor.querySelector('.font-teko').firstChild,
        descriptionNodeCountKept: originalTextNodes.every((node) => node.isConnected),
        name: state.anchor.querySelector('.font-teko').textContent,
        description: renderedDescription,
        detailsCount: details.length,
        visibleErrataCount: card.querySelectorAll('.w11-extension-errata').length,
        detailsSummary: summary && summary.textContent,
        detailsOpened: !!(summary && summary.parentElement.open),
        detailsText: card.querySelector('[data-w11-owned="details"]')?.textContent || '',
        activity: { ...state.activity },
        userProse: document.querySelector('#user-prose').textContent,
        userInput: document.querySelector('#user-input').value,
        editorCardName: document.querySelector('#editor-card .font-teko').textContent,
        editorOwnedCount: document.querySelectorAll('#editor-card [data-w11-owned]').length,
        articleCardName: document.querySelector('#article-card .font-teko').textContent,
        articleOwnedCount: document.querySelectorAll('#article-card [data-w11-owned]').length,
        guideCardName: document.querySelector('#guide-card .font-teko').textContent,
        guideOwnedCount: document.querySelectorAll('#guide-card [data-w11-owned]').length,
        foreignRouteName: document.querySelector('#foreign-route-card .font-teko').textContent,
        foreignRouteOwnedCount: document.querySelectorAll('#foreign-route-card [data-w11-owned]').length
      };
    });
    assert.equal(firstPass.name, model.translatedName);
    assert.equal(firstPass.description.replace(/\s+/g, ' ').trim(), model.translatedDescription.replace(/\s+/g, ' ').trim());
    assert.equal(firstPass.activeElementKept, true);
    assert.equal(firstPass.breaksKept, true);
    assert.equal(firstPass.spanKept, true);
    assert.equal(firstPass.titleNodeKept, true);
    assert.equal(firstPass.descriptionNodeCountKept, true);
    assert.equal(firstPass.detailsCount, 1);
    assert.equal(firstPass.visibleErrataCount, 0);
    assert.equal(firstPass.detailsSummary, '詳細說明');
    assert.equal(firstPass.detailsOpened, true);
    assert.ok(firstPass.detailsText.includes('效果'));
    assert.ok(firstPass.detailsText.includes('條件'));
    assert.equal(firstPass.activity.click, 1);
    assert.equal(firstPass.activity.input, 1);
    assert.equal(firstPass.activity.change, 1);
    assert.equal(firstPass.activity.initializes.length, 1);
    assert.equal(firstPass.userProse, model.nativeName + ' ' + model.nativeDescription);
    assert.equal(firstPass.userInput, 'keep me');
    assert.equal(firstPass.editorCardName, model.nativeName);
    assert.equal(firstPass.editorOwnedCount, 0);
    assert.equal(firstPass.articleCardName, model.nativeName);
    assert.equal(firstPass.articleOwnedCount, 0);
    assert.equal(firstPass.guideCardName, model.nativeName);
    assert.equal(firstPass.guideOwnedCount, 0);
    assert.equal(firstPass.foreignRouteName, model.nativeName);
    assert.equal(firstPass.foreignRouteOwnedCount, 0);

    await page.evaluate((popupMarkup) => {
      const wrapper = document.createElement('section');
      wrapper.id = 'native-popup';
      wrapper.innerHTML = popupMarkup;
      document.querySelector('#app').append(wrapper);
      history.pushState({}, '', '#popup-open');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, makeCardMarkup(model, 'popup-card'));
    await page.waitForFunction(() => document.querySelector('#popup-card .font-teko')?.textContent === '顱腦崩裂');
    const afterPopup = await page.evaluate(async () => {
      await window.__w11.controller.scan();
      await window.__w11.controller.scan();
      return {
        popupName: document.querySelector('#popup-card .font-teko').textContent,
        popupDetailsCount: document.querySelectorAll('#popup-card [data-w11-owned="details"]').length,
        primaryDetailsCount: document.querySelectorAll('#positive-card [data-w11-owned="details"]').length,
        initializeCount: window.__w11.activity.initializes.length
      };
    });
    assert.deepEqual(afterPopup, {
      popupName: model.translatedName,
      popupDetailsCount: 1,
      primaryDetailsCount: 1,
      initializeCount: 1
    });

    await page.evaluate(async () => {
      const state = window.__w11;
      state.pendingEvidence = new Promise((resolve) => { state.releaseEvidence = resolve; });
      state.pendingScan = state.controller.scan();
      await Promise.resolve();
      await state.controller.setEnabled(false);
    });
    await page.evaluate(() => {
      const state = window.__w11;
      state.releaseEvidence(window.__nativeEvidence);
      state.pendingEvidence = null;
    });
    const disabledResult = await page.evaluate(async () => {
      await window.__w11.pendingScan;
      return {
        title: document.querySelector('#positive-card .font-teko').textContent,
        details: document.querySelectorAll('#positive-card [data-w11-owned]').length,
        status: window.__w11.controller.getState().reason,
        initializeCount: window.__w11.activity.initializes.length
      };
    });
    assert.deepEqual(disabledResult, {
      title: model.nativeName,
      details: 0,
      status: 'disabled',
      initializeCount: 1
    });
    await page.evaluate(() => window.__w11.controller.setEnabled(true));
    await page.waitForFunction(() => document.querySelector('#positive-card .font-teko')?.textContent === '顱腦崩裂');

    await page.evaluate(() => {
      const node = window.__w11.textNodes[0];
      node.nodeValue = 'Vue replaced this native text.';
    });
    await page.waitForFunction(() => document.querySelector('#positive-card .font-teko')?.textContent === 'Brain Rupture'
      && document.querySelector('#positive-card [data-w11-owned="details"]') === null);
    const vuePreserved = await page.evaluate(() => ({
      changed: window.__w11.textNodes[0].nodeValue,
      title: document.querySelector('#positive-card .font-teko').textContent,
      popupName: document.querySelector('#popup-card .font-teko').textContent
    }));
    assert.equal(vuePreserved.changed, 'Vue replaced this native text.');
    assert.equal(vuePreserved.title, 'Brain Rupture');
    assert.equal(vuePreserved.popupName, model.translatedName);

    await page.evaluate(async () => {
      window.__w11.setEvidence(window.__w11.bytesB);
      await window.__w11.controller.scan();
    });
    await page.waitForFunction(() => window.__w11.controller.getState().reason === 'identity-changed');
    const afterIdentityChange = await page.evaluate(() => ({
      title: document.querySelector('#popup-card .font-teko').textContent,
      details: document.querySelectorAll('#popup-card [data-w11-owned="details"]').length,
      initializes: window.__w11.activity.initializes.length,
      status: window.__w11.controller.getState().reason
    }));
    assert.deepEqual(afterIdentityChange, {
      title: model.nativeName,
      details: 0,
      initializes: 1,
      status: 'identity-changed'
    });

    await page.evaluate(async (cardMarkup) => {
      window.__w11.setEvidence(new TextEncoder().encode('W11 isolated synthetic proof; not a live Games Lantern identity'));
      const wrapper = document.createElement('section');
      wrapper.id = 'patch-change-app';
      wrapper.innerHTML = cardMarkup;
      document.querySelector('#app').append(wrapper);
      const patchClient = {
        async initialize(identity) {
          window.__w11.patchInitializes = (window.__w11.patchInitializes || 0) + 1;
          return { status: 'ready', source: 'baseline', identity, snapshot: window.__w11.verifiedSnapshot };
        }
      };
      window.__w11.patchController = W11DomController.createDomController({
        document,
        root: wrapper,
        identityResolver: window.__w11.resolver,
        getNativeSnapshotBytes: () => window.__nativeEvidence,
        client: patchClient
      });
      await window.__w11.patchController.start();
    }, makeCardMarkup(model, 'patch-change-card'));
    const patchMatched = await page.evaluate(() => document.querySelector('#patch-change-card .font-teko').textContent);
    assert.equal(patchMatched, model.translatedName);
    await page.evaluate(() => {
      document.querySelector('#patch-live').className = 'bg-primary';
      document.querySelector('#patch-old').className = 'bg-primary/20';
    });
    await page.waitForFunction(() => window.__w11.patchController.getState().reason === 'patch-selection-changed', null, { timeout: 1500 });
    const afterPatchChange = await page.evaluate(() => ({
      title: document.querySelector('#patch-change-card .font-teko').textContent,
      details: document.querySelectorAll('#patch-change-card [data-w11-owned]').length,
      status: window.__w11.patchController.getState().reason,
      initializeCount: window.__w11.patchInitializes
    }));
    assert.deepEqual(afterPatchChange, {
      title: model.nativeName,
      details: 0,
      status: 'patch-selection-changed',
      initializeCount: 1
    });
    await page.evaluate(() => window.__w11.patchController.dispose());

    await page.evaluate(() => window.__w11.controller.dispose());
  } finally {
    if (context) await context.close();
    if (serverListening) await new Promise((resolve) => server.close(resolve));
    removePrivateProfileRoot(profileRoot);
  }
});

test('InterT20_PatchChangeDuringDelayedInitializationNeverAppliesStaleView', async () => {
  // Scenario: Given an exact local proof while client initialization is pending, the native patch selection changes by class only.
  // Purpose: Reject stale release content before the writer runs and observe native selection changes without a manual scan.
  const { snapshot } = await readVerifiedCandidate();
  const model = presentation.buildSkillViewModels(snapshot).find((row) => row.nativeName === 'Brain Rupture');
  assert.ok(model);
  const evidence = Buffer.from('W11 isolated delayed-init proof; not a live identity', 'utf8');
  const evidenceSha256 = sha256(evidence);
  const runtime = loadRuntime();
  const profileRoot = createPrivateProfileRoot();
  const html = `<main id="app"><div id="darktide-build-editor"><section id="patch-selector"><h2>Talent Tree Patch</h2><button id="patch-live" class="bg-primary/20">Depths of the Damned<span>Live</span></button><button id="patch-old" class="bg-primary">Skitarii Class</button></section></div>${makeCardMarkup(model, 'delayed-card')}</main>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>');
  });
  let context;
  let serverListening = false;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    serverListening = true;
    const address = server.address();
    context = await runtime.playwright.chromium.launchPersistentContext(profileRoot, {
      executablePath: runtime.executablePath,
      headless: true,
      args: ['--disable-background-networking', '--no-first-run']
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + address.port + '/');
    for (const file of ['native-identity.js', 'view-model.js', 'presentation.js', 'dom-adapter.js', 'dom-controller.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', file) });
    }
    const input = {
      identity: snapshot.identity,
      evidence: evidence.toString('utf8'),
      evidenceSha256,
      rows: [...snapshot.domains.entries()].filter(([kind]) => kind === 'skills' || kind === 'terms')
    };
    await page.evaluate((value) => {
      const verifiedSnapshot = { identity: value.identity, domains: new Map(value.rows) };
      let finishInitialization;
      const initialization = new Promise((resolve) => { finishInitialization = resolve; });
      const state = { applyCalls: 0, initializationStarted: false, initializeCount: 0 };
      const resolver = W11NativeIdentity.createNativeIdentityResolver({ proofs: [{
        evidenceId: 'isolated-delayed-test-only',
        sha256: value.evidenceSha256,
        identity: value.identity,
        patchLabel: 'Depths of the Damned'
      }] });
      const baseAdapter = W11DomAdapter.createDomAdapter({ document });
      const adapter = Object.freeze({
        ...baseAdapter,
        applySkill(slot, model) {
          state.applyCalls += 1;
          return baseAdapter.applySkill(slot, model);
        }
      });
      const client = {
        initialize() {
          state.initializeCount += 1;
          state.initializationStarted = true;
          return initialization;
        }
      };
      const controller = W11DomController.createDomController({
        document,
        root: document,
        identityResolver: resolver,
        getNativeSnapshotBytes: () => new TextEncoder().encode(value.evidence),
        client,
        adapter
      });
      state.controller = controller;
      state.finishInitialization = finishInitialization;
      state.startPromise = controller.start();
      state.snapshot = verifiedSnapshot;
      window.__w11Delayed = state;
    }, input);
    await page.waitForFunction(() => window.__w11Delayed.initializationStarted === true, null, { timeout: 5000 });

    // Given button labels remain unchanged, When selection classes swap without an explicit scan, Then the pending result must be discarded.
    await page.evaluate(() => {
      document.querySelector('#patch-live').className = 'bg-primary';
      document.querySelector('#patch-old').className = 'bg-primary/20';
    });
    await page.evaluate(async () => {
      const state = window.__w11Delayed;
      state.finishInitialization({ status: 'ready', identity: state.snapshot.identity, snapshot: state.snapshot });
      await state.startPromise;
    });
    const result = await page.evaluate(() => ({
      applyCalls: window.__w11Delayed.applyCalls,
      initializeCount: window.__w11Delayed.initializeCount,
      name: document.querySelector('#delayed-card .font-teko').textContent,
      details: document.querySelectorAll('#delayed-card [data-w11-owned]').length,
      reason: window.__w11Delayed.controller.getState().reason
    }));
    assert.deepEqual(result, {
      applyCalls: 0,
      initializeCount: 1,
      name: model.nativeName,
      details: 0,
      reason: 'patch-selection-changed'
    });
    await page.evaluate(() => window.__w11Delayed.controller.dispose());
  } finally {
    if (context) await context.close();
    if (serverListening) await new Promise((resolve) => server.close(resolve));
    removePrivateProfileRoot(profileRoot);
  }
});

test('InterT30_ExactErrataStaysVisibleBeforeCollapsedDetails', async () => {
  // Scenario: Given a W08 view-model with one exact anchored erratum and an ordinary closed details panel.
  // Purpose: Keep the visible official/errata reading order before the expandable five-section detail area.
  const model = makeErrataFixtureModel();
  const runtime = loadRuntime();
  const profileRoot = createPrivateProfileRoot();
  const card = `<div id="fixture-card"><a class="flex items-center gap-2" href="https://darktide.gameslantern.com/abilities/fixture-skill"><img alt=""><div><div class="font-teko">Official Skill</div><div class="text-xs">Official first.<br><br>Official second.</div></div></a></div>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + card + '</body></html>');
  });
  let context;
  let serverListening = false;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    serverListening = true;
    const address = server.address();
    context = await runtime.playwright.chromium.launchPersistentContext(profileRoot, {
      executablePath: runtime.executablePath,
      headless: true,
      args: ['--disable-background-networking', '--no-first-run']
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + address.port + '/');
    await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', 'view-model.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', 'presentation.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../extension/shared', 'dom-adapter.js') });
    const result = await page.evaluate((viewModel) => {
      const adapter = W11DomAdapter.createDomAdapter({ document });
      const slot = adapter.collectSkillSlots(document).find((row) => row.anchor.closest('#fixture-card'));
      const record = adapter.applySkill(slot, viewModel);
      const panel = document.querySelector('#fixture-card [data-w11-owned="details"]');
      const errata = panel && panel.querySelector('.w11-extension-errata');
      const disclosure = panel && panel.querySelector('details');
      return {
        written: !!record,
        errataText: errata && errata.textContent,
        errataInsideDisclosure: !!(errata && errata.closest('details')),
        disclosureOpen: !!(disclosure && disclosure.open),
        order: [...panel.children].map((node) => node.className || node.tagName)
      };
    }, model);
    assert.equal(result.written, true);
    assert.ok(result.errataText.includes('有效勘誤。'));
    assert.equal(result.errataText.includes('舊勘誤不可見。'), false);
    assert.equal(result.errataInsideDisclosure, false);
    assert.equal(result.disclosureOpen, false);
    assert.equal(result.order[0], 'w11-extension-errata');
  } finally {
    if (context) await context.close();
    if (serverListening) await new Promise((resolve) => server.close(resolve));
    removePrivateProfileRoot(profileRoot);
  }
});
