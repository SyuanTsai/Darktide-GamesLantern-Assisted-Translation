'use strict';

(function(){
  const origin=window.W01SharedLoader.DEV_ORIGIN;
  const SECTION_LABELS=[
    ['effects','效果'],
    ['conditions','條件'],
    ['calculation','計算'],
    ['notes','補充說明'],
    ['extra','額外說明']
  ];
  const ENTITY_DOMAINS=[
    {domain:'skills',kind:'skill',label:'技能'},
    {domain:'blessings',kind:'blessing',label:'祝福'},
    {domain:'weapons',kind:'weapon',label:'武器'}
  ];
  const state={lastActivation:null,selectedReleaseId:null};
  const byId=id=>document.getElementById(id);
  function node(tag,text,className){
    const element=document.createElement(tag);
    if(text!==undefined&&text!==null) element.textContent=String(text);
    if(className) element.className=className;
    return element;
  }
  function clear(element){
    while(element.firstChild) element.removeChild(element.firstChild);
  }
  function sendWorker(message){
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage(message,response=>{
        const lastError=chrome.runtime.lastError;
        if(lastError){reject(new Error('背景服務通訊失敗'));return;}
        if(!response){reject(new Error('背景服務沒有回覆'));return;}
        resolve(response);
      });
    });
  }
  function status(text,stateName='ready'){
    const element=byId('snapshot-state');
    element.textContent=text;
    element.dataset.state=stateName;
    document.body.dataset.w01State=stateName;
  }
  function showError(message){
    const element=byId('error-message');
    element.textContent=message||'載入失敗';
    element.hidden=false;
  }
  function clearError(){
    const element=byId('error-message');
    element.textContent='';
    element.hidden=true;
  }
  function appendPair(list,label,value){
    list.append(node('dt',label),node('dd',value));
  }
  function reviewLabel(record){
    return record&&record.reviewState==='approved'?'已標示審核完成':'待人工審核';
  }
  function termLocalizations(domains){
    const map=new Map();
    const terms=domains.terms;
    for(const record of terms.records){
      if(record.owner==='web'&&record.kind==='term-localization'&&record.locale==='zh-TW')
        map.set(record.entityRef,record);
    }
    return map;
  }
  function appendTermReference(parent,termRef,localizedTerms){
    const record=localizedTerms.get(termRef);
    if(!record){
      parent.append(node('p','此術語尚無可顯示的繁中詞條。','term-reference'));
      return;
    }
    const block=node('div',undefined,'term-reference');
    block.append(node('strong',record.payload.label||'術語'));
    if(typeof record.payload.definition==='string')
      block.append(node('p',record.payload.definition));
    parent.append(block);
  }
  function renderOfficial(parent,official){
    if(!official||typeof official!=='object') return;
    const block=node('section',undefined,'official-copy');
    block.append(node('h4','官方字串與繁中呈現'));
    const localized=official.localizations&&official.localizations['zh-TW'];
    if(localized&&typeof localized.text==='string'){
      const group=node('div',undefined,'text-pair');
      group.append(node('span','繁體中文','field-label'),node('p',localized.text));
      block.append(group);
    }
    if(typeof official.sourceText==='string'){
      const group=node('div',undefined,'text-pair');
      group.append(node('span','來源字串（'+String(official.sourceLocale||'')+'）','field-label'),
        node('p',official.sourceText));
      block.append(group);
    }
    if(typeof official.resolvedText==='string'&&official.resolvedText!==official.sourceText){
      const group=node('div',undefined,'text-pair');
      group.append(node('span','解析後來源字串','field-label'),node('p',official.resolvedText));
      block.append(group);
    }
    parent.append(block);
  }
  function renderErrata(parent,errata){
    if(!Array.isArray(errata)||errata.length===0) return;
    const block=node('section',undefined,'errata');
    block.append(node('h4','獨立勘誤'));
    for(const item of errata){
      const article=node('article',undefined,'erratum');
      article.append(node('span',reviewLabel(item),'review-chip'));
      if(typeof item.text==='string') article.append(node('p',item.text));
      block.append(article);
    }
    parent.append(block);
  }
  function renderDetailSections(parent,sections,localizedTerms){
    for(const [key,label] of SECTION_LABELS){
      const block=node('section',undefined,'detail-section');
      block.append(node('h4',label));
      const items=sections&&Array.isArray(sections[key])?sections[key]:[];
      if(items.length===0){
        block.append(node('p','—','empty-value'));
      }else{
        const list=node('ul');
        for(const item of items){
          const row=node('li');
          if(typeof item.text==='string') row.append(node('span',item.text));
          if(typeof item.termRef==='string') appendTermReference(row,item.termRef,localizedTerms);
          if(!row.childNodes.length) row.append(node('span','此欄資料格式不含可顯示文字。','empty-value'));
          list.append(row);
        }
        block.append(list);
      }
      parent.append(block);
    }
  }
  function appendBlessingTiers(card,domain,entity){
    const variants=domain.records.filter(record=>record.owner==='source'&&record.kind==='blessing-variant'&&
      record.payload&&record.payload.blessingRef===entity.recordId);
    if(variants.length===0) return;
    const block=node('section',undefined,'tier-summary');
    block.append(node('h4','已定義階級'));
    for(const variant of variants){
      const payload=variant.payload||{};
      if(payload.obtainableTiers&&payload.obtainableTiers.status==='unknown')
        block.append(node('p','可取得階級：未知'));
      const tiers=Array.isArray(payload.definedTiers)?payload.definedTiers:[];
      for(const tier of tiers){
        const tierValue=Array.isArray(payload.tierValues)?
          payload.tierValues.find(row=>row&&row.tier===tier):null;
        const value=tierValue&&tierValue.value;
        let description='資料標示為未知';
        if(value&&value.status==='known'){
          if(typeof value.decimal==='string'&&typeof value.unit==='string')
            description=value.decimal+' '+value.unit;
          else if(typeof value.text==='string') description=value.text;
          else description='來源已提供階級值';
        }
        block.append(node('p','T'+String(tier)+' · '+description));
      }
    }
    card.append(block);
  }
  function renderEntityCards(snapshot,localizedTerms){
    const target=byId('content-cards');
    clear(target);
    let count=0;
    for(const config of ENTITY_DOMAINS){
      const domain=snapshot.domains[config.domain];
      if(!domain||!Array.isArray(domain.records)) continue;
      const entities=domain.records.filter(record=>record.owner==='source'&&record.kind===config.kind);
      for(const entity of entities){
        const presentation=domain.records.find(record=>record.owner==='web'&&record.kind==='presentation'&&
          record.entityRef===entity.recordId&&record.locale==='zh-TW');
        if(!presentation||!presentation.payload) continue;
        const payload=presentation.payload;
        const card=node('article',undefined,'entity-card');
        card.append(node('p',config.label,'entity-kind'));
        card.append(node('h3',typeof payload.name==='string'?payload.name:'未提供繁中名稱'));
        card.append(node('span',reviewLabel(presentation),'review-chip'));
        renderOfficial(card,payload.official);
        renderErrata(card,payload.errata);
        renderDetailSections(card,payload.detailSections,localizedTerms);
        if(config.domain==='blessings') appendBlessingTiers(card,domain,entity);
        target.append(card);
        count++;
      }
    }
    byId('domain-content').hidden=count===0;
    if(count===0) target.append(node('p','目前沒有可顯示的技能、祝福或武器。'));
  }
  function renderTermCards(snapshot){
    const target=byId('term-cards');
    clear(target);
    const domain=snapshot.domains.terms;
    const localized=termLocalizations(snapshot.domains);
    const terms=domain.records.filter(record=>record.owner==='source'&&record.kind==='term');
    for(const term of terms){
      const local=localized.get(term.recordId);
      const card=node('article',undefined,'entity-card term-card');
      card.append(node('p','術語','entity-kind'));
      card.append(node('h3',local&&typeof local.payload.label==='string'?local.payload.label:'待補繁中詞條'));
      card.append(node('span',local?reviewLabel(local):'待補繁中詞條','review-chip'));
      if(local&&typeof local.payload.definition==='string')
        card.append(node('p',local.payload.definition));
      target.append(card);
    }
    byId('terms-content').hidden=terms.length===0;
    if(terms.length===0) target.append(node('p','目前沒有可顯示的術語。'));
  }
  function renderIntegrity(snapshot){
    const list=byId('integrity-list');
    clear(list);
    const info=snapshot.active;
    list.append(node('li','manifest.json · SHA-256 '+String(info.manifestSha256||'')));
    for(const [kind,file] of Object.entries(info.fileHashes||{}))
      list.append(node('li',kind+'.json · '+String(file.sizeBytes)+' bytes · SHA-256 '+String(file.sha256)));
    byId('integrity-details').hidden=false;
  }
  function renderNetworkAudit(requests){
    const list=byId('network-audit');
    clear(list);
    if(!Array.isArray(requests)||requests.length===0){
      list.append(node('li','尚無 Preview 請求紀錄。'));
      return;
    }
    for(const request of requests){
      let path='固定主機請求';
      try{
        const url=new URL(request.url);
        path=url.pathname;
      }catch{}
      const result=request.networkError?'網路錯誤':
        (typeof request.status==='number'?'HTTP '+String(request.status):'未收到狀態');
      list.append(node('li',path+' · '+result));
    }
  }
  function renderSnapshot(snapshot){
    clearError();
    const active=snapshot.active;
    const manifest=snapshot.manifest;
    const allRecords=Object.values(snapshot.domains).flatMap(domain=>domain.records||[]);
    const hasPending=allRecords.some(record=>record.reviewState!=='approved');
    const notice=byId('data-status');
    clear(notice);
    if(manifest.fixtureOnly===true){
      notice.append(node('strong','合成 Fixture 資料'));
      notice.append(node('span',' 此資料不是已確認的遊戲事實。'));
      notice.classList.add('fixture-notice');
    }else if(manifest.publicationEligible!==true){
      notice.append(node('strong','非發布資料'));
      notice.append(node('span',' 此套件尚未標記為可發布。'));
      notice.classList.add('fixture-notice');
    }else{
      notice.classList.remove('fixture-notice');
    }
    if(hasPending||manifest.publicationEligible!==true){
      notice.append(node('p','內容含待審記錄或未通過發布條件；保留來源文字與勘誤的分離呈現。'));
      notice.classList.add('pending-notice');
    }else{
      notice.classList.remove('pending-notice');
    }
    notice.hidden=notice.childNodes.length===0;

    const metadata=byId('snapshot-metadata');
    clear(metadata);
    appendPair(metadata,'遊戲版本',active.gameVersion);
    appendPair(metadata,'發佈識別',active.gameReleaseId);
    appendPair(metadata,'內容版本',active.contentVersion);
    appendPair(metadata,'資料修訂',active.dataRevision);
    appendPair(metadata,'Fixture only',String(manifest.fixtureOnly===true));
    appendPair(metadata,'可發布',String(manifest.publicationEligible===true));
    appendPair(metadata,'待審記錄',String(hasPending));
    byId('snapshot-info').hidden=false;
    const terms=termLocalizations(snapshot.domains);
    renderEntityCards(snapshot,terms);
    renderTermCards(snapshot);
    renderIntegrity(snapshot);
    status('已顯示通過驗證的本機快照。','active');
  }
  async function loadSnapshot(gameReleaseId){
    if(!gameReleaseId){
      status('請先選擇已啟用的發佈。','empty');
      return;
    }
    status('正在驗證本機快照…','loading');
    clearError();
    const response=await sendWorker({type:'W01_GET_SNAPSHOT',gameReleaseId});
    if(!response.ok) throw new Error(response.error||'無法讀取已驗證快照');
    if(!response.snapshot){
      status('尚未啟用這個發佈。','empty');
      return;
    }
    state.selectedReleaseId=gameReleaseId;
    renderSnapshot(response.snapshot);
  }
  async function refreshReleaseList(){
    const response=await sendWorker({type:'W01_LIST_ACTIVE'});
    if(!response.ok) throw new Error(response.error||'無法讀取本機發佈清單');
    const select=byId('active-release');
    const previous=state.selectedReleaseId||select.value;
    clear(select);
    const releases=Array.isArray(response.activeReleases)?response.activeReleases:[];
    for(const release of releases){
      const option=node('option',release.gameVersion+' · '+release.contentVersion+' · '+release.gameReleaseId);
      option.value=release.gameReleaseId;
      select.append(option);
    }
    if(releases.length===0){
      select.append(node('option','沒有已啟用的發佈'));
      select.disabled=true;
      byId('snapshot-info').hidden=true;
      byId('domain-content').hidden=true;
      byId('terms-content').hidden=true;
      byId('integrity-details').hidden=true;
      byId('data-status').hidden=true;
      status('本機尚無已啟用快照。可從固定 Preview 載入。','empty');
      return;
    }
    select.disabled=false;
    const selected=releases.some(release=>release.gameReleaseId===previous)?previous:releases[0].gameReleaseId;
    select.value=selected;
    await loadSnapshot(selected);
  }
  async function loadPreviewPackage(){
    clearError();
    const gameVersion=byId('game-version').value.trim();
    const gameReleaseId=byId('game-release-id').value.trim();
    state.selectedReleaseId=gameReleaseId;
    status('正在向固定 Preview 來源載入套件…','loading');
    const response=await sendWorker({type:'W01_CHECK_AND_ACTIVATE',gameVersion,gameReleaseId});
    state.lastActivation=response;
    renderNetworkAudit(response.networkRequests||[]);
    if(!response.ok){
      await refreshReleaseList();
      showError(response.error||'Preview 套件驗證失敗；目前快照不會被替換。');
      return;
    }
    await refreshReleaseList();
  }
  async function init(){
    byId('preview-origin').textContent=origin;
    byId('load-preview').addEventListener('click',()=>{
      loadPreviewPackage().catch(error=>showError(error.message));
    });
    byId('refresh-snapshot').addEventListener('click',()=>{
      loadSnapshot(byId('active-release').value).catch(error=>showError(error.message));
    });
    byId('active-release').addEventListener('change',()=>{
      loadSnapshot(byId('active-release').value).catch(error=>showError(error.message));
    });
    renderNetworkAudit([]);
    try{await refreshReleaseList();}
    catch(error){status('無法讀取本機快照。','error');showError(error.message);}
  }
  window.W01Preview=Object.freeze({
    refreshReleaseList,
    loadSnapshot,
    sendWorker,
    getLastActivation:()=>state.lastActivation
  });
  init();
})();
