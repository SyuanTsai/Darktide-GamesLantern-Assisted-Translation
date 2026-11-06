const test=require('node:test');const assert=require('node:assert/strict');
const {snapshot}=require('../helpers/source-data-display.cjs');const p=require('../../extension/shared/presentation.js');
const {createProductionDatasetResolver}=require('../../extension/shared/production-dataset.js');const {serializeNativeSnapshot,identityText,stateText}=require('../../extension/shared/content-entry.js');
function evidence(s,patch={status:'selected',label:'Fixture patch'},change={}){const m=p.buildSkillViewModels(s)[0];return serializeNativeSnapshot({pathname:'/abilities/example',patch,skills:[{structure:'gameslantern-ability-detail-v1',name:m.nativeName,description:m.nativeDescription,...change}],weapons:[]});}
// Scenario: validated snapshot has a version never built into the extension. Purpose: remove fixed release selection, pin first resolution and show new identity.
test('UnitT10_信任快照identity與文件固定',async()=>{
 const s=snapshot();let calls=0;const resolver=createProductionDatasetResolver({loadSnapshot:async()=>{calls++;return{status:'ready',snapshot:s,identity:s.identity};}});
 const proof=await resolver.resolve(evidence(s));assert.equal(proof.status,'verified');assert.deepEqual(proof.identity,s.identity);
 assert.equal(proof.patchLabel,'Fixture patch');await resolver.resolve(evidence(s));assert.equal(calls,1);
 assert.equal(await resolver.loadPinnedSnapshotForReading(),s);assert.equal(identityText(s.identity),'9.8.7／0000000／example-batch');
 assert.match(stateText({status:'ready'},{status:'ready',snapshot:s}),/9\.8\.7／0000000／example-batch/);
});
// Scenario: observed text, alias or patch state is inconsistent. Purpose: preserve original and never infer a release from familiar labels.
test('UnitT20_比對失敗或模糊patch不套用',async()=>{
 const s=snapshot();const resolver=createProductionDatasetResolver({loadSnapshot:async()=>({status:'ready',snapshot:s,identity:s.identity})});
 assert.equal((await resolver.resolve(evidence(s,{status:'ambiguous'}))).status,'unknown');
 assert.equal((await resolver.resolve(evidence(s,undefined,{description:'other'}))).status,'unknown');
 assert.equal((await resolver.resolve(evidence(s,undefined,{gameslanternId:'example-id',name:'changed',description:'changed'}))).status,'verified');
 assert.equal((await resolver.resolve(evidence(s,undefined,{gameslanternId:'wrong'}))).status,'unknown');
 for(const key of ['schemaVersion','gameVersion','sourceCommit','textBatch']){const bad=createProductionDatasetResolver({loadSnapshot:async()=>({status:'ready',snapshot:s,identity:{...s.identity,[key]:'wrong'}})});assert.equal((await bad.resolve(evidence(s))).status,'unknown');}
});
