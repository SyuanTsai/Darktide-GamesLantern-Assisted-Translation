(function (root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(commonJs ? require('./presentation.js') : root.W11Presentation);
  if (commonJs) module.exports = api;
  root.W11DomAdapter = api;
})(typeof globalThis === 'object' ? globalThis : this, function (presentationApi) {
  'use strict';

  // 來源：DarkTide-Web web/shared-render.mjs，origin/main 818f2cd2a6acd3962b6291c93e07b49dda05a4fe。
  const UNIT_LABELS = Object.freeze({
    percent: '%', ratio: '比例', seconds: '秒', s: '秒', count: '次', meters: '公尺',
    point: '點', 'dodge-count': '次閃避', 'stamina-point': '耐力點',
    'stamina-point-per-second': '耐力點／秒', 'normalized-speed-per-second': '標準化速度／秒', 'instance-count': '彈藥單位',
    'attack-power-point': '攻擊威力點', 'cleave-power-point': '鋸擊威力點',
  });

  function valueWithUnit(value, unit) {
    return String(value) + (unit && value !== '原始碼未公開' ? ' ' + (Object.hasOwn(UNIT_LABELS, unit) ? UNIT_LABELS[unit] : unit) : '');
  }

  const OWNED_ATTRIBUTE = 'data-w11-owned';
  const SECTION_LABELS = Object.freeze({
    effect: '效果',
    conditions: '條件',
    calculation: '計算',
    notes: '補充',
    extra: '額外'
  });
  function nodeText(element, overrides = null) {
    let output = '';
    function visit(node) {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) output += overrides && overrides.has(child) ? overrides.get(child) : child.nodeValue;
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

  function restoredText(element, record) {
    const overrides = new Map((record && Array.isArray(record.changes) ? record.changes : [])
      .map((change) => [change.node, change.originalValue]));
    return textNodes(element).map((node) => overrides.has(node) ? overrides.get(node) : node.nodeValue).join('');
  }

  function recordOverrides(record) {
    return new Map((record && Array.isArray(record.changes) ? record.changes : [])
      .map((change) => [change.node, change.originalValue]));
  }

  function skillIdentityKey(anchor, document, detail) {
    const images = anchor && anchor.querySelectorAll ? [...anchor.querySelectorAll('img')] : [];
    const image = images.length === 1 ? images[0] : null;
    return JSON.stringify([detail ? 'detail' : 'ability', document && document.location && document.location.pathname || '',
      anchor && typeof anchor.href === 'string' ? anchor.href : '',
      image ? image.currentSrc || image.src || '' : '', image ? image.alt || '' : '']);
  }

  function isEditableElement(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.isContentEditable === true) return true;
      if (current.hasAttribute && current.hasAttribute('contenteditable')) {
        const value = current.getAttribute('contenteditable').trim().toLowerCase();
        if (value === 'false') return false;
        if (value === '' || value === 'true' || value === 'plaintext-only') return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function protectedElement(element) {
    return isEditableElement(element) || !!(element && element.closest && element.closest(
      'input, textarea, select, option, .ck-content, .ck-editor, '
      + '#description, #guide, #guide-content, .build-guide, .darktide-description, '
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

  function abilityDetailDocument(document) {
    if (!document || !document.location || typeof document.location.href !== 'string') return false;
    try {
      const url = new URL(document.location.href);
      return url.protocol === 'https:' && url.hostname === 'darktide.gameslantern.com'
        && !url.port && !url.username && !url.password && !url.search && !url.hash
        && /^\/abilities\/[a-z0-9-]+\/?$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function observedParagraphBreaks(element) {
    const breaks = [...element.querySelectorAll('br')];
    if (breaks.length !== 2 || breaks[0].parentElement !== breaks[1].parentElement) return false;
    let node = breaks[0].nextSibling;
    while (node && node !== breaks[1]) {
      if (node.nodeType !== 3 || !/^\s*$/.test(node.nodeValue || '')) return false;
      node = node.nextSibling;
    }
    return node === breaks[1];
  }

  function hasKnownAbilityShape(anchor) {
    if (!anchor || anchor.tagName !== 'A' || !anchor.classList.contains('flex')
      || !anchor.classList.contains('items-center') || !anchor.classList.contains('gap-2')
      || !hasSupportedAbilityRoute(anchor)) return false;
    if (anchor.querySelector('a, button, input, textarea, select')) return false;
    if ([...anchor.querySelectorAll('[contenteditable]')].some(isEditableElement)) return false;
    const images = anchor.querySelectorAll('img');
    const names = anchor.querySelectorAll('.font-teko');
    const descriptions = anchor.querySelectorAll('.text-xs');
    return images.length === 1 && names.length === 1 && descriptions.length === 1
      && names[0].tagName === 'DIV' && descriptions[0].tagName === 'DIV'
      && names[0].parentElement === descriptions[0].parentElement;
  }

  function hasKnownAbilityTooltipShape(tooltip) {
    if (!tooltip || protectedElement(tooltip)) return null;
    const isBuildTooltip = tooltip.matches('div.fixed.max-w-sm.w-full.pointer-events-none')
      && !!tooltip.closest('#darktide-build-editor');
    const isGlobalTooltip = tooltip.id === 'gameslantern-tooltip';
    if (!isBuildTooltip && !isGlobalTooltip) return null;
    const names = tooltip.querySelectorAll('div.text-lg');
    const descriptions = tooltip.querySelectorAll('div.font-normal');
    if (names.length !== 1 || descriptions.length !== 1 || names[0].nextElementSibling !== descriptions[0]
      || names[0].parentElement !== descriptions[0].parentElement
      || protectedElement(names[0]) || protectedElement(descriptions[0])
      || textNodes(names[0]).length !== 1 || names[0].childElementCount !== 0
      || descriptions[0].querySelector('script, style, iframe, object, embed, template')
      || !observedParagraphBreaks(descriptions[0])) return null;
    return { nameElement: names[0], descriptionElement: descriptions[0], tooltip: true };
  }

  function hasKnownAbilityDetailShape(container) {
    if (!container || protectedElement(container) || !container.matches('div.shadow-md.border.max-w-sm')) return null;
    const names = container.querySelectorAll('div.text-lg');
    const descriptions = container.querySelectorAll('div.font-normal.leading-5');
    if (names.length !== 1 || descriptions.length !== 1 || names[0].nextElementSibling !== descriptions[0]
      || names[0].parentElement !== descriptions[0].parentElement
      || protectedElement(names[0]) || protectedElement(descriptions[0])
      || textNodes(names[0]).length !== 1 || names[0].childElementCount !== 0
      || descriptions[0].querySelector('a, button, input, textarea, select, script, style, iframe, object, embed, template')
      || !observedParagraphBreaks(descriptions[0])) return null;
    for (const element of descriptions[0].querySelectorAll('*')) {
      if (!['SPAN', 'BR'].includes(element.tagName)) return null;
    }
    return { anchor: container, nameElement: names[0], descriptionElement: descriptions[0], detail: true };
  }

  function collectSkillSlots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const document = root.nodeType === 9 ? root : root.ownerDocument;
    const slots = [];
    for (const anchor of root.querySelectorAll('a.flex.items-center.gap-2')) {
      if (protectedElement(anchor) || !hasKnownAbilityShape(anchor)) continue;
      const nameElement = anchor.querySelector('.font-teko');
      const descriptionElement = anchor.querySelector('.text-xs');
      if (textNodes(nameElement).length !== 1 || nameElement.childElementCount !== 0) continue;
      if (!observedParagraphBreaks(descriptionElement)) continue;
      if (descriptionElement.querySelector('script, style, iframe, object, embed, template')) continue;
      slots.push(Object.freeze({ anchor, nameElement, descriptionElement,
        identityKey: skillIdentityKey(anchor, document, false) }));
    }
    const tooltipSeen = new Set(slots.map((slot) => slot.nameElement));
    for (const tooltip of root.querySelectorAll('#gameslantern-tooltip, #darktide-build-editor div.fixed.max-w-sm.w-full.pointer-events-none')) {
      const shape = hasKnownAbilityTooltipShape(tooltip);
      if (!shape || tooltipSeen.has(shape.nameElement)) continue;
      tooltipSeen.add(shape.nameElement);
      slots.push(Object.freeze({ anchor: tooltip, ...shape,
        identityKey: skillIdentityKey(tooltip, document, false) }));
    }
    if (abilityDetailDocument(document)) {
      const containers = [...root.querySelectorAll('div.shadow-md.border.max-w-sm')];
      if (containers.length === 1) {
        const detail = hasKnownAbilityDetailShape(containers[0]);
        if (detail) slots.push(Object.freeze({ ...detail,
          identityKey: skillIdentityKey(detail.anchor, document, true) }));
      }
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
      let secondBreak = index + 1;
      const whitespace = [];
      while (secondBreak < tokens.length && tokens[secondBreak] !== null
        && tokens[secondBreak].nodeType === 3 && /^\s*$/.test(tokens[secondBreak].nodeValue || '')) {
        whitespace.push(tokens[secondBreak]);
        secondBreak += 1;
      }
      if (tokens[secondBreak] === null) {
        group.push(...whitespace);
        index = secondBreak;
      }
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

  function appendMarkedText(element, text, rows) {
    const document = element.ownerDocument;
    let position = 0;
    for (const row of [...rows].sort((a, b) => a.start - b.start)) {
      if (row.start < position || row.end > text.length) continue;
      element.append(document.createTextNode(text.slice(position, row.start)));
      const mark = document.createElement('mark'); mark.className = 'glat-errata-mark'; mark.textContent = text.slice(row.start, row.end); element.append(mark);
      const note = document.createElement('small'); note.className = 'glat-errata-note'; note.textContent = '（勘誤：' + row.corrected + '）'; element.append(note);
      position = row.end;
    }
    element.append(document.createTextNode(text.slice(position)));
  }

  function makeWeaponOfficial(document, mark) {
    const official = mark && mark.official;
    const resolvedText = typeof official?.resolvedText === 'string' ? official.resolvedText : '';
    if (!resolvedText.trim() || resolvedText.trim() === String(mark.name || '').trim()) return null;

    const section = document.createElement('section');
    section.className = 'w11-extension-official';
    const heading = document.createElement('h4');
    heading.textContent = '官方繁體中文';
    const resolved = document.createElement('p');
    resolved.className = 'w11-extension-official-text';
    appendMarkedText(resolved, resolvedText, (mark.anchoredErrata || []).filter(row => row.field === 'official'));
    section.append(heading, resolved);

    const sourceText = typeof official.sourceText === 'string' ? official.sourceText : '';
    if (sourceText.trim() && sourceText !== resolvedText) {
      const source = document.createElement('details');
      source.className = 'w11-extension-official-source';
      const summary = document.createElement('summary');
      summary.textContent = '查看官方原始字串';
      const original = document.createElement('p');
      original.textContent = sourceText;
      source.append(summary, original);
      section.append(source);
    }
    return section;
  }

  function addSection(parent, heading, lines) {
    if (!lines.length) return;
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    const title = document.createElement('h4'); title.textContent = heading; section.append(title);
    const list = document.createElement('ul');
    for (const line of lines) { const li = document.createElement('li'); li.textContent = line; list.append(li); }
    section.append(list); parent.append(section);
  }

  function makeTierTable(document, rows) {
    if (!rows?.length) return null;
    const table = document.createElement('table'); table.className = 'w11-extension-tier-table';
    const caption = document.createElement('caption'); caption.textContent = '等級 × 數值'; table.append(caption);
    const keys = [...new Set(rows.flatMap(row => row.params.map(p => p.key)))];
    const head = document.createElement('tr');
    for (const label of ['等級', ...keys]) { const th = document.createElement('th'); th.textContent = label; head.append(th); }
    table.append(head);
    for (const row of rows) {
      const tr = document.createElement('tr'); const th = document.createElement('th'); th.textContent = 'LV' + row.tier; tr.append(th);
      for (const key of keys) { const p = row.params.find(p => p.key === key); const td = document.createElement('td'); td.textContent = p ? valueWithUnit(p.value, p.unit) : '原始碼未公開'; tr.append(td); }
      table.append(tr);
    }
    return table;
  }

  function makeWeaponPanel(document, family, initialMark) {
    const panel = document.createElement('section'); panel.setAttribute(OWNED_ATTRIBUTE, 'weapon'); panel.className = 'w11-extension-weapon';
    const heading = document.createElement('h2'); heading.textContent = family.translatedName || family.nativeName; panel.append(heading);
    const controls = document.createElement('div'); panel.append(controls);
    const content = document.createElement('div'); panel.append(content);
    function renderMark(mark) {
      content.replaceChildren();
      const title = document.createElement('h3'); appendMarkedText(title, (mark.name || mark.nativeName) + '／' + mark.markLabel, (mark.anchoredErrata || []).filter(row => row.field === 'name')); content.append(title);
      const official = makeWeaponOfficial(document, mark); if (official) content.append(official);
      const fallback = official ? [] : (mark.anchoredErrata || []).filter(row => row.field === 'official').map(row => row.fallback);
      const details = makeDetails(document, { ...mark, errata: [...mark.errata, ...fallback] }); if (details) content.append(details);
      for (const bar of mark.bars || []) addSection(content, bar.name.zh || bar.name.en || bar.id,
        bar.stats.map(stat => (stat.name.zh || stat.name.en || stat.key) + '：' + stat.min + '～' + stat.max));
      addSection(content, '動作', (mark.actions || []).map(a => (a.name.zh || a.name.en || a.id) + '（' + a.slot + '／' + a.type + '）'));
      addSection(content, '可用祝福', (mark.blessings || []).map(b => b.name));
      if (Array.isArray(mark.curves) && mark.curves.length) {
        addSection(content, '屬性曲線', mark.curves.flatMap(curve => [curve.label, ...curve.knots.map(k =>
          '來源曲線節點：輸入 ' + valueWithUnit(k.input, curve.inputUnit) + '，輸出 ' + valueWithUnit(k.output, curve.outputUnit))]));
      }
      if (Array.isArray(mark.attackCombos) && mark.attackCombos.length) {
        addSection(content, '攻擊組合', mark.attackCombos.map(combo => combo.label + '：' + combo.steps.map(step => step.label + '（' + step.kind + '）').join(' → ')));
      }
    }
    for (const mark of family.marks) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = mark.markLabel;
      button.setAttribute('aria-pressed', String(mark.markId === initialMark.markId));
      button.addEventListener('click', () => { for (const other of controls.children) other.setAttribute('aria-pressed', String(other === button)); renderMark(mark); });
      controls.append(button);
    }
    renderMark(initialMark); return panel;
  }

  function canonicalWeaponPage(href) {
    if (typeof href !== 'string') return false;
    try {
      const url = new URL(href);
      return url.protocol === 'https:' && url.hostname === 'darktide.gameslantern.com'
        && !url.port && !url.username && !url.password && !url.search && !url.hash
        && /^\/weapons\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(url.pathname);
    } catch (_) { return false; }
  }

  function supportedWeaponImage(source, document) {
    if (typeof source !== 'string' || !source) return false;
    try {
      const url = new URL(source, document.baseURI);
      return url.protocol === 'https:' && ['gameslantern.com', 'darktide.gameslantern.com'].includes(url.hostname)
        && !url.port && !url.username && !url.password && !url.search && !url.hash
        && url.pathname.startsWith('/storage/sites/darktide/weapons/')
        && /\.(?:png|webp|jpe?g)$/i.test(url.pathname);
    } catch (_) { return false; }
  }

  function collectWeaponSlots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const document = root.nodeType === 9 ? root : root.ownerDocument;
    const href = document && document.location && document.location.href;
    if (!canonicalWeaponPage(href)) return [];
    const slots = [];
    for (const heading of root.querySelectorAll('h1')) {
      const container = heading.parentElement;
      if (!container || !container.matches('div.relative.flex.justify-center.pb-4.w-full')) continue;
      const elements = [...heading.children];
      if (elements.length !== 3 || elements[0].tagName !== 'SPAN' || elements[1].tagName !== 'BR'
        || elements[2].tagName !== 'SPAN' || elements[0].childElementCount !== 0
        || textNodes(elements[0]).length !== 1 || protectedElement(heading)) continue;
      const nativeTitle = elements[0].textContent;
      if (!nativeTitle || !nativeTitle.trim()) continue;
      const mirrorCandidates = [...container.children].filter((child) => child !== heading
        && child.tagName === 'DIV' && isWeaponTitleMirror(child, nativeTitle, elements[2].textContent));
      if (mirrorCandidates.length !== 1) continue;
      const mirror = mirrorCandidates[0];
      const mirrorTitleElement = mirror.children[0];
      const outlineTitleNodes = textNodes(mirrorTitleElement);
      if (outlineTitleNodes.length !== 1
        || visibleLine(outlineTitleNodes[0].nodeValue) !== visibleLine(nativeTitle)) continue;
      let imageScope = container;
      while (imageScope && !(imageScope.matches('.relative')
        && imageScope.querySelectorAll('img[alt="Header Image"]').length === 1)) {
        imageScope = imageScope.parentElement;
      }
      if (!imageScope) continue;
      const image = imageScope.querySelector('img[alt="Header Image"]');
      if (!image || !supportedWeaponImage(image.currentSrc || image.src, document)) continue;
      slots.push(Object.freeze({ anchor: heading, heading, container, mirror, mirrorTitleElement,
        titleSpan: elements[0], titleNode: textNodes(elements[0])[0], outlineTitleNode: outlineTitleNodes[0],
        headerRegion: imageScope, image, document,
        identityKey: JSON.stringify([document.location.href, image.alt, image.currentSrc || image.src]) }));
    }
    return slots;
  }

  function visibleLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isWeaponTitleMirror(element, title, subtitle) {
    const children = [...element.children];
    return children.length === 3 && children[0].tagName === 'SPAN' && children[1].tagName === 'BR'
      && children[2].tagName === 'SPAN' && children[0].childElementCount === 0
      && children[2].childElementCount === 0 && textNodes(children[0]).length === 1
      && textNodes(children[2]).length === 1
      && visibleLine(children[0].textContent) === visibleLine(title)
      && visibleLine(children[2].textContent) === visibleLine(subtitle);
  }

  function replaceUniquePhrase(value, source, replacement) {
    if (typeof value !== 'string' || typeof source !== 'string' || !source || typeof replacement !== 'string') return null;
    const index = value.indexOf(source);
    if (index < 0 || value.indexOf(source, index + source.length) >= 0) return null;
    return value.slice(0, index) + replacement + value.slice(index + source.length);
  }

  function createDomAdapter({ document = globalThis.document } = {}) {
    if (!document || typeof document.createElement !== 'function') throw new TypeError('a DOM document is required');

    function observe(slot, record = null) {
      const overrides = recordOverrides(record);
      return Object.freeze({
        structure: slot.detail ? 'gameslantern-ability-detail-v1' : 'gameslantern-ability-card-v1',
        ...(slot.gameslanternId === undefined ? {} : { gameslanternId: slot.gameslanternId }),
        name: restoredText(slot.nameElement, record),
        description: nodeText(slot.descriptionElement, overrides)
      });
    }

    function observeWeapon(slot, record = null) {
      if (!slot || !slot.document || !slot.image) return null;
      return Object.freeze({
        structure: 'gameslantern-weapon-detail-v1',
        ...(slot.gameslanternId === undefined ? {} : { gameslanternId: slot.gameslanternId }),
        href: slot.document.location.href,
        title: restoredText(slot.titleSpan, record),
        mirrorTitle: restoredText(slot.mirrorTitleElement, record),
        imageAlt: slot.image.alt,
        imageSrc: slot.image.currentSrc || slot.image.src
      });
    }

    function applySkill(slot, model) {
      if (!slot || !model || protectedElement(slot.anchor)
        || !presentationApi.matchesSkillObservation(model, observe(slot))) return null;
      const existingDetails = slot.tooltip || slot.detail
        ? slot.anchor.querySelector('[data-w11-owned="details"]')
        : slot.anchor.parentElement.querySelector(':scope > [' + OWNED_ATTRIBUTE + '="details"]');
      if (existingDetails) return null;
      const targetParagraphs = typeof model.translatedDescription === 'string' ? model.translatedDescription.split('\n\n') : [];
      const groups = paragraphGroups(slot.descriptionElement);

      const writes = [];
      const titleNode = textNodes(slot.nameElement)[0];
      if (typeof model.translatedName === 'string') writes.push({ node: titleNode, value: model.translatedName });
      const parameterValues = Object.values(model.translationParams).filter((value) => typeof value === 'string' && value.trim());
      const descriptionWrites = [];
      for (let index = 0; targetParagraphs.length === groups.length && index < groups.length; index += 1) {
        const groupWrites = planParagraphWrites(groups[index], targetParagraphs[index], parameterValues);
        if (!groupWrites) { descriptionWrites.length = 0; break; }
        descriptionWrites.push(...groupWrites);
      }
      writes.push(...descriptionWrites);
      const changes = [];
      for (const row of writes) {
        if (row.node.nodeValue === row.value) continue;
        changes.push({ node: row.node, originalValue: row.node.nodeValue, writtenValue: row.value });
      }
      const pending = [...(model.anchoredErrata || [])];
      const inserted = [];
      for (const field of ['name', 'official']) {
        const full = field === 'name' ? model.translatedName : model.translatedDescription;
        const candidates = field === 'name' ? writes.filter(row => row.node === titleNode) : descriptionWrites;
        let cursor = 0;
        for (const row of candidates) {
          if (!row.value) continue;
          const offset = full.indexOf(row.value, cursor);
          if (offset < 0) continue;
          cursor = offset + row.value.length;
          const selected = pending.filter(a => a.field === field && a.start >= offset && a.end <= cursor).sort((a, b) => a.start - b.start);
          let end = offset;
          const accepted = selected.filter(a => { if (a.start < end) return false; end = a.end; return true; });
          if (!accepted.length) continue;
          let change = changes.find(c => c.node === row.node);
          if (!change) { change = { node: row.node, originalValue: row.node.nodeValue, writtenValue: row.value }; changes.push(change); }
          const fragment = document.createElement('span');
          appendMarkedText(fragment, row.value, accepted.map(a => ({ ...a, start: a.start - offset, end: a.end - offset })));
          inserted.push({ node: row.node, fragment, change, accepted });
          for (const a of accepted) pending.splice(pending.indexOf(a), 1);
        }
      }
      const details = makeDetails(document, { ...model, errata: [...model.errata, ...pending.map(a => a.fallback)] });
      if (!changes.length && !details) return null;
      if (details && slot.tooltip) details.classList.add('w11-extension-tooltip-panel');
      for (const change of changes) change.node.nodeValue = change.writtenValue;
      const ownedNodes = details ? [details] : [];
      for (const entry of inserted) {
        const { node, fragment, change } = entry;
        const children = [...fragment.childNodes];
        node.nodeValue = children.shift().nodeValue;
        change.writtenValue = node.nodeValue;
        let reference = node.nextSibling;
        for (const child of children) { node.parentNode.insertBefore(child, reference); ownedNodes.push(child); for (const text of child.nodeType === 3 ? [child] : textNodes(child)) changes.push({ node: text, originalValue: '', writtenValue: text.nodeValue }); }
      }
      if (details) {
        if (slot.tooltip || slot.detail) slot.descriptionElement.parentNode.insertBefore(details, slot.descriptionElement.nextSibling);
        else slot.anchor.parentNode.insertBefore(details, slot.anchor.nextSibling);
      }
      return { anchor: slot.anchor, changes, details, ownedNodes, identityKey: slot.identityKey };
    }

    function applyWeapon(slot, family, mark, marks) {
      const observation = observeWeapon(slot);
      if (!slot || !family || !mark || !Array.isArray(marks) || marks.length < 1
        || !presentationApi.matchesWeaponObservation(mark, observation)
        || marks.filter((row) => row && row.markId === mark.markId).length !== 1) return null;
      const insertParent = slot.headerRegion && slot.headerRegion.parentElement;
      if (!insertParent) return null;
      const existing = insertParent.querySelector(':scope > [' + OWNED_ATTRIBUTE + '="weapon"]');
      if (existing) return null;
      const nativeTitle = slot.titleNode.nodeValue;
      const nativeFamilyName = mark.nativeName;
      const translatedTitle = (mark.name ? replaceUniquePhrase(nativeTitle, nativeFamilyName, mark.name) : null);
      const translatedOutline = (mark.name ? replaceUniquePhrase(slot.outlineTitleNode.nodeValue, nativeFamilyName, mark.name) : null);
      const panel = makeWeaponPanel(document, family, mark);
      const changes = translatedTitle !== null && translatedOutline !== null ? [
        { node: slot.titleNode, originalValue: nativeTitle, writtenValue: translatedTitle },
        { node: slot.outlineTitleNode, originalValue: slot.outlineTitleNode.nodeValue, writtenValue: translatedOutline }
      ] : [];
      for (const change of changes) change.node.nodeValue = change.writtenValue;
      insertParent.insertBefore(panel, slot.headerRegion.nextSibling);
      return { anchor: slot.heading, changes, ownedNodes: [panel], identityKey: slot.identityKey };
    }

    function restore(record) {
      if (!record) return;
      for (const change of record.changes) {
        if (change.node.isConnected && change.node.nodeValue === change.writtenValue) {
          change.node.nodeValue = change.originalValue;
        }
      }
      for (const node of record.ownedNodes || [record.details]) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
    }

    function createBlessingReader(models) {
      if (!Array.isArray(models)) throw new TypeError('blessing reader models must be an array');
      const element = document.createElement('section'); element.setAttribute(OWNED_ATTRIBUTE, 'blessing-reader'); element.className = 'w11-extension-blessing-reader';
      const heading = document.createElement('h2'); heading.textContent = '祝福翻譯閱讀'; element.append(heading);
      const label = document.createElement('label'); label.textContent = '祝福';
      const select = document.createElement('select'); select.setAttribute('aria-label', '祝福'); label.append(select); element.append(label);
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '選擇祝福'; select.append(placeholder);
      const rows = [...new Map(models.map(row => [row.id, row])).values()];
      rows.forEach((row, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = row.translatedName || row.nativeName || row.id; select.append(option); });
      const result = document.createElement('div'); result.setAttribute('data-w11-blessing-result', ''); element.append(result);
      const render = () => {
        result.replaceChildren(); if (select.value === '') return;
        const row = rows[Number(select.value)]; if (!row) return;
        const name = document.createElement('h3'); appendMarkedText(name, row.translatedName || row.nativeName, (row.anchoredErrata || []).filter(a => a.field === 'name')); result.append(name);
        if (row.translatedDescription) { const description = document.createElement('p'); description.className = 'w11-extension-blessing-description'; appendMarkedText(description, row.translatedDescription, (row.anchoredErrata || []).filter(a => a.field === 'official')); result.append(description); }
        const details = makeDetails(document, row); if (details) result.append(details);
        const table = makeTierTable(document, row.tierTable); if (table) result.append(table);
        const applicability = document.createElement('p'); applicability.setAttribute('data-w11-blessing-applicability', '');
        applicability.textContent = '適用武器：' + row.applicability.weapons.map(w => w.name + '／' + w.markId).join('、'); result.append(applicability);
      };
      select.addEventListener('change', render);
      return Object.freeze({ element, dispose() { select.removeEventListener('change', render); element.remove(); } });
    }

    function selectedPatchLabel(root = document) {
      return readSelectedPatchLabel(root);
    }

    return Object.freeze({ applySkill, applyWeapon, collectSkillSlots, collectWeaponSlots, createBlessingReader, observe, observeWeapon, restore, selectedPatchLabel,
      patchSelectionRegion: (root = document) => patchSelectionRegion(root) });
  }

  return Object.freeze({ createDomAdapter, collectSkillSlots, collectWeaponSlots, readSelectedPatchLabel, patchSelectionRegion, makeWeaponPanel, makeDetails, makeTierTable });
});
