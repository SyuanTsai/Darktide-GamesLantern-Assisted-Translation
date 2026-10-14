'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DEV_ORIGIN,rollback,REQUIRED_KINDS,verifyStoredSnapshot}=require('../../extension/w01/loader-core.js');
const {GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,createRelease,refreshVersion,rewriteDomain,MemoryStore,activate,json,digest,
  tieredNativeRelease}=require('./fixtures.cjs');
const {nativeRelease}=require('./native-fixtures.cjs');
function addPublicSourceLocator(release){
  const reference=release.manifest.source.references[0];
  reference.fixtureOnly=false;
  reference.repository='https://github.com/Aussiemon/Darktide-Source-Code';
  reference.commit='a'.repeat(40);
  reference.path='scripts/settings/equipment/weapon_templates/chain_axes/example.lua';
  reference.snapshot={commit:reference.commit};
  refreshVersion(release);
  return release;
}
const MODS_ANALYSIS_LOCATOR=Object.freeze({
  sourceId:'legacy:mods:psyker:brain-burst-improved:analysis-en',
  repository:'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
  commit:'241ad76ce62330472aa423055a5b85db59bb6c0d',
  path:'Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md'
});
function addModsAnalysisLocator(release){
  release.manifest.source.references.push({
    ...MODS_ANALYSIS_LOCATOR,
    fixtureOnly:false,
    safeSummary:'Public analysis reference for the Psyker Brain Burst Improved skill.',
    snapshot:{commit:MODS_ANALYSIS_LOCATOR.commit}
  });
  refreshVersion(release);
  return release;
}
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

test('UnitT56_PendingPreviewRequiresAnExplicitDevOptIn',async()=>{
  // Scenario: Given a non-fixture, non-published pending-preview package at the fixed preview origin.
  // Purpose: Keep candidate data unavailable unless the DEV loader explicitly enables pending previews.
  const release=nativeRelease();
  await assert.rejects(()=>activate(release,new MemoryStore()),/pending-preview.*disabled|pending preview.*disabled/i);
});

test('UnitT57_AcceptsNativeOfficialZhTwWithHashIdentityAndExactNumberBinding',async()=>{
  // Scenario: Given synthetic native EN and zh-TW source spans keyed by an eight-hex hash with a null reverse key.
  // Purpose: Preserve both official templates and resolve only the bound decimal while retaining the zh-TW unit.
  const release=nativeRelease(),store=new MemoryStore();
  const {result}=await activate(release,store,{allowPendingPreview:true});
  const official=result.domains.skills.records.find(item=>item.kind==='presentation').payload.official;
  const localized=official.localizations['zh-TW'];
  assert.equal(official.key,null);
  assert.equal(official.sourceHash,'a1b2c3d4');
  assert.equal(official.occurrence,1);
  assert.equal(official.segments.map(item=>item.text).join(''),official.sourceText);
  assert.equal(official.resolvedText,'Synthetic cooldown 35 seconds.');
  assert.equal(official.params[0].bindingRef,'fixture:claim:a');
  assert.equal(localized.origin,'official');
  assert.equal(localized.key,'fixture.cooldown.zh');
  assert.equal(localized.sourceHash,'b1b2c3d4');
  assert.equal(localized.occurrence,2);
  assert.equal(localized.sourceText,'合成冷卻 {cooldown:%s} 秒。');
  assert.equal(localized.resolvedText,'合成冷卻 35 秒。');
  assert.equal(localized.text,localized.resolvedText);
  assert.equal(result.manifest.fixtureOnly,false);
  assert.equal(result.manifest.publicationEligible,false);
  const stored=await store.getSnapshot(GAME_RELEASE_ID,release.dataRevision);
  await assert.rejects(()=>verifyStoredSnapshot(stored),/pending-preview package is disabled/i);
  await verifyStoredSnapshot(stored,{allowPendingPreview:true});
  assert.ok(!release.fetches.some(url=>url.endsWith('/game-changes.json')));
});

test('UnitT58_ValidatesSourcePercentAndWebOfficialNameBindings',async()=>{
  // Scenario: Given native placeholders bound to a known Source percent claim or a same-locale Web official-name ref.
  // Purpose: Limit substitutions to the approved decimal/percent and Web registry forms without reading summaries as text.
  for(const format of ['signed-percent','official-name']){
    const release=nativeRelease({format});
    const {result}=await activate(release,new MemoryStore(),{allowPendingPreview:true});
    const localized=result.domains.skills.records.find(item=>item.kind==='presentation').payload.official.localizations['zh-TW'];
    assert.equal(localized.resolvedText,format==='signed-percent'?'合成移動速度 +17%。':'合成武器 合成鏈斧。');
  }
});

