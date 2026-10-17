'use strict';

const {createRelease,refreshVersion,rewriteDomain,digest,record}=require('./fixtures.cjs');

function nativeSegments(text,parts){
  return parts.map(([segmentId,kind,value])=>({segmentId,kind,text:value,sha256:digest(Buffer.from(value,'utf8'))}));
}
function nativeRelease({format='plain-number',numberName='cooldown',pendingPreview=true,includeFeature=true,
  dataRevision='3'.repeat(64),contentVersion='0.0.3'}={}){
  const release=createRelease({dataRevision,contentVersion});
  const sourceRefEn='fixture-web-source-en',sourceRefZh='fixture-web-source-zh';
  release.manifest.web.references.push(
    {sourceId:sourceRefEn,fixtureOnly:true,safeSummary:'Synthetic English official source reference.'},
    {sourceId:sourceRefZh,fixtureOnly:true,safeSummary:'Synthetic zh-TW official source reference.'}
  );
  const sourceHashEn=format==='official-name'?'deaf1234':'a1b2c3d4';
  const sourceHashZh=format==='official-name'?'beaf1234':'b1b2c3d4';
  const sourceKeyEn=format==='official-name'?'fixture.weapon_name':null;
  const sourceKeyZh=format==='official-name'?'fixture.weapon_name.zh':'fixture.cooldown.zh';
  let enText,enParts,zhText,zhParts,enParam,zhParam;
  if(format==='plain-number'){
    const isDefaultCooldown=numberName==='cooldown';
    const isTime=numberName==='time';
    const placeholder='{'+numberName+':%s}';
    const value=isTime?'2':'35';
    enParts=[['before','literal',isTime?'Synthetic active duration ':isDefaultCooldown?'Synthetic cooldown ':'Synthetic '+numberName+' '],
      [numberName,'template-placeholder',placeholder],['after','literal',' seconds.']];
    zhParts=[['before','literal',isTime?'合成持續時間 ':isDefaultCooldown?'合成冷卻 ':'合成'+numberName+' '],
      [numberName,'template-placeholder',placeholder],['after','literal',' 秒。']];
    enParam={name:numberName,placeholder,status:'bound',bindingRef:'fixture:claim:a',format,resolvedValue:value};
    zhParam={...enParam};
  }else if(format==='signed-percent'){
    enParts=[['before','literal','Synthetic movement '],['movement','template-placeholder','{movement_speed:%s}'],['after','literal','.']];
    zhParts=[['before','literal','合成移動速度 '],['movement','template-placeholder','{movement_speed:%s}'],['after','literal','。']];
    enParam={name:'movement_speed',placeholder:'{movement_speed:%s}',status:'bound',bindingRef:'fixture:claim:percent',format,resolvedValue:'+17%'};
    zhParam={...enParam};
  }else{
    enParts=[['before','literal','Synthetic weapon '],['weapon-name','template-placeholder','{weapon_name}'],['after','literal','.']];
    zhParts=[['before','literal','合成武器 '],['weapon-name','template-placeholder','{weapon_name}'],['after','literal','。']];
    enParam={name:'weapon_name',placeholder:'{weapon_name}',status:'bound',bindingRef:'fixture-web-name-en',format:'official-name',resolvedValue:'Chain axe'};
    zhParam={name:'weapon_name',placeholder:'{weapon_name}',status:'bound',bindingRef:'fixture-web-name-zh',format:'official-name',resolvedValue:'合成鏈斧'};
  }
  enText=enParts.map(part=>part[2]).join('');
  zhText=zhParts.map(part=>part[2]).join('');
  const enSegments=nativeSegments(enText,enParts);
  const zhSegments=nativeSegments(zhText,zhParts);
  const resolvedEn=enText.replace(enParam.placeholder,enParam.resolvedValue);
  const resolvedZh=zhText.replace(zhParam.placeholder,zhParam.resolvedValue);
  const localization={origin:'official',sourceRef:sourceRefZh,sourceLocale:'zh-TW',resource:'fixture/ui',sourceHash:sourceHashZh,
    key:sourceKeyZh,occurrence:2,sourceText:zhText,sourceTextSha256:digest(Buffer.from(zhText,'utf8')),
    segments:zhSegments,params:[zhParam],resolvedText:resolvedZh,
    resolvedTextSha256:digest(Buffer.from(resolvedZh,'utf8')),text:resolvedZh,
    sha256:digest(Buffer.from(resolvedZh,'utf8'))};
  const official={sourceRef:sourceRefEn,sourceLocale:'en',resource:'fixture/ui',sourceHash:sourceHashEn,key:sourceKeyEn,occurrence:1,
    sourceText:enText,sourceTextSha256:digest(Buffer.from(enText,'utf8')),segments:enSegments,params:[enParam],
    resolvedText:resolvedEn,resolvedTextSha256:digest(Buffer.from(resolvedEn,'utf8')),
    localizations:{'zh-TW':localization}};
  if(includeFeature){
    release.manifest.compatibility.requiredFeatures.push('official-native-localizations-v1');
    const dependencies={skills:['terms'],blessings:['skills','weapons','terms'],weapons:['skills','terms'],terms:['skills'],
      'game-changes':['skills']};
    for(const file of release.manifest.files) file.dependencies=dependencies[file.kind];
  }
  if(format==='signed-percent'){
    rewriteDomain(release,'skills',doc=>doc.records.push(record('fixture:claim:percent','claim','source',{
      targetRef:'fixture:skill:a',property:'description.format_values.movement_speed.value',
      value:{status:'known',decimal:'17',unit:'percent'},context:{},basis:'code-derived',
      evidenceRefs:['fixture:evidence:a']})));
  }else if(format==='plain-number'){
    rewriteDomain(release,'skills',doc=>{
      const claim=doc.records.find(item=>item.recordId==='fixture:claim:a');
      claim.payload.property=numberName==='time'?'template.buff_override.active_duration':
        'description.format_values.'+numberName+'.value';
      claim.payload.value={status:'known',decimal:numberName==='time'?'2':'35',
        unit:numberName==='time'?'s':'seconds'};
      claim.payload.basis=numberName==='time'?'code-observed':'code-derived';
    });
  }
  if(format==='official-name'){
    for(const [sourceId,sourceLocale,sourceHash,key,text] of [
      ['fixture-web-name-en','en',sourceHashEn,sourceKeyEn,'Chain axe'],
      ['fixture-web-name-zh','zh-TW',sourceHashZh,sourceKeyZh,'合成鏈斧']
    ]) release.manifest.web.references.push({sourceId,fixtureOnly:true,
      safeSummary:'Synthetic Web-owned official name reference.',officialName:{sourceLocale,
        resource:'fixture/ui',sourceHash,key,occurrence:sourceLocale==='en'?1:2,text,
        sha256:digest(Buffer.from(text,'utf8'))}});
    rewriteDomain(release,'skills',doc=>{
      const presentation=doc.records.find(item=>item.kind==='presentation');
      presentation.sourceRefs=[sourceRefEn,sourceRefZh,'fixture-web-name-en','fixture-web-name-zh'];
      presentation.payload.official.localizations['zh-TW']=localization;
    });
  }else{
    rewriteDomain(release,'skills',doc=>{
      const presentation=doc.records.find(item=>item.kind==='presentation');
      presentation.sourceRefs=[sourceRefEn,sourceRefZh];
    });
  }
  rewriteDomain(release,'skills',doc=>{
    const presentation=doc.records.find(item=>item.kind==='presentation');
    presentation.payload.official=official;
    presentation.payload.errata=[];
  });
  if(pendingPreview){
    release.version.package_kind='pending-preview';
    for(const kind of ['skills','blessings','weapons','terms','game-changes'])
      rewriteDomain(release,kind,doc=>{doc.fixtureOnly=false;doc.publicationEligible=false;});
    release.manifest.fixtureOnly=false;
    release.manifest.publicationEligible=false;
  }
  refreshVersion(release);
  return release;
}

module.exports={nativeRelease};
