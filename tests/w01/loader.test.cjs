'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DEV_ORIGIN,rollback,REQUIRED_KINDS,verifyStoredSnapshot}=require('../../extension/w01/loader-core.js');
const {GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,createRelease,refreshVersion,rewriteDomain,MemoryStore,activate,json,digest}=require('./fixtures.cjs');
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