test('UnitT59_RejectsNativeIdentityMismatchAndInvalidCandidatePolicy',async()=>{
  // Scenario: Given native localization bound to another resource hash or pending-preview flags that claim fixture/publication.
  // Purpose: Require exact locale identity and false fixture/publication flags for explicit candidate opt-in.
  const mismatch=nativeRelease();
  rewriteDomain(mismatch,'skills',doc=>{
    doc.records.find(item=>item.kind==='presentation').payload.official.localizations['zh-TW'].sourceHash='0000000G';
  });
  await assert.rejects(()=>activate(mismatch,new MemoryStore(),{allowPendingPreview:true}),/native.*identity|localization identity/i);
  const foreignBinding=nativeRelease();
  rewriteDomain(foreignBinding,'skills',doc=>{
    doc.records.find(item=>item.recordId==='fixture:claim:a').payload.targetRef='fixture:blessing:a';
  });
  await assert.rejects(()=>activate(foreignBinding,new MemoryStore(),{allowPendingPreview:true}),/native numeric binding targets another entity/i);
  const wrongPercentUnit=nativeRelease({format:'signed-percent'});
  rewriteDomain(wrongPercentUnit,'skills',doc=>{
    doc.records.find(item=>item.recordId==='fixture:claim:percent').payload.value.unit='ratio';
  });
  await assert.rejects(()=>activate(wrongPercentUnit,new MemoryStore(),{allowPendingPreview:true}),/Source percent claim/i);
  const percentUsedAsPlainNumber=nativeRelease();
  rewriteDomain(percentUsedAsPlainNumber,'skills',doc=>{
    doc.records.find(item=>item.recordId==='fixture:claim:a').payload.value.unit='percent';
  });
  await assert.rejects(()=>activate(percentUsedAsPlainNumber,new MemoryStore(),{allowPendingPreview:true}),/plain-number binding/i);
  const missingFeature=nativeRelease({includeFeature:false});
  await assert.rejects(()=>activate(missingFeature,new MemoryStore(),{allowPendingPreview:true}),/requires official-native-localizations-v1/i);
  const summaryAsName=nativeRelease({format:'official-name'});
  rewriteDomain(summaryAsName,'skills',doc=>{
    delete summaryAsName.manifest.web.references.find(item=>item.sourceId==='fixture-web-name-zh').officialName;
  });
  await assert.rejects(()=>activate(summaryAsName,new MemoryStore(),{allowPendingPreview:true}),/official-name binding/i);
  const sourceOwnedName=nativeRelease({format:'official-name'});
  sourceOwnedName.manifest.source.references[0].officialName=
    sourceOwnedName.manifest.web.references.find(item=>item.sourceId==='fixture-web-name-en').officialName;
  refreshVersion(sourceOwnedName);
  await assert.rejects(()=>activate(sourceOwnedName,new MemoryStore(),{allowPendingPreview:true}),
    /official-name metadata is restricted to the Web/i);
  const missingDirectDependency=nativeRelease();
  missingDirectDependency.manifest.files.find(item=>item.kind==='skills').dependencies=[];
  refreshVersion(missingDirectDependency);
  await assert.rejects(()=>activate(missingDirectDependency,new MemoryStore(),{allowPendingPreview:true}),
    /native manifest dependencies do not match direct record references: skills/i);
  const unfetchedDependency=nativeRelease();
  unfetchedDependency.manifest.files.find(item=>item.kind==='skills').dependencies.push('game-changes');
  refreshVersion(unfetchedDependency);
  await assert.rejects(()=>activate(unfetchedDependency,new MemoryStore(),{allowPendingPreview:true}),
    /depends on an unfetched domain/i);
  for(const change of [
    release=>{release.manifest.fixtureOnly=true;refreshVersion(release);},
    release=>{release.manifest.publicationEligible=true;refreshVersion(release);},
    release=>{release.version.package_kind='fixture';release.routes.set('/version.json',json(release.version));}
  ]){
    const release=nativeRelease();change(release);
    await assert.rejects(()=>activate(release,new MemoryStore(),{allowPendingPreview:true}),/pending-preview|candidate|fixture|publication/i);
  }
});

