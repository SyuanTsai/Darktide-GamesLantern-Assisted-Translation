'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DEV_ORIGIN,rollback,REQUIRED_KINDS,verifyStoredSnapshot}=require('../../extension/w01/loader-core.js');
const {GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,createRelease,refreshVersion,rewriteDomain,MemoryStore,activate,json,digest}=require('./fixtures.cjs');
test('UnitT10_LoadsOnlyTheRequiredSharedDomainsAndActivatesOneSnapshot',async()=>{
  // Scenario: Given a valid v17-D preview version, shared manifest, source registry, and four domain files.
  // Purpose: Verify exact byte hashes, dependency closure, fixed HTTPS origin, record references, and atomic snapshot handoff.
  const r=createRelease(),store=new MemoryStore();
  const {result}=await activate(r,store);
  assert.deepEqual(REQUIRED_KINDS,['skills','blessings','weapons','terms']);
  assert.equal(result.gameReleaseId,GAME_RELEASE_ID);
  assert.equal(result.gameVersion,GAME_VERSION);
  assert.equal(result.dataRevision,r.dataRevision);
  assert.deepEqual(Object.keys(result.files).sort(),['blessings','skills','terms','weapons']);
  assert.equal(result.domains.skills.records.find(record=>record.kind==='presentation').payload.official.sourceText,
    'Cooldown < 40 seconds & still literal.');
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,r.dataRevision);
  assert.equal(r.fetches[0],DEV_ORIGIN+'/version.json');
  assert.ok(r.fetches.every(url=>new URL(url).origin===DEV_ORIGIN));
  assert.ok(!r.fetches.some(url=>url.endsWith('/game-changes.json')));
});

test('UnitT20_RejectsUnsafeManifestAndDomainPathsBeforeExternalFetch',async()=>{
  // Scenario: Given a version entry or file path that attempts traversal, an absolute URL, or a case variant.
  // Purpose: Ensure no manifest-controlled path can escape the fixed preview origin or data revision.
  const cases=[
    r=>{r.version.game_releases[0].manifest_path='https://evil.test/manifest.json';r.routes.set('/version.json',json(r.version));},
    r=>{r.version.game_releases[0].manifest_path='/data/../manifest.json';r.routes.set('/version.json',json(r.version));},
    r=>{r.manifest.files.find(x=>x.kind==='skills').path='../skills.json';refreshVersion(r);},
    r=>{r.manifest.files.find(x=>x.kind==='terms').path='Terms.json';refreshVersion(r);}
  ];
  for(const mutate of cases){
    const r=createRelease();mutate(r);
    await assert.rejects(()=>activate(r),/path|revision|origin|manifest/i);
    assert.ok(r.fetches.every(url=>new URL(url).origin===DEV_ORIGIN));
    assert.equal(r.fetches.some(url=>new URL(url).origin==='https://evil.test'),false);
  }
});

test('UnitT30_RejectsUnknownFeaturesMissingDependenciesAndWrongGameIdentity',async()=>{
  // Scenario: Given a shared manifest with an unknown feature, incomplete dependency graph, or another game release ID.
  // Purpose: Fail closed instead of partially enabling data for a different patch or unsupported contract.
  const edits=[
    r=>{r.manifest.compatibility.requiredFeatures.push('execute-remote-template-v1');refreshVersion(r);},
    r=>{r.manifest.files.find(x=>x.kind==='blessings').dependencies=['weapons'];refreshVersion(r);},
    r=>{r.manifest.gameReleaseId='another-release';refreshVersion(r);}
  ];
  for(const mutate of edits){
    const r=createRelease(),store=new MemoryStore();mutate(r);
    await assert.rejects(()=>activate(r,store),/feature|depend|release|identity|compatib/i);
    assert.equal(await store.getActive(GAME_RELEASE_ID),null);
  }
  const r=createRelease();await assert.rejects(()=>activate(r,new MemoryStore(),{gameVersion:'1.13.2'}),/release|version|patch|match/i);
});

