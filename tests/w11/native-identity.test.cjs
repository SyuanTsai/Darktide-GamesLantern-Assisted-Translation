const test=require('node:test');const assert=require('node:assert/strict');const {createHash,webcrypto}=require('node:crypto');
const {snapshot}=require('../helpers/source-data-display.cjs');const {createNativeIdentityResolver,matchAlias}=require('../../extension/shared/native-identity.js');
// Scenario: only an exact registered byte digest resolves. Purpose: test harness cannot infer identity from labels or arbitrary bytes.
test('UnitT10_本機證據只接受精確digest與新identity',async()=>{
 const bytes=Buffer.from('isolated fixture');const identity=snapshot().identity;
 const resolver=createNativeIdentityResolver({cryptoApi:webcrypto,proofs:[{evidenceId:'test',sha256:createHash('sha256').update(bytes).digest('hex'),identity,patchLabel:'Patch'}]});
 assert.deepEqual((await resolver.resolve(bytes)).identity,identity);assert.equal((await resolver.resolve(Buffer.from('other'))).status,'unknown');
 assert.throws(()=>createNativeIdentityResolver({cryptoApi:webcrypto,proofs:[{evidenceId:'bad',sha256:'a'.repeat(64),identity:{gameVersion:'9.8.7'}}]}));
});
// Scenario: a route slug or title resembles an ID. Purpose: only directly observed IDs enable strong matching.
test('UnitT20_別名比對不由path猜ID',()=>{
 const aliases={ids:['id'],path:'/abilities/example'};
 assert.equal(matchAlias(aliases,{gameslanternId:'id'}),true);assert.equal(matchAlias(aliases,{gameslanternId:'other'}),false);
 assert.equal(matchAlias(aliases,{path:'/abilities/example'}),null);assert.equal(matchAlias(null,{gameslanternId:'id'}),null);
});