test('UnitT65_AcceptsOnlyCompleteOwnerScopedPublicSourceLocators',async()=>{
  // Scenario: Given a pending-preview package with Web-owned names and Source-owned public code locators.
  // Purpose: Validate the exact Source locator contract without fetching locators or weakening owner/revision checks.
  const valid=addPublicSourceLocator(nativeRelease());
  const store=new MemoryStore();
  const activated=await activate(valid,store,{allowPendingPreview:true});
  assert.equal(activated.result.manifest.source.references[0].repository,
    'https://github.com/Aussiemon/Darktide-Source-Code');
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,valid.dataRevision);
  assert.equal(valid.fetches.length,6);
  assert.ok(valid.fetches.every(url=>new URL(url).origin===DEV_ORIGIN));

  const cases=[
    {name:'partial locator',edit:reference=>{delete reference.snapshot;},expected:/repository, commit, path, and snapshot together/i},
    {name:'wrong repository',edit:reference=>{reference.repository='https://github.com/example/source';},expected:/allowlisted public Source repository/i},
    {name:'noncanonical commit',edit:reference=>{reference.commit='A'.repeat(40);},expected:/full lowercase Git SHA/i},
    {name:'unsafe path',edit:reference=>{reference.path='../private/source.lua';},expected:/path is unsafe/i},
    {name:'mismatched snapshot',edit:reference=>{reference.snapshot.commit='b'.repeat(40);},expected:/snapshot.commit must match/i},
    {name:'fixture locator',edit:reference=>{reference.fixtureOnly=true;},expected:/explicitly non-fixture/i},
    {name:'missing locator summary',edit:reference=>{delete reference.safeSummary;},expected:/safeSummary/i}
  ];
  for(const [index,{name,edit,expected}] of cases.entries()){
    const candidate=addPublicSourceLocator(nativeRelease({dataRevision:['4','5','6','7','8','9','a'][index].repeat(64),
      contentVersion:'0.0.'+String(index+4)}));
    edit(candidate.manifest.source.references[0]);
    refreshVersion(candidate);
    await assert.rejects(()=>activate(candidate,store,{allowPendingPreview:true}),expected,name);
    assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,valid.dataRevision,
      name+' must not replace the active snapshot');
  }

  const wrongOwner=addPublicSourceLocator(nativeRelease({dataRevision:'a'.repeat(64),contentVersion:'0.0.10'}));
  const sourceReference=wrongOwner.manifest.source.references[0];
  const webReference=wrongOwner.manifest.web.references[0];
  for(const key of ['repository','commit','path','snapshot']) webReference[key]=sourceReference[key];
  refreshVersion(wrongOwner);
  await assert.rejects(()=>activate(wrongOwner,store,{allowPendingPreview:true}),
    /Web reference metadata may not contain Source-owned repository locators/i);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,valid.dataRevision,
    'Web-owned references must not accept Source locators');
});

test('UnitT66_AcceptsOnlyTheExactModsAnalysisSourceLocator',async()=>{
  // Scenario: Given a pending-preview package with the fixed MODS analysis locator or one field changed.
  // Purpose: Permit this single public Source citation while rejecting nearby repository, commit, path, or identity variants before activation.
  const valid=addModsAnalysisLocator(nativeRelease());
  const validStore=new MemoryStore();
  const {result}=await activate(valid,validStore,{allowPendingPreview:true});
  const accepted=result.manifest.source.references.find(reference=>
    reference.sourceId===MODS_ANALYSIS_LOCATOR.sourceId);
  assert.deepEqual({repository:accepted.repository,commit:accepted.commit,path:accepted.path,
    snapshot:accepted.snapshot,fixtureOnly:accepted.fixtureOnly},
  {repository:MODS_ANALYSIS_LOCATOR.repository,commit:MODS_ANALYSIS_LOCATOR.commit,
    path:MODS_ANALYSIS_LOCATOR.path,snapshot:{commit:MODS_ANALYSIS_LOCATOR.commit},fixtureOnly:false});
  assert.equal((await validStore.getActive(GAME_RELEASE_ID)).dataRevision,valid.dataRevision);
  assert.equal(valid.fetches.length,6);

  const cases=[
    {name:'nearby source ID',edit:reference=>{reference.sourceId+=':copy';},expected:/allowlisted public Source repository/i},
    {name:'nearby repository',edit:reference=>{reference.repository='https://github.com/example/Warhammer-40-000-DARKTIDE-Mods';},
      expected:/MODS analysis source identity must use its exact complete Source locator/i},
    {name:'nearby commit',edit:reference=>{reference.commit='a'.repeat(40);reference.snapshot.commit=reference.commit;},
      expected:/MODS analysis source identity must use its exact complete Source locator/i},
    {name:'nearby safe path',edit:reference=>{reference.path='Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst.md';},
      expected:/MODS analysis source identity must use its exact complete Source locator/i}
  ];
  for(const [index,{name,edit,expected}] of cases.entries()){
    const candidate=addModsAnalysisLocator(nativeRelease({
      dataRevision:['4','5','6','7'][index].repeat(64),contentVersion:'0.0.'+String(index+4)
    }));
    const reference=candidate.manifest.source.references.find(item=>
      item.sourceId===MODS_ANALYSIS_LOCATOR.sourceId);
    edit(reference);
    refreshVersion(candidate);
    const store=new MemoryStore();
    await assert.rejects(()=>activate(candidate,store,{allowPendingPreview:true}),
      expected,name);
    assert.equal(await store.getActive(GAME_RELEASE_ID),null,name+' must not activate a snapshot');
    assert.equal(candidate.fetches.length,2,name+' must be rejected before domain downloads');
  }
});

