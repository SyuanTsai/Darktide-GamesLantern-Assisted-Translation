(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./native-identity.js') : root.W11NativeIdentity,
    commonJs ? require('./presentation.js') : root.W11Presentation,
    commonJs ? require('./dom-adapter.js') : root.W11DomAdapter
  );
  if (commonJs) module.exports = api;
  root.W11DomController = api;
})(typeof globalThis === 'object' ? globalThis : this, function (identityApi, presentationApi, adapterApi) {
  'use strict';

  function sameIdentity(left, right) {
    return !!left && !!right && left.gameVersion === right.gameVersion
      && left.gameReleaseId === right.gameReleaseId
      && (left.snapshotId === undefined ? null : left.snapshotId)
        === (right.snapshotId === undefined ? null : right.snapshotId);
  }

  function copyIdentity(value) {
    return value ? Object.freeze({
      gameVersion: value.gameVersion,
      gameReleaseId: value.gameReleaseId,
      ...(value.snapshotId === undefined ? {} : { snapshotId: value.snapshotId })
    }) : null;
  }

  function isOwnedChange(record) {
    if (record.type === 'characterData') {
      return !!(record.target.parentElement && record.target.parentElement.closest('[data-w11-owned]'));
    }
    if (record.type !== 'childList') return false;
    const changed = [...record.addedNodes, ...record.removedNodes];
    return changed.length > 0 && changed.every((node) => node.nodeType === 1
      ? node.hasAttribute('data-w11-owned') || !!node.closest('[data-w11-owned]')
      : node.parentElement && node.parentElement.closest('[data-w11-owned]'));
  }

  function createDomController({ document = globalThis.document, root = document, identityResolver,
    getNativeSnapshotBytes = () => null, client, adapter, buildViewModels = presentationApi.buildSkillViewModels,
    onStatus = () => {} } = {}) {
    if (!document || !root || typeof root.querySelectorAll !== 'function') throw new TypeError('a document and scan root are required');
    if (!identityResolver || typeof identityResolver.resolve !== 'function') throw new TypeError('a native identity resolver is required');
    if (!client || typeof client.initialize !== 'function') throw new TypeError('a W10 document-pinned client is required');
    if (typeof getNativeSnapshotBytes !== 'function' || typeof buildViewModels !== 'function' || typeof onStatus !== 'function') {
      throw new TypeError('DOM controller dependencies are invalid');
    }
    const dom = adapter || adapterApi.createDomAdapter({ document });
    const view = document.defaultView;
    const records = new Map();
    let currentIdentity = null;
    let pinnedSnapshot = null;
    let models = [];
    let observer = null;
    let patchObserver = null;
    let observedPatchRegion = null;
    let scanPromise = null;
    let scanAgain = false;
    let enabled = true;
    let disposed = false;
    let stopped = false;
    let monitoring = false;
    let lifecycleGeneration = 0;
    let state = { status: 'original', reason: 'unknown-identity', identity: null };

    function setState(status, reason, identity = currentIdentity) {
      state = { status, reason: reason || null, identity: copyIdentity(identity) };
      try { onStatus(Object.freeze({ ...state })); } catch (_) { /* UI status listeners are optional. */ }
    }

    function restoreAll() {
      for (const [anchor, record] of records) {
        dom.restore(record);
        records.delete(anchor);
      }
    }

    function detachMonitoring() {
      if (!monitoring) return;
      if (observer) observer.disconnect();
      observer = null;
      if (patchObserver) patchObserver.disconnect();
      patchObserver = null;
      observedPatchRegion = null;
      if (view) {
        view.removeEventListener('popstate', onRouteChange);
        view.removeEventListener('hashchange', onRouteChange);
        view.removeEventListener('pageshow', onRouteChange);
      }
      monitoring = false;
    }

    function refreshPatchObserver() {
      if (!monitoring || !view || typeof view.MutationObserver !== 'function'
        || typeof dom.patchSelectionRegion !== 'function') return;
      const target = dom.patchSelectionRegion(document);
      if (target === observedPatchRegion) return;
      if (patchObserver) patchObserver.disconnect();
      patchObserver = null;
      observedPatchRegion = target || null;
      if (!target) return;
      patchObserver = new view.MutationObserver(() => { void scan(); });
      patchObserver.observe(target, { attributes: true, attributeFilter: ['class'], subtree: true });
    }

    function attachMonitoring() {
      if (monitoring || disposed || !enabled || stopped) return;
      if (view && typeof view.MutationObserver === 'function') {
        observer = new view.MutationObserver((mutations) => {
          if (mutations.some((mutation) => !isOwnedChange(mutation))) {
            refreshPatchObserver();
            void scan();
          }
        });
        observer.observe(root, { childList: true, characterData: true, subtree: true });
      }
      if (view) {
        view.addEventListener('popstate', onRouteChange);
        view.addEventListener('hashchange', onRouteChange);
        view.addEventListener('pageshow', onRouteChange);
      }
      monitoring = true;
      refreshPatchObserver();
    }

    function canContinue(generation) {
      return !disposed && enabled && !stopped && generation === lifecycleGeneration;
    }

    function patchSelectionFailure(proof) {
      const patch = dom.selectedPatchLabel(document);
      if (patch.status === 'ambiguous') return 'patch-selection-ambiguous';
      if (patch.status === 'selected' && (!proof.patchLabel || patch.label !== proof.patchLabel)) {
        return 'patch-selection-changed';
      }
      return null;
    }

    function stopWithReason(reason) {
      lifecycleGeneration += 1;
      detachMonitoring();
      restoreAll();
      pinnedSnapshot = null;
      models = [];
      stopped = true;
      setState('original', reason, currentIdentity);
    }

    function reconcileRecords(slots) {
      const slotAnchors = new Set(slots.map((slot) => slot.anchor));
      for (const [anchor, record] of records) {
        if (!slotAnchors.has(anchor) || record.changes.some((change) =>
          !change.node.isConnected || change.node.nodeValue !== change.writtenValue)) {
          dom.restore(record);
          records.delete(anchor);
        }
      }
    }

    async function performScan() {
      if (disposed || !enabled || stopped) return;
      const generation = lifecycleGeneration;
      let evidence;
      let proof;
      try {
        evidence = await getNativeSnapshotBytes();
        if (!canContinue(generation)) return;
        if (!evidence) {
          if (currentIdentity) stopWithReason('identity-changed');
          else setState('original', 'unknown-identity', null);
          return;
        }
        proof = await identityResolver.resolve(evidence);
        if (!canContinue(generation)) return;
      } catch (_) {
        if (!canContinue(generation)) return;
        if (currentIdentity) stopWithReason('identity-changed');
        else setState('original', 'unknown-identity', null);
        return;
      }
      if (!proof || proof.status !== 'verified' || !proof.identity) {
        if (currentIdentity) stopWithReason('identity-changed');
        else setState('original', 'unknown-identity', null);
        return;
      }

      const selectionFailure = patchSelectionFailure(proof);
      if (selectionFailure) {
        stopWithReason(selectionFailure);
        return;
      }
      if (currentIdentity && !sameIdentity(currentIdentity, proof.identity)) {
        stopWithReason('identity-changed');
        return;
      }
      if (!currentIdentity) currentIdentity = copyIdentity(proof.identity);

      if (!pinnedSnapshot) {
        let result;
        try { result = await client.initialize(currentIdentity); } catch (_) { result = null; }
        if (!canContinue(generation)) return;
        const currentSelectionFailure = patchSelectionFailure(proof);
        if (currentSelectionFailure) {
          stopWithReason(currentSelectionFailure);
          return;
        }
        if (!result || result.status !== 'ready' || !result.snapshot
          || (result.identity && !sameIdentity(result.identity, currentIdentity))) {
          stopWithReason('no-compatible-data');
          return;
        }
        pinnedSnapshot = result.snapshot;
        try { models = buildViewModels(pinnedSnapshot); } catch (_) { models = []; }
        if (!Array.isArray(models)) models = [];
      }

      const slots = dom.collectSkillSlots(root);
      reconcileRecords(slots);
      for (const slot of slots) {
        if (records.has(slot.anchor)) continue;
        const observation = dom.observe(slot);
        const matches = models.filter((model) => presentationApi.matchesSkillObservation(model, observation));
        if (matches.length !== 1) continue;
        const record = dom.applySkill(slot, matches[0]);
        if (record) records.set(slot.anchor, record);
      }
      setState(models.length ? 'ready' : 'original', models.length ? null : 'no-matching-presentation', currentIdentity);
    }

    function scan() {
      if (scanPromise) {
        scanAgain = true;
        return scanPromise;
      }
      scanPromise = (async () => {
        do {
          scanAgain = false;
          await performScan();
        } while (scanAgain && !disposed && enabled && !stopped);
      })().finally(() => { scanPromise = null; });
      return scanPromise;
    }

    function onRouteChange() { void scan(); }

    function start() {
      if (disposed) throw new Error('DOM controller has been disposed');
      attachMonitoring();
      return scan();
    }

    function setEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('enabled state must be boolean');
      if (disposed) return Promise.resolve();
      enabled = value;
      if (!enabled) {
        lifecycleGeneration += 1;
        detachMonitoring();
        restoreAll();
        setState('original', 'disabled', currentIdentity);
        return Promise.resolve();
      }
      attachMonitoring();
      if (stopped) return Promise.resolve();
      return scan();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      lifecycleGeneration += 1;
      detachMonitoring();
      restoreAll();
      pinnedSnapshot = null;
      models = [];
      setState('original', 'disposed', currentIdentity);
    }

    return Object.freeze({ start, scan, setEnabled, dispose,
      getState: () => Object.freeze({ ...state, identity: copyIdentity(state.identity) }) });
  }

  return Object.freeze({ createDomController });
});
