'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadAndActivate,rollback}=require('../../extension/w01/loader-core.js');
const {
  inspectSharedPackage,loaderOptionsForPackage,createPackageFetch,createMemoryStore,REQUIRED_KINDS,DEV_ORIGIN
}=require('./shared-package-helpers.cjs');

const r1PackageDirectory=process.env.SYP_W01_SHARED_PACKAGE_DIR;
const r2PackageDirectory=process.env.SYP_W01_SHARED_PACKAGE_R2_DIR;

test('UnitT64_CompiledPackageOptionsEnableOnlyFixtureOrPendingPreview',()=>{
  // Scenario: Given package kinds presented to the shared-package loader helper.
  // Purpose: Keep the DEV path explicit for fixtures and pending previews while refusing published packages.
  assert.deepEqual(loaderOptionsForPackage({packageKind:'fixture'}),
    {allowFixture:true,allowPendingPreview:false});
  assert.deepEqual(loaderOptionsForPackage({packageKind:'pending-preview'}),
    {allowFixture:false,allowPendingPreview:true});
  assert.throws(()=>loaderOptionsForPackage({packageKind:'published'}),/not enabled for the DEV loader/i);
});

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
  assert.equal(r1.packageKind,r2.packageKind,'R1 and R2 must use the same DEV package kind.');
  assert.notEqual(r1.entry.content_version,r2.entry.content_version);
  assert.notEqual(r1.entry.data_revision,r2.entry.data_revision);
  for(const pkg of [r1,r2]){
    assert.equal(pkg.manifest.fixtureOnly,pkg.packageKind==='fixture');
    assert.equal(pkg.manifest.publicationEligible,false);
  }

  const store=createMemoryStore();
  const r1Requests=[];
  const activeR1=await loadAndActivate({
    fetchImpl:createPackageFetch(r1,r1Requests),store,
    gameVersion:r1.entry.game_version,gameReleaseId:r1.manifest.gameReleaseId,
    ...loaderOptionsForPackage(r1)
  });
  assert.equal(activeR1.dataRevision,r1.entry.data_revision);
  assert.equal(activeR1.contentVersion,r1.entry.content_version);
  assert.equal((await store.getActive(r1.manifest.gameReleaseId)).dataRevision,r1.entry.data_revision);

  const badR2={...r2,routes:new Map(r2.routes)};
  const skillsPath='/data/'+r2.entry.data_revision+'/'+r2.files.skills.path;
  const originalSkills=r2.files.skills.bytes.toString('utf8');
  const mismatchedText=originalSkills.replace('"schemaVersion"','"schemaVersioN"');
  assert.notEqual(mismatchedText,originalSkills);
  const mismatchedSkills=Buffer.from(mismatchedText,'utf8');
  assert.equal(mismatchedSkills.byteLength,r2.files.skills.sizeBytes);
  badR2.routes.set(skillsPath,mismatchedSkills);
  const failedR2Requests=[];
  await assert.rejects(loadAndActivate({
    fetchImpl:createPackageFetch(badR2,failedR2Requests),store,
    gameVersion:r2.entry.game_version,gameReleaseId:r2.manifest.gameReleaseId,
    ...loaderOptionsForPackage(r2)
  }),/skills hash mismatch/);
  const activeAfterFailure=await store.getActive(r1.manifest.gameReleaseId);
  assert.equal(activeAfterFailure.dataRevision,r1.entry.data_revision);
  assert.equal(activeAfterFailure.contentVersion,r1.entry.content_version);

  const r2Requests=[];
  const activeR2=await loadAndActivate({
    fetchImpl:createPackageFetch(r2,r2Requests),store,
    gameVersion:r2.entry.game_version,gameReleaseId:r2.manifest.gameReleaseId,
    ...loaderOptionsForPackage(r2)
  });
  assert.equal(activeR2.dataRevision,r2.entry.data_revision);
  assert.equal(activeR2.contentVersion,r2.entry.content_version);
  const rolledBack=await rollback({
    store,gameReleaseId:r1.manifest.gameReleaseId,dataRevision:r1.entry.data_revision,
    ...loaderOptionsForPackage(r1)
  });
  assert.equal(rolledBack.dataRevision,r1.entry.data_revision);
  assert.equal(rolledBack.contentVersion,r1.entry.content_version);
  assert.equal((await store.getActive(r1.manifest.gameReleaseId)).dataRevision,r1.entry.data_revision);

  for(const requests of [r1Requests,failedR2Requests,r2Requests])
    assert.ok(requests.every(request=>request.origin===DEV_ORIGIN&&request.method==='GET'));
  assert.equal(r1Requests.length,6);
  assert.equal(failedR2Requests.length,3);
  assert.equal(r2Requests.length,6);
  assert.equal(r1.manifest.fixtureOnly,r1.packageKind==='fixture');
  assert.equal(r2.manifest.fixtureOnly,r2.packageKind==='fixture');
  assert.equal(r1.manifest.publicationEligible,false);
  assert.equal(r2.manifest.publicationEligible,false);

  t.diagnostic(JSON.stringify({
    packageRoots:{r1:r1.root,r2:r2.root},
    r1:{contentVersion:r1.entry.content_version,dataRevision:r1.entry.data_revision,
      packageKind:r1.packageKind,
      manifestSha256:r1.manifestSha256,
      domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,r1.files[kind].sha256]))},
    r2:{contentVersion:r2.entry.content_version,dataRevision:r2.entry.data_revision,
      packageKind:r2.packageKind,
      manifestSha256:r2.manifestSha256,
      domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,r2.files[kind].sha256]))},
    badR2HashMismatchPreservedR1:true,
    validR2Activated:true,
    rollbackRestoredR1:true,
    localPackageRequests:r1Requests.length+failedR2Requests.length+r2Requests.length,
    liveHttpRequests:0
  },null,2));
});