test('UnitT67_RejectsModsSourceIdUsingTheGenericSourceRepository',async()=>{
  // Scenario: Given the reserved MODS analysis source ID with its MODS commit/path but the generic Source repository.
  // Purpose: Ensure the reserved identity is bound to its complete fixed locator before any domain fetch or activation.
  const candidate=addModsAnalysisLocator(nativeRelease({
    dataRevision:'b'.repeat(64),contentVersion:'0.0.11'
  }));
  const reference=candidate.manifest.source.references.find(item=>
    item.sourceId===MODS_ANALYSIS_LOCATOR.sourceId);
  reference.repository='https://github.com/Aussiemon/Darktide-Source-Code';
  refreshVersion(candidate);
  const store=new MemoryStore();
  await assert.rejects(()=>activate(candidate,store,{allowPendingPreview:true}),
    /MODS analysis source identity must use its exact complete Source locator/i);
  assert.equal(await store.getActive(GAME_RELEASE_ID),null,
    'the MODS source identity with a generic repository must not activate');
  assert.equal(candidate.fetches.length,2,
    'the mismatched MODS locator must be rejected before domain downloads');
});

test('UnitT68_RejectsModsSourceIdWithoutLocatorFields',async()=>{
  // Scenario: Given the reserved MODS analysis source ID with all public locator fields removed.
  // Purpose: Ensure a reserved source identity cannot fall through the generic no-locator registry path.
  const candidate=addModsAnalysisLocator(nativeRelease({
    dataRevision:'c'.repeat(64),contentVersion:'0.0.12'
  }));
  const reference=candidate.manifest.source.references.find(item=>
    item.sourceId===MODS_ANALYSIS_LOCATOR.sourceId);
  for(const key of ['repository','commit','path','snapshot']) delete reference[key];
  refreshVersion(candidate);
  const store=new MemoryStore();
  await assert.rejects(()=>activate(candidate,store,{allowPendingPreview:true}),
    /MODS analysis source identity must use its exact complete Source locator/i);
  assert.equal(await store.getActive(GAME_RELEASE_ID),null,
    'the MODS source identity without locators must not activate');
  assert.equal(candidate.fetches.length,2,
    'the missing MODS locator must be rejected before domain downloads');
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

test('UnitT61_ValidatesNativeEnglishResolutionLocaleOwnedNamesAndAtomicFailure',async()=>{
  // Scenario: Given a native English and zh-TW source string with independent locale identities and typed bindings.
  // Purpose: Verify both original templates resolve from same-locale Web names or same-entity Source claims before activation.
  const englishMismatch=nativeRelease({dataRevision:'5'.repeat(64),contentVersion:'0.0.5'});
  const activeStore=new MemoryStore();
  await activate(englishMismatch,activeStore,{allowPendingPreview:true});
  const badEnglish=nativeRelease({dataRevision:'6'.repeat(64),contentVersion:'0.0.6'});
  rewriteDomain(badEnglish,'skills',doc=>{
    const official=doc.records.find(item=>item.kind==='presentation').payload.official;
    official.resolvedText='Synthetic cooldown 34 seconds.';
    official.resolvedTextSha256=digest(Buffer.from(official.resolvedText,'utf8'));
  });
  await assert.rejects(()=>activate(badEnglish,activeStore,{allowPendingPreview:true}),
    /native English official text resolved text does not match ordered placeholder bindings/i);
  assert.equal((await activeStore.getActive(GAME_RELEASE_ID)).dataRevision,englishMismatch.dataRevision);

  const wrongEnglishNameLocale=nativeRelease({format:'official-name'});
  wrongEnglishNameLocale.manifest.web.references.find(item=>item.sourceId==='fixture-web-name-en')
    .officialName.sourceLocale='zh-TW';
  refreshVersion(wrongEnglishNameLocale);
  await assert.rejects(()=>activate(wrongEnglishNameLocale,new MemoryStore(),{allowPendingPreview:true}),
    /native English official text official-name binding is not the same-locale official text/i);

  const crossEntityEnglishClaim=nativeRelease();
  rewriteDomain(crossEntityEnglishClaim,'skills',doc=>{
    doc.records.find(item=>item.kind==='claim'&&item.recordId==='fixture:claim:a').payload.targetRef='fixture:blessing:a';
  });
  await assert.rejects(()=>activate(crossEntityEnglishClaim,new MemoryStore(),{allowPendingPreview:true}),
    /native numeric binding targets another entity/i);
});

test('UnitT62_NativeNumericBindingsRequireDisplayDerivedSources',async()=>{
  // Scenario: Given native numeric placeholders sourced from a description formatter, the exact time override, or re-sealed alternatives.
  // Purpose: Prevent gameplay values and raw ratios from replacing official text placeholders while retaining the known 2-second exception.
  const r1=nativeRelease({format:'signed-percent',dataRevision:'7'.repeat(64),contentVersion:'0.0.7'});
  const store=new MemoryStore();
  await activate(r1,store,{allowPendingPreview:true});
  const invalidMutations=[
    {edit:claim=>{claim.payload.basis='game-tested';},expected:/code-derived description format value/i},
    {edit:claim=>{claim.payload.property='final_damage_percent';},expected:/code-derived description format value/i}
  ];
  for(const {edit,expected} of invalidMutations){
    const candidate=nativeRelease({format:'signed-percent',dataRevision:'8'.repeat(64),contentVersion:'0.0.8'});
    rewriteDomain(candidate,'skills',doc=>{
      edit(doc.records.find(item=>item.recordId==='fixture:claim:percent'));
    });
    await assert.rejects(()=>activate(candidate,store,{allowPendingPreview:true}),expected);
    assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,r1.dataRevision);
  }

  const time=nativeRelease({numberName:'time',dataRevision:'9'.repeat(64),contentVersion:'0.0.9'});
  const timeResult=await activate(time,new MemoryStore(),{allowPendingPreview:true});
  const timeOfficial=timeResult.result.domains.skills.records.find(item=>item.kind==='presentation').payload.official;
  const timeClaim=timeResult.result.domains.skills.records.find(item=>item.recordId==='fixture:claim:a').payload;
  assert.equal(timeClaim.basis,'code-observed');
  assert.equal(timeClaim.property,'template.buff_override.active_duration');
  assert.deepEqual(timeClaim.value,{status:'known',decimal:'2',unit:'s'});
  assert.equal(timeOfficial.params[0].bindingRef,'fixture:claim:a');
  assert.equal(timeOfficial.resolvedText,'Synthetic active duration 2 seconds.');
  assert.equal(timeOfficial.localizations['zh-TW'].resolvedText,'合成持續時間 2 秒。');

  const switched=nativeRelease({format:'signed-percent',
    dataRevision:'a'.repeat(64),contentVersion:'0.0.10'});
  rewriteDomain(switched,'skills',doc=>{
    const claim=doc.records.find(item=>item.recordId==='fixture:claim:percent');
    claim.payload.basis='code-observed';
    claim.payload.property='template.stat_buffs.multiplier';
    claim.payload.value={status:'known',decimal:'1.5',unit:'ratio'};
    const official=doc.records.find(item=>item.kind==='presentation').payload.official;
    for(const sourceText of [official,official.localizations['zh-TW']]){
      const param=sourceText.params[0];
      param.format='plain-number';
      param.resolvedValue='1.5';
      sourceText.resolvedText=sourceText.sourceText.replace(param.placeholder,param.resolvedValue);
      sourceText.resolvedTextSha256=digest(Buffer.from(sourceText.resolvedText,'utf8'));
      if(sourceText.origin==='official'){
        sourceText.text=sourceText.resolvedText;
        sourceText.sha256=sourceText.resolvedTextSha256;
      }
    }
  });
  const beforeFailure=await store.getActive(GAME_RELEASE_ID);
  await assert.rejects(()=>activate(switched,store,{allowPendingPreview:true}),
    /code-derived description format value or the exact active-duration override/i);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,beforeFailure.dataRevision);
});

