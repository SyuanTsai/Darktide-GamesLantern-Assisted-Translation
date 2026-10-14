'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {DEV_ORIGIN,loadAndActivate}=require('../../extension/w01/loader-core.js');
const GAME_VERSION='fixture-preview';
const GAME_RELEASE_ID='fixture-game-1';
const SOURCE_REVISION='b'.repeat(64);
const DATA_R1='1'.repeat(64);
const DATA_R2='2'.repeat(64);
const SOURCE_REF='fixture-source';
const WEB_REF='fixture-web-source';
const DEPENDENCIES={
  skills:['terms'],
  blessings:['weapons','terms'],
  weapons:['terms'],
  terms:[],
  'game-changes':['skills']
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value),'utf8');
function response(body,{status=200,type='application/json'}={}) {
  const bytes=Buffer.from(body);
  return {status,ok:status>=200&&status<300,headers:{get:name=>name.toLowerCase()==='content-type'?type:null},
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
function record(recordId,kind,owner,payload,extra={}) {
  return {recordId,kind,owner,gameReleaseId:GAME_RELEASE_ID,payload,
    sourceRefs:[...(owner==='web'?[]:[SOURCE_REF])],reviewState:'pending',...extra};
}
function presentation(entityRef,label) {
  const includeOfficial=entityRef==='fixture:skill:a';
  const payload={name:label,
    detailSections:{effects:[{itemId:'fixture-effect-'+entityRef.replaceAll(':','-'),
      text:'Synthetic fixture item; not game content.',claimRefs:['fixture:claim:a']}],
      conditions:[],calculation:[],notes:[],extra:[{itemId:'fixture-term-'+entityRef.replaceAll(':','-'),
        termRef:'fixture:term:a'}]}};
  if(includeOfficial){
    const sourceText='Cooldown < 40 seconds & still literal.';
    const sourceDigest=digest(Buffer.from(sourceText,'utf8'));
    const localizedText='冷卻 < 40 秒 & 保留原句字元。';
    payload.official={sourceRef:WEB_REF,sourceLocale:'en',resource:'fixture/skills',
      key:'fixture.cooldown',occurrence:1,sourceText,sourceTextSha256:sourceDigest,
      segments:[{segmentId:'cooldown',text:sourceText,sha256:sourceDigest}],params:[],
      resolvedText:sourceText,resolvedTextSha256:sourceDigest,
      localizations:{'zh-TW':{origin:'faithful-translation',text:localizedText,
        sha256:digest(Buffer.from(localizedText,'utf8'))}}};
    payload.errata=[{erratumId:'fixture-erratum-smite-cooldown',
      anchor:{segmentId:'cooldown',sourceTextDigest:sourceDigest},gameReleaseId:GAME_RELEASE_ID,
      context:{},problem:'Synthetic fixture preserves a visible source and claim difference.',
      claimRef:'fixture:claim:a',evidenceRefs:['fixture:evidence:a'],
      text:'Synthetic erratum only; pending human review.',reviewState:'pending'}];
  }
  return record('fixture:presentation:'+entityRef.replaceAll(':','-'),'presentation','web',payload,
    {entityRef,locale:'zh-TW',sourceRefs:includeOfficial?[WEB_REF]:[]});
}
function createRelease({dataRevision=DATA_R1,contentVersion='0.0.1'}={}) {
  const documents={
    skills:[
      record('fixture:skill:a','skill','source',{termRef:'fixture:term:a',claimRefs:['fixture:claim:a']}),
      record('fixture:claim:a','claim','source',{targetRef:'fixture:skill:a',property:'cooldown',
        value:{status:'known',decimal:'35',unit:'seconds'},context:{},basis:'unknown',
        evidenceRefs:['fixture:evidence:a']}),
      record('fixture:evidence:a','evidence','source',{sourceRef:SOURCE_REF,safeSummary:'Synthetic fixture evidence.'}),
      presentation('fixture:skill:a','示意技能')
    ],
    blessings:[
      record('fixture:blessing:a','blessing','source',{variantRefs:['fixture:variant:a']}),
      record('fixture:variant:a','blessing-variant','source',{blessingRef:'fixture:blessing:a',
        weaponRefs:['fixture:weapon:a'],definedTiers:[1],obtainableTiers:{status:'unknown',reasonCode:'FIXTURE'},
        tierValues:[{tier:1,value:{status:'unknown',reasonCode:'FIXTURE'}}]}),
      presentation('fixture:blessing:a','示意祝福')
    ],
    weapons:[
      record('fixture:weapon:a','weapon','source',{familyId:'fixture-family:a',markId:'fixture-mark:a',
        templateKey:'fixture.template',statRefs:[],attackProfileRefs:[],
        dataCoverage:{status:'unknown',missing:[]}}),
      presentation('fixture:weapon:a','示意武器')
    ],
    terms:[
      record('fixture:term:a','term','source',{termKey:'fixture.term',contextKey:'fixture',
        technicalDefinitionEn:'Synthetic shared term.',claimRefs:['fixture:claim:a']}),
      record('fixture:term-localization:a','term-localization','web',
        {label:'示意術語',definition:'集中維護的繁中定義。'},
        {entityRef:'fixture:term:a',locale:'zh-TW',sourceRefs:[]})
    ],
    'game-changes':[
      record('fixture-change:a','game-change','source',{changeId:'fixture-change:a',entityKind:'skill',
        targetRef:'fixture:skill:a',operation:'update',comparison:{},changedFields:[],
        evidenceRefs:['fixture:evidence:a'],verificationMethod:'fixture-only'}, {sourceRefs:[]})
    ]
  };
  const encoded=Object.fromEntries(Object.entries(documents).map(([kind,records])=>[
    kind,json({schemaVersion:'2.0.0',gameReleaseId:GAME_RELEASE_ID,gameVersion:GAME_VERSION,
      sourceRevision:SOURCE_REVISION,fixtureOnly:true,publicationEligible:false,records})
  ]));
  const manifest={schemaVersion:'2.0.0',gameReleaseId:GAME_RELEASE_ID,gameVersion:GAME_VERSION,
    contentVersion,dataRevision,fixtureOnly:true,publicationEligible:false,
    source:{owner:'source',repository:'https://github.com/SyuanTsai/DarkTide-Source-Data',commit:'a'.repeat(40),
      sourceRevision:SOURCE_REVISION,manifestSha256:'c'.repeat(64),
      references:[{sourceId:SOURCE_REF,fixtureOnly:true,safeSummary:'Synthetic Source reference.'}]},
    web:{owner:'web',authoringCommit:'d'.repeat(40),compilerCommit:'e'.repeat(40),
      references:[{sourceId:WEB_REF,fixtureOnly:true,safeSummary:'Synthetic Web reference.'}]},
    compatibility:{dataContractMajor:2,requiredFeatures:['official-errata-details-v1'],gameSnapshotRefs:[SOURCE_REF]},
    files:Object.keys(encoded).map(kind=>({kind,path:kind+'.json',sizeBytes:encoded[kind].length,
      sha256:digest(encoded[kind]),dependencies:DEPENDENCIES[kind]})),
    changeIndexPath:'game-changes.json'};
  const manifestBytes=json(manifest);
  const version={schema_version:2,data_revision:dataRevision,build_id:'preview-build',
    game_version:GAME_VERSION,package_kind:'fixture',
    game_releases:[{game_version:GAME_VERSION,content_version:contentVersion,data_revision:dataRevision,
      manifest_path:'/data/'+dataRevision+'/manifest.json',manifest_sha256:digest(manifestBytes)}]};
  const routes=new Map([['/version.json',json(version)],
    ['/data/'+dataRevision+'/manifest.json',manifestBytes]]);
  for(const [kind,bytes] of Object.entries(encoded))
    routes.set('/data/'+dataRevision+'/'+kind+'.json',bytes);
  const types=new Map(),fetches=[];
  const fetchImpl=async input=>{
    const url=new URL(String(input));
    fetches.push(url.href);
    assert.equal(url.origin,DEV_ORIGIN);
    if(!routes.has(url.pathname)) return response('not found',{status:404,type:'text/plain'});
    return response(routes.get(url.pathname),{type:types.get(url.pathname)||'application/json; charset=utf-8'});
  };
  return {dataRevision,contentVersion,manifest,manifestBytes,version,routes,types,fetches,fetchImpl,encoded};
}
function refreshVersion(release) {
  const bytes=json(release.manifest);
  release.manifestBytes=bytes;
  release.routes.set('/data/'+release.dataRevision+'/manifest.json',bytes);
  release.version.game_releases[0].manifest_sha256=digest(bytes);
  release.routes.set('/version.json',json(release.version));
}
function rewriteDomain(release,kind,edit) {
  const path='/data/'+release.dataRevision+'/'+kind+'.json';
  const document=JSON.parse(release.routes.get(path).toString('utf8'));
  edit(document);
  const bytes=json(document);
  release.routes.set(path,bytes);
  const file=release.manifest.files.find(entry=>entry.kind===kind);
  file.sizeBytes=bytes.length;file.sha256=digest(bytes);
  refreshVersion(release);
}
function tieredNativeRelease({dataRevision='c'.repeat(64),contentVersion='0.0.3'}={}){
  const {nativeRelease}=require('./native-fixtures.cjs');
  const release=nativeRelease({format:'signed-percent',dataRevision,contentVersion});
  const percentByTier={1:'17',2:'18',3:'19',4:'20'};
  const ratioByTier={1:'0.17',2:'0.18',3:'0.19',4:'0.2'};
  const claimIdByTier=tier=>'fixture:blessing:tier-'+String(tier)+'-percent';
  const timeClaimId='fixture:blessing:active-duration';
  const variantRef='fixture:variant:a';
  const zhSourceRef='fixture-web-source-zh';
  const enSourceRef='fixture-web-source-en';
  function officialLocale(locale,tier){
    const isEnglish=locale==='en';
    const sourceText=isEnglish?
      'Movement speed {movement_speed:%s} for {time:%s} seconds.':
      '移動速度 {movement_speed:%s}，持續 {time:%s} 秒。';
    const parts=isEnglish?[
      ['before','literal','Movement speed '],['movement-speed','template-placeholder','{movement_speed:%s}'],
      ['middle','literal',' for '],['active-duration','template-placeholder','{time:%s}'],
      ['after','literal',' seconds.']
    ]:[
      ['before','literal','移動速度 '],['movement-speed','template-placeholder','{movement_speed:%s}'],
      ['middle','literal','，持續 '],['active-duration','template-placeholder','{time:%s}'],
      ['after','literal',' 秒。']
    ];
    const segments=parts.map(([segmentId,kind,text])=>({segmentId,kind,text,
      sha256:digest(Buffer.from(text,'utf8'))}));
    const params=[
      {name:'movement_speed',placeholder:'{movement_speed:%s}',status:'bound',
        bindingRef:claimIdByTier(tier),format:'signed-percent',resolvedValue:'+'+percentByTier[tier]+'%'},
      {name:'time',placeholder:'{time:%s}',status:'bound',bindingRef:timeClaimId,
        format:'plain-number',resolvedValue:'2'}
    ];
    const paramsByPlaceholder=new Map(params.map(param=>[param.placeholder,param]));
    const resolvedText=segments.map(segment=>segment.kind==='literal'?segment.text:
      paramsByPlaceholder.get(segment.text).resolvedValue).join('');
    const source= {
      sourceRef:isEnglish?enSourceRef:zhSourceRef,
      sourceLocale:locale,
      resource:'fixture/blessings',
      sourceHash:isEnglish?'a1b2c3d4':'b1b2c3d4',
      key:null,
      occurrence:1,
      sourceText,
      sourceTextSha256:digest(Buffer.from(sourceText,'utf8')),
      segments,
      params,
      resolvedText,
      resolvedTextSha256:digest(Buffer.from(resolvedText,'utf8'))
    };
    if(isEnglish) return source;
    return {origin:'official',...source,text:resolvedText,sha256:source.resolvedTextSha256};
  }
  function officialPair(tier){
    return { ...officialLocale('en',tier),
      localizations:{'zh-TW':officialLocale('zh-TW',tier)} };
  }
  function tierDetails(tier){
    return {effects:[{itemId:'fixture-tier-effect-'+tier,
        text:'Synthetic tier '+tier+' movement effect at +'+percentByTier[tier]+'%.',
        claimRefs:[claimIdByTier(tier)]}],
      conditions:[],
      calculation:[{itemId:'fixture-tier-duration-'+tier,
        text:'Synthetic active duration 2 seconds.',claimRefs:[timeClaimId]}],
      notes:[],extra:[]};
  }
  const options=[1,2,3,4].map(tier=>({tier,official:officialPair(tier),detailSections:tierDetails(tier)}));
  rewriteDomain(release,'blessings',document=>{
    const variant=document.records.find(item=>item.recordId===variantRef);
    variant.payload.definedTiers=[1,2,3,4];
    variant.payload.tierValues=[1,2,3,4].map(tier=>({tier,value:{status:'known',
      decimal:ratioByTier[tier],unit:'ratio'}}));
    document.records.push(...[1,2,3,4].map(tier=>record(claimIdByTier(tier),'claim','source',{
      targetRef:variantRef,
      property:'description.format_values.movement_speed.defined_tier_'+tier+'_display_percent',
      value:{status:'known',decimal:percentByTier[tier],unit:'percent'},context:{},basis:'code-derived',
      evidenceRefs:['fixture:evidence:a']
    })));
    document.records.push(record(timeClaimId,'claim','source',{
      targetRef:variantRef,property:'template.buff_override.active_duration',
      value:{status:'known',decimal:'2',unit:'s'},context:{},basis:'code-observed',
      evidenceRefs:['fixture:evidence:a']
    }));
    const presentation=document.records.find(item=>item.kind==='presentation'&&
      item.entityRef==='fixture:blessing:a');
    presentation.sourceRefs=[enSourceRef,zhSourceRef];
    presentation.payload.official=JSON.parse(JSON.stringify(options[3].official));
    presentation.payload.errata=[];
    presentation.payload.detailSections=JSON.parse(JSON.stringify(options[3].detailSections));
    presentation.payload.tierPresentations={variantRef,defaultTier:4,options};
  });
  release.manifest.files.find(file=>file.kind==='blessings').dependencies=['skills','weapons'];
  release.manifest.compatibility.requiredFeatures.push('blessing-tier-presentations-v1');
  refreshVersion(release);
  return release;
}
class MemoryStore {
  constructor(){this.active=new Map();this.snapshots=new Map();this.failCommit=false;}
  key(gameReleaseId,dataRevision){return gameReleaseId+'|'+dataRevision;}
  async getActive(gameReleaseId){return this.active.get(gameReleaseId)||null;}
  async getSnapshot(gameReleaseId,dataRevision){return this.snapshots.get(this.key(gameReleaseId,dataRevision))||null;}
  async commitSnapshot(snapshot) {
    if(this.failCommit) throw new Error('simulated commit failure');
    this.snapshots.set(this.key(snapshot.gameReleaseId,snapshot.dataRevision),snapshot);
    this.active.set(snapshot.gameReleaseId,snapshot);
  }
  async activateSnapshot(gameReleaseId,dataRevision) {
    const snapshot=await this.getSnapshot(gameReleaseId,dataRevision);
    if(!snapshot) throw new Error('snapshot unavailable');
    this.active.set(gameReleaseId,snapshot);
  }
}
async function activate(release,store=new MemoryStore(),options={}) {
  const result=await loadAndActivate({fetchImpl:release.fetchImpl,store,gameVersion:GAME_VERSION,
    gameReleaseId:GAME_RELEASE_ID,allowFixture:true,...options});
  return {result,store};
}
module.exports={GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,DEPENDENCIES,digest,json,response,record,presentation,
  createRelease,refreshVersion,rewriteDomain,tieredNativeRelease,MemoryStore,activate};
