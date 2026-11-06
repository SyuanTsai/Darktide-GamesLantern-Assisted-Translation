(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.W11SharedViewModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const SECTION_ORDER = Object.freeze([
    ['effect', '效果'], ['conditions', '條件'], ['calculation', '計算'],
    ['notes', '補充'], ['extra', '額外']
  ]);

  function safeText(value) {
    return typeof value === 'string' && value.trim() && !/[{}<>]/.test(value) ? value : null;
  }

  function localizedName(item) {
    const text = safeText(item.name.zh);
    return text ? text + (item.name.origin === 'glossary' ? '（非官方譯名）' : '') : null;
  }

  function parameters(params) {
    return Object.entries(params || {}).map(([key, param]) => ({
      key,
      value: param.unknown ? '原始碼未公開'
        : Array.isArray(param.value) ? param.value.map(value => value === null ? '原始碼未公開' : String(value)).join('、')
          : String(param.value),
      unit: param.unit || ''
    }));
  }

  function locateErratum(text, erratum) {
    // 待 WP3 定案定位欄位（精確子字串與出現次序）後在此接上；目前不搜尋或猜測位置。
    return null;
  }

  function projectWeaponCurves(item) {
    const curves = (item.values.curves || []).filter(c => c.interpolation !== 'unknown' && !c.unknown && c.knots.length === 2 && c.knots.every(k => k.output !== null && (!Array.isArray(k.output) || k.output.length > 0)));
    const result = curves.map(c => { const stat = item.values.bars.flatMap(b => b.stats).find(s => s.curveId === c.id); return { label: stat?.name.zh || stat?.name.en || '', inputUnit: c.input.unit, outputUnit: c.outputUnit || '', knots: c.knots }; });
    return result.length ? result : null;
  }

  function projectWeaponAttackCombos(item) {
    const result = (item.values.attackCombos || []).filter(c => !c.unknown && c.steps.length > 0).map(c => ({ label: c.kind === 'light' ? '輕擊連段' : '重擊連段', steps: c.steps.map(s => ({ label: s.name.zh || s.name.en || '', kind: c.kind })) }));
    return result.length ? result : null;
  }

  // Called only at the presentation boundary with a spec1-validated document set.
  function projectItem(item, documents) {
    return {
      id: item.id,
      entityRef: { recordId: item.id },
      aliases: item.aliases?.gameslantern || null,
      nativeName: item.name.en,
      nativeDescription: item.official.en,
      translatedName: localizedName(item),
      translatedDescription: safeText(item.official.zh),
      translationParams: {},
      detailSections: SECTION_ORDER.filter(([key]) => item.explanation[key].trim())
        .map(([key, heading]) => ({ sectionId: key, heading, items: [item.explanation[key]] })),
      errata: item.errata.filter(erratum => erratum.locale === 'zh'
        && locateErratum(item.official.zh, erratum) === null)
        .map(erratum => erratum.official + ' → ' + erratum.corrected),
      terms: documents.terms.items.filter(term => term.values.refs.includes(item.id) && localizedName(term))
        .map(term => {
          const label = localizedName(term);
          const contextKey = term.values.context;
          return {
            label, definition: term.explanation.effect, contextKey, termRef: { recordId: term.id },
            text: label + (contextKey ? '（' + contextKey + '）' : '') + '：' + term.explanation.effect
          };
        }),
      params: parameters(item.values.params)
    };
  }

  return Object.freeze({ SECTION_ORDER, safeText, localizedName, parameters, projectItem,
    locateErratum, projectWeaponCurves, projectWeaponAttackCombos });
});