test('UnitT63_LegacyOfficialSegmentsRejectDuplicateIdsAfterValidReseal',async()=>{
  // Scenario: Given an existing faithful-translation fixture with duplicate span IDs but valid text, segment, domain, and manifest hashes.
  // Purpose: Preserve legacy anchor identity validation and leave the active snapshot unchanged on this semantic failure.
  const r1=createRelease({dataRevision:'7'.repeat(64),contentVersion:'0.0.7'});
  const store=new MemoryStore();
  await activate(r1,store);
  const candidate=createRelease({dataRevision:'8'.repeat(64),contentVersion:'0.0.8'});
  rewriteDomain(candidate,'skills',doc=>{
    const official=doc.records.find(item=>item.kind==='presentation').payload.official;
    const split=Math.floor(official.sourceText.length/2);
    const first=official.sourceText.slice(0,split),second=official.sourceText.slice(split);
    official.segments=[
      {segmentId:'duplicate',text:first,sha256:digest(Buffer.from(first,'utf8'))},
      {segmentId:'duplicate',text:second,sha256:digest(Buffer.from(second,'utf8'))}
    ];
    doc.records.find(item=>item.kind==='presentation').payload.errata=[];
  });
  await assert.rejects(()=>activate(candidate,store),/duplicate presentation official segment id/i);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,r1.dataRevision);
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

test('UnitT72_ValidatesFourTierNativePresentationAgainstItsSourceClaims',async()=>{
  // Scenario: Given a pending blessing package with four explicit native tier options and matching Source claims.
  // Purpose: Verify the new feature gate, exact LV1–LV4 bindings, and the LV4 root presentation before activation.
  const release=tieredNativeRelease({dataRevision:'c'.repeat(64),contentVersion:'0.0.72'});
  const {result,store}=await activate(release,new MemoryStore(),{allowPendingPreview:true});
  const presentation=result.domains.blessings.records.find(record=>record.kind==='presentation');
  const tierPresentations=presentation.payload.tierPresentations;
  assert.ok(result.manifest.compatibility.requiredFeatures.includes('official-native-localizations-v1'));
  assert.ok(result.manifest.compatibility.requiredFeatures.includes('blessing-tier-presentations-v1'));
  assert.equal(tierPresentations.defaultTier,4);
  assert.deepEqual(tierPresentations.options.map(option=>option.tier),[1,2,3,4]);
  assert.deepEqual(presentation.payload.official,tierPresentations.options[3].official);
  assert.deepEqual(presentation.payload.detailSections,tierPresentations.options[3].detailSections);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,release.dataRevision);
  assert.equal(release.fetches.length,6);

  const sourceBacked=tieredNativeRelease({dataRevision:'e'.repeat(64),contentVersion:'0.0.721'});
  rewriteDomain(sourceBacked,'blessings',document=>{
    const variant=document.records.find(record=>record.kind==='blessing-variant');
    variant.payload.tierValues[1].value.decimal='0.185';
    document.records.find(record=>record.recordId==='fixture:blessing:tier-2-percent').payload.value.decimal='18.5';
    const presentation=document.records.find(record=>record.kind==='presentation');
    const option=presentation.payload.tierPresentations.options[1];
    option.detailSections.effects[0].text='Synthetic tier 2 movement effect at +18.5%.';
    const official=option.official;
    for(const sourceString of [official,official.localizations['zh-TW']]){
      sourceString.params.find(param=>param.name==='movement_speed').resolvedValue='+18.5%';
      const params=new Map(sourceString.params.map(param=>[param.placeholder,param.resolvedValue]));
      sourceString.resolvedText=sourceString.segments.map(segment=>segment.kind==='literal'?
        segment.text:params.get(segment.text)).join('');
      sourceString.resolvedTextSha256=digest(Buffer.from(sourceString.resolvedText,'utf8'));
      if(sourceString.origin==='official'){
        sourceString.text=sourceString.resolvedText;
        sourceString.sha256=sourceString.resolvedTextSha256;
      }
    }
  });
  const accepted=await activate(sourceBacked,new MemoryStore(),{allowPendingPreview:true});
  assert.equal(accepted.result.domains.blessings.records.find(record=>record.kind==='presentation')
    .payload.tierPresentations.options[1].official.localizations['zh-TW'].resolvedText,
  '移動速度 +18.5%，持續 2 秒。');
  assert.equal(accepted.result.domains.blessings.records.find(record=>record.kind==='presentation')
    .payload.tierPresentations.options[1].detailSections.effects[0].text,
  'Synthetic tier 2 movement effect at +18.5%.');
});

