(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./native-identity.js') : root.W11NativeIdentity,
    commonJs ? require('./client.js') : root.W10SharedClient,
    commonJs ? require('./dom-controller.js') : root.W11DomController,
    commonJs ? require('./dom-adapter.js') : root.W11DomAdapter,
    commonJs ? require('./presentation.js') : root.W11Presentation
  );
  if (commonJs) module.exports = api;
  root.W11ContentEntry = api;
  if (!commonJs && root.document && root.chrome && root.chrome.runtime) {
    try { root.__W11_CONTENT_ENTRY_INSTANCE__ = api.startPage(root); } catch (_) { /* Unknown pages stay native. */ }
  }
})(typeof globalThis === 'object' ? globalThis : this, function (identityApi, clientApi, controllerApi, adapterApi, presentationApi) {
  'use strict';

  const GAME_ORIGIN = 'https://darktide.gameslantern.com';
  const OWNED_ATTRIBUTE = 'data-w11-owned';
  const SUPPORTED_PATH = /^\/(?:build-editor|abilities(?:\/[a-z0-9-]+)?|weapon-blessing-traits|weapons(?:\/[a-z0-9-]+){1,2})\/?$/i;
  const PATCH_CHANGED_EVIDENCE = Object.freeze({
    'unknown-identity': '無法辨識目前遊戲版本或快照，保留原站內容。',
    'identity-changed': '遊戲身分已變更，已還原原站內容。',
    'patch-selection-changed': '原站選用的遊戲版本已變更，已還原原站內容。',
    'patch-selection-ambiguous': '無法確認原站選用的遊戲版本，保留原站內容。',
    'no-matching-presentation': '目前沒有安全對應的翻譯，保留原站內容。',
    disabled: '已切回原站內容。',
    disposed: '已切回原站內容。'
  });

  function isSupportedPage(location) {
    return !!location && location.origin === GAME_ORIGIN
      && typeof location.pathname === 'string' && SUPPORTED_PATH.test(location.pathname);
  }

  function exactKeys(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be an object');
    const keys = Object.keys(value).sort();
    const allowed = [...expected].sort();
    if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
      throw new TypeError(label + ' must contain exactly: ' + allowed.join(', '));
    }
  }

  function normalizePatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('native patch result is invalid');
    if (patch.status === 'selected') {
      exactKeys(patch, ['status', 'label'], 'native selected patch');
      if (typeof patch.label !== 'string' || !patch.label.trim()) throw new TypeError('native patch label is invalid');
      return { status: 'selected', label: patch.label };
    }
    exactKeys(patch, ['status'], 'native patch result');
    if (!['absent', 'ambiguous'].includes(patch.status)) throw new TypeError('native patch status is invalid');
    return { status: patch.status };
  }

  function normalizeSkillObservation(observation) {
    exactKeys(observation, ['structure', 'name', 'description'], 'native ability observation');
    if (observation.structure !== 'gameslantern-ability-card-v1'
      || typeof observation.name !== 'string' || !observation.name.trim()
      || typeof observation.description !== 'string' || !observation.description.trim()) {
      throw new TypeError('native ability observation is incomplete');
    }
    return { structure: observation.structure, name: observation.name, description: observation.description };
  }

  function normalizeWeaponObservation(observation) {
    exactKeys(observation, ['structure', 'href', 'title', 'mirrorTitle', 'imageAlt', 'imageSrc'], 'native weapon observation');
    if (observation.structure !== 'gameslantern-weapon-detail-v1' || typeof observation.href !== 'string'
      || typeof observation.title !== 'string' || typeof observation.mirrorTitle !== 'string'
      || observation.imageAlt !== 'Header Image' || typeof observation.imageSrc !== 'string') {
      throw new TypeError('native weapon observation is incomplete');
    }
    const page = new URL(observation.href);
    const image = new URL(observation.imageSrc, page.origin);
    if (page.protocol !== 'https:' || page.hostname !== 'darktide.gameslantern.com' || page.port
      || page.username || page.password || page.search || page.hash
      || !/^\/weapons\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(page.pathname)
      || image.protocol !== 'https:' || !['darktide.gameslantern.com', 'gameslantern.com'].includes(image.hostname)
      || image.port || image.username || image.password || image.search || image.hash
      || !image.pathname.startsWith('/storage/sites/darktide/weapons/')) {
      throw new TypeError('native weapon observation escaped its supported page or image shape');
    }
    return { structure: observation.structure, route: page.pathname, title: observation.title,
      mirrorTitle: observation.mirrorTitle, imageAlt: observation.imageAlt, imagePath: image.pathname };
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(JSON.stringify(value));
  }

  function serializeNativeSnapshot(input = {}) {
    exactKeys(input, ['pathname', 'patch', 'skills', 'weapons'], 'native snapshot evidence');
    const { pathname, patch, skills, weapons } = input;
    if (typeof pathname !== 'string' || !SUPPORTED_PATH.test(pathname)
      || !Array.isArray(skills) || !Array.isArray(weapons)) throw new TypeError('native snapshot evidence is invalid');
    return utf8Bytes({ schemaVersion: 'w11-native-dom-evidence/1', pathname,
      patch: normalizePatch(patch),
      skills: skills.map(normalizeSkillObservation),
      weapons: weapons.map(normalizeWeaponObservation) });
  }

  function collectNativeSnapshot(document, adapter) {
    const patch = normalizePatch(adapter.selectedPatchLabel(document));
    const skills = adapter.collectSkillSlots(document).map((slot) => adapter.observe(slot));
    const weapons = adapter.collectWeaponSlots(document).map((slot) => adapter.observeWeapon(slot));
    return { pathname: document.location.pathname, patch, skills, weapons };
  }

  function createNativeEvidenceProvider({ document = globalThis.document, adapter } = {}) {
    if (!document || !document.location || !adapter
      || typeof adapter.selectedPatchLabel !== 'function'
      || typeof adapter.collectSkillSlots !== 'function' || typeof adapter.observe !== 'function'
      || typeof adapter.collectWeaponSlots !== 'function' || typeof adapter.observeWeapon !== 'function') {
      throw new TypeError('native evidence provider dependencies are invalid');
    }
    let pinned = null;
    let pinnedPath = null;
    let pinnedPatch = null;

    function currentBytes() {
      const pathname = document.location.pathname;
      const patch = normalizePatch(adapter.selectedPatchLabel(document));
      if (pinned && (pathname !== pinnedPath || JSON.stringify(patch) !== pinnedPatch)) {
        return serializeNativeSnapshot({ pathname, patch, skills: [], weapons: [] });
      }
      if (pinned) return pinned.slice();
      return serializeNativeSnapshot(collectNativeSnapshot(document, adapter));
    }

    function equalBytes(left, right) {
      if (left.byteLength !== right.byteLength) return false;
      for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) return false;
      }
      return true;
    }

    const getNativeSnapshotBytes = function getNativeSnapshotBytes() {
      return currentBytes();
    };
    Object.defineProperty(getNativeSnapshotBytes, 'pin', {
      value(verifiedBytes) {
        if (!(verifiedBytes instanceof Uint8Array)) return false;
        if (pinned) return equalBytes(pinned, verifiedBytes);
        let fresh;
        try { fresh = collectNativeSnapshot(document, adapter); } catch (_) { return false; }
        const freshBytes = serializeNativeSnapshot(fresh);
        if (!equalBytes(freshBytes, verifiedBytes)) return false;
        pinned = freshBytes.slice();
        pinnedPath = fresh.pathname;
        pinnedPatch = JSON.stringify(fresh.patch);
        return true;
      }
    });
    return getNativeSnapshotBytes;
  }

  function stateText(state, lastClientResult) {
    if (state && state.reason && PATCH_CHANGED_EVIDENCE[state.reason]) return PATCH_CHANGED_EVIDENCE[state.reason];
    if (state && state.status === 'ready' && lastClientResult && lastClientResult.status === 'ready') {
      return lastClientResult.statusText || clientApi.getStatusText(lastClientResult);
    }
    return clientApi.getStatusText({ status: 'original', reason: state && state.reason || 'unknown-identity' });
  }

  function createControls(document) {
    const controls = document.createElement('aside');
    controls.setAttribute(OWNED_ATTRIBUTE, 'controls');
    controls.className = 'w11-extension-controls';
    controls.setAttribute('aria-label', '繁體翻譯控制');
    const actions = document.createElement('div');
    actions.className = 'w11-extension-control-actions';
    const enable = document.createElement('button');
    enable.type = 'button';
    enable.textContent = '啟用繁體';
    const original = document.createElement('button');
    original.type = 'button';
    original.textContent = '切回原文';
    const status = document.createElement('p');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('role', 'status');
    status.textContent = '正在確認本機資料…';
    actions.append(enable, original);
    controls.append(actions, status);
    (document.body || document.documentElement).append(controls);
    return { controls, enable, original, status };
  }

  function startPage(pageRoot) {
    if (!pageRoot || !pageRoot.document || !isSupportedPage(pageRoot.location)
      || !pageRoot.chrome || !pageRoot.chrome.runtime) return null;
    if (!identityApi || !clientApi || !controllerApi || !adapterApi || !presentationApi) return null;
    const document = pageRoot.document;
    const adapter = adapterApi.createDomAdapter({ document });
    const evidenceProvider = createNativeEvidenceProvider({ document, adapter });
    const registry = pageRoot.W11TestProofRegistry;
    const proofs = registry && Array.isArray(registry.proofs) ? registry.proofs : [];
    const identityResolver = identityApi.createNativeIdentityResolver({ proofs, cryptoApi: pageRoot.crypto });
    const rawClient = clientApi.createW10Client({ runtime: pageRoot.chrome.runtime });
    let lastClientResult = null;
    let controller = null;
    let currentState = { status: 'original', reason: 'unknown-identity' };
    let blessingReader = null;
    let blessingReaderSnapshot = null;
    let userEnabledIntent = true;
    const ui = createControls(document);

    function clearBlessingReader() {
      if (!blessingReader) return;
      blessingReader.dispose();
      blessingReader = null;
      blessingReaderSnapshot = null;
    }

    function syncBlessingReader(state) {
      const shouldShow = pageRoot.location.pathname === '/weapon-blessing-traits'
        && state && state.status === 'ready' && lastClientResult && lastClientResult.status === 'ready'
        && lastClientResult.snapshot;
      if (!shouldShow) {
        clearBlessingReader();
        return;
      }
      if (blessingReader && blessingReaderSnapshot === lastClientResult.snapshot) return;
      clearBlessingReader();
      let models;
      try { models = presentationApi.buildBlessingViewModels(lastClientResult.snapshot, {}); } catch (_) { models = []; }
      if (!Array.isArray(models) || models.length === 0) return;
      try {
        blessingReader = adapterApi.createDomAdapter({ document }).createBlessingReader(models);
        blessingReaderSnapshot = lastClientResult.snapshot;
        (document.body || document.documentElement).append(blessingReader.element);
      } catch (_) {
        clearBlessingReader();
      }
    }

    function renderStatus(state = currentState) {
      currentState = state;
      const text = stateText(state, lastClientResult);
      if (ui.status.textContent !== text) ui.status.textContent = text;
      ui.controls.dataset.status = state.status || 'original';
      syncBlessingReader(state);
    }

    const client = Object.freeze({
      async initialize(identity, options) {
        lastClientResult = await rawClient.initialize(identity, options);
        renderStatus(currentState);
        return lastClientResult;
      }
    });

    controller = controllerApi.createDomController({
      document,
      root: document,
      identityResolver,
      getNativeSnapshotBytes: evidenceProvider,
      client,
      adapter,
      onStatus: renderStatus
    });
    const onEnable = () => {
      userEnabledIntent = true;
      void controller.setEnabled(true);
    };
    const onOriginal = () => {
      userEnabledIntent = false;
      void controller.setEnabled(false);
    };
    const onPageHide = (event) => {
      if (event && event.persisted) {
        void controller.setEnabled(false);
        return;
      }
      dispose();
    };
    const onPageShow = (event) => {
      if (event && event.persisted && userEnabledIntent) void controller.setEnabled(true);
    };
    ui.enable.addEventListener('click', onEnable);
    ui.original.addEventListener('click', onOriginal);
    pageRoot.addEventListener('pagehide', onPageHide);
    pageRoot.addEventListener('pageshow', onPageShow);
    const startPromise = controller.start().catch(() => renderStatus({ status: 'original', reason: 'worker-unavailable' }));
    let disposed = false;

    function dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      clearBlessingReader();
      ui.enable.removeEventListener('click', onEnable);
      ui.original.removeEventListener('click', onOriginal);
      pageRoot.removeEventListener('pagehide', onPageHide);
      pageRoot.removeEventListener('pageshow', onPageShow);
      if (ui.controls.parentNode) ui.controls.parentNode.removeChild(ui.controls);
    }

    return Object.freeze({ controller, adapter, identityResolver, evidenceProvider, startPromise,
      controls: ui.controls, dispose });
  }

  return Object.freeze({ createNativeEvidenceProvider, isSupportedPage, serializeNativeSnapshot, startPage });
});
