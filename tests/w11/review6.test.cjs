const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot, displayFixture } = require('../helpers/source-data-display.cjs');
const { createDocument, descendants } = require('../helpers/display-dom.cjs');
const { createDomAdapter } = require('../../extension/shared/dom-adapter.js');
const { createDomController } = require('../../extension/shared/dom-controller.js');

function fixture(field = 'name', tooltip = false, observed = false) {
  const data = displayFixture(), text = field === 'name' ? '範例' : '中文';
  data.skills.items[0].errata = [{ locale: 'zh', official: text, corrected: '修正', valueRef: '/values/params/bonus', anchor: { field, locale: 'zh', text, occurrence: 1 } }];
  const s = snapshot(data), document = createDocument();
  document.nodeType = 9; document.location = { href: 'https://darktide.gameslantern.com/abilities/example', pathname: '/abilities/example' };
  document.defaultView.addEventListener = () => {}; document.defaultView.removeEventListener = () => {};
  const container = document.createElement('div'), name = document.createElement('div'), description = document.createElement('div');
  container.id = tooltip ? 'gameslantern-tooltip' : ''; container.matches = selector => !tooltip && selector === 'div.shadow-md.border.max-w-sm';
  name.textContent = 'Example';
  for (const [i, part] of data.skills.items[0].official.en.split('\n\n').entries()) { if (i) description.append(document.createElement('br'), document.createElement('br')); description.append(document.createTextNode(part)); }
  container.append(name, description); Object.defineProperty(name, 'nextElementSibling', { get: () => description });
  container.querySelectorAll = selector => selector === 'div.text-lg' ? [name] : (selector === 'div.font-normal.leading-5' || selector === 'div.font-normal') ? [description] : [];
  name.querySelectorAll = selector => selector === '*' ? descendants(name, n => n.nodeType === 1) : [];
  description.querySelectorAll = selector => selector === 'br' ? descendants(description, n => n.tagName === 'BR') : selector === '*' ? descendants(description, n => n.nodeType === 1) : [];
  document.querySelectorAll = selector => (tooltip && selector.startsWith('#gameslantern-tooltip')) || (!tooltip && selector === 'div.shadow-md.border.max-w-sm') ? [container] : [];
  const observers = [];
  if (observed) {
    document.defaultView.MutationObserver = class {
      constructor(callback) { this.callback = callback; this.records = []; this.queued = false; observers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; this.records = []; }
      takeRecords() { return this.records.splice(0); }
      enqueue(record) { if (!this.active) return; this.records.push(record); if (!this.queued) { this.queued = true; queueMicrotask(() => { this.queued = false; const records = this.takeRecords(); if (records.length && this.active) this.callback(records); }); } }
    };
    const proto = Object.getPrototypeOf(name), append = proto.append, insertBefore = proto.insertBefore;
    proto.append = function (...nodes) { append.apply(this, nodes); for (const node of nodes) for (const o of observers) o.enqueue({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] }); };
    proto.insertBefore = function (node, next) { if (!next) return this.append(node); insertBefore.call(this, node, next); for (const o of observers) o.enqueue({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] }); };
  }
  const actual = createDomAdapter({ document }), adapter = { ...actual, collectWeaponSlots: () => [], patchSelectionRegion: () => null, selectedPatchLabel: () => ({ status: 'absent' }) };
  const controller = createDomController({ document, adapter, getNativeSnapshotBytes: () => new Uint8Array([1]), identityResolver: { resolve: async () => ({ status: 'verified', identity: s.identity }) }, client: { initialize: async () => ({ status: 'ready', snapshot: s, identity: s.identity }) } });
  return { document, container, name, controller, marks: () => descendants(container, n => n.tagName === 'MARK') };
}

// Scenario: a later site observer changes the name immediately after either correction is inserted. Purpose: preserve late scan requests without a manual scan or self-mutation loop.
test('InterT10_原站微任務變更在掃描結束後仍自動還原', async () => {
  for (const field of ['name', 'official']) {
    const h = fixture(field, false, true); let changed = false;
    const starting = h.controller.start();
    const site = new h.document.defaultView.MutationObserver(() => { if (!changed && h.marks().length) { changed = true; h.name.append(h.document.createElement('em')); } });
    site.observe(h.container, { childList: true, subtree: true });
    await starting; await new Promise(resolve => setImmediate(resolve));
    assert.equal(changed, true, field); assert.equal(h.controller.getState().status, 'original', field); assert.equal(h.marks().length, 0, field);
    site.disconnect(); h.controller.dispose();
  }
});

// Scenario: the site inserts or wraps a node inside an extension mark. Purpose: reject non-owned descendants even when their ancestor is owned.
test('InterT20_巢狀原站節點使名稱結構失效', async () => {
  for (const kind of ['input', 'empty-em', 'wrapped-text', 'tooltip']) {
    const h = fixture('name', kind === 'tooltip'); await h.controller.start();
    assert.equal(h.marks().length, 1, kind); const mark = h.marks()[0];
    if (kind === 'wrapped-text') { const text = mark.childNodes[0]; mark.removeChild(text); const em = h.document.createElement('em'); em.append(text); mark.append(em); }
    else mark.append(h.document.createElement(kind === 'input' ? 'input' : 'em'));
    await h.controller.scan(); assert.equal(h.controller.getState().status, 'original', kind); assert.equal(h.marks().length, 0, kind); h.controller.dispose();
  }
});