test('UnitT73_RejectsInvalidTierBindingsAndKeepsTheCurrentSnapshot',async()=>{
  // Scenario: Given a verified four-tier R1, then a re-sealed candidate with one tier, locale, claim, or feature defect.
  // Purpose: Reject incomplete or cross-tier official data atomically without replacing the active snapshot.
  const store=new MemoryStore();
  const r1=tieredNativeRelease({dataRevision:'d'.repeat(64),contentVersion:'0.0.73'});
  await activate(r1,store,{allowPendingPreview:true});
  const activeRevision=(await store.getActive(GAME_RELEASE_ID)).dataRevision;
  function resealOfficial(official){
    for(const sourceString of [official,official.localizations['zh-TW']]){
      for(const segment of sourceString.segments)
        segment.sha256=digest(Buffer.from(segment.text,'utf8'));
      sourceString.sourceText=sourceString.segments.map(segment=>segment.text).join('');
      sourceString.sourceTextSha256=digest(Buffer.from(sourceString.sourceText,'utf8'));
      const params=new Map(sourceString.params.map(param=>[param.placeholder,param.resolvedValue]));
      sourceString.resolvedText=sourceString.segments.map(segment=>segment.kind==='literal'?
        segment.text:params.get(segment.text)).join('');
      sourceString.resolvedTextSha256=digest(Buffer.from(sourceString.resolvedText,'utf8'));
      if(sourceString.origin==='official'){
        sourceString.text=sourceString.resolvedText;
        sourceString.sha256=sourceString.resolvedTextSha256;
      }
    }
  }
  const cases=[
    {name:'missing tier',expected:/tier presentation options must be tiers 1 through 4 in order/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='presentation').payload.tierPresentations.options.splice(1,1);
      })},
    {name:'duplicate tier',expected:/tier presentation options must be tiers 1 through 4 in order/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='presentation').payload.tierPresentations.options[1].tier=1;
      })},
    {name:'wrong default',expected:/default tier must be 4/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='presentation').payload.tierPresentations.defaultTier=3;
      })},
    {name:'Source defines fewer than four tiers',expected:/must define exactly tiers 1 through 4/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='blessing-variant').payload.definedTiers.pop();
      })},
    {name:'Source tier value is unknown',expected:/tier values must define known ratios/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='blessing-variant').payload.tierValues[2].value.status='unknown';
      })},
    {name:'unknown tier number',expected:/tier presentation options must be tiers 1 through 4 in order/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='presentation').payload.tierPresentations.options[3].tier=5;
      })},
    {name:'wrong tier property',expected:/tier 2 movement claim is invalid/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.recordId==='fixture:blessing:tier-2-percent').payload.property=
          'description.format_values.movement_speed.defined_tier_1_display_percent';
      })},
    {name:'wrong variant target',expected:/native numeric binding targets another entity/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.recordId==='fixture:blessing:tier-2-percent').payload.targetRef=
          'fixture:skill:a';
      })},
    {name:'ratio and percent disagree',expected:/tier 2 movement claim is invalid or differs from its Source ratio/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        document.records.find(record=>record.kind==='blessing-variant').payload.tierValues[1].value.decimal='0.19';
      })},
    {name:'duration uses another valid numeric property',expected:/tier 1 active duration must use the existing 2-second override claim/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        const duration=document.records.find(record=>record.recordId==='fixture:blessing:active-duration');
        duration.payload.property='description.format_values.time.value';
        duration.payload.basis='code-derived';
      })},
    {name:'English and zh-TW bind different tier claims',expected:/tier 2 English and zh-TW movement bindings differ/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        const presentation=document.records.find(record=>record.kind==='presentation');
        presentation.payload.tierPresentations.options[1].official.localizations['zh-TW'].params
          .find(param=>param.name==='movement_speed').bindingRef='fixture:blessing:tier-1-percent';
      })},
    {name:'option template differs from tier four',expected:/tier 2 official identity or template differs/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        const presentation=document.records.find(record=>record.kind==='presentation');
        const official=presentation.payload.tierPresentations.options[1].official;
        official.segments[0].text='Different movement speed ';
        resealOfficial(official);
      })},
    {name:'detail points at another tier',expected:/tier 2 detail claim is not bound by that option/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        const presentation=document.records.find(record=>record.kind==='presentation');
        presentation.payload.tierPresentations.options[1].detailSections.effects[0].claimRefs=
          ['fixture:blessing:tier-1-percent'];
      })},
    {name:'root differs from tier four',expected:/tier presentation root detail sections must match tier 4/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        const presentation=document.records.find(record=>record.kind==='presentation');
        presentation.payload.detailSections.notes=[{itemId:'fixture-mismatched-root',text:'Mismatch.'}];
      })},
    {name:'root official differs from tier four',expected:/tier presentation root official must match tier 4/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        const presentation=document.records.find(record=>record.kind==='presentation');
        const official=presentation.payload.official;
        const movement=official.localizations['zh-TW'].params.find(param=>param.name==='movement_speed');
        movement.bindingRef='fixture:blessing:tier-3-percent';
        movement.resolvedValue='+19%';
        resealOfficial(official);
      })},
    {name:'feature missing',expected:/requires blessing-tier-presentations-v1/i,
      edit:release=>{release.manifest.compatibility.requiredFeatures=
        release.manifest.compatibility.requiredFeatures.filter(feature=>feature!=='blessing-tier-presentations-v1');
        refreshVersion(release);}},
    {name:'feature advertised without options',expected:/must be present if and only if blessing-tier-presentations-v1 is declared/i,
      edit:release=>rewriteDomain(release,'blessings',document=>{
        delete document.records.find(record=>record.kind==='presentation').payload.tierPresentations;
      })},
    {name:'tier feature without native feature',expected:/requires official-native-localizations-v1/i,
      edit:release=>{release.manifest.compatibility.requiredFeatures=
        release.manifest.compatibility.requiredFeatures.filter(feature=>feature!=='official-native-localizations-v1');
        refreshVersion(release);}}
  ];
  for(const [index,{name,expected,edit}] of cases.entries()){
    const candidate=tieredNativeRelease({dataRevision:(index+1).toString(16).padStart(64,'0'),
      contentVersion:'0.0.'+String(74+index)});
    edit(candidate);
    await assert.rejects(()=>activate(candidate,store,{allowPendingPreview:true}),expected,name);
    assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,activeRevision,
      name+' must preserve the previously verified snapshot');
  }
});

