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
  const WEAPON_UNITS = Object.freeze({ percent: '%', ratio: '比例', seconds: '秒', s: '秒', count: '次',
    meters: '公尺', point: '點', 'dodge-count': '次閃避', 'stamina-point': '耐力點',
    'stamina-point-per-second': '耐力點／秒', 'normalized-speed-per-second': '標準化速度／秒',
    'attack-power-point': '攻擊威力點', 'cleave-power-point': '鋸擊威力點', 'instance-count': '彈藥單位' });
  const WEAPON_STAT_LABELS = Object.freeze({ chainaxe_dps_stat: '傷害輸出', chainaxe_armor_pierce_stat: '破甲',
    chainaxe_mobility_stat: '移動性', chainaxe_defence_stat: '防禦', chainaxe_sawing_stat: '鏈鋸階段',
    damage_stat: '傷害', cleave_stat: '劈砍', impact_stat: '衝擊' });
  const WEAPON_PROPERTY_LABELS = Object.freeze({ consecutive_dodges_reset: '連續閃避重置時間',
    distance_scale: '閃避距離係數', diminishing_return_distance_modifier: '閃避距離衰減係數',
    diminishing_return_start: '衰減起始閃避次數', diminishing_return_limit: '衰減閃避上限',
    speed_modifier: '移動速度修正', stamina_modifier: '耐力修正', sprint_cost_per_second: '衝刺耐力消耗',
    push_cost: '推擊耐力消耗', sprint_forward_deceleration: '向前衝刺減速',
    sprint_sideway_acceleration: '側向衝刺加速', sprint_sideway_deceleration: '側向衝刺減速',
    sprint_forward_acceleration: '向前衝刺加速', sprint_speed_mod: '衝刺速度修正', attack: '攻擊威力',
    damage: '傷害', armor_damage_modifier: '護甲傷害修正' });
  const ATTACK_MODES = Object.freeze({ light: '輕攻擊', heavy: '重攻擊', push: '推擊', block: '格擋', special: '特殊動作', hipfire: '腰射', ads: '機瞄' });
  const TARGET_ROLES = Object.freeze({ 'single-target': '單一目標', 'multi-target-cleave': '多目標劈砍' });
  const ATTACK_BRANCHES = Object.freeze({ normal: '一般分支', abort: '中止分支', 'special-active': '特殊動作啟動分支',
    inner: '內側分支', outer: '外側分支' });
  const ATTACK_INPUTS = Object.freeze({ light: '輕攻擊', heavy: '重攻擊', special: '特殊動作',
    dodge: '閃避', block: '格擋', push: '推擊', shoot_pressed: '射擊輸入', zoom_shoot: '機瞄射擊輸入', weapon_special: '特殊動作輸入' });

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
    resolved.textContent = resolvedText;
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

  function makeWeaponErrata(document, rows) {
    if (!Array.isArray(rows)) return null;
    const entries = rows.filter((row) => {
      const value = typeof row === 'string' ? row : row && row.text;
      return typeof value === 'string' && value.trim();
    });
    if (!entries.length) return null;

    const section = document.createElement('section');
    section.className = 'w11-extension-errata';
    const heading = document.createElement('h4');
    heading.textContent = '獨立勘誤';
    section.append(heading);
    const list = document.createElement('ul');
    for (const row of entries) {
      const value = typeof row === 'string' ? row : row.text;
      const item = document.createElement('li');
      item.append(document.createTextNode(value));
      const context = typeof row === 'object' && typeof row.context?.description === 'string'
        ? row.context.description : '';
      if (context.trim()) {
        const description = document.createElement('p');
        description.className = 'w11-extension-errata-context';
        description.textContent = context;
        item.append(description);
      }
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function appendCode(parent, label, value) {
    if (typeof value !== 'string' || !value) return;
    const wrapper = parent.ownerDocument.createElement('span');
    wrapper.append(parent.ownerDocument.createTextNode(label + ' '));
    const code = parent.ownerDocument.createElement('code');
    code.textContent = value;
    wrapper.append(code);
    parent.append(wrapper);
  }

  function sourceUnit(unit) {
    if (typeof unit !== 'string' || !unit) return '';
    return WEAPON_UNITS[unit] ? ' ' + WEAPON_UNITS[unit] : '（來源單位：' + unit + '）';
  }

  function sourceValue(value) {
    const row = value && value.status === 'known' ? value
      : value && value.displayValue && value.displayValue.status === 'known' ? value.displayValue : null;
    if (row && typeof row.decimal === 'string') return row.decimal + sourceUnit(row.unit);
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && value.status === 'unknown') return '來源數值未知';
    return '來源數值未確認';
  }

  function sourceRange(range, kind) {
    if (!range || range.status === 'unknown') return kind === 'obtainable' ? '來源未提供實際可取得範圍' : '來源範圍未知';
    if (range.status === 'not-applicable') return '來源未列此範圍';
    if (range.status !== 'known' || typeof range.min !== 'string' || typeof range.max !== 'string') return '來源範圍未確認';
    return range.min + ' 至 ' + range.max + sourceUnit(range.unit);
  }

  function sourcePropertyLabel(property) {
    if (typeof property !== 'string') return '來源數值';
    if (property.includes('armor_damage_modifier')) return '護甲傷害修正';
    if (property.includes('chainaxe_sawing_stat')) return '鏈鋸階段攻擊威力';
    if (property.includes('power_distribution.attack')) return '攻擊威力';
    const normalized = property.replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean).pop();
    if (normalized === 'ammunition_clips') return '彈匣容量';
    if (normalized === 'ammunition_reserve') return '備用彈藥容量';
    return WEAPON_PROPERTY_LABELS[normalized] || '來源數值';
  }

  function decodeRawSourceValue(rawValue) {
    if (typeof rawValue !== 'string') return rawValue;
    if (rawValue.startsWith('"')) {
      try {
        const parsed = JSON.parse(rawValue);
        if (typeof parsed === 'string') return parsed;
      } catch { /* Keep non-JSON source text literal. */ }
    }
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;
    return rawValue;
  }

  function rangedSourceRow(row) {
    const fieldPath = row?.sourceLocator?.fieldPath;
    if (typeof fieldPath !== 'string') return null;
    const value = decodeRawSourceValue(row.rawValue);
    const numeric = typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(value));
    const numericText = numeric ? String(value) : null;
    const enumLabels = Object.freeze({ hipfire: '腰射', ads: '機瞄', semi_auto: '半自動', flashlight: '手電筒',
      shoot_hit_scan: '命中掃描射擊', immediate_single_shot: '單次即時射擊', shoot_pressed: '射擊輸入',
      zoom_shoot: '機瞄射擊輸入', weapon_special: '特殊動作輸入' });
    const displayed = fieldPath.match(/^weapon_template\.displayed_attacks\.(primary|secondary|special)\.(type|fire_mode)$/u);
    if (displayed) {
      const label = displayed[2] === 'fire_mode' ? '射擊模式'
        : displayed[1] === 'special' ? '特殊動作' : '射擊姿勢';
      return { fieldPath, label, value: enumLabels[value] ?? '來源值未有確認顯示名' };
    }
    const action = fieldPath.match(/^weapon_template\.actions\.(action_shoot_hip|action_shoot_zoomed|action_toggle_flashlight)\.(.+)$/u);
    if (action) {
      const property = action[2].split('.').at(-1);
      if (property === 'kind') return { fieldPath, label: '動作種類', value: enumLabels[value] ?? '來源值未有確認顯示名' };
      if (property === 'start_input') return { fieldPath, label: '動作輸入', value: enumLabels[value] ?? '來源輸入未有確認顯示名' };
      if (property === 'ammunition_usage' && numericText !== null) return { fieldPath, label: '每次射擊消耗', value: numericText + ' ' + WEAPON_UNITS['instance-count'] };
      if (property === 'allow_shots_with_less_than_required_ammo' && typeof value === 'boolean') {
        return { fieldPath, label: '彈藥不足此動作需求時仍允許射擊', value: value ? '是' : '否' };
      }
      if (property === 'total_time' && numericText !== null) return { fieldPath, label: '動作總時長', value: numericText + ' 秒' };
      if (property === 'chain_time' && numericText !== null) return { fieldPath, label: '動作銜接時間', value: numericText + ' 秒' };
      if (property === 'activation_time' && numericText !== null) return { fieldPath, label: '特殊動作啟用時間', value: numericText + ' 秒' };
    }
    if (/^hitscan_templates\.[A-Za-z0-9_]+\.range$/u.test(fieldPath) && numericText !== null) {
      return { fieldPath, label: '命中掃描範圍', value: numericText + '（來源未提供單位）' };
    }
    return null;
  }

  function sourceConditionText(rows, ranged) {
    if (!Array.isArray(rows) || rows.length === 0) return '未記載額外來源條件';
    return rows.map((row) => {
      const field = typeof row?.fieldPath === 'string' ? row.fieldPath.split('.').pop() : '';
      const value = typeof row?.rawValue === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(row.rawValue)
        ? row.rawValue : null;
      if (value !== null && field === 'chain_time') return (ranged ? '動作銜接時間 ' : '連段時間 ') + value + ' 秒';
      if (value !== null && field === 'chain_until') return (ranged ? '動作銜接窗口 ' : '連段窗口 ') + value + ' 秒';
      if (value !== null) return '其他來源條件值 ' + value;
      return '另有來源條件（原始值不作程式解讀）';
    }).join('；');
  }

  function makeWeaponPanel(document, family, initialMark) {
    const panel = document.createElement('section');
    panel.setAttribute(OWNED_ATTRIBUTE, 'weapon');
    panel.className = 'w11-extension-panel w11-extension-weapon';
    const heading = document.createElement('h2');
    heading.textContent = family.translatedName;
    const status = document.createElement('p');
    status.textContent = '同一份已驗證資料中的官方武器家族與型號數值。';
    const tabs = document.createElement('nav');
    tabs.setAttribute('aria-label', '武器型號');
    const view = document.createElement('div');
    view.setAttribute('data-w11-weapon-view', 'true');
    panel.append(heading, status, tabs, view);

    function renderMark(mark) {
      const hasRangedProfile = (mark.attackProfiles || []).some(profile => ['hipfire', 'ads'].includes(profile.payload?.mode));
      view.replaceChildren();
      const title = document.createElement('h3');
      title.textContent = mark.name;
      const label = document.createElement('p');
      label.textContent = '來源型號：' + mark.markLabel;
      view.append(title, label);
      if (mark.note) {
        const note = document.createElement('p');
        note.textContent = mark.note;
        view.append(note);
      }
      const official = makeWeaponOfficial(document, mark);
      if (official) view.append(official);
      const errata = makeWeaponErrata(document, mark.errata);
      if (errata) view.append(errata);

      for (const statSection of mark.statSections || []) {
        const section = document.createElement('section');
        const sectionHeading = document.createElement('h4');
        sectionHeading.textContent = statSection.label;
        section.append(sectionHeading);
        const list = document.createElement('dl');
        for (const claim of statSection.claims || []) {
          const payload = claim.payload || {};
          const context = payload.context || {};
          const dt = document.createElement('dt');
          const mode = ATTACK_MODES[context.attackMode];
          const armor = typeof payload.property === 'string'
            ? payload.property.match(/\[armor_types\.([a-z_]+)\]/u)?.[1] : null;
          const labelParts = [];
          if (mode) labelParts.push(mode);
          if (armor) labelParts.push('來源護甲類別 ' + armor + '（尚無已確認顯示名）');
          if (context.weaponStat && WEAPON_STAT_LABELS[context.weaponStat]) labelParts.push(WEAPON_STAT_LABELS[context.weaponStat]);
          if (context.comparisonStat?.status === 'known' && typeof context.comparisonStat.decimal === 'string') {
            labelParts.push('面板比較點 ' + context.comparisonStat.decimal + '%');
          }
          labelParts.push(sourcePropertyLabel(payload.property));
          dt.textContent = labelParts.join(' · ');
          if (typeof context.profile === 'string' && context.profile) {
            dt.append(document.createTextNode(' · 來源傷害設定 '));
            appendCode(dt, '', context.profile);
          }
          if (typeof payload.property === 'string' || typeof claim.recordId === 'string') {
            const location = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = '來源定位';
            location.append(summary);
            if (typeof claim.recordId === 'string') {
              const claimRow = document.createElement('p');
              appendCode(claimRow, '來源紀錄', claim.recordId);
              location.append(claimRow);
            }
            if (typeof payload.property === 'string') {
              const propertyRow = document.createElement('p');
              appendCode(propertyRow, '來源欄位', payload.property);
              location.append(propertyRow);
            }
            dt.append(location);
          }
          const dd = document.createElement('dd');
          dd.textContent = sourceValue(payload.displayValue?.status ? payload.displayValue : payload.value);
          list.append(dt, dd);
        }
        for (const curve of statSection.curves || []) {
          const knots = curve.payload?.knots;
          if (!Array.isArray(knots)) continue;
          knots.forEach((knot, index) => {
            const dt = document.createElement('dt');
            dt.textContent = '來源曲線節點 ' + (index + 1) + ' · 輸入 ' + knot.input + sourceUnit(curve.payload.inputUnit);
            const dd = document.createElement('dd');
            dd.textContent = sourceValue({ status: 'known', decimal: knot.output, unit: curve.payload.outputUnit });
            list.append(dt, dd);
          });
        }
        for (const definition of statSection.statDefinitions || []) {
          const payload = definition.payload || {};
          if (payload.theoreticalInputRange) {
            const dt = document.createElement('dt'); dt.textContent = '理論輸入範圍';
            const dd = document.createElement('dd'); dd.textContent = sourceRange(payload.theoreticalInputRange, 'theoretical');
            list.append(dt, dd);
          }
          if (payload.obtainableInputRange) {
            const dt = document.createElement('dt'); dt.textContent = '實際可取得範圍';
            const dd = document.createElement('dd'); dd.textContent = sourceRange(payload.obtainableInputRange, 'obtainable');
            list.append(dt, dd);
          }
        }
        if (list.children.length) section.append(list);
        view.append(section);
      }

      const details = document.createElement('details');
      details.className = 'w11-extension-weapon-source';
      const detailsSummary = document.createElement('summary');
      detailsSummary.textContent = hasRangedProfile
        ? '其他來源數值、素質語意與射擊條件' : '其他來源數值、素質語意與連段條件';
      details.append(detailsSummary);
      for (const table of mark.source?.statTables || []) {
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = '素質來源表：' + (WEAPON_STAT_LABELS[table.statKey] || '其他素質');
        appendCode(title, '來源表', table.tableKey);
        section.append(title);
        const list = document.createElement('ul');
        for (const property of table.properties || []) {
          const orderedValues = property.orderedValues || [];
          const values = orderedValues.map((row) => {
            const value = typeof row.decimal === 'string' ? row.decimal : typeof row.rawValue === 'string' ? row.rawValue : null;
            if (value === null) return null;
            const endpoint = row.key === 'lerp_basic' ? '基礎模板端點'
              : row.key === 'lerp_perfect' ? '完美模板端點' : row.key;
            return endpoint + ' ' + value;
          }).filter(Boolean);
          if (!values.length) continue;
          const item = document.createElement('li');
          const hasTemplateEndpoints = orderedValues.some(row => row.key === 'lerp_basic' || row.key === 'lerp_perfect');
          const valueLabel = hasTemplateEndpoints ? '來源模板端點（不代表實際可取得範圍）' : '來源值';
          item.append(document.createTextNode(sourcePropertyLabel(property.property) + valueLabel + '：'
            + values.join('；') + sourceUnit(property.unit) + ' '));
          appendCode(item, '來源欄位', property.property);
          list.append(item);
        }
        if (list.children.length) section.append(list);
        details.append(section);
      }
      for (const item of mark.source?.statDefinitions || []) {
        const definition = item?.definition;
        const payload = definition?.payload || {};
        if (!definition) continue;
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = payload.quantity === 'ammunition_clips' ? '彈匣來源定義與曲線'
          : payload.quantity === 'ammunition_reserve' ? '備用彈藥來源定義與曲線' : '來源數值定義與曲線';
        appendCode(title, '來源定義', definition.recordId);
        section.append(title);
        if (payload.theoreticalInputRange) {
          const theoretical = document.createElement('p');
          theoretical.textContent = '理論來源輸入範圍：' + sourceRange(payload.theoreticalInputRange, 'theoretical');
          section.append(theoretical);
        }
        if (payload.obtainableInputRange) {
          const obtainable = document.createElement('p');
          obtainable.textContent = '實際可取得範圍：' + sourceRange(payload.obtainableInputRange, 'obtainable')
            + (['ammunition_clips', 'ammunition_reserve'].includes(payload.quantity)
              ? '；來源模板端點不等同實際可取得彈藥數量。' : '');
          section.append(obtainable);
        }
        for (const knot of item.curve?.payload?.knots || []) {
          const endpoint = document.createElement('p');
          endpoint.textContent = '來源曲線節點：輸入 ' + knot.input + sourceUnit(item.curve.payload.inputUnit)
            + '，輸出 ' + knot.output + sourceUnit(item.curve.payload.outputUnit) + '。';
          section.append(endpoint);
        }
        details.append(section);
      }
      for (const row of mark.source?.statTableSemantics || []) {
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = '來源素質語意：' + (WEAPON_STAT_LABELS[row.statKey] || '其他素質');
        appendCode(title, '來源群組', row.groupKey);
        section.append(title);
        const list = document.createElement('ul');
        for (const binding of row.bindings || []) {
          const item = document.createElement('li');
          item.append(document.createTextNode(sourcePropertyLabel(binding.property) + '；理論輸入範圍：'
            + sourceRange(binding.theoreticalInputRange, 'theoretical') + '；實際可取得範圍：'
            + sourceRange(binding.obtainableInputRange, 'obtainable') + ' '));
          appendCode(item, '來源欄位', binding.property);
          list.append(item);
        }
        if (list.children.length) section.append(list);
        details.append(section);
      }
      if (Array.isArray(mark.source?.displayedAttacks) && mark.source.displayedAttacks.length) {
        const section = document.createElement('section');
        const title = document.createElement('h4'); title.textContent = '遊戲顯示的攻擊段'; section.append(title);
        const list = document.createElement('ul');
        for (const attack of mark.source.displayedAttacks) {
          for (const segment of attack.segments || []) {
            const item = document.createElement('li');
            item.append(document.createTextNode((ATTACK_MODES[attack.mode] || '來源攻擊') + '第 ' + segment.index
              + ' 段：' + (TARGET_ROLES[segment.targetRole] || '來源用途未有確認顯示名') + ' '));
            appendCode(item, '來源攻擊類型', segment.attackType);
            list.append(item);
          }
        }
        section.append(list); details.append(section);
      }
      const rangedRows = (mark.source?.sourceRows || []).map(rangedSourceRow).filter(Boolean);
      if (rangedRows.length) {
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = '射擊、彈藥與動作來源欄位';
        section.append(title);
        const list = document.createElement('ul');
        for (const row of rangedRows) {
          const item = document.createElement('li');
          item.append(document.createTextNode(row.label + '：' + row.value + ' '));
          appendCode(item, '來源欄位', row.fieldPath);
          list.append(item);
        }
        section.append(list);
        details.append(section);
      }
      const missingRows = mark.source?.dataCoverage?.missing || [];
      if (missingRows.length) {
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = '來源涵蓋與未匯入欄位';
        section.append(title);
        const list = document.createElement('ul');
        for (const row of missingRows) {
          const item = document.createElement('li');
          item.append(document.createTextNode(row.reasonCode === 'NOT_IMPORTED' ? '尚未匯入' : '來源欄位未完整提供'));
          appendCode(item, '來源狀態', row.reasonCode);
          appendCode(item, '來源欄位', row.field);
          list.append(item);
        }
        section.append(list);
        details.append(section);
      }
      const continuations = mark.source?.actionContinuations || [];
      if (continuations.length) {
        const section = document.createElement('section');
        const title = document.createElement('h4'); title.textContent = '來源動作銜接與條件'; section.append(title);
        const list = document.createElement('ul');
        for (const row of continuations) {
          const item = document.createElement('li');
          if (row.fromAction && row.toAction) {
            item.append(document.createTextNode('來源動作 ')); appendCode(item, '', row.fromAction);
            item.append(document.createTextNode(' → ')); appendCode(item, '', row.toAction);
            item.append(document.createTextNode('；'));
          }
          const inputLabel = ATTACK_INPUTS[row.inputKey] || '來源輸入';
          item.append(document.createTextNode(inputLabel + ' ')); appendCode(item, '', row.inputKey);
          item.append(document.createTextNode('；' + sourceConditionText(row.conditions, hasRangedProfile)));
          list.append(item);
        }
        section.append(list); details.append(section);
      }
      for (const profile of mark.attackProfiles || []) {
        const resolution = profile.payload?.actionResolution || {};
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = ATTACK_MODES[profile.payload?.mode] || '來源攻擊設定';
        appendCode(title, '攻擊設定', profile.recordId);
        appendCode(title, '動作', profile.payload?.action);
        section.append(title);
        for (const entry of resolution.entryBindings || []) {
          const item = document.createElement('p');
          item.append(document.createTextNode('來源動作 ')); appendCode(item, '', entry.fromAction);
          item.append(document.createTextNode(' → ')); appendCode(item, '', entry.toAction);
          item.append(document.createTextNode('；' + (ATTACK_INPUTS[entry.inputKey] || '來源輸入') + ' '));
          appendCode(item, '', entry.inputKey);
          item.append(document.createTextNode('；' + sourceConditionText(entry.conditions, hasRangedProfile)));
          section.append(item);
        }
        for (const branch of resolution.branchBindings || []) {
          const item = document.createElement('p');
          item.textContent = (ATTACK_BRANCHES[branch.branch] || '來源分支') + '；來源值 ' + (branch.rawValue ?? '未提供')
            + '；保留來源對應，不執行程式邏輯。 ';
          appendCode(item, '分支', branch.branch);
          appendCode(item, '對應傷害設定', branch.profileRef?.recordId);
          section.append(item);
        }
        for (const condition of resolution.runtimeConditions || []) {
          const item = document.createElement('p');
          item.textContent = '來源條件（未執行判定）：' + sourceConditionText([condition], hasRangedProfile);
          section.append(item);
        }
        details.append(section);
      }
      view.append(details);
      const sectionModel = {
        detailSections: (mark.sections || []).map((section) => ({ sectionId: section.sectionId,
          items: (section.items || []).map((item) => typeof item === 'string' ? item : item?.text).filter(Boolean) })),
        errata: [],
        terms: mark.terms || []
      };
      const sectionDetails = makeDetails(document, sectionModel);
      if (sectionDetails) view.append(sectionDetails);
    }

    for (const mark of family.marks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = mark.markLabel;
      button.setAttribute('aria-pressed', String(mark.markId === initialMark.markId));
      button.addEventListener('click', () => {
        for (const peer of tabs.querySelectorAll('button')) peer.setAttribute('aria-pressed', String(peer === button));
        renderMark(mark);
      });
      tabs.append(button);
    }
    renderMark(initialMark);
    return panel;
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
        name: restoredText(slot.nameElement, record),
        description: nodeText(slot.descriptionElement, overrides)
      });
    }

    function observeWeapon(slot, record = null) {
      if (!slot || !slot.document || !slot.image) return null;
      return Object.freeze({
        structure: 'gameslantern-weapon-detail-v1',
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
      if (details && slot.tooltip) details.classList.add('w11-extension-tooltip-panel');
      for (const change of changes) change.node.nodeValue = change.writtenValue;
      if (details) {
        if (slot.tooltip || slot.detail) slot.descriptionElement.parentNode.insertBefore(details, slot.descriptionElement.nextSibling);
        else slot.anchor.parentNode.insertBefore(details, slot.anchor.nextSibling);
      }
      return { anchor: slot.anchor, changes, details, identityKey: slot.identityKey };
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
      const translatedTitle = replaceUniquePhrase(nativeTitle, nativeFamilyName, mark.name);
      const translatedOutline = replaceUniquePhrase(slot.outlineTitleNode.nodeValue, nativeFamilyName, mark.name);
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
      const rows = models.filter((row) => row && row.blessingRef && typeof row.blessingRef.recordId === 'string'
        && row.variantRef && typeof row.variantRef.recordId === 'string'
        && Number.isInteger(row.tier) && row.tier > 0 && typeof row.translatedName === 'string'
        && row.translatedName.trim() && typeof row.translatedDescription === 'string'
        && Array.isArray(row.detailSections) && Array.isArray(row.errata) && Array.isArray(row.terms));
      const grouped = new Map();
      for (const row of rows) {
        const blessingId = row.blessingRef.recordId;
        const variantId = row.variantRef.recordId;
        if (!grouped.has(blessingId)) grouped.set(blessingId, { name: row.translatedName, variants: new Map() });
        const blessing = grouped.get(blessingId);
        if (!blessing.variants.has(variantId)) blessing.variants.set(variantId, []);
        blessing.variants.get(variantId).push(row);
      }

      const element = document.createElement('section');
      element.setAttribute(OWNED_ATTRIBUTE, 'blessing-reader');
      element.className = 'w11-extension-blessing-reader';
      element.setAttribute('aria-label', '祝福翻譯閱讀');
      const heading = document.createElement('h2');
      heading.textContent = '祝福翻譯閱讀';
      element.append(heading);

      const blessingLabel = document.createElement('label');
      blessingLabel.textContent = '祝福';
      const blessingSelect = document.createElement('select');
      blessingSelect.setAttribute('aria-label', '祝福');
      const blessingPlaceholder = document.createElement('option');
      blessingPlaceholder.value = '';
      blessingPlaceholder.textContent = '選擇祝福';
      blessingSelect.append(blessingPlaceholder);
      for (const [blessingId, blessing] of grouped) {
        const option = document.createElement('option');
        option.value = blessingId;
        option.textContent = blessing.name;
        blessingSelect.append(option);
      }
      blessingLabel.append(blessingSelect);

      const variantLabel = document.createElement('label');
      variantLabel.textContent = '祝福變體';
      const variantSelect = document.createElement('select');
      variantSelect.setAttribute('aria-label', '祝福變體');
      variantSelect.disabled = true;
      const variantPlaceholder = document.createElement('option');
      variantPlaceholder.value = '';
      variantPlaceholder.textContent = '選擇變體';
      variantSelect.append(variantPlaceholder);
      variantLabel.append(variantSelect);

      const tierGroup = document.createElement('fieldset');
      tierGroup.className = 'w11-extension-blessing-tiers';
      tierGroup.disabled = true;
      const tierLegend = document.createElement('legend');
      tierLegend.textContent = '階級';
      tierGroup.append(tierLegend);
      const applicability = document.createElement('p');
      applicability.setAttribute('data-w11-blessing-applicability', '');
      const result = document.createElement('div');
      result.setAttribute('data-w11-blessing-result', '');
      result.setAttribute('aria-live', 'polite');
      result.textContent = rows.length ? '請選擇祝福。' : '目前沒有可顯示的已驗證祝福資料。';
      element.append(blessingLabel, variantLabel, tierGroup, applicability, result);

      let selectedBlessingId = '';
      let selectedVariantId = '';
      function clearResult(message) {
        result.replaceChildren(document.createTextNode(message));
      }
      function populateTiers() {
        for (const button of [...tierGroup.querySelectorAll('[data-w11-tier]')]) button.removeEventListener('click', button.__w11SelectTier);
        for (const button of [...tierGroup.querySelectorAll('[data-w11-tier]')]) button.remove();
        tierGroup.disabled = true;
        const blessing = grouped.get(selectedBlessingId);
        const tierRows = blessing && blessing.variants.get(selectedVariantId);
        if (!tierRows || !tierRows.length) {
          applicability.textContent = '';
          clearResult(selectedBlessingId ? '請選擇祝福變體。' : '請選擇祝福。');
          return;
        }
        const tiers = [...new Map(tierRows.map((row) => [row.tier, row])).values()]
          .sort((left, right) => left.tier - right.tier);
        applicability.textContent = tiers.some((row) => row.applicability?.status === 'verified')
          ? '適用武器關聯：已由資料驗證。' : '適用武器：尚未驗證。';
        for (const row of tiers) {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('data-w11-tier', String(row.tier));
          button.setAttribute('aria-pressed', 'false');
          button.textContent = 'LV' + row.tier;
          const selectTier = () => {
            for (const sibling of tierGroup.querySelectorAll('[data-w11-tier]')) {
              sibling.setAttribute('aria-pressed', sibling === button ? 'true' : 'false');
            }
            result.replaceChildren();
            const name = document.createElement('h3');
            name.textContent = row.translatedName;
            const tier = document.createElement('p');
            tier.textContent = '階級：LV' + row.tier;
            const description = document.createElement('p');
            description.className = 'w11-extension-blessing-description';
            description.textContent = row.translatedDescription;
            result.append(name, tier, description);
            const details = makeDetails(document, row);
            if (details) result.append(details);
          };
          button.__w11SelectTier = selectTier;
          button.addEventListener('click', selectTier);
          tierGroup.append(button);
        }
        tierGroup.disabled = false;
        clearResult('請明確選擇階級。');
      }
      const onBlessingChange = () => {
        selectedBlessingId = blessingSelect.value;
        selectedVariantId = '';
        applicability.textContent = '';
        variantSelect.replaceChildren(variantPlaceholder.cloneNode(true));
        variantSelect.disabled = !selectedBlessingId;
        const blessing = grouped.get(selectedBlessingId);
        if (blessing) {
          let index = 0;
          for (const variantId of blessing.variants.keys()) {
            index += 1;
            const option = document.createElement('option');
            option.value = variantId;
            option.textContent = '變體 ' + index;
            variantSelect.append(option);
          }
        }
        populateTiers();
      };
      const onVariantChange = () => {
        selectedVariantId = variantSelect.value;
        populateTiers();
      };
      blessingSelect.addEventListener('change', onBlessingChange);
      variantSelect.addEventListener('change', onVariantChange);
      function dispose() {
        blessingSelect.removeEventListener('change', onBlessingChange);
        variantSelect.removeEventListener('change', onVariantChange);
        for (const button of tierGroup.querySelectorAll('[data-w11-tier]')) {
          button.removeEventListener('click', button.__w11SelectTier);
        }
        if (element.parentNode) element.parentNode.removeChild(element);
      }
      return Object.freeze({ element, dispose });
    }

    function selectedPatchLabel(root = document) {
      return readSelectedPatchLabel(root);
    }

    return Object.freeze({ applySkill, applyWeapon, collectSkillSlots, collectWeaponSlots, createBlessingReader, observe, observeWeapon, restore, selectedPatchLabel,
      patchSelectionRegion: (root = document) => patchSelectionRegion(root) });
  }

  return Object.freeze({ createDomAdapter, collectSkillSlots, collectWeaponSlots, readSelectedPatchLabel, patchSelectionRegion });
});
