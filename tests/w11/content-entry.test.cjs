'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNativeEvidenceProvider, isSupportedPage, serializeNativeSnapshot } = require('../../extension/shared/content-entry.js');
const { collectSkillSlots, createDomAdapter } = require('../../extension/shared/dom-adapter.js');

const GAME_ORIGIN = 'https://darktide.gameslantern.com';

function makeObservedAbilityCard(gapText = '\n') {
  const document = {
    baseURI: GAME_ORIGIN + '/',
    createTreeWalker(element) { return this.defaultView.createTreeWalker(element); },
    defaultView: {
      NodeFilter: { SHOW_TEXT: 4 },
      createTreeWalker(element) {
        let index = -1;
        return {
          currentNode: null,
          nextNode() {
            index += 1;
            if (index >= element._textNodes.length) return false;
            this.currentNode = element._textNodes[index];
            return true;
          }
        };
      }
    }
  };
  const column = { nodeType: 1, parentElement: null };
  const nameText = { nodeType: 3, nodeValue: 'Brain Rupture', parentElement: null };
  const nameElement = {
    nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: column,
    childElementCount: 0, textContent: 'Brain Rupture', _textNodes: [nameText]
  };
  nameText.parentElement = nameElement;
  const first = { nodeType: 3, nodeValue: 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.' };
  const br1 = { nodeType: 1, tagName: 'BR' };
  const gap = { nodeType: 3, nodeValue: gapText };
  const br2 = { nodeType: 1, tagName: 'BR' };
  const paragraphStart = { nodeType: 3, nodeValue: 'This is an augmented version of ' };
  const highlightedName = { nodeType: 1, tagName: 'SPAN' };
  const highlightedNameText = { nodeType: 3, nodeValue: 'Brain Burst', parentElement: highlightedName };
  highlightedName.childNodes = [highlightedNameText];
  const middle = { nodeType: 3, nodeValue: ' dealing ' };
  const highlightedParameter = { nodeType: 1, tagName: 'SPAN' };
  const highlightedParameterText = { nodeType: 3, nodeValue: '+50%', parentElement: highlightedParameter };
  highlightedParameter.childNodes = [highlightedParameterText];
  const ending = { nodeType: 3, nodeValue: ' Damage.' };
  const descriptionNodes = [first, br1, gap, br2, paragraphStart, highlightedName, middle, highlightedParameter, ending];
  br1.nextSibling = gap;
  gap.nextSibling = br2;
  const descriptionElement = {
    nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: column,
    _textNodes: [first, gap, paragraphStart, highlightedNameText, middle, highlightedParameterText, ending],
    querySelectorAll(selector) { return selector === 'br' ? [br1, br2] : []; },
    querySelector(selector) {
      if (selector === '.font-teko') return nameElement;
      if (selector === '.text-xs') return descriptionElement;
      return null;
    },
    childNodes: descriptionNodes
  };
  for (const node of descriptionNodes) if (node.nodeType === 3) node.parentElement = descriptionElement;
  const image = { nodeType: 1, tagName: 'IMG' };
  const anchor = {
    nodeType: 1, tagName: 'A', href: GAME_ORIGIN + '/abilities/brain-rupture', ownerDocument: document,
    classList: { contains(value) { return ['flex', 'items-center', 'gap-2'].includes(value); } },
    parentElement: null,
    hasAttribute() { return false; },
    closest() { return null; },
    querySelector(selector) {
      if (selector === '.font-teko') return nameElement;
      if (selector === '.text-xs') return descriptionElement;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[contenteditable]') return [];
      if (selector === 'img') return [image];
      if (selector === '.font-teko') return [nameElement];
      if (selector === '.text-xs') return [descriptionElement];
      return [];
    }
  };
  const root = {
    querySelectorAll(selector) {
      return selector === 'a.flex.items-center.gap-2' ? [anchor] : [];
    }
  };
  return { root, anchor, descriptionElement, descriptionNodes };
}

function makeObservedAbilityDetail(pathname = '/abilities/brain-rupture', gapText = '\n') {
  const document = {
    nodeType: 9,
    location: { href: GAME_ORIGIN + pathname },
    baseURI: GAME_ORIGIN + pathname,
    createElement() { return {}; },
    createTreeWalker(element) { return this.defaultView.createTreeWalker(element); },
    defaultView: {
      NodeFilter: { SHOW_TEXT: 4 },
      createTreeWalker(element) {
        let index = -1;
        return { currentNode: null, nextNode() {
          index += 1;
          if (index >= element._textNodes.length) return false;
          this.currentNode = element._textNodes[index];
          return true;
        } };
      }
    }
  };
  const container = { nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: null,
    isContentEditable: false, hasAttribute: () => false, getAttribute: () => '', closest: () => null,
    matches: (selector) => selector === 'div.shadow-md.border.max-w-sm' };
  const row = { nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: container,
    isContentEditable: false, hasAttribute: () => false, getAttribute: () => '', closest: () => null };
  const nameText = { nodeType: 3, nodeValue: 'Brain Rupture', parentElement: null };
  const name = { nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: row,
    childElementCount: 0, isContentEditable: false, hasAttribute: () => false, getAttribute: () => '',
    closest: () => null, textContent: 'Brain Rupture', _textNodes: [nameText] };
  nameText.parentElement = name;
  const first = { nodeType: 3, nodeValue: 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.' };
  const br1 = { nodeType: 1, tagName: 'BR', parentElement: null };
  const gap = { nodeType: 3, nodeValue: gapText };
  const br2 = { nodeType: 1, tagName: 'BR', parentElement: null };
  const rest = { nodeType: 3, nodeValue: 'This is an augmented version of Brain Burst dealing +50% Damage.' };
  const descriptionNodes = [first, br1, gap, br2, rest];
  br1.parentElement = br2.parentElement = row;
  br1.nextSibling = gap;
  gap.nextSibling = br2;
  for (const node of descriptionNodes) if (node.nodeType === 3) node.parentElement = null;
  const description = { nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: row,
    isContentEditable: false, hasAttribute: () => false, getAttribute: () => '', closest: () => null,
    childNodes: descriptionNodes, _textNodes: [first, gap, rest],
    querySelectorAll(selector) {
      if (selector === 'br') return [br1, br2];
      if (selector === '*') return [br1, br2];
      return [];
    },
    querySelector: () => null };
  for (const node of descriptionNodes) if (node.nodeType === 3) node.parentElement = description;
  row.querySelectorAll = (selector) => selector === 'div.text-lg' ? [name]
    : selector === 'div.font-normal.leading-5' ? [description] : [];
  row.querySelector = () => null;
  name.nextElementSibling = description;
  container.querySelectorAll = (selector) => selector === 'div.text-lg' ? [name]
    : selector === 'div.font-normal.leading-5' ? [description] : [];
  container.querySelector = () => null;
  container.childNodes = [row];
  const root = { nodeType: 9, ownerDocument: document, location: document.location,
    querySelectorAll(selector) {
      if (selector === 'a.flex.items-center.gap-2') return [];
      if (selector === '#gameslantern-tooltip, #darktide-build-editor div.fixed.max-w-sm.w-full.pointer-events-none') return [];
      if (selector === 'div.shadow-md.border.max-w-sm') return [container];
      return [];
    } };
  return { root, container, description, name, descriptionNodes, document };
}

test('UnitT10_ContentEntryAcceptsOnlyExactSupportedGamesLanternRoutes', () => {
  // Scenario: Given top-level locations on supported Games Lantern routes and lookalike URLs.
  // Purpose: Keep the local adapter limited to the observed exact HTTPS origin and route shapes.
  for (const pathname of ['/build-editor', '/abilities', '/abilities/brain-rupture',
    '/weapon-blessing-traits', '/weapons/assault-chainaxe', '/weapons/assault-chainaxe/orestes-mk-iv-assault-chainaxe']) {
    assert.equal(isSupportedPage({ origin: GAME_ORIGIN, pathname }), true, pathname);
  }
  for (const location of [
    { origin: 'https://gameslantern.com', pathname: '/abilities/brain-rupture' },
    { origin: 'https://darktide.gameslantern.com.evil', pathname: '/abilities/brain-rupture' },
    { origin: 'http://darktide.gameslantern.com', pathname: '/abilities/brain-rupture' },
    { origin: GAME_ORIGIN, pathname: '/settings' },
    { origin: GAME_ORIGIN, pathname: '/abilities/%2e%2e' },
    { origin: GAME_ORIGIN, pathname: '/weapons/one/two/three' }
  ]) assert.equal(isSupportedPage(location), false);
});

test('UnitT20_NativeEvidenceSerializesOnlyObservedPageFactsDeterministically', () => {
  // Scenario: Given only a supported path, patch consistency result, and native slot observations.
  // Purpose: Hash reproducible DOM evidence without deriving or accepting a caller-supplied game identity.
  const evidence = serializeNativeSnapshot({
    pathname: '/abilities/brain-rupture',
    patch: { status: 'absent' },
    skills: [{ structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description: 'Official description.' }],
    weapons: []
  });
  assert.equal(new TextDecoder().decode(evidence), JSON.stringify({
    schemaVersion: 'w11-native-dom-evidence/1',
    pathname: '/abilities/brain-rupture',
    patch: { status: 'absent' },
    skills: [{ structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description: 'Official description.' }],
    weapons: []
  }));
  assert.throws(() => serializeNativeSnapshot({
    pathname: '/abilities/brain-rupture', patch: { status: 'absent' }, skills: [], weapons: [],
    identity: { gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2' }
  }), /exact|unexpected/i);
});

test('UnitT30_EvidenceProviderWaitsForNativeSlotsThenPinsVerifiedPreWriteFacts', () => {
  // Scenario: Given an abilities page whose game card arrives after document_idle.
  // Purpose: Allow late native facts to resolve once, then retain the verified pre-write digest while rejecting patch or route changes.
  const document = { location: { pathname: '/abilities/brain-rupture' } };
  let patch = { status: 'absent' };
  let observation = { structure: 'gameslantern-ability-card-v1', name: 'Brain Rupture', description: 'Original description.' };
  let slots = [];
  const adapter = {
    selectedPatchLabel: () => patch,
    collectSkillSlots: () => slots,
    observe: () => observation,
    collectWeaponSlots: () => [],
    observeWeapon: () => null
  };
  const getBytes = createNativeEvidenceProvider({ document, adapter });
  const empty = getBytes();
  slots = [{}];
  const initial = getBytes();
  assert.notDeepEqual(initial, empty, 'late native cards must be considered before a proof is pinned');
  assert.equal(getBytes.pin(initial), true, 'verified evidence can be pinned immediately before client initialization');
  observation = { ...observation, description: 'Extension translation.' };
  assert.deepEqual(getBytes(), initial, 'later scans must retain pre-write evidence for this document');
  assert.equal(getBytes.pin(initial), true, 'pinning the same verified document evidence is idempotent');
  patch = { status: 'selected', label: 'Old' };
  assert.notDeepEqual(getBytes(), initial, 'a changed native patch must stop matching the original local proof');
  patch = { status: 'absent' };
  document.location.pathname = '/weapons/other/other';
  assert.notDeepEqual(getBytes(), initial, 'a changed SPA route must stop matching the original local proof');
});

test('UnitT40_AbilityCardCollectorAcceptsObservedWhitespaceBetweenParagraphBreaks', () => {
  // Scenario: Given the Root-observed two-paragraph ability card markup with a whitespace-only text node between its BR elements.
  // Purpose: Accept ordinary HTML formatting whitespace while retaining the exact paragraph boundary for reversible writing.
  const fixture = makeObservedAbilityCard('\n');

  const slots = collectSkillSlots(fixture.root);

  assert.equal(slots.length, 1, 'the observed native card must be collected despite whitespace between BR elements');
  assert.equal(slots[0].anchor, fixture.anchor);
  assert.equal(slots[0].descriptionElement.childNodes, fixture.descriptionNodes,
    'collection must retain the observed native text and span nodes');
});

test('UnitT50_AbilityCardCollectorRejectsNonWhitespaceBetweenParagraphBreaks', () => {
  // Scenario: Given an otherwise known ability card whose two BR elements have intervening non-whitespace text.
  // Purpose: Keep malformed or unfamiliar markup fail-closed instead of treating arbitrary text as layout whitespace.
  const fixture = makeObservedAbilityCard('unexpected text');

  const slots = collectSkillSlots(fixture.root);

  assert.equal(slots.length, 0);
});

test('UnitT60_AbilityDetailCollectorRequiresTheObservedExactRouteAndCardShape', () => {
  // Scenario: Given the observed Brain Rupture detail-page card with formatting whitespace between its two BR nodes.
  // Purpose: Collect only the unique official ability detail card on its exact supported route, without scanning generic prose.
  const fixture = makeObservedAbilityDetail();
  const adapter = createDomAdapter({ document: fixture.document });
  const slots = collectSkillSlots(fixture.root);

  assert.equal(slots.length, 1);
  assert.equal(slots[0].anchor, fixture.container);
  assert.equal(adapter.observe(slots[0]).structure, 'gameslantern-ability-detail-v1');
  assert.equal(adapter.observe(slots[0]).name, 'Brain Rupture');
  assert.equal(adapter.observe(slots[0]).description, 'Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.\n\n\nThis is an augmented version of Brain Burst dealing +50% Damage.');

  const wrongRoute = makeObservedAbilityDetail('/guides/brain-rupture');
  assert.equal(collectSkillSlots(wrongRoute.root).length, 0);
  const malformed = makeObservedAbilityDetail('/abilities/brain-rupture', 'unexpected prose');
  assert.equal(collectSkillSlots(malformed.root).length, 0);
});
