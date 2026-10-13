'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadAndActivate,rollback}=require('../../extension/w01/loader-core.js');
const {
  inspectSharedPackage,createPackageFetch,createMemoryStore,REQUIRED_KINDS,DEV_ORIGIN
}=require('./shared-package-helpers.cjs');

const r1PackageDirectory=process.env.SYP_W01_SHARED_PACKAGE_DIR;
const r2PackageDirectory=process.env.SYP_W01_SHARED_PACKAGE_R2_DIR;

// Scenario: Given frozen R1 and R2 Web package roots, then an R1 activation, hash-mismatched R2, valid R2, and rollback.
// Purpose: Bind compiled Web bytes to the one active snapshot, preserve R1 on failure, and verify legal same-release rollback without live HTTP.
test('InterT12_CompiledWebR1AndR2PackagesActivateAndRollbackAsVerifiedSnapshots',{
  skip:!r1PackageDirectory||!r2PackageDirectory?
    'Set SYP_W01_SHARED_PACKAGE_DIR and SYP_W01_SHARED_PACKAGE_R2_DIR to frozen private Web package roots.':false
},async t=>{
  const r1=inspectSharedPackage(r1PackageDirectory);
  const r2=inspectSharedPackage(r2PackageDirectory);
  assert.equal(r1.entry.game_version,r2.entry.game_version);
  assert.equal(r1.manifest.gameReleaseId,r2.manifest.gameReleaseId);
  assert.notEqual(r1.entry.content_version,r2.entry.content_version);
  assert.notEqual(r1.entry.data_revision,r2.entry.data_revision);

  const store=createMemoryStore();
  const r1Requests=[];
  const activeR1=await loadAndActivate({
    fetchImpl:createPackageFetch(r1,r1Requests),store,
    gameVersion:r1.entry.game_version,gameReleaseId:r1.manifest.gameReleaseId,allowFixture:true
  });
  assert.equal(activeR1.dataRevision,r1.entry.data_revision);
  assert.equal(activeR1.contentVersion,r1.entry.content_version);
  assert.equal((await store.getActive(r1.manifest.gameReleaseId)).dataRevision,r1.entry.data_revision);

  const badR2={...r2,routes:new Map(r2.routes)};
  const skillsPath='/data/'+r2.entry.data_revision+'/'+r2.files.skills.path;
  const originalSkills=r2.files.skills.bytes.toString('utf8');
  const mismatchedSkills=originalSkills.replace('"fixture:skill:smite"','"fixture:skill:smita"');
  assert.notEqual(mismatchedSkills,originalSkills);
  assert.equal(Buffer.byteLength(mismatchedSkills),r2.files.skills.sizeBytes);
  badR2.routes.set(skillsPath,Buffer.from(mismatchedSkills,'utf8'));
  const failedR2Requests=[];
  await assert.rejects(loadAndActivate({
    fetchImpl:createPackageFetch(badR2,failedR2Requests),store,
    gameVersion:r2.entry.game_version,gameReleaseId:r2.manifest.gameReleaseId,allowFixture:true
  }),/skills hash mismatch/);
  const activeAfterFailure=await store.getActive(r1.manifest.gameReleaseId);
  assert.equal(activeAfterFailure.dataRevision,r1.entry.data_revision);
  assert.equal(activeAfterFailure.contentVersion,r1.entry.content_version);

  const r2Requests=[];
  const activeR2=await loadAndActivate({
    fetchImpl:createPackageFetch(r2,r2Requests),store,
    gameVersion:r2.entry.game_version,gameReleaseId:r2.manifest.gameReleaseId,allowFixture:true
  });
  assert.equal(activeR2.dataRevision,r2.entry.data_revision);
  assert.equal(activeR2.contentVersion,r2.entry.content_version);
  const rolledBack=await rollback({
    store,gameReleaseId:r1.manifest.gameReleaseId,dataRevision:r1.entry.data_revision,allowFixture:true
  });
  assert.equal(rolledBack.dataRevision,r1.entry.data_revision);
  assert.equal(rolledBack.contentVersion,r1.entry.content_version);
  assert.equal((await store.getActive(r1.manifest.gameReleaseId)).dataRevision,r1.entry.data_revision);

  for(const requests of [r1Requests,failedR2Requests,r2Requests])
    assert.ok(requests.every(request=>request.origin===DEV_ORIGIN&&request.method==='GET'));
  assert.equal(r1Requests.length,6);
  assert.equal(failedR2Requests.length,3);
  assert.equal(r2Requests.length,6);
  assert.equal(r1.manifest.fixtureOnly,true);
  assert.equal(r2.manifest.fixtureOnly,true);
  assert.equal(r1.manifest.publicationEligible,false);
  assert.equal(r2.manifest.publicationEligible,false);

  t.diagnostic(JSON.stringify({
    packageRoots:{r1:r1.root,r2:r2.root},
    r1:{contentVersion:r1.entry.content_version,dataRevision:r1.entry.data_revision,
      manifestSha256:r1.manifestSha256,
      domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,r1.files[kind].sha256]))},
    r2:{contentVersion:r2.entry.content_version,dataRevision:r2.entry.data_revision,
      manifestSha256:r2.manifestSha256,
      domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,r2.files[kind].sha256]))},
    badR2HashMismatchPreservedR1:true,
    validR2Activated:true,
    rollbackRestoredR1:true,
    localPackageRequests:r1Requests.length+failedR2Requests.length+r2Requests.length,
    liveHttpRequests:0
  },null,2));
});