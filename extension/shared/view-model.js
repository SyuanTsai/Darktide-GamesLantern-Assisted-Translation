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
    // 格式定案後（WP2 擴充）在此接上；不得由 bars 的 min/max 推算曲線。
    return null;
  }

  function projectWeaponAttackCombos(item) {
    // 格式定案後（WP2 擴充）在此接上。
    return null;
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
        .map(erratum => erratum.official + ' → ' + erratum.corrected + '（' + erratum.valueRef + '）'),
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