test('UnitT74_ZeroSignedPercentMatchesTheSharedCompilerFormat',async()=>{
  // Scenario: Given a fully resealed native tier whose Source ratio and percent claim are both zero.
  // Purpose: Accept the compiler-compatible 0% spelling while preserving both native locales and tier details.
  const release=tieredNativeRelease({dataRevision:'f'.repeat(64),contentVersion:'0.0.75'});
  rewriteDomain(release,'blessings',document=>{
    document.records.find(record=>record.kind==='blessing-variant').payload.tierValues[3].value.decimal='0';
    document.records.find(record=>record.recordId==='fixture:blessing:tier-4-percent').payload.value.decimal='0';
    const presentation=document.records.find(record=>record.kind==='presentation');
    const option=presentation.payload.tierPresentations.options[3];
    for(const official of [option.official,option.official.localizations['zh-TW']]){
      official.params.find(param=>param.name==='movement_speed').resolvedValue='0%';
      const params=new Map(official.params.map(param=>[param.placeholder,param.resolvedValue]));
      official.resolvedText=official.segments.map(segment=>segment.kind==='literal'?
        segment.text:params.get(segment.text)).join('');
      official.resolvedTextSha256=digest(Buffer.from(official.resolvedText,'utf8'));
      if(official.sourceLocale==='zh-TW'){
        official.text=official.resolvedText;
        official.sha256=official.resolvedTextSha256;
      }
    }
    option.detailSections.effects[0].text='Synthetic tier 4 movement effect at 0%.';
    presentation.payload.official=JSON.parse(JSON.stringify(option.official));
    presentation.payload.detailSections=JSON.parse(JSON.stringify(option.detailSections));
  });
  const store=new MemoryStore();
  const {result}=await activate(release,store,{allowPendingPreview:true});
  const presentation=result.domains.blessings.records.find(record=>record.kind==='presentation');
  const option=presentation.payload.tierPresentations.options[3];
  assert.equal(option.official.resolvedText,'Movement speed 0% for 2 seconds.');
  assert.equal(option.official.localizations['zh-TW'].resolvedText,'移動速度 0%，持續 2 秒。');
  assert.equal(option.detailSections.effects[0].text,'Synthetic tier 4 movement effect at 0%.');
  assert.deepEqual(presentation.payload.official,option.official);
  assert.deepEqual(presentation.payload.detailSections,option.detailSections);
  assert.equal((await store.getActive(GAME_RELEASE_ID)).dataRevision,release.dataRevision);
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