test('UnitT40_RejectsBadMimeSizeHashAndFixtureOutsideDevMode',async()=>{
  // Scenario: Given a bad response or preview fixture presented to a non-development loader.
  // Purpose: Prevent malformed, oversized, unhashed, or fixture-only bytes from reaching activation.
  const cases=[
    r=>r.types.set('/version.json','text/html'),
    r=>r.types.set('/data/'+r.dataRevision+'/skills.json','text/plain'),
    r=>r.routes.set('/data/'+r.dataRevision+'/skills.json',Buffer.alloc(3*1024*1024,0x41)),
    r=>r.routes.set('/data/'+r.dataRevision+'/skills.json',Buffer.from('{"schemaVersion":"2.0.0"}'))
  ];
  for(const mutate of cases){
    const r=createRelease(),store=new MemoryStore();mutate(r);
    await assert.rejects(()=>activate(r,store),/mime|size|hash|json|schema|response/i);
    assert.equal(await store.getActive(GAME_RELEASE_ID),null);
  }
  const r=createRelease();
  await assert.rejects(()=>activate(r,new MemoryStore(),{allowFixture:false}),/fixture|publication|eligible/i);
});

test('UnitT50_RejectsUnknownRefsMissingPresentationAndRemoteExecutableFields',async()=>{
  // Scenario: Given a shared record with unresolved source/claim refs, a missing localized presentation, or remote code fields.
  // Purpose: Require A/D identity and safe content envelopes while preserving literal official text characters.
  const mutations=[
    r=>rewriteDomain(r,'skills',doc=>{doc.records[0].sourceRefs=['missing-source'];}),
    r=>rewriteDomain(r,'skills',doc=>{doc.records[0].payload.claimRefs=['missing-claim'];}),
    r=>rewriteDomain(r,'skills',doc=>{doc.records=doc.records.filter(record=>record.kind!=='presentation');}),
    r=>rewriteDomain(r,'skills',doc=>{doc.records[0].payload.htmlTemplate='<div>unsafe</div>';}),
    r=>rewriteDomain(r,'skills',doc=>{delete doc.records[0].recordId;})
  ];
  for(const mutate of mutations){
    const r=createRelease();mutate(r);
    await assert.rejects(()=>activate(r),/ref|presentation|template|record|identity|schema/i);
  }
});

test('UnitT55_EnforcesOwnerScopedWebRefsOfficialHashesAndASections',async()=>{
  // Scenario: Given a syntactically valid shared domain with a forged owner ref, official digest, or incomplete A shape.
  // Purpose: Keep Web-owned wording separate from Source evidence and preserve the pinned A fields byte-for-byte.
  const mutations=[
    {mutate:r=>rewriteDomain(r,'skills',doc=>{
      doc.records.find(record=>record.kind==='presentation').sourceRefs=['fixture-source'];
    }),pattern:/source references are missing or unknown/i},
    {mutate:r=>rewriteDomain(r,'skills',doc=>{
      doc.records.find(record=>record.kind==='presentation').payload.official.sourceRef='fixture-source';
    }),pattern:/official source reference is unknown/i},
    {mutate:r=>rewriteDomain(r,'weapons',doc=>{
      doc.records.find(record=>record.kind==='weapon').payload.dataCoverage.missing=[
        {field:'synthetic',reasonCode:'FIXTURE',sourceRef:'fixture-web-source'}
      ];
    }),pattern:/owner-scoped source reference/i},
    {mutate:r=>rewriteDomain(r,'skills',doc=>{
      doc.records.find(record=>record.kind==='presentation').payload.official.sourceText+=' extra';
    }),pattern:/source text hash mismatch/i},
    {mutate:r=>rewriteDomain(r,'skills',doc=>{
      doc.records.find(record=>record.kind==='presentation').payload.errata[0].anchor.sourceTextDigest='0'.repeat(64);
    }),pattern:/erratum anchor does not match/i},
    {mutate:r=>rewriteDomain(r,'skills',doc=>{
      delete doc.records.find(record=>record.kind==='presentation').payload.detailSections.notes;
    }),pattern:/detail sections fields are invalid/i},
    {mutate:r=>rewriteDomain(r,'skills',doc=>{doc.sourceRevision='f'.repeat(64);}),
      pattern:/game release identity is incompatible/i},
    {mutate:r=>{r.manifest.web.references[0].sourceId='fixture-source';refreshVersion(r);},
      pattern:/registries overlap/i}
  ];
  for(const {mutate,pattern} of mutations){
    const release=createRelease();mutate(release);
    await assert.rejects(()=>activate(release),pattern);
  }
});

