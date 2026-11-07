const test=require('node:test'); const assert=require('node:assert/strict');
const {snapshot,displayFixture}=require('../helpers/source-data-display.cjs');
const p=require('../../extension/shared/presentation.js');
// Scenario: exact anchors select occurrences in either source field. Purpose: reject missing and out-of-range matches without normalization.
test('UnitT05_精確定位勘誤',()=>{
 const item={official:{zh:'甲甲甲',en:null},name:{zh:'名稱',en:null}};
 const e={anchor:{field:'official',locale:'zh',text:'甲',occurrence:2}};
 assert.deepEqual(p.locateErratum(item,e),{field:'official',locale:'zh',start:1,end:2});
 assert.equal(p.locateErratum(item,{anchor:{...e.anchor,text:'乙'}}),null);
 assert.equal(p.locateErratum(item,{anchor:{...e.anchor,occurrence:4}}),null);
 assert.equal(p.locateErratum(item,{anchor:{...e.anchor,locale:'en'}}),null);
 assert.deepEqual(p.locateErratum(item,{anchor:{field:'name',locale:'zh',text:'名稱',occurrence:1}}),{field:'name',locale:'zh',start:0,end:2});
 assert.equal(p.locateErratum(item,{}),null);
});
// Scenario: repeated Latin and Chinese text overlaps at the second occurrence. Purpose: count overlapping matches and reject an occurrence beyond the last match.
test('UnitT06_重疊勘誤定位',()=>{
 for(const [text,anchorText] of [['aaa','aa'],['哈哈哈','哈哈']]){
  const item={official:{zh:text}}; const anchor={field:'official',locale:'zh',text:anchorText,occurrence:2};
  assert.deepEqual(p.locateErratum(item,{anchor}),{field:'official',locale:'zh',start:1,end:3});
  assert.equal(p.locateErratum(item,{anchor:{...anchor,occurrence:3}}),null);
 }
});
// Scenario: validated new documents enter the presentation boundary. Purpose: protect field projection, text guards and term context.
test('UnitT10_投影四份文件與文字防護',()=>{
 const s=snapshot(); const [a,b]=p.buildSkillViewModels(s);
 assert.equal(a.translatedName,'範例'); assert.equal(b.translatedName,null); assert.equal(b.translatedDescription,null);
 assert.deepEqual(a.detailSections.map(x=>x.heading),['效果','條件','補充','額外']);
 assert.equal(a.errata.length,1); assert.match(a.errata[0],/修正說明/);
 assert.equal(a.terms.length,1); assert.match(a.terms[0].label,/（非官方譯名）/); assert.equal(a.terms[0].contextKey,'傷害');
 assert.equal(p.locateErratum('原說明',s.documents.skills.items[0].errata[0]),null);
 const d=displayFixture(); d.skills.items[0].official.zh=null; assert.equal(p.buildSkillViewModels(snapshot(d))[0].translatedDescription,null);
});
// Scenario: aliases and fallback observations compete. Purpose: strong IDs win, unknown IDs and incomplete English never guess.
test('UnitT20_強鍵優先與完整原文比對',()=>{
 const [a,b]=p.buildSkillViewModels(snapshot()); const o={structure:'gameslantern-ability-card-v1',name:'wrong',description:'wrong',gameslanternId:'example-id'};
 assert.equal(p.matchesSkillObservation(a,o),true); assert.equal(p.matchesSkillObservation(a,{...o,gameslanternId:'wrong'}),false);
 assert.equal(p.matchesSkillObservation(a,{...o,gameslanternId:undefined,name:a.nativeName,description:a.nativeDescription}),true);
 assert.equal(p.matchesSkillObservation(b,{...o,gameslanternId:undefined,name:b.nativeName,description:b.nativeDescription}),true);
 assert.equal(p.matchesSkillObservation(b,{...o,gameslanternId:undefined,name:b.nativeName}),false);
 const fallback={...a,aliases:null,nativeName:'wrong',nativeDescription:'wrong'};
 assert.deepEqual(p.findMatchingModels([fallback,a],o,p.matchesSkillObservation),[a]);
});
// Scenario: four tiers link to two weapon marks. Purpose: retain original description and exact applicability without generated prose or curves.
test('UnitT30_祝福階級數值與武器關聯',()=>{
 const s=snapshot(); const rows=p.buildBlessingViewModels(s); assert.equal(rows.length,4);
 assert.equal(rows[0].translatedDescription,'祝福原文。'); assert.equal(rows[0].tierTable.length,4);
 assert.equal(rows[0].tierTable[3].params[1].value,'原始碼未公開');
 const [f]=p.buildWeaponFamilyViewModels(s); assert.equal(f.marks.length,2);
 assert.equal(f.marks[0].bars[0].stats[0].max,20); assert.equal(f.marks[0].blessings[0].name,'範例祝福');
 assert.equal(p.buildBlessingViewModels(s,{familyId:f.familyId,markId:f.marks[0].markId})[0].applicability.status,'verified');
 assert.deepEqual(p.buildBlessingViewModels(s,{familyId:f.familyId,markId:'missing'}),[]);
 assert.equal(p.projectWeaponCurves(s.documents.weapons.items[0]),null); assert.equal(p.projectWeaponAttackCombos(s.documents.weapons.items[0]),null);
 assert.equal(f.marks[0].curves,null); assert.equal(f.marks[0].attackCombos,null);
});
// Scenario: blessing tiers and weapon routes have both strong and fallback identities. Purpose: reject mismatched IDs, tier/context and native page facts.
test('UnitT40_祝福及武器強鍵與fallback防護',()=>{
 const s=snapshot(),row=p.buildBlessingViewModels(s)[0],mark=p.buildWeaponFamilyViewModels(s)[0].marks[0];
 const blessing={structure:'gameslantern-blessing-row-v1',name:row.nativeName,description:row.nativeDescription,tier:1};
 assert.equal(p.matchesBlessingObservation(row,blessing),true);
 assert.equal(p.matchesBlessingObservation(row,{...blessing,tier:4}),false);
 assert.equal(p.matchesBlessingObservation(row,{...blessing,description:'other'}),false);
 assert.equal(p.matchesBlessingObservation({...row,aliases:{ids:['blessing-id']}},{...blessing,name:'other',gameslanternId:'blessing-id'}),true);
 assert.equal(p.matchesBlessingObservation(row,{...blessing,familyId:'missing',markId:'missing'}),false);
 const title='Mk I Example Sword'; const weapon={structure:'gameslantern-weapon-detail-v1',href:'https://darktide.gameslantern.com/weapons/example-sword/mk-i-example-sword',title,mirrorTitle:title,imageAlt:'Header Image',imageSrc:'https://darktide.gameslantern.com/storage/sites/darktide/weapons/example.png'};
 assert.equal(p.matchesWeaponObservation(mark,weapon),true);
 for(const changed of [{title:'other'},{mirrorTitle:'other'},{imageSrc:'https://evil.invalid/example.png'},{href:'https://darktide.gameslantern.com/weapons/other/mk-i-example-sword'}])assert.equal(p.matchesWeaponObservation(mark,{...weapon,...changed}),false);
 assert.equal(p.matchesWeaponObservation({...mark,aliases:{ids:['weapon-id']}},{...weapon,title:'other',gameslanternId:'weapon-id'}),true);
 assert.equal(p.matchesWeaponObservation({...mark,aliases:{ids:['weapon-id']}},{...weapon,gameslanternId:'wrong'}),false);
 const fullTitle={...mark,nativeName:title,markLabel:'m1',familySlug:'internal-family',aliases:{ids:['not-observed'],path:'/weapons/example-sword/mk-i-example-sword'}};
 assert.equal(p.matchesWeaponObservation(fullTitle,weapon),true);
 assert.equal(p.matchesWeaponObservation(fullTitle,{...weapon,title:'other'}),false);
});
// Scenario: null and unresolved strings occur independently in names and descriptions. Purpose: guard every overwrite field while preserving valid translations and empty sections.
test('UnitT50_null與placeholder及markup不覆寫',()=>{
 for(const value of [null,'','   ','{value}','x < y','x > y']){
  const d=displayFixture();d.skills.items[0].name.zh=value;d.skills.items[0].official.zh=value;
  const model=p.buildSkillViewModels(snapshot(d))[0];assert.equal(model.translatedName,null);assert.equal(model.translatedDescription,null);
 }
 const d=displayFixture();d.skills.items[0].name.origin='glossary';d.skills.items[0].source.glossary={repo:'fixture',commit:'0'.repeat(40),path:'test',line:1};
 assert.equal(p.buildSkillViewModels(snapshot(d))[0].translatedName,'範例（非官方譯名）');
 const complete=structuredClone(d);complete.skills.items[0].explanation.calculation='計算內容';assert.deepEqual(p.buildSkillViewModels(snapshot(complete))[0].detailSections.map(x=>x.heading),['效果','條件','計算','補充','額外']);
});

// Scenario: all category items carry valid previous-version metadata. Purpose: preserve projections and matching inputs without exposing provenance.
test('UnitT15_沿用來源不影響顯示與比對',()=>{
 const original=displayFixture(), changed=structuredClone(original);
 for(const category of ['skills','weapons','blessings','terms']) for(const item of changed[category].items) item.retainedFrom={gameVersion:'9.8',sourceCommit:'a'.repeat(40),textBatch:'previous'};
 const a=snapshot(original), b=snapshot(changed);
 for(const build of [p.buildSkillViewModels,p.buildBlessingViewModels,p.buildWeaponFamilyViewModels]) assert.deepEqual(build(b),build(a));
});
