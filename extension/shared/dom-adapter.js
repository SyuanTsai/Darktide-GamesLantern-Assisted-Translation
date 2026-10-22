(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(commonJs ? require('./presentation.js') : root.W11Presentation);
  if (commonJs) module.exports = api;
  root.W11DomAdapter = api;
})(typeof globalThis === 'object' ? globalThis : this, function (presentationApi) {
  'use strict';

  const OWNED_ATTRIBUTE = 'data-w11-owned';
  const SECTION_LABELS = Object.freeze({
    effects: '效果',
    conditions: '條件',
    calculation: '計算',
    notes: '補充說明',
    extra: '額外說明'
  });

  function nodeText(element) {
    let output = '';
    function visit(node) {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) output += child.nodeValue;
        else if (child.nodeType === 1 && child.tagName === 'BR') output += '\n';
        else visit(child);
      }
    }
    visit(element);
    return output;
  }

  function textNodes(element) {
    const view = element.ownerDocument.defaultView;
    const walker = element.ownerDocument.createTreeWalker(element, view.NodeFilter.SHOW_TEXT);
    const result = [];
    while (walker.nextNode()) result.push(walker.currentNode);
    return result;
  }

  function protectedElement(element) {
    return !!(element && element.closest && element.closest(
      'input, textarea, select, option, [contenteditable="true"], .ck-content, .ck-editor, '
      + '#darktide-build-editor, #description, #guide, #guide-content, .build-guide, .darktide-description, '
      + '.guide-content, .article, article, [data-w11-protected="true"]'
    ));
  }

  function hasSupportedAbilityRoute(anchor) {
    const href = anchor && anchor.href;
    if (typeof href !== 'string' || !href) return false;
    try {
      const url = new URL(href, anchor.ownerDocument.baseURI);
      return url.protocol === 'https:' && url.hostname === 'darktide.gameslantern.com'
        && !url.port && !url.username && !url.password
        && /^\/abilities\/[a-z0-9-]+\/?$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function hasKnownAbilityShape(anchor) {
    if (!anchor || anchor.tagName !== 'A' || !anchor.classList.contains('flex')
      || !anchor.classList.contains('items-center') || !anchor.classList.contains('gap-2')
      || !hasSupportedAbilityRoute(anchor)) return false;
    if (anchor.querySelector('a, button, input, textarea, select, [contenteditable="true"]')) return false;
    const images = anchor.querySelectorAll('img');
    const names = anchor.querySelectorAll('.font-teko');
    const descriptions = anchor.querySelectorAll('.text-xs');
    return images.length === 1 && names.length === 1 && descriptions.length === 1
      && names[0].tagName === 'DIV' && descriptions[0].tagName === 'DIV'
      && names[0].parentElement === descriptions[0].parentElement;
  }

  function collectSkillSlots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const slots = [];
    for (const anchor of root.querySelectorAll('a.flex.items-center.gap-2')) {
      if (protectedElement(anchor) || !hasKnownAbilityShape(anchor)) continue;
      const nameElement = anchor.querySelector('.font-teko');
      const descriptionElement = anchor.querySelector('.text-xs');
      if (textNodes(nameElement).length !== 1 || nameElement.childElementCount !== 0) continue;
      const breaks = [...descriptionElement.querySelectorAll('br')];
      if (breaks.length !== 2 || breaks[0].nextSibling !== breaks[1]) continue;
      if (descriptionElement.querySelector('script, style, iframe, object, embed, template')) continue;
      slots.push(Object.freeze({ anchor, nameElement, descriptionElement }));
    }
    return slots;
  }

  function inspectPatchSelection(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return Object.freeze({ status: 'absent', region: null });
    const editor = root.matches && root.matches('#darktide-build-editor')
      ? root : root.querySelector('#darktide-build-editor');
    if (!editor) return Object.freeze({ status: 'absent', region: null });
    const headings = [...editor.querySelectorAll('h2')]
      .filter((heading) => heading.textContent.replace(/\s+/g, ' ').trim() === 'Talent Tree Patch');
    if (headings.length === 0) return Object.freeze({ status: 'absent', region: null });
    if (headings.length !== 1) return Object.freeze({ status: 'ambiguous', region: editor });
    const heading = headings[0];
    let selected = [];
    const candidateRegions = [heading.parentElement, heading.nextElementSibling,
      heading.parentElement && heading.parentElement.nextElementSibling]
      .filter((region, index, regions) => region && region !== editor && editor.contains(region)
        && regions.indexOf(region) === index);
    for (const region of candidateRegions) {
      selected = [...(region.tagName === 'BUTTON' ? [region] : []), ...region.querySelectorAll('button')]
        .filter((button) => button.classList.contains('bg-primary/20'));
      if (selected.length) return selected.length === 1
        ? Object.freeze({ status: 'selected', label: [...selected[0].childNodes]
          .filter((node) => node.nodeType === 3).map((node) => node.nodeValue)
          .join(' ').replace(/\s+/g, ' ').trim(), region })
        : Object.freeze({ status: 'ambiguous', region });
    }
    return Object.freeze({ status: 'ambiguous', region: candidateRegions[0] || null });
  }

  function readSelectedPatchLabel(root) {
    const result = inspectPatchSelection(root);
    if (result.status === 'selected' && !result.label) return Object.freeze({ status: 'ambiguous' });
    return result.status === 'selected'
      ? Object.freeze({ status: 'selected', label: result.label })
      : Object.freeze({ status: result.status });
  }

  function patchSelectionRegion(root) {
    return inspectPatchSelection(root).region;
  }

  function paragraphGroups(element) {
    const tokens = [];
    function visit(node) {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) tokens.push(child);
        else if (child.nodeType === 1 && child.tagName === 'BR') tokens.push(null);
        else visit(child);
      }
    }
    visit(element);
    const groups = [];
    let group = [];
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== null) {
        group.push(tokens[index]);
        continue;
      }
      if (tokens[index + 1] === null) index += 1;
      groups.push(group);
      group = [];
    }
    groups.push(group);
    return groups;
  }

  function planParagraphWrites(nodes, target, parameterValues) {
    if (!nodes.length) return null;
    const pins = [];
    for (const node of nodes) {
      const value = node.nodeValue.trim();
      if (parameterValues.includes(value)) pins.push({ node, value, index: nodes.indexOf(node) });
    }
    if (pins.length === 0) return [{ node: nodes[0], value: target }, ...nodes.slice(1).map((node) => ({ node, value: '' }))];

    const writes = [];
    let targetOffset = 0;
    let nodeOffset = 0;
    for (const pin of pins) {
      const occurrence = target.indexOf(pin.value, targetOffset);
      if (occurrence < 0 || target.indexOf(pin.value, occurrence + pin.value.length) >= 0) return null;
      const between = nodes.slice(nodeOffset, pin.index);
      const prefix = target.slice(targetOffset, occurrence);
      if (prefix && between.length === 0) return null;
      if (between.length) {
        writes.push({ node: between[0], value: prefix });
        for (const emptyNode of between.slice(1)) writes.push({ node: emptyNode, value: '' });
      }
      if (pin.node.nodeValue !== target.slice(occurrence, occurrence + pin.value.length)) return null;
      writes.push({ node: pin.node, value: pin.value });
      nodeOffset = pin.index + 1;
      targetOffset = occurrence + pin.value.length;
    }
    const trailing = nodes.slice(nodeOffset);
    const suffix = target.slice(targetOffset);
    if (suffix && trailing.length === 0) return null;
    if (trailing.length) {
      writes.push({ node: trailing[0], value: suffix });
      for (const emptyNode of trailing.slice(1)) writes.push({ node: emptyNode, value: '' });
    }
    return writes;
  }

  function makeDetails(document, model) {
    const sections = model.detailSections.filter((section) => SECTION_LABELS[section.sectionId]
      && section.items.some((item) => typeof item === 'string' && item.trim()));
    const hasErrata = model.errata.some((row) => typeof row === 'string' && row.trim());
    const hasTerms = model.terms.some((row) => row && typeof row.text === 'string' && row.text.trim());
    if (sections.length === 0 && !hasErrata && !hasTerms) return null;

    const panel = document.createElement('div');
    panel.setAttribute(OWNED_ATTRIBUTE, 'details');
    panel.className = 'w11-extension-panel';
    if (hasErrata) {
      const section = document.createElement('section');
      section.className = 'w11-extension-errata';
      const heading = document.createElement('h4');
      heading.textContent = '勘誤';
      section.append(heading);
      const list = document.createElement('ul');
      for (const value of model.errata) {
        if (typeof value !== 'string' || !value.trim()) continue;
        const item = document.createElement('li');
        item.textContent = value;
        list.append(item);
      }
      section.append(list);
      panel.append(section);
    }
    if (sections.length || hasTerms) {
      const details = document.createElement('details');
      details.className = 'w11-extension-details';
      const summary = document.createElement('summary');
      summary.textContent = '詳細說明';
      details.append(summary);
      for (const section of sections) {
        const wrapper = document.createElement('section');
        wrapper.className = 'w11-extension-section';
        const heading = document.createElement('h4');
        heading.textContent = SECTION_LABELS[section.sectionId];
        wrapper.append(heading);
        const list = document.createElement('ul');
        for (const value of section.items) {
          if (typeof value !== 'string' || !value.trim()) continue;
          const item = document.createElement('li');
          item.textContent = value;
          list.append(item);
        }
        wrapper.append(list);
        details.append(wrapper);
      }
      if (hasTerms) {
        const section = document.createElement('section');
        section.className = 'w11-extension-terms';
        const heading = document.createElement('h4');
        heading.textContent = '術語';
        section.append(heading);
        const list = document.createElement('ul');
        for (const term of model.terms) {
          if (!term || typeof term.text !== 'string' || !term.text.trim()) continue;
          const item = document.createElement('li');
          item.textContent = term.text;
          list.append(item);
        }
        section.append(list);
        details.append(section);
      }
      panel.append(details);
    }
    return panel;
  }

  function createDomAdapter({ document = globalThis.document } = {}) {
    if (!document || typeof document.createElement !== 'function') throw new TypeError('a DOM document is required');

    function observe(slot) {
      return Object.freeze({
        structure: 'gameslantern-ability-card-v1',
        name: slot.nameElement.textContent,
        description: nodeText(slot.descriptionElement)
      });
    }

    function applySkill(slot, model) {
      if (!slot || !model || protectedElement(slot.anchor)
        || !presentationApi.matchesSkillObservation(model, observe(slot))) return null;
      if (slot.anchor.parentElement.querySelector(':scope > [' + OWNED_ATTRIBUTE + '="details"]')) return null;
      const targetParagraphs = model.translatedDescription.split('\n\n');
      const groups = paragraphGroups(slot.descriptionElement);
      if (targetParagraphs.length !== groups.length) return null;
      const writes = [];
      const titleNode = textNodes(slot.nameElement)[0];
      writes.push({ node: titleNode, value: model.translatedName });
      const parameterValues = Object.values(model.translationParams).filter((value) => typeof value === 'string' && value.trim());
      for (let index = 0; index < groups.length; index += 1) {
        const groupWrites = planParagraphWrites(groups[index], targetParagraphs[index], parameterValues);
        if (!groupWrites) return null;
        writes.push(...groupWrites);
      }
      const changes = [];
      for (const row of writes) {
        if (row.node.nodeValue === row.value) continue;
        changes.push({ node: row.node, originalValue: row.node.nodeValue, writtenValue: row.value });
      }
      const details = makeDetails(document, model);
      if (!changes.length && !details) return null;
      for (const change of changes) change.node.nodeValue = change.writtenValue;
      if (details) slot.anchor.parentNode.insertBefore(details, slot.anchor.nextSibling);
      return { anchor: slot.anchor, changes, details };
    }

    function restore(record) {
      if (!record) return;
      for (const change of record.changes) {
        if (change.node.isConnected && change.node.nodeValue === change.writtenValue) {
          change.node.nodeValue = change.originalValue;
        }
      }
      if (record.details && record.details.parentNode) record.details.parentNode.removeChild(record.details);
    }

    function selectedPatchLabel(root = document) {
      return readSelectedPatchLabel(root);
    }

    return Object.freeze({ applySkill, collectSkillSlots, observe, restore, selectedPatchLabel,
      patchSelectionRegion: (root = document) => patchSelectionRegion(root) });
  }

  return Object.freeze({ createDomAdapter, collectSkillSlots, readSelectedPatchLabel, patchSelectionRegion });
});
