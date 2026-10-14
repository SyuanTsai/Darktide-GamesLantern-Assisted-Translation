(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.W01SharedLoader=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';

  const DEV_ORIGIN='https://darktide-zh-tw-preview.syuan-tsai.workers.dev';
  const PUBLIC_SOURCE_REPOSITORY='https://github.com/Aussiemon/Darktide-Source-Code';
  const MODS_ANALYSIS_REFERENCE=Object.freeze({
    sourceId:'legacy:mods:psyker:brain-burst-improved:analysis-en',
    repository:'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
    commit:'241ad76ce62330472aa423055a5b85db59bb6c0d',
    path:'Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md'
  });
  const SOURCE_LOCATOR_KEYS=Object.freeze(['repository','commit','path','snapshot']);
  const REQUIRED_KINDS=Object.freeze(['skills','blessings','weapons','terms']);
  const ALL_KINDS=Object.freeze(['skills','blessings','weapons','terms','game-changes']);
  const DEPENDENCIES=Object.freeze({
    skills:['terms'],blessings:['weapons','terms'],weapons:['terms'],terms:[],
    'game-changes':['skills']
  });
  const DOMAIN_RECORD_KINDS=Object.freeze({
    skills:new Set(['skill','claim','evidence','presentation']),
    blessings:new Set(['blessing','blessing-variant','claim','evidence','presentation']),
    weapons:new Set(['weapon','weapon-family','weapon-mark','stat-definition','stat-curve','modifier-rule','claim','evidence','presentation']),
    terms:new Set(['term','term-localization','claim','evidence'])
  });
  const OWNER_BY_KIND=Object.freeze({
    skill:'source',blessing:'source','blessing-variant':'source',weapon:'source',
    'weapon-family':'source','weapon-mark':'source','stat-definition':'source',
    'stat-curve':'source','modifier-rule':'source',claim:'source',evidence:'source',
    term:'source',presentation:'web','term-localization':'web'
  });
  const REVIEW_STATES=new Set(['draft','pending','approved','rejected','stale']);
  const SUPPORTED_FEATURES=new Set(['official-errata-details-v1','official-native-localizations-v1']);
  const EXECUTABLE_KEYS=new Set([
    'js','javascript','wasm','html','htmltemplate','templatehtml',
    'selector','selectorprogram','domselectorprogram','formula','executable',
    'script','remotejs','remotewasm','htmlprogram'
  ]);
  const LIMITS=Object.freeze({
    versionBytes:64*1024,manifestBytes:256*1024,fileBytes:2*1024*1024,snapshotBytes:6*1024*1024
  });

  function fail(message){throw new Error(message);}
  function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
  function isNonEmptyString(value){return typeof value==='string'&&value.trim().length>0;}
  function isSha256(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
  function assertSha(value,label){if(!isSha256(value)) fail(label+' sha256 is invalid');}
  function assertGameVersion(value,label,allowFixture=true){
    if(value==='fixture-preview'){if(allowFixture) return;fail(label+' fixture game version is not allowed');}
    if(typeof value!=='string'||!/^\d+(?:\.\d+){1,3}$/.test(value)) fail(label+' game version is invalid');
  }
  function assertDataRevision(value,label){
    if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)) fail(label+' data revision is invalid');
  }
  function assertReleaseId(value,label){
    if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)||value.includes('..'))
      fail(label+' game release identity is invalid');
  }
  function toArrayBuffer(bytes){
    const array=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    return array.buffer.slice(array.byteOffset,array.byteOffset+array.byteLength);
  }
  async function sha256(bytes,cryptoApi){
    if(!cryptoApi||!cryptoApi.subtle||typeof cryptoApi.subtle.digest!=='function') fail('SHA-256 crypto is unavailable');
    const digest=await cryptoApi.subtle.digest('SHA-256',toArrayBuffer(bytes));
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function fixedUrl(pathname){
    if(typeof pathname!=='string'||!pathname.startsWith('/')||pathname.startsWith('//')||
      pathname.includes('\\')||/[?#]/.test(pathname)) fail('unsafe URL path');
    const url=new URL(pathname,DEV_ORIGIN);
    if(url.origin!==DEV_ORIGIN||url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
      fail('URL escaped fixed preview origin');
    return url.href;
  }
  function validateRelativePath(pathname,label){
    if(!isNonEmptyString(pathname)||pathname.startsWith('/')||pathname.startsWith('//')||
      pathname.includes('\\')||/%2e|%2f|%5c/i.test(pathname)||/[?#:]/.test(pathname)||
      pathname.split('/').some(part=>!part||part==='.'||part==='..')||pathname!==pathname.toLowerCase())
      fail(label+' path is unsafe');
    return pathname;
  }
  function parseContentVersion(value,label){
    if(typeof value!=='string'||!/^\d+(?:\.\d+){2,3}$/.test(value)) fail(label+' content version is invalid');
    return value.split('.').map(part=>Number(part));
  }
  function compareContentVersions(left,right){
    const a=parseContentVersion(left,'left'),b=parseContentVersion(right,'right'),length=Math.max(a.length,b.length);
    for(let index=0;index<length;index++){
      const delta=(a[index]||0)-(b[index]||0);
      if(delta!==0) return delta<0?-1:1;
    }
    return 0;
  }
  function assertFixturePolicy(fixtureOnly,publicationEligible,allowFixture,label){
    if(typeof fixtureOnly!=='boolean'||typeof publicationEligible!=='boolean') fail(label+' publication flags are invalid');
    if(fixtureOnly){
      if(!allowFixture||publicationEligible) fail(label+' fixture is not eligible in this build');
    }else if(!publicationEligible) fail(label+' release is not publication eligible');
  }
  function packageKindForFlags(fixtureOnly,publicationEligible){
    if(fixtureOnly===true&&publicationEligible===false) return 'fixture';
    if(fixtureOnly===false&&publicationEligible===false) return 'pending-preview';
    if(fixtureOnly===false&&publicationEligible===true) return 'published';
    return null;
  }
  function assertPackagePolicy(packageKind,fixtureOnly,publicationEligible,{allowFixture=false,allowPendingPreview=false},label){
    const actual=packageKindForFlags(fixtureOnly,publicationEligible);
    if(!actual||actual!==packageKind) fail(label+' package kind and publication flags are inconsistent');
    if(packageKind==='fixture'){
      if(!allowFixture) fail(label+' fixture package is not allowed');
      assertFixturePolicy(fixtureOnly,publicationEligible,true,label);
      return;
    }
    if(packageKind==='pending-preview'){
      if(!allowPendingPreview) fail(label+' pending-preview package is disabled');
      if(fixtureOnly!==false||publicationEligible!==false)
        fail(label+' pending-preview flags are invalid');
      return;
    }
    fail(label+' published package is not accepted by this DEV loader');
  }
  function validateSourceLocatorPath(value,label){
    if(typeof value!=='string'||value.length===0||value.includes('\\')||value.startsWith('/')||
      /^[A-Za-z]:/.test(value)||value.includes('\0')||
      value.split('/').some(part=>!part||part==='.'||part==='..'))
      fail(label+' path is unsafe');
    return value;
  }
  function validateReferenceRegistry(references,label){
    if(!Array.isArray(references)) fail(label+' reference registry is missing');
    const ids=new Set();
    for(const reference of references){
      if(!isObject(reference)||!isNonEmptyString(reference.sourceId)||ids.has(reference.sourceId))
        fail(label+' reference registry is invalid');
      const hasSourceLocator=SOURCE_LOCATOR_KEYS.some(key=>Object.prototype.hasOwnProperty.call(reference,key));
      if(label==='Web'&&hasSourceLocator)
        fail('Web reference metadata may not contain Source-owned repository locators');
      if(label==='source'&&Object.prototype.hasOwnProperty.call(reference,'officialName'))
        fail('official-name metadata is restricted to the Web reference registry');
      if(reference.sourceId===MODS_ANALYSIS_REFERENCE.sourceId){
        const exactModsAnalysis=label==='source'&&
          SOURCE_LOCATOR_KEYS.every(key=>Object.prototype.hasOwnProperty.call(reference,key))&&
          reference.repository===MODS_ANALYSIS_REFERENCE.repository&&
          reference.commit===MODS_ANALYSIS_REFERENCE.commit&&
          reference.path===MODS_ANALYSIS_REFERENCE.path&&
          isObject(reference.snapshot)&&reference.snapshot.commit===MODS_ANALYSIS_REFERENCE.commit;
        if(!exactModsAnalysis)
          fail('MODS analysis source identity must use its exact complete Source locator');
      }
      const allowed=['sourceId','fixtureOnly','safeSummary',...(label==='source'?SOURCE_LOCATOR_KEYS:['officialName'])];
      if(Object.keys(reference).some(key=>!allowed.includes(key))||
        ('fixtureOnly' in reference&&typeof reference.fixtureOnly!=='boolean')||
        ('safeSummary' in reference&&!isNonEmptyString(reference.safeSummary)))
        fail(label+' reference metadata is invalid');
      if(hasSourceLocator){
        if(label!=='source'||SOURCE_LOCATOR_KEYS.some(key=>!Object.prototype.hasOwnProperty.call(reference,key)))
          fail('Source public locator must contain repository, commit, path, and snapshot together');
        if(reference.repository!==PUBLIC_SOURCE_REPOSITORY){
          const exactModsAnalysis=reference.sourceId===MODS_ANALYSIS_REFERENCE.sourceId&&
            reference.repository===MODS_ANALYSIS_REFERENCE.repository&&
            reference.commit===MODS_ANALYSIS_REFERENCE.commit&&
            reference.path===MODS_ANALYSIS_REFERENCE.path;
          if(!exactModsAnalysis)
            fail('source public locator repository is not the allowlisted public Source repository');
        }
        if(typeof reference.commit!=='string'||!/^[a-f0-9]{40}$/.test(reference.commit))
          fail('source public locator commit must be a full lowercase Git SHA');
        validateSourceLocatorPath(reference.path,'source public locator');
        assertExactKeys(reference.snapshot,['commit'],'source public locator snapshot');
        if(reference.snapshot.commit!==reference.commit)
          fail('source public locator snapshot.commit must match commit');
        if(reference.fixtureOnly!==false)
          fail('source public locator must be explicitly non-fixture');
        if(!isNonEmptyString(reference.safeSummary))
          fail('source public locator requires safeSummary');
      }
      if('officialName' in reference){
        const officialName=reference.officialName;
        assertExactKeys(officialName,['sourceLocale','resource','sourceHash','key','occurrence','text','sha256'],
          label+' official name reference');
        if(!['en','zh-TW'].includes(officialName.sourceLocale)||!isNonEmptyString(officialName.resource)||
          !/^[a-f0-9]{8}$/.test(officialName.sourceHash)||
          !(officialName.key===null||isNonEmptyString(officialName.key))||
          !Number.isInteger(officialName.occurrence)||officialName.occurrence<1||
          !isNonEmptyString(officialName.text)) fail(label+' official name identity is invalid');
        assertSha(officialName.sha256,'official name');
        // Exact string hashes are checked asynchronously with the same WebCrypto API in presentation validation.
      }
      ids.add(reference.sourceId);
    }
    return ids;
  }
  function validateSourceReferences(source){
    if(!isObject(source)||source.owner!=='source'||!isNonEmptyString(source.repository)||
      typeof source.commit!=='string'||!/^[a-f0-9]{40}$/.test(source.commit)||
      typeof source.sourceRevision!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceRevision))
      fail('manifest source provenance or reference registry is incomplete');
    assertSha(source.manifestSha256,'source manifest');
    return validateReferenceRegistry(source.references,'source');
  }
  function validateWebReferences(web){
    if(!isObject(web)||web.owner!=='web'||typeof web.authoringCommit!=='string'||
      !/^[a-f0-9]{40}$/.test(web.authoringCommit)||typeof web.compilerCommit!=='string'||
      !/^[a-f0-9]{40}$/.test(web.compilerCommit)) fail('manifest Web provenance is incomplete');
    return validateReferenceRegistry(web.references,'Web');
  }
  function validateManifest(manifest,{entry,gameVersion,gameReleaseId,allowFixture,allowPendingPreview=false,packageKind}){
    if(!isObject(manifest)||manifest.schemaVersion!=='2.0.0') fail('manifest schema version is unsupported');
    assertReleaseId(manifest.gameReleaseId,'manifest');
    assertGameVersion(manifest.gameVersion,'manifest',allowFixture);
    assertDataRevision(manifest.dataRevision,'manifest');
    if(manifest.gameReleaseId!==gameReleaseId||manifest.gameVersion!==gameVersion||
      manifest.contentVersion!==entry.content_version||manifest.dataRevision!==entry.data_revision)
      fail('manifest identity does not match requested game release');
    assertPackagePolicy(packageKind,manifest.fixtureOnly,manifest.publicationEligible,
      {allowFixture,allowPendingPreview},'manifest');
    const sourceIds=validateSourceReferences(manifest.source);
    const webIds=validateWebReferences(manifest.web);
    if([...webIds].some(sourceId=>sourceIds.has(sourceId)))
      fail('manifest Source and Web reference registries overlap');
    const compatibility=manifest.compatibility;
    if(!isObject(compatibility)||compatibility.dataContractMajor!==2||
      !Array.isArray(compatibility.requiredFeatures)||!Array.isArray(compatibility.gameSnapshotRefs))
      fail('manifest compatibility contract is invalid');
    const featureSet=new Set();
    for(const feature of compatibility.requiredFeatures){
      if(!isNonEmptyString(feature)||featureSet.has(feature)) fail('manifest required feature is invalid');
      if(!SUPPORTED_FEATURES.has(feature)) fail('unsupported required feature: '+feature);
      featureSet.add(feature);
    }
    for(const snapshotRef of compatibility.gameSnapshotRefs){
      if(!isNonEmptyString(snapshotRef)||!sourceIds.has(snapshotRef)) fail('manifest game snapshot reference is invalid');
    }
    const nativeDependencies=featureSet.has('official-native-localizations-v1');
    if(!Array.isArray(manifest.files)) fail('manifest file list is invalid');
    if(manifest.files.length!==ALL_KINDS.length) fail('manifest must list all five shared domains');
    const files=new Map(),lowerPaths=new Set();
    for(const file of manifest.files){
      if(!isObject(file)||!ALL_KINDS.includes(file.kind)) fail('manifest contains an unknown domain');
      const expectedPath=file.kind+'.json';
      validateRelativePath(file.path,'manifest file');
      if(file.path!==expectedPath) fail('manifest domain path is not canonical');
      if(lowerPaths.has(file.path.toLowerCase())) fail('manifest has a case-colliding path');
      lowerPaths.add(file.path.toLowerCase());
      if(files.has(file.kind)) fail('manifest has a duplicate domain');
      if(!Number.isInteger(file.sizeBytes)||file.sizeBytes<1||file.sizeBytes>LIMITS.fileBytes)
        fail('manifest domain size is outside the allowed limit');
      assertSha(file.sha256,'manifest domain');
      if(!Array.isArray(file.dependencies)) fail('manifest domain dependencies are invalid');
      const actual=[...file.dependencies].sort(),expected=[...DEPENDENCIES[file.kind]].sort();
      if(actual.some(dep=>!ALL_KINDS.includes(dep)||dep===file.kind)||new Set(actual).size!==actual.length)
        fail('manifest domain dependency contract is invalid');
      if(!nativeDependencies&&JSON.stringify(actual)!==JSON.stringify(expected))
        fail('manifest domain dependency contract is invalid');
      if(nativeDependencies&&REQUIRED_KINDS.includes(file.kind)&&actual.some(dep=>!REQUIRED_KINDS.includes(dep)))
        fail('required extension domain depends on an unfetched domain');
      files.set(file.kind,file);
    }
    for(const kind of REQUIRED_KINDS){
      if(!files.has(kind)) fail('manifest is missing required domain '+kind);
    }
    if(ALL_KINDS.some(kind=>!files.has(kind))) fail('manifest is missing a shared domain');
    for(const [kind,file] of files){
      for(const dependency of file.dependencies){
        if(!files.has(dependency)) fail('manifest dependency is not listed: '+kind+' -> '+dependency);
      }
    }
    if(manifest.changeIndexPath!=='game-changes.json'||!files.has('game-changes'))
      fail('manifest change index path is invalid');
    return files;
  }
  function validateVersion(version,{allowFixture,allowPendingPreview=false}){
    if(!isObject(version)||version.schema_version!==2||
      !isNonEmptyString(version.data_revision)||!isNonEmptyString(version.build_id)||
      !isNonEmptyString(version.game_version)||!['fixture','pending-preview'].includes(version.package_kind)||
      !Array.isArray(version.game_releases)) fail('version.json contract is invalid');
    if(version.package_kind==='fixture'&&!allowFixture) fail('version fixture package is not allowed');
    if(version.package_kind==='pending-preview'&&!allowPendingPreview)
      fail('version pending-preview package is disabled');
    assertDataRevision(version.data_revision,'version');
    assertGameVersion(version.game_version,'version',allowFixture);
    const seen=new Set();
    for(const entry of version.game_releases){
      if(!isObject(entry)) fail('version game release entry is invalid');
      assertGameVersion(entry.game_version,'version entry',allowFixture);
      assertDataRevision(entry.data_revision,'version entry');
      parseContentVersion(entry.content_version,'version entry');
      if(seen.has(entry.game_version)) fail('duplicate game version entry');
      seen.add(entry.game_version);
      assertSha(entry.manifest_sha256,'version manifest');
      const expected='/data/'+entry.data_revision+'/manifest.json';
      if(entry.manifest_path!==expected) fail('version manifest path does not match data revision');
      fixedUrl(entry.manifest_path);
    }
    return version;
  }
  function assertExactKeys(value,keys,label){
    if(!isObject(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))
      fail(label+' fields are invalid');
  }
  async function validateNativeOfficialText(value,webReferences,cryptoApi,{locale,label,hasOrigin=false,hasResolvedDigest=false}={}){
    const webById=new Map(webReferences.map(reference=>[reference.sourceId,reference]));
    if((hasOrigin&&value.origin!=='official')||value.sourceLocale!==locale||
      !isNonEmptyString(value.sourceRef)||!webById.has(value.sourceRef)||
      !isNonEmptyString(value.resource)||!/^[a-f0-9]{8}$/.test(value.sourceHash)||
      !(value.key===null||isNonEmptyString(value.key))||!Number.isInteger(value.occurrence)||value.occurrence<1)
      fail(label+' identity is invalid');
    if(!isNonEmptyString(value.sourceText)||!isNonEmptyString(value.resolvedText)||
      !Array.isArray(value.segments)||value.segments.length===0||!Array.isArray(value.params))
      fail(label+' source text, segments, or params are invalid');
    assertSha(value.sourceTextSha256,label+' source text');
    assertSha(value.resolvedTextSha256,label+' resolved text');
    if(await sha256(new TextEncoder().encode(value.sourceText),cryptoApi)!==value.sourceTextSha256)
      fail(label+' source text hash mismatch');
    if(await sha256(new TextEncoder().encode(value.resolvedText),cryptoApi)!==value.resolvedTextSha256)
      fail(label+' resolved text hash mismatch');
    if(hasResolvedDigest){
      if(!isNonEmptyString(value.text)||value.text!==value.resolvedText||value.sha256!==value.resolvedTextSha256)
        fail(label+' visible text does not match the resolved official text');
      assertSha(value.sha256,label+' visible text');
    }

    const segmentIds=new Set(),placeholders=new Set();
    for(const segment of value.segments){
      assertExactKeys(segment,['segmentId','kind','text','sha256'],label+' segment');
      if(!isNonEmptyString(segment.segmentId)||segmentIds.has(segment.segmentId)||
        !['literal','template-placeholder'].includes(segment.kind)||!isNonEmptyString(segment.text))
        fail(label+' segment identity or kind is invalid');
      segmentIds.add(segment.segmentId);
      assertSha(segment.sha256,label+' segment');
      if(await sha256(new TextEncoder().encode(segment.text),cryptoApi)!==segment.sha256)
        fail(label+' segment hash mismatch');
      if(segment.kind==='template-placeholder'){
        if(placeholders.has(segment.text)) fail(label+' has a duplicate placeholder');
        placeholders.add(segment.text);
      }
    }
    if(value.segments.map(segment=>segment.text).join('')!==value.sourceText)
      fail(label+' segments do not preserve source text');
    if(value.params.length!==placeholders.size) fail(label+' params do not match placeholders');
    const paramsByPlaceholder=new Map(),names=new Set();
    for(const param of value.params){
      assertExactKeys(param,['name','placeholder','status','bindingRef','format','resolvedValue'],label+' param');
      if(!isNonEmptyString(param.name)||names.has(param.name)||!isNonEmptyString(param.placeholder)||
        !placeholders.has(param.placeholder)||param.status!=='bound'||!isNonEmptyString(param.bindingRef)||
        !['plain-number','signed-percent','official-name'].includes(param.format)||
        !isNonEmptyString(param.resolvedValue)||paramsByPlaceholder.has(param.placeholder))
        fail(label+' param binding is invalid');
      names.add(param.name);
      paramsByPlaceholder.set(param.placeholder,param);
    }
    let reconstructed='';
    for(const segment of value.segments){
      if(segment.kind==='literal') reconstructed+=segment.text;
      else{
        const param=paramsByPlaceholder.get(segment.text);
        if(!param) fail(label+' placeholder is unbound');
        reconstructed+=param.resolvedValue;
      }
    }
    if(reconstructed!==value.resolvedText)
      fail(label+' resolved text does not match ordered placeholder bindings');
    for(const param of value.params){
      if(param.format==='official-name'){
        const reference=webById.get(param.bindingRef),officialName=reference&&reference.officialName;
        if(!isObject(officialName)) fail(label+' official-name binding is not in the Web registry');
        if(officialName.sourceLocale!==locale||param.resolvedValue!==officialName.text)
          fail(label+' official-name binding is not the same-locale official text');
        if(await sha256(new TextEncoder().encode(officialName.text),cryptoApi)!==officialName.sha256)
          fail(label+' official-name reference hash mismatch');
      }
    }
  }
  async function validatePresentation(record,webReferences,cryptoApi,{nativeFeature=false}={}){
    const webIds=webReferences instanceof Set?webReferences:new Set(webReferences.map(reference=>reference.sourceId));
    if(!isNonEmptyString(record.entityRef)||record.locale!=='zh-TW') fail('presentation identity or locale is missing');
    const payload=record.payload,payloadKeys=['name','detailSections'];
    if('official' in payload) payloadKeys.push('official','errata');
    if(Object.keys(payload).some(key=>!payloadKeys.includes(key))||
      ('official' in payload)!==('errata' in payload)||!isNonEmptyString(payload.name)||
      !isObject(payload.detailSections)) fail('presentation payload is incomplete');
    assertExactKeys(payload.detailSections,['effects','conditions','calculation','notes','extra'],
      'presentation detail sections');
    for(const section of ['effects','conditions','calculation','notes','extra']){
      if(!Array.isArray(payload.detailSections[section])) fail('presentation detail section is invalid: '+section);
      for(const item of payload.detailSections[section]){
        if(!isObject(item)) fail('presentation detail item is invalid');
        const itemKeys=['itemId',...('text' in item?['text']:[]),...('claimRefs' in item?['claimRefs']:[]),...('termRef' in item?['termRef']:[])];
        assertExactKeys(item,itemKeys,'presentation detail item');
        if(!isNonEmptyString(item.itemId)||(!isNonEmptyString(item.text)&&!isNonEmptyString(item.termRef)))
          fail('presentation detail item is incomplete');
        if('text' in item&&!isNonEmptyString(item.text)) fail('presentation detail text is invalid');
        if('claimRefs' in item&&(!Array.isArray(item.claimRefs)||item.claimRefs.some(ref=>!isNonEmptyString(ref))))
          fail('presentation detail claim references are invalid');
        if('termRef' in item&&!isNonEmptyString(item.termRef)) fail('presentation detail term reference is invalid');
      }
    }
    if(!('official' in payload)) return;
    const official=payload.official;
    const localizations=official.localizations;
    const nativeLocalization=isObject(localizations)&&isObject(localizations['zh-TW'])&&
      localizations['zh-TW'].origin==='official';
    const nativeFields=['sourceRef','sourceLocale','resource','sourceHash','key','occurrence','sourceText',
      'sourceTextSha256','segments','params','resolvedText','resolvedTextSha256','localizations'];
    const legacyFields=['sourceRef','sourceLocale','resource','key','occurrence','sourceText',
      'sourceTextSha256','segments','params','resolvedText','resolvedTextSha256','localizations'];
    if(nativeLocalization){
      if(!nativeFeature) fail('native zh-TW localization requires official-native-localizations-v1');
      assertExactKeys(official,nativeFields,'presentation official');
    }else assertExactKeys(official,legacyFields,'presentation official');
    if(!isNonEmptyString(official.sourceRef)||!webIds.has(official.sourceRef)||
      !record.sourceRefs.includes(official.sourceRef)) fail('presentation official source reference is unknown');
    if(nativeLocalization){
      if(official.sourceLocale!=='en') fail('native English official source locale is invalid');
      assertExactKeys(official.localizations,['zh-TW'],'presentation official localizations');
      const localization=official.localizations['zh-TW'];
      assertExactKeys(localization,['origin','sourceRef','sourceLocale','resource','sourceHash','key','occurrence',
        'sourceText','sourceTextSha256','segments','params','resolvedText','resolvedTextSha256','text','sha256'],
        'native zh-TW localization');
      if(localization.resource!==official.resource) fail('native locale resources do not identify the same game string');
      await validateNativeOfficialText(official,webReferences,cryptoApi,{locale:'en',label:'native English official text'});
      await validateNativeOfficialText(localization,webReferences,cryptoApi,{locale:'zh-TW',
        label:'native zh-TW localization',hasOrigin:true,hasResolvedDigest:true});
    }else{
    for(const key of ['sourceLocale','resource','sourceText','resolvedText']){
      if(!isNonEmptyString(official[key])) fail('presentation official '+key+' is invalid');
    }
    if(!isNonEmptyString(official.key)) fail('presentation official key is invalid');
    if(!Number.isInteger(official.occurrence)||official.occurrence<1) fail('presentation official occurrence is invalid');
    assertSha(official.sourceTextSha256,'official source text');
    assertSha(official.resolvedTextSha256,'official resolved text');
    if(await sha256(new TextEncoder().encode(official.sourceText),cryptoApi)!==official.sourceTextSha256)
      fail('presentation official source text hash mismatch');
    if(await sha256(new TextEncoder().encode(official.resolvedText),cryptoApi)!==official.resolvedTextSha256)
      fail('presentation official resolved text hash mismatch');
    if(!Array.isArray(official.segments)||official.segments.length===0||!Array.isArray(official.params))
      fail('presentation official segments or params are invalid');
    const segmentIds=new Set();
    for(const segment of official.segments){
      assertExactKeys(segment,['segmentId','text','sha256'],'presentation official segment');
      if(!isNonEmptyString(segment.segmentId)||!isNonEmptyString(segment.text))
        fail('presentation official segments are invalid');
      if(segmentIds.has(segment.segmentId)) fail('duplicate presentation official segment id');
      segmentIds.add(segment.segmentId);
      assertSha(segment.sha256,'official segment');
      if(await sha256(new TextEncoder().encode(segment.text),cryptoApi)!==segment.sha256)
        fail('presentation official segment hash mismatch');
    }
    if(official.segments.map(segment=>segment.text).join('')!==official.sourceText)
      fail('presentation official segments do not preserve source text');
    assertExactKeys(official.localizations,['zh-TW'],'presentation official localizations');
    const localization=official.localizations['zh-TW'];
    assertExactKeys(localization,['origin','text','sha256'],'presentation zh-TW localization');
    if(localization.origin!=='faithful-translation'||!isNonEmptyString(localization.text))
      fail('presentation zh-TW localization is invalid');
    assertSha(localization.sha256,'official localization');
    if(await sha256(new TextEncoder().encode(localization.text),cryptoApi)!==localization.sha256)
      fail('presentation zh-TW localization hash mismatch');
    }
    if(!Array.isArray(payload.errata)) fail('presentation errata are invalid');
    for(const erratum of payload.errata){
      assertExactKeys(erratum,['erratumId','anchor','gameReleaseId','context','problem','claimRef',
        'evidenceRefs','text','reviewState'],'presentation erratum');
      if(!isNonEmptyString(erratum.erratumId)||erratum.gameReleaseId!==record.gameReleaseId||
        erratum.reviewState!=='pending'||!isObject(erratum.context)||!isNonEmptyString(erratum.problem)||
        !isNonEmptyString(erratum.claimRef)||!Array.isArray(erratum.evidenceRefs)||
        erratum.evidenceRefs.some(ref=>!isNonEmptyString(ref))||!isNonEmptyString(erratum.text))
        fail('presentation erratum is invalid');
      assertExactKeys(erratum.anchor,['segmentId','sourceTextDigest'],'presentation erratum anchor');
      const segment=official.segments.find(item=>item.segmentId===erratum.anchor.segmentId);
      if(!segment||erratum.anchor.sourceTextDigest!==segment.sha256)
        fail('presentation erratum anchor does not match an official segment');
    }
  }
  async function validateDomainDocument(document,{kind,manifest,allowFixture,allowPendingPreview=false,
    packageKind,cryptoApi=globalThis.crypto}){
    if(!isObject(document)||document.schemaVersion!=='2.0.0'||!Array.isArray(document.records))
      fail(kind+' domain schema is invalid');
    if(document.gameReleaseId!==manifest.gameReleaseId||document.gameVersion!==manifest.gameVersion||
      document.sourceRevision!==manifest.source.sourceRevision)
      fail(kind+' domain game release identity is incompatible');
    if(document.fixtureOnly!==manifest.fixtureOnly||document.publicationEligible!==manifest.publicationEligible)
      fail(kind+' domain publication flags do not match manifest');
    assertPackagePolicy(packageKind,document.fixtureOnly,document.publicationEligible,
      {allowFixture,allowPendingPreview},kind+' domain');
    if(document.records.length===0) fail(kind+' domain has no records');
    const sourceIds=validateSourceReferences(manifest.source),webIds=validateWebReferences(manifest.web);
    const recordIds=new Set();
    for(const record of document.records){
      if(!isObject(record)||!isNonEmptyString(record.recordId)||!isNonEmptyString(record.kind)||
        record.gameReleaseId!==manifest.gameReleaseId||!isObject(record.payload))
        fail(kind+' domain record envelope is invalid');
      if(!DOMAIN_RECORD_KINDS[kind].has(record.kind)) fail(kind+' domain contains an unsupported record kind');
      if(OWNER_BY_KIND[record.kind]!==record.owner) fail(kind+' domain record owner is invalid');
      if(recordIds.has(record.recordId)) fail(kind+' domain contains a duplicate record id');
      recordIds.add(record.recordId);
      const ownerIds=record.owner==='source'?sourceIds:record.owner==='web'?webIds:null;
      if(!ownerIds||!Array.isArray(record.sourceRefs)||
        record.sourceRefs.some(ref=>typeof ref!=='string'||!ownerIds.has(ref)))
        fail(kind+' domain record source references are missing or unknown');
      if(!REVIEW_STATES.has(record.reviewState)) fail(kind+' domain record review state is invalid');
      if(manifest.publicationEligible&&record.reviewState!=='approved')
        fail(kind+' domain record is not approved');
      if(record.kind==='presentation') await validatePresentation(record,manifest.web.references,cryptoApi,{
        nativeFeature:manifest.compatibility.requiredFeatures.includes('official-native-localizations-v1')});
      if(record.kind==='term-localization'&&(!isNonEmptyString(record.entityRef)||record.locale!=='zh-TW'||
        !isNonEmptyString(record.payload.label)||!isNonEmptyString(record.payload.definition)||
        Object.keys(record.payload).some(key=>!['label','definition'].includes(key)))) fail('term localization is incomplete');
    }
    return document;
  }
  function scanPayloadSafety(value,label){
    if(Array.isArray(value)){for(const item of value) scanPayloadSafety(item,label);return;}
    if(!isObject(value)) return;
    for(const [key,child] of Object.entries(value)){
      const normalized=key.toLowerCase().replace(/[-_]/g,'');
      if(EXECUTABLE_KEYS.has(normalized)) fail(label+' contains forbidden executable field: '+key);
      scanPayloadSafety(child,label);
    }
  }
  function validateRecordReferences(domains,manifest,manifestFiles){
    const sourceIds=validateSourceReferences(manifest.source),webIds=validateWebReferences(manifest.web),records=new Map();
    const domainByRecord=new Map();
    for(const [domainKind,document] of Object.entries(domains)){
      for(const record of document.records){
        if(records.has(record.recordId)) fail('duplicate record id across required domains');
        records.set(record.recordId,record);
        domainByRecord.set(record.recordId,domainKind);
      }
    }
    const nativeFeature=manifest.compatibility.requiredFeatures.includes('official-native-localizations-v1');
    function checkRecordReferences(value,path,ownerIds){
      if(Array.isArray(value)){for(let i=0;i<value.length;i++) checkRecordReferences(value[i],path+'['+i+']',ownerIds);return;}
      if(!isObject(value)) return;
      for(const [key,child] of Object.entries(value)){
        const lower=key.toLowerCase();
        if(lower==='sourcerefs'){
          if(!Array.isArray(child)||child.some(ref=>typeof ref!=='string'||!ownerIds.has(ref)))
            fail('unknown owner-scoped source reference at '+path+'.'+key);
        }else if(lower==='sourceref'){
          if(typeof child!=='string'||!ownerIds.has(child)) fail('unknown owner-scoped source reference at '+path+'.'+key);
        }else if(lower==='bindingref'){
          const bindingPath=(path+'.'+key).toLowerCase();
          if(!nativeFeature||!/^record:.*\.official(?:\.localizations\.zh-tw)?\.params\[\d+\]\.bindingref$/.test(bindingPath))
            fail('unexpected binding reference at '+path+'.'+key);
        }else if(lower.endsWith('refs')){
          if(!Array.isArray(child)||child.some(ref=>typeof ref!=='string'||!records.has(ref)))
            fail('unknown record reference at '+path+'.'+key);
        }else if(lower.endsWith('ref')&&child!==null&&child!==undefined){
          if(typeof child!=='string'||!records.has(child)) fail('unknown record reference at '+path+'.'+key);
        }
        checkRecordReferences(child,path+'.'+key,ownerIds);
      }
    }
    function requireKind(reference,kinds,label){
      const target=records.get(reference);
      if(!target||!kinds.includes(target.kind)) fail(label+' references an unknown or incompatible record');
      return target;
    }
    for(const record of records.values()){
      const ownerIds=record.owner==='source'?sourceIds:webIds;
      if(!Array.isArray(record.sourceRefs)||record.sourceRefs.some(ref=>!ownerIds.has(ref)))
        fail('record source references use the wrong owner registry: '+record.recordId);
      checkRecordReferences(record.payload,'record:'+record.recordId,ownerIds);
      if(record.kind==='evidence'&&(!isNonEmptyString(record.payload.sourceRef)||!sourceIds.has(record.payload.sourceRef)))
        fail('Source evidence has an unknown source reference: '+record.recordId);
      if(record.kind==='presentation'){
        requireKind(record.entityRef,['skill','blessing','weapon'],'presentation entityRef');
        if(record.payload.official){
          if(!webIds.has(record.payload.official.sourceRef)||!record.sourceRefs.includes(record.payload.official.sourceRef))
            fail('presentation official sourceRef is not owned by Web');
          const localized=record.payload.official.localizations['zh-TW'];
          if(localized&&localized.origin==='official'){
            if(!manifest.compatibility.requiredFeatures.includes('official-native-localizations-v1'))
              fail('native zh-TW localization feature is not declared');
            if(!webIds.has(localized.sourceRef)||!record.sourceRefs.includes(localized.sourceRef))
              fail('native localization sourceRef is not owned by Web');
            const nativeStrings=[
              {value:record.payload.official,locale:'en'},
              {value:localized,locale:'zh-TW'}
            ];
            for(const {value:officialString,locale} of nativeStrings){
              for(const param of officialString.params){
                if(param.format==='plain-number'||param.format==='signed-percent'){
                  const claim=requireKind(param.bindingRef,['claim'],'native numeric binding');
                  if(claim.owner!=='source') fail('native numeric binding must resolve to a Source claim');
                  const value=claim.payload.value;
                  if(!isObject(value)||value.status!=='known'||typeof value.decimal!=='string'||
                    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.decimal)||!isNonEmptyString(value.unit))
                    fail('native numeric binding is not a known decimal Source claim');
                  const entity=requireKind(record.entityRef,['skill','blessing','weapon'],'native presentation entity');
                  const targetRef=claim.payload.targetRef;
                  let targetMatches=targetRef===record.entityRef;
                  if(entity.kind==='blessing'&&!targetMatches&&Array.isArray(entity.payload.variantRefs)&&
                    entity.payload.variantRefs.includes(targetRef)){
                    const variant=records.get(targetRef);
                    targetMatches=Boolean(variant&&variant.kind==='blessing-variant'&&
                      variant.owner==='source'&&variant.payload.blessingRef===entity.recordId);
                  }
                  if(!targetMatches) fail('native numeric binding targets another entity');
                  const propertyPrefix='description.format_values.'+param.name+'.';
                  const descriptionFormatClaim=claim.payload.basis==='code-derived'&&
                    typeof claim.payload.property==='string'&&claim.payload.property.startsWith(propertyPrefix);
                  const exactActiveDuration=param.format==='plain-number'&&param.name==='time'&&
                    claim.payload.basis==='code-observed'&&
                    claim.payload.property==='template.buff_override.active_duration'&&value.unit==='s';
                  if(!descriptionFormatClaim&&!exactActiveDuration)
                    fail('native numeric binding must use a code-derived description format value or the exact active-duration override');
                  if(param.format==='plain-number'){
                    if(value.unit==='percent'||param.resolvedValue!==value.decimal)
                      fail('native plain-number binding does not match its Source decimal');
                  }else{
                    if(value.unit!=='percent'||param.resolvedValue!=='+'+value.decimal+'%')
                      fail('native signed-percent binding does not match a Source percent claim');
                  }
                }else if(param.format==='official-name'){
                  const reference=manifest.web.references.find(item=>item.sourceId===param.bindingRef);
                  if(!reference||!record.sourceRefs.includes(param.bindingRef)||
                    !isObject(reference.officialName)||reference.officialName.sourceLocale!==locale||
                    param.resolvedValue!==reference.officialName.text)
                    fail('native official-name binding is not a same-locale Web reference');
                }
              }
            }
          }
          for(const erratum of record.payload.errata){
            requireKind(erratum.claimRef,['claim'],'presentation errata claimRef');
            for(const reference of erratum.evidenceRefs) requireKind(reference,['evidence'],'presentation errata evidenceRef');
          }
        }
        for(const section of Object.values(record.payload.detailSections)){
          for(const item of section){
            for(const reference of item.claimRefs||[]) requireKind(reference,['claim'],'presentation detail claimRef');
            if(item.termRef) requireKind(item.termRef,['term'],'presentation detail termRef');
          }
        }
      }
      if(record.kind==='term-localization') requireKind(record.entityRef,['term'],'term localization entityRef');
    }
    const requiredTypes={skills:['skill'],blessings:['blessing','blessing-variant'],weapons:['weapon'],terms:['term']};
    for(const [domain,kinds] of Object.entries(requiredTypes)){
      for(const kind of kinds){
        if(!domains[domain].records.some(record=>record.kind===kind))
          fail(domain+' domain is missing required '+kind+' record');
      }
    }
    const recordsById=records;
    for(const record of records.values()){
      if(['skill','blessing','weapon'].includes(record.kind)){
        const matches=[...records.values()].filter(candidate=>
          candidate.kind==='presentation'&&candidate.entityRef===record.recordId&&candidate.locale==='zh-TW');
        if(matches.length!==1) fail('entity is missing a unique zh-TW presentation: '+record.recordId);
      }
      if(record.kind==='term'){
        const matches=[...records.values()].filter(candidate=>
          candidate.kind==='term-localization'&&candidate.entityRef===record.recordId&&candidate.locale==='zh-TW');
        if(matches.length!==1) fail('term is missing a unique zh-TW localization: '+record.recordId);
      }
    }
    if(manifest.compatibility.requiredFeatures.includes('official-native-localizations-v1')){
      function addReferencedRecords(value,refs){
        if(Array.isArray(value)){for(const item of value) addReferencedRecords(item,refs);return;}
        if(!isObject(value)) return;
        for(const [key,child] of Object.entries(value)){
          const lower=key.toLowerCase();
          if(lower==='sourceref'||lower==='sourcerefs') continue;
          if(lower==='bindingref'){
            if(typeof child==='string'&&records.has(child)) refs.add(child);
            continue;
          }
          if(lower.endsWith('refs')&&Array.isArray(child)){
            for(const reference of child) if(typeof reference==='string'&&records.has(reference)) refs.add(reference);
          }else if(lower.endsWith('ref')&&typeof child==='string'&&records.has(child)) refs.add(child);
          addReferencedRecords(child,refs);
        }
      }
      for(const kind of REQUIRED_KINDS){
        const actual=new Set();
        for(const record of domains[kind].records){
          addReferencedRecords(record,actual);
        }
        const crossDomain=new Set([...actual].map(reference=>domainByRecord.get(reference))
          .filter(targetKind=>targetKind&&targetKind!==kind));
        if([...crossDomain].some(targetKind=>!REQUIRED_KINDS.includes(targetKind)))
          fail('native domain references an unfetched domain: '+kind);
        const declared=manifestFiles.get(kind).dependencies;
        if(JSON.stringify([...crossDomain].sort())!==JSON.stringify([...declared].sort()))
          fail('native manifest dependencies do not match direct record references: '+kind);
      }
    }
    return recordsById;
  }
  function getJsonMime(response,label){
    const contentType=response&&response.headers&&response.headers.get&&response.headers.get('content-type');
    if(typeof contentType!=='string') fail(label+' MIME type is missing');
    const parts=contentType.split(';').map(part=>part.trim().toLowerCase());
    if(parts[0]!=='application/json'||parts.slice(1).some(part=>part!=='charset=utf-8'))
      fail(label+' MIME type must be application/json');
  }
  async function readJson(fetchImpl,url,maxBytes,label){
    const response=await fetchImpl(url,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store'});
    if(!response||!response.ok||response.status!==200) fail(label+' HTTP response is not successful');
    if(response.url){
      const responseUrl=new URL(response.url);
      if(responseUrl.origin!==DEV_ORIGIN||responseUrl.protocol!=='https:') fail(label+' response escaped fixed preview origin');
    }
    getJsonMime(response,label);
    if(typeof response.arrayBuffer!=='function') fail(label+' body is not readable');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength>maxBytes) fail(label+' size exceeds the allowed limit');
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch(error){fail(label+' JSON body is invalid: '+error.message);}
    scanPayloadSafety(value,label);
    return {value,bytes};
  }
  async function loadAndActivate({fetchImpl,store,gameVersion,gameReleaseId,allowFixture=false,
    allowPendingPreview=false,cryptoApi=globalThis.crypto}){
    if(typeof fetchImpl!=='function'||!store||typeof store.commitSnapshot!=='function')
      fail('loader dependencies are invalid');
    assertGameVersion(gameVersion,'requested',allowFixture);
    assertReleaseId(gameReleaseId,'requested');
    const versionResponse=await readJson(fetchImpl,fixedUrl('/version.json'),LIMITS.versionBytes,'version.json');
    const version=validateVersion(versionResponse.value,{allowFixture,allowPendingPreview});
    const entries=version.game_releases.filter(entry=>entry.game_version===gameVersion);
    if(entries.length!==1) fail('no unique version entry matches requested game patch');
    const entry=entries[0];
    const manifestResponse=await readJson(fetchImpl,fixedUrl(entry.manifest_path),LIMITS.manifestBytes,'manifest');
    const actualManifestHash=await sha256(manifestResponse.bytes,cryptoApi);
    if(actualManifestHash!==entry.manifest_sha256) fail('manifest hash mismatch');
    const manifest=manifestResponse.value;
    const manifestFiles=validateManifest(manifest,{entry,gameVersion,gameReleaseId,allowFixture,allowPendingPreview,
      packageKind:version.package_kind});
    const totalBytes=REQUIRED_KINDS.reduce((total,kind)=>total+manifestFiles.get(kind).sizeBytes,0);
    if(totalBytes>LIMITS.snapshotBytes) fail('snapshot size exceeds the allowed limit');
    const domains={},stagedFiles={};
    for(const kind of REQUIRED_KINDS){
      const metadata=manifestFiles.get(kind);
      const url=fixedUrl('/data/'+manifest.dataRevision+'/'+metadata.path);
      const response=await readJson(fetchImpl,url,LIMITS.fileBytes,kind);
      if(response.bytes.byteLength!==metadata.sizeBytes) fail(kind+' size does not match manifest');
      if(await sha256(response.bytes,cryptoApi)!==metadata.sha256) fail(kind+' hash mismatch');
      domains[kind]=await validateDomainDocument(response.value,{kind,manifest,allowFixture,allowPendingPreview,
        packageKind:version.package_kind,cryptoApi});
      stagedFiles[kind]={path:metadata.path,sizeBytes:metadata.sizeBytes,sha256:metadata.sha256,
        bytes:toArrayBuffer(response.bytes)};
    }
    validateRecordReferences(domains,manifest,manifestFiles);
    const snapshot={
      gameReleaseId:manifest.gameReleaseId,gameVersion:manifest.gameVersion,
      contentVersion:manifest.contentVersion,dataRevision:manifest.dataRevision,
      manifest,manifestBytes:toArrayBuffer(manifestResponse.bytes),
      manifestSha256:actualManifestHash,versionBuildId:version.build_id,
      files:stagedFiles,domains
    };
    await store.commitSnapshot(snapshot);
    return snapshot;
  }
  async function verifyStoredSnapshot(snapshot,{cryptoApi=globalThis.crypto,allowFixture=true,
    allowPendingPreview=false}={}){
    if(!isObject(snapshot)) fail('stored snapshot is invalid');
    assertReleaseId(snapshot.gameReleaseId,'stored snapshot');
    assertGameVersion(snapshot.gameVersion,'stored snapshot',allowFixture);
    assertDataRevision(snapshot.dataRevision,'stored snapshot');
    parseContentVersion(snapshot.contentVersion,'stored snapshot');
    assertSha(snapshot.manifestSha256,'stored manifest');
    if(!snapshot.manifestBytes) fail('stored manifest bytes are missing');
    const manifestBytes=new Uint8Array(snapshot.manifestBytes);
    if(manifestBytes.byteLength>LIMITS.manifestBytes||await sha256(manifestBytes,cryptoApi)!==snapshot.manifestSha256)
      fail('stored manifest hash mismatch');
    let manifest;
    try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}
    catch(error){fail('stored manifest JSON is invalid');}
    if(!isObject(snapshot.manifest)||JSON.stringify(snapshot.manifest)!==JSON.stringify(manifest))
      fail('stored manifest object does not match verified manifest bytes');
    const packageKind=packageKindForFlags(manifest.fixtureOnly,manifest.publicationEligible);
    if(!packageKind) fail('stored manifest package flags are invalid');
    const entry={content_version:snapshot.contentVersion,data_revision:snapshot.dataRevision};
    const manifestFiles=validateManifest(manifest,{entry,gameVersion:snapshot.gameVersion,
      gameReleaseId:snapshot.gameReleaseId,allowFixture,allowPendingPreview,packageKind});
    if(!isObject(snapshot.files)||JSON.stringify(Object.keys(snapshot.files).sort())!==JSON.stringify([...REQUIRED_KINDS].sort()))
      fail('stored snapshot contains missing or unlisted domains');
    let totalBytes=0;
    const domains={};
    for(const kind of REQUIRED_KINDS){
      const file=snapshot.files[kind],metadata=manifestFiles.get(kind);
      if(!isObject(file)||file.path!==metadata.path||file.sizeBytes!==metadata.sizeBytes||
        file.sha256!==metadata.sha256||!file.bytes) fail('stored domain metadata differs from manifest: '+kind);
      const bytes=new Uint8Array(file.bytes);
      totalBytes+=bytes.byteLength;
      if(bytes.byteLength!==metadata.sizeBytes||await sha256(bytes,cryptoApi)!==metadata.sha256)
        fail('stored domain integrity failed: '+kind);
      let document;
      try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch(error){fail('stored domain JSON is invalid: '+kind);}
      scanPayloadSafety(document,'stored '+kind);
      domains[kind]=await validateDomainDocument(document,{kind,manifest,allowFixture,allowPendingPreview,
        packageKind,cryptoApi});
    }
    if(totalBytes>LIMITS.snapshotBytes) fail('stored snapshot exceeds size limit');
    validateRecordReferences(domains,manifest,manifestFiles);
    return {...snapshot,manifest,domains};
  }
  async function rollback({store,gameReleaseId,dataRevision,cryptoApi=globalThis.crypto,allowFixture=true,
    allowPendingPreview=false}){
    if(!store||typeof store.getActive!=='function'||typeof store.getSnapshot!=='function'||
      typeof store.activateSnapshot!=='function') fail('rollback storage is invalid');
    assertReleaseId(gameReleaseId,'rollback');
    assertDataRevision(dataRevision,'rollback');
    const active=await store.getActive(gameReleaseId);
    if(!active) fail('rollback has no active snapshot');
    const target=await store.getSnapshot(gameReleaseId,dataRevision);
    if(!target||target.gameReleaseId!==gameReleaseId||target.dataRevision!==dataRevision||
      target.gameVersion!==active.gameVersion) fail('rollback target snapshot is unavailable or incompatible');
    await verifyStoredSnapshot(active,{cryptoApi,allowFixture,allowPendingPreview});
    const verifiedTarget=await verifyStoredSnapshot(target,{cryptoApi,allowFixture,allowPendingPreview});
    if(compareContentVersions(verifiedTarget.contentVersion,active.contentVersion)>=0)
      fail('rollback target must be an older compatible content version');
    await store.activateSnapshot(gameReleaseId,dataRevision);
    return verifiedTarget;
  }

  function openDatabase(indexedDb=globalThis.indexedDB){
    if(!indexedDb||typeof indexedDb.open!=='function') return Promise.reject(new Error('IndexedDB is unavailable'));
    return new Promise((resolve,reject)=>{
      const request=indexedDb.open('glat-w01-shared-v2',1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots',{keyPath:'id'});
        if(!db.objectStoreNames.contains('active')) db.createObjectStore('active',{keyPath:'gameReleaseId'});
      };
      request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
      request.onsuccess=()=>resolve(request.result);
      request.onblocked=()=>reject(new Error('IndexedDB open is blocked'));
    });
  }
  function idbRequest(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));
    });
  }
  function idbTransaction(transaction){
    return new Promise((resolve,reject)=>{
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB transaction aborted'));
      transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB transaction failed'));
    });
  }
  function makeSnapshotRecord(snapshot){
    const files={};
    for(const kind of REQUIRED_KINDS){
      const file=snapshot.files[kind];
      files[kind]={path:file.path,sizeBytes:file.sizeBytes,sha256:file.sha256,bytes:toArrayBuffer(file.bytes)};
    }
    return {
      id:snapshot.gameReleaseId+'|'+snapshot.dataRevision,gameReleaseId:snapshot.gameReleaseId,
      gameVersion:snapshot.gameVersion,contentVersion:snapshot.contentVersion,
      dataRevision:snapshot.dataRevision,manifest:snapshot.manifest,
      manifestBytes:toArrayBuffer(snapshot.manifestBytes),manifestSha256:snapshot.manifestSha256,
      versionBuildId:snapshot.versionBuildId,files
    };
  }
  class IndexedDbSnapshotStore {
    constructor(indexedDb=globalThis.indexedDB,{beforeCommit=null}={}){
      this.indexedDb=indexedDb;this.database=null;this.beforeCommit=beforeCommit;
    }
    async db(){if(!this.database) this.database=await openDatabase(this.indexedDb);return this.database;}
    async getActive(gameReleaseId){
      const db=await this.db();
      return new Promise((resolve,reject)=>{
        const transaction=db.transaction(['active','snapshots'],'readonly');
        let result=null;
        const activeRequest=transaction.objectStore('active').get(gameReleaseId);
        activeRequest.onerror=()=>reject(activeRequest.error||new Error('IndexedDB active read failed'));
        activeRequest.onsuccess=()=>{
          const pointer=activeRequest.result;
          if(!pointer) return;
          const snapshotRequest=transaction.objectStore('snapshots').get(pointer.id);
          snapshotRequest.onerror=()=>reject(snapshotRequest.error||new Error('IndexedDB snapshot read failed'));
          snapshotRequest.onsuccess=()=>{result=snapshotRequest.result||null;};
        };
        transaction.oncomplete=()=>resolve(result);
        transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB read transaction aborted'));
        transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB read transaction failed'));
      });
    }
    async listActive(){
      const db=await this.db();
      return new Promise((resolve,reject)=>{
        const transaction=db.transaction(['active'],'readonly');
        let result=[];
        const request=transaction.objectStore('active').getAll();
        request.onsuccess=()=>{result=Array.isArray(request.result)?request.result:[];};
        request.onerror=()=>reject(request.error||new Error('IndexedDB active list read failed'));
        transaction.oncomplete=()=>resolve(result);
        transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB active list transaction aborted'));
        transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB active list transaction failed'));
      });
    }
    async getSnapshot(gameReleaseId,dataRevision){
      const db=await this.db(),transaction=db.transaction(['snapshots'],'readonly');
      return (await idbRequest(transaction.objectStore('snapshots').get(gameReleaseId+'|'+dataRevision)))||null;
    }
    async commitSnapshot(snapshot){
      const db=await this.db(),transaction=db.transaction(['snapshots','active'],'readwrite');
      const record=makeSnapshotRecord(snapshot);
      try{
        transaction.objectStore('snapshots').put(record);
        transaction.objectStore('active').put({gameReleaseId:record.gameReleaseId,id:record.id,
          dataRevision:record.dataRevision,gameVersion:record.gameVersion,contentVersion:record.contentVersion});
        if(this.beforeCommit) this.beforeCommit(transaction,record);
      }catch(error){
        try{transaction.abort();}catch{}
        throw error;
      }
      await idbTransaction(transaction);
    }
    async activateSnapshot(gameReleaseId,dataRevision){
      const db=await this.db(),transaction=db.transaction(['snapshots','active'],'readwrite');
      const snapshots=transaction.objectStore('snapshots'),active=transaction.objectStore('active');
      const request=snapshots.get(gameReleaseId+'|'+dataRevision);
      request.onsuccess=()=>{
        const snapshot=request.result;
        if(!snapshot){transaction.abort();return;}
        active.put({gameReleaseId:snapshot.gameReleaseId,id:snapshot.id,dataRevision:snapshot.dataRevision,
          gameVersion:snapshot.gameVersion,contentVersion:snapshot.contentVersion});
      };
      await idbTransaction(transaction);
    }
  }

  return Object.freeze({DEV_ORIGIN,REQUIRED_KINDS,ALL_KINDS,LIMITS,loadAndActivate,rollback,
    verifyStoredSnapshot,IndexedDbSnapshotStore,compareContentVersions});
});
