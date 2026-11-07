const test = require('node:test'); const assert = require('node:assert/strict');
const { snapshot } = require('../helpers/source-data-display.cjs');
const p = require('../../extension/shared/presentation.js');
const { createDomController } = require('../../extension/shared/dom-controller.js');
function harness() {
  const s = snapshot(), model = p.buildSkillViewModels(s)[0];
  let identity = s.identity, patch = { status: 'selected', label: 'Patch A' }, restored = 0, applied = 0;
  let observation = { structure: 'gameslantern-ability-card-v1', name: model.nativeName, description: model.nativeDescription };
  const anchor = {}, slot = { anchor, identityKey: 'original' };
  const adapter = { selectedPatchLabel: () => patch, collectSkillSlots: () => [slot], collectWeaponSlots: () => [], observe: () => observation,
    applySkill: () => { applied++; return { changes: [], identityKey: slot.identityKey }; }, restore: () => { restored++; } };
  const document = { querySelectorAll: () => [] };
  const controller = createDomController({ document, adapter, getNativeSnapshotBytes: () => new Uint8Array([1]),
    identityResolver: { resolve: async () => ({ status: 'verified', identity, patchLabel: 'Patch A' }) },
    client: { initialize: async () => ({ status: 'ready', snapshot: s, identity: s.identity }) } });
  return { controller, slot, get restored() { return restored; }, get applied() { return applied; },
    setIdentity: value => { identity = value; }, setPatch: value => { patch = value; }, setObservation: value => { observation = value; }, identity: s.identity };
}
// Scenario: patch selection changes after a matching document was translated. Purpose: restore all writes and keep the document stopped.
test('UnitT10_patch切換與模糊狀態還原原文', async () => {
  for (const patch of [{ status: 'selected', label: 'Patch B' }, { status: 'ambiguous' }]) {
    const h = harness(); await h.controller.start(); assert.equal(h.controller.getState().status, 'ready');
    h.setPatch(patch); await h.controller.scan(); assert.equal(h.controller.getState().status, 'original'); assert.equal(h.restored, 1);
    h.setPatch({ status: 'selected', label: 'Patch A' }); await h.controller.scan(); assert.equal(h.applied, 1); h.controller.dispose();
  }
});
// Scenario: any of four snapshot identity fields changes with the same English text. Purpose: same-text cross-version reuse is rejected.
test('UnitT20_快照四欄任一變更皆還原且停止', async () => {
  for (const key of ['schemaVersion', 'gameVersion', 'sourceCommit', 'textBatch']) {
    const h = harness(); await h.controller.start(); h.setIdentity({ ...h.identity, [key]: 'changed' }); await h.controller.scan();
    assert.equal(h.controller.getState().reason, 'identity-changed'); assert.equal(h.restored, 1); h.controller.dispose();
  }
});
// Scenario: unmatched content or a reused slot is seen, then the user disables translation. Purpose: no guessing and reversible document writes.
test('UnitT30_不匹配保留原文且停用會還原', async () => {
  const h = harness(); h.setObservation({ structure: 'gameslantern-ability-card-v1', name: 'other', description: 'other' });
  await h.controller.start(); assert.equal(h.applied, 0); assert.equal(h.controller.getState().status, 'original'); h.controller.dispose();
  const enabled = harness(); await enabled.controller.start(); await enabled.controller.setEnabled(false); assert.equal(enabled.restored, 1);
  await enabled.controller.setEnabled(true); assert.equal(enabled.applied, 2); enabled.slot.identityKey = 'reused'; await enabled.controller.scan();
  assert.equal(enabled.restored, 2); assert.equal(enabled.applied, 2); enabled.controller.dispose();
});

// Scenario: an actual adapter and controller rescan marked detail text and then see an unexpected site element. Purpose: retain owned marks while rejecting changed source structure.
test('InterT05_實際控制器重掃勘誤與結構變更', async () => {
 const {displayFixture}=require('../helpers/source-data-display.cjs');
 const {createDocument,descendants}=require('../helpers/display-dom.cjs');
 const {createDomAdapter}=require('../../extension/shared/dom-adapter.js');
 for(const field of ['name','official']) {
  const data=displayFixture(), text=field==='name'?'範例':'中文';
  data.skills.items[0].errata=[{locale:'zh',official:text,corrected:'修正',valueRef:'/values/params/bonus',anchor:{field,locale:'zh',text,occurrence:1}}];
  const s=snapshot(data), document=createDocument(); document.nodeType=9; document.location={href:'https://darktide.gameslantern.com/abilities/example',pathname:'/abilities/example'};
  document.defaultView.addEventListener=()=>{}; document.defaultView.removeEventListener=()=>{};
  const container=document.createElement('div'), name=document.createElement('div'), description=document.createElement('div');
  container.matches=selector=>selector==='div.shadow-md.border.max-w-sm'; name.textContent='Example';
  for(const [i,part] of data.skills.items[0].official.en.split('\n\n').entries()){if(i)description.append(document.createElement('br'),document.createElement('br'));description.append(document.createTextNode(part));}
  container.append(name,description); Object.defineProperty(name,'nextElementSibling',{get:()=>description});
  container.querySelectorAll=selector=>selector==='div.text-lg'?[name]:selector==='div.font-normal.leading-5'?[description]:[];
  description.querySelectorAll=selector=>selector==='br'?descendants(description,n=>n.tagName==='BR'):selector==='*'?descendants(description,n=>n.nodeType===1):[];
  document.querySelectorAll=selector=>selector==='div.shadow-md.border.max-w-sm'?[container]:[];
  const actual=createDomAdapter({document}), adapter={...actual,collectWeaponSlots:()=>[],selectedPatchLabel:()=>({status:'absent'})};
  const controller=createDomController({document,adapter,getNativeSnapshotBytes:()=>new Uint8Array([1]),identityResolver:{resolve:async()=>({status:'verified',identity:s.identity})},client:{initialize:async()=>({status:'ready',snapshot:s,identity:s.identity})}});
  await controller.start(); for(let i=0;i<4;i++){await controller.scan();assert.equal(controller.getState().status,'ready');assert.equal(descendants(container,n=>n.tagName==='MARK').length,1);}
  name.append(document.createElement('em')); await controller.scan(); assert.equal(controller.getState().status,'original'); assert.equal(descendants(container,n=>n.tagName==='MARK').length,0);
  await controller.setEnabled(false); assert.equal(descendants(container,n=>n.tagName==='MARK').length,0); controller.dispose();
 }
});