test('UnitT60_FailedUpdateKeepsActiveAndLegalRollbackSelectsOlderSameRelease',async()=>{
  // Scenario: Given r1 active, an invalid r2 attempt, then a valid r2 while r1 remains cached.
  // Purpose: Verify failed update preservation and rollback only to an available older compatible snapshot.
  const r1=createRelease({dataRevision:DATA_R1,contentVersion:'0.0.1'});
  const store=new MemoryStore();await activate(r1,store);
  const activeBefore=await store.getActive(GAME_RELEASE_ID);
  const r2=createRelease({dataRevision:DATA_R2,contentVersion:'0.0.2'});
  r2.routes.set('/data/'+DATA_R2+'/skills.json',Buffer.from('tampered'));
  await assert.rejects(()=>activate(r2,store),/hash|size|schema|json/i);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,activeBefore.dataRevision);
  const r2good=createRelease({dataRevision:DATA_R2,contentVersion:'0.0.2'});
  await activate(r2good,store);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,DATA_R2);
  const restored=await rollback({store,gameReleaseId:GAME_RELEASE_ID,dataRevision:DATA_R1});
  assert.equal(restored.dataRevision,DATA_R1);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,DATA_R1);
  await assert.rejects(()=>rollback({store,gameReleaseId:GAME_RELEASE_ID,dataRevision:DATA_R2}),/older|rollback|version/i);
  await assert.rejects(()=>rollback({store,gameReleaseId:'another-release',dataRevision:DATA_R1}),/snapshot|release|identity/i);
});

test('UnitT70_StorageCommitFailureNeverReplacesTheCurrentSnapshot',async()=>{
  // Scenario: Given r1 active and a storage transaction failure while r2 is staged.
  // Purpose: Preserve r1 whenever the atomic active-pointer transaction cannot commit.
  const r1=createRelease({dataRevision:DATA_R1,contentVersion:'0.0.1'});
  const store=new MemoryStore();await activate(r1,store);
  const r2=createRelease({dataRevision:DATA_R2,contentVersion:'0.0.2'});
  store.failCommit=true;
  await assert.rejects(()=>activate(r2,store),/commit failure/i);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,DATA_R1);
});

test('UnitT80_StoredSnapshotCannotRebindOneDomainOutsideItsManifest',async()=>{
  // Scenario: Given a cached valid snapshot whose skill bytes are changed and locally rehashed.
  // Purpose: Bind every cached domain to the original verified manifest so offline use cannot accept a mixed snapshot.
  const {verifyStoredSnapshot}=require('../../extension/w01/loader-core.js');
  const release=createRelease(),store=new MemoryStore();
  await activate(release,store);
  const cached=await store.getSnapshot(GAME_RELEASE_ID,release.dataRevision);
  await verifyStoredSnapshot(cached);
  const document=JSON.parse(Buffer.from(cached.files.skills.bytes).toString('utf8'));
  document.records.find(record=>record.kind==='presentation').payload.name='偽造技能';
  const bytes=json(document);
  cached.files.skills.bytes=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  cached.files.skills.sizeBytes=bytes.length;
  cached.files.skills.sha256=digest(bytes);
  await assert.rejects(()=>verifyStoredSnapshot(cached),/stored domain metadata differs from manifest: skills/i);
});
