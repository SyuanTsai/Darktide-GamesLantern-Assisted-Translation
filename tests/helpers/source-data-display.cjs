const { fixture } = require('./source-data-fixture.cjs');
const contract = require('../../extension/shared/source-data-contract.js');
function displayFixture() {
  const data = fixture('9.8.7');
  const skill = data.skills.items[0];
  skill.name = { en: 'Example', zh: '範例', origin: 'official' };
  skill.official = { en: 'Complete English description.\n\nSecond paragraph.', zh: '完整中文描述。\n\n第二段。' };
  skill.aliases = { gameslantern: { ids: ['example-id'], path: '/abilities/example' } };
  skill.explanation = { effect: '效果內容', conditions: '條件內容', calculation: '', notes: '補充內容', extra: '額外內容' };
  skill.errata = [ {locale:'zh', official:'原說明', corrected:'修正說明', valueRef:'/values/params/bonus'},
    {locale:'en', official:'old', corrected:'new', valueRef:'/values/params/bonus'} ];
  const other = structuredClone(skill); other.id += '_other'; other.key = 'other'; delete other.aliases;
  other.name = {en:'Other', zh:null, origin:'official'};
  other.official = {en:'Other English description.', zh:'提升 {bonus}。'};
  data.skills.items.push(other);
  const weapon = data.weapons.items[0];
  weapon.name = {en:'Example Sword', zh:'範例劍', origin:'official'};
  weapon.official = {en:'Sword.', zh:'劍的說明。'};
  weapon.values.family = 'example-sword'; weapon.values.mark = 'Mk I';
  weapon.values.actions = [{slot:'primary',id:'light',type:'light',name:{en:'Slash',zh:'斬擊'}}];
  weapon.values.bars = [{id:'damage',name:{en:'Damage',zh:'傷害'},stats:[{key:'damage',name:{en:'Damage',zh:'傷害'},min:10,max:20}]}];
  const mark2 = structuredClone(weapon); mark2.id += '_mk2'; mark2.key += '_mk2'; mark2.values.mark = 'Mk II';
  data.weapons.items.push(mark2);
  const blessing = data.blessings.items[0];
  blessing.name = {en:'Example Blessing',zh:'範例祝福',origin:'official'};
  blessing.official = {en:'Blessing description.',zh:'祝福原文。'};
  blessing.values.weapons = [weapon.id,mark2.id];
  blessing.values.tiers = [1,2,3,4].map(tier=>({tier,params:{bonus:{value:tier,unit:'percent'},hidden:{value:null,unknown:'NOT_EXPOSED_BY_SOURCE'}}}));
  weapon.values.blessings = mark2.values.blessings = [blessing.id];
  const term = data.terms.items[0];
  term.name = {en:'Power',zh:'威力',origin:'glossary'};
  term.source.glossary = {repo:'fixture',commit:'0'.repeat(40),path:'glossary',line:1};
  term.values.context = '傷害'; term.values.refs = [skill.id,weapon.id,blessing.id]; term.explanation.effect = '術語定義';
  const term2=structuredClone(term); term2.id += '_other'; term2.key += '_other'; term2.values.context='其他'; term2.values.refs=[other.id];
  data.terms.items.push(term2);
  return data;
}
function snapshot(data = displayFixture()) {
  return contract.validateSnapshot({current:data.current,documents:Object.fromEntries(['skills','weapons','blessings','terms'].map(k=>[k,data[k]]))});
}
module.exports = { displayFixture, snapshot };
