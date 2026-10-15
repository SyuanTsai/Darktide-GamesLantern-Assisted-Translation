'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildDevExtension}=require('../../scripts/w01/build-dev-extension.cjs');
const {
  GAME_VERSION,GAME_RELEASE_ID,DATA_R1,DATA_R2,
  createRelease,rewriteDomain,tieredNativeRelease
}=require('./fixtures.cjs');
const {nativeRelease}=require('./native-fixtures.cjs');
const {loadPlaywright}=require('./playwright-runtime.cjs');

function serializeRoutes(release){
  return Object.fromEntries([...release.routes.entries()].map(([pathname,bytes])=>[pathname,bytes.toString('base64')]));
}

// Scenario: Given a verified R1 snapshot in the loaded MV3 preview, then a UI-triggered R2 update with mismatched domain bytes.
// Purpose: Preserve R1 and keep the failure and request audit visible while rendering populated verified detail sections only.
test('InterT11_PreviewRendersVerifiedIdbSnapshotsAsTextAcrossFaultAndRollback',async t=>{
  const previewSource=fs.readFileSync(path.join(__dirname,'../../extension/w01/preview.js'),'utf8');
  assert.doesNotMatch(previewSource,/\.(?:innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(previewSource,/\b(?:eval|Function)\s*\(/);
  const {playwright,version:playwrightVersion}=loadPlaywright();
  const built=buildDevExtension({includeTestHarness:true});
  const profilePath=path.join(built.outputRoot,'profile');
  const screenshots={
    r1:path.join(built.outputRoot,'preview-r1.png'),
    r2:path.join(built.outputRoot,'preview-r2.png'),
    rollback:path.join(built.outputRoot,'preview-rollback-r1.png'),
    failedUpdate:path.join(built.outputRoot,'preview-failed-update-r1.png')
  };
  const r1=createRelease({dataRevision:DATA_R1,contentVersion:'0.0.1'});
  rewriteDomain(r1,'skills',document=>{
    const presentation=document.records.find(record=>record.owner==='web'&&record.kind==='presentation'&&
      record.entityRef==='fixture:skill:a');
    presentation.payload.name='<em>示意技能</em>';
    const sections=presentation.payload.detailSections;
    sections.conditions=[{itemId:'fixture-condition-skill',text:'Synthetic fixture condition.',
      claimRefs:['fixture:claim:a']}];
    sections.calculation=[{itemId:'fixture-calculation-skill',text:'Synthetic fixture calculation.',
      claimRefs:['fixture:claim:a']}];
    sections.notes=[{itemId:'fixture-note-skill',text:'Synthetic fixture note.',
      claimRefs:['fixture:claim:a']}];
  });
  const r2=createRelease({dataRevision:DATA_R2,contentVersion:'0.0.2'});
  rewriteDomain(r2,'weapons',document=>{
    const presentation=document.records.find(record=>record.kind==='presentation'&&
      record.entityRef==='fixture:weapon:a');
    presentation.payload.detailSections={effects:[],conditions:[],calculation:[],notes:[],extra:[]};
  });
  const r2InvalidRoutes=serializeRoutes(r2);
  const r2SkillsPath='/data/'+DATA_R2+'/skills.json';
  const r2SkillsBytes=r2.routes.get(r2SkillsPath);
  r2InvalidRoutes[r2SkillsPath]=Buffer.from(
    r2SkillsBytes.toString('utf8').replace('"fixture:skill:a"','"fixture:skill:b"')
  ).toString('base64');
  let context;
  const pageErrors=[];
  const consoleErrors=[];
  const browserRequestOrigins=[];
  const originalWorkingDirectory=process.cwd();
  try{
    process.chdir(built.outputRoot);
    try{
      context=await playwright.chromium.launchPersistentContext(profilePath,{
        channel:'chromium',executablePath:process.env.SYP_W01_CHROMIUM_EXE||undefined,
        headless:true,viewport:{width:1180,height:900},
        ignoreDefaultArgs:['--disable-extensions'],
        args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath]
      });
    }catch(error){
      if(error.message.includes('spawn UNKNOWN')){
        t.diagnostic('Bundled Chromium could not start: '+error.message);
        t.skip('Loaded-extension renderer test unavailable because Chromium failed to start.');
        return;
      }
      throw error;
    }
    let worker=context.serviceWorkers().find(candidate=>candidate.url().endsWith('/service-worker.js'));
    if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
    assert.ok(worker.url().endsWith('/service-worker.js'));
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('request',request=>{
      const url=new URL(request.url());
      browserRequestOrigins.push(url.protocol+'//'+url.host);
    });
    await page.goto('chrome-extension://'+extensionId+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.runW01PreviewFaultStages==='function');
    const stages=await page.evaluate(input=>window.runW01PreviewFaultStages(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,
      r1DataRevision:DATA_R1,r2DataRevision:DATA_R2,
      r1Routes:serializeRoutes(r1),r2Routes:serializeRoutes(r2),
      r2InvalidRoutes
    });
    assert.equal(stages.initialActive.dataRevision,DATA_R1);
    assert.equal(stages.invalidUpdateRejected,true);
    assert.equal(stages.activeAfterInvalid.dataRevision,DATA_R1);
    assert.equal(stages.transactionAbortObserved,true);
    assert.equal(stages.activeAfterAbort.dataRevision,DATA_R1);
    assert.equal(stages.abortedSnapshotAbsent,true);

    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.waitForFunction(()=>document.body.dataset.w01State==='active');
    let rendered=await page.locator('#snapshot-info').textContent();
    assert.ok(rendered.includes(GAME_VERSION));
    assert.ok(rendered.includes(DATA_R1));
    assert.ok((await page.locator('#data-status').textContent()).includes('合成 Fixture 資料'));
    const skillTitle=page.locator('#content-cards .entity-card h3').first();
    assert.equal(await skillTitle.textContent(),'<em>示意技能</em>');
    assert.equal(await page.locator('#content-cards .entity-card h3 em').count(),0);
    const contentText=await page.locator('#content-cards').textContent();
    assert.ok(contentText.includes('冷卻 < 40 秒 & 保留原句字元。'));
    assert.ok(contentText.includes('Cooldown < 40 seconds & still literal.'));
    assert.ok(contentText.includes('Synthetic fixture condition.'));
    assert.ok(contentText.includes('Synthetic fixture calculation.'));
    assert.ok(contentText.includes('Synthetic fixture note.'));
    assert.ok(contentText.includes('獨立勘誤'));
    assert.ok(contentText.includes('待人工審核'));
    assert.ok(contentText.includes('已定義階級'));
    assert.ok(contentText.includes('可取得階級：未知'));
    assert.ok(contentText.includes('T1 · 資料標示為未知'));
    const detailSectionHeadings=await page.locator('#content-cards .detail-section h4').allTextContents();
    assert.deepEqual(detailSectionHeadings,
      ['效果','條件','計算','補充說明','額外說明',
        '效果','額外說明',
        '效果','額外說明']);
    assert.ok(!(await page.locator('#content-cards .detail-section .empty-value').allTextContents())
      .includes('—'));
    assert.ok((await page.locator('#term-cards').textContent()).includes('集中維護的繁中定義。'));
    await page.screenshot({path:screenshots.r1,fullPage:true});

    await worker.evaluate(routes=>{
      self.__w01OriginalFetch=self.fetch;
      self.fetch=async input=>{
        const url=new URL(String(input));
        const encoded=routes[url.pathname];
        if(url.origin!==W01SharedLoader.DEV_ORIGIN||typeof encoded!=='string')
          return new Response('not found',{status:404,headers:{'Content-Type':'text/plain'}});
        const binary=atob(encoded);
        const bytes=new Uint8Array(binary.length);
        for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
        return new Response(bytes,{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
      };
    },r2InvalidRoutes);
    await page.locator('#load-preview').click();
    await page.waitForFunction(()=>window.W01Preview&&window.W01Preview.getLastActivation()&&
      window.W01Preview.getLastActivation().ok===false&&document.body.dataset.w01State==='active');
    const failedActivation=await page.evaluate(()=>window.W01Preview.getLastActivation());
    assert.match(failedActivation.error,/hash mismatch/);
    assert.equal(await page.locator('#snapshot-metadata').textContent().then(text=>text.includes(DATA_R1)),true);
    assert.equal(await page.locator('#error-message').isVisible(),true,
      'the failed update message must remain visible after the R1 snapshot refresh');
    assert.match(await page.locator('#error-message').textContent(),/hash mismatch/);
    const failedNetworkAudit=await page.locator('#network-audit').textContent();
    assert.ok(failedNetworkAudit.includes('/version.json'));
    assert.ok(failedNetworkAudit.includes('/data/'+DATA_R2+'/skills.json'));
    assert.ok(failedNetworkAudit.includes('HTTP 200'));
    await page.screenshot({path:screenshots.failedUpdate,fullPage:true});
    await worker.evaluate(()=>{self.fetch=self.__w01OriginalFetch;delete self.__w01OriginalFetch;});

    await page.goto('chrome-extension://'+extensionId+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.activateW01PreviewR2==='function');
    const r2Active=await page.evaluate(input=>window.activateW01PreviewR2(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,r2Routes:serializeRoutes(r2)
    });
    assert.equal(r2Active.dataRevision,DATA_R2);
    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.waitForFunction(()=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes('0.0.2'));
    rendered=await page.locator('#snapshot-info').textContent();
    assert.ok(rendered.includes(DATA_R2));
    const emptyWeaponCard=page.locator('#content-cards .entity-card').filter({hasText:'示意武器'}).first();
    assert.equal(await emptyWeaponCard.locator('.detail-section').count(),0,
      'A presentation with five empty sections must render no detail section.');
    assert.ok(!(await emptyWeaponCard.textContent()).includes('—'),
      'A presentation with five empty sections must not render an empty dash.');
    await page.screenshot({path:screenshots.r2,fullPage:true});

    const rollback=await page.evaluate(async input=>new Promise(resolve=>{
      chrome.runtime.sendMessage({type:'W01_ROLLBACK',gameReleaseId:input.gameReleaseId,
        dataRevision:input.dataRevision},resolve);
    }),{gameReleaseId:GAME_RELEASE_ID,dataRevision:DATA_R1});
    assert.equal(rollback.ok,true);
    assert.equal(rollback.active.dataRevision,DATA_R1);
    await page.reload();
    await page.waitForFunction(()=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes('0.0.1'));
    rendered=await page.locator('#snapshot-info').textContent();
    assert.ok(rendered.includes(DATA_R1));
    await page.screenshot({path:screenshots.rollback,fullPage:true});

    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(consoleErrors,[]);
    assert.ok(browserRequestOrigins.every(origin=>'chrome-extension://'+extensionId===origin));
    t.diagnostic(JSON.stringify({
      devBuild:'unpacked MV3 extension; private persistent profile',
      extensionId,
      playwrightVersion,
      projectDeclaredPlaywright:'1.62.1',
      chromeVersion:context.browser().version(),
      serviceWorker:worker.url(),
      browserRequestOrigins:[...new Set(browserRequestOrigins)],
      browserRequestCount:browserRequestOrigins.length,
      syntheticOnly:true,
      htmlTextRenderedLiterally:true,
      fixtureAndPendingBadgesVisible:true,
      detailSectionHeadings,
      emptySectionPlaceholdersHidden:true,
      invalidUpdateAndTransactionAbortPreservedR1:true,
      failedUpdateMessageVisibleAfterRefresh:true,
      failedUpdateNetworkAuditRetained:true,
      updateDisplayedR2:true,
      rollbackDisplayedR1:true,
      consoleErrors,
      pageErrors,
      screenshots
    },null,2));
  }finally{
    if(context) await context.close();
    process.chdir(originalWorkingDirectory);
  }
});

// Scenario: Given a synthetic pending-preview package with native zh-TW official source spans and one bound number.
// Purpose: Verify the loaded MV3 page labels the data as pending and renders official source/template text safely.
test('InterT12_RendersNativeOfficialZhTwAndPendingCompatibilityNotice',async t=>{
  const {playwright,version:playwrightVersion}=loadPlaywright();
  const built=buildDevExtension({includeTestHarness:true});
  const profilePath=path.join(built.outputRoot,'profile');
  const screenshot=path.join(built.outputRoot,'preview-native-pending.png');
  const candidate=nativeRelease();
  const candidateR2=nativeRelease({dataRevision:'4'.repeat(64),contentVersion:'0.0.4'});
  rewriteDomain(candidateR2,'skills',document=>{
    document.records.find(record=>record.kind==='presentation').payload.name='示意技能修訂2';
  });
  let context;
  const pageErrors=[];
  const consoleErrors=[];
  try{
    context=await playwright.chromium.launchPersistentContext(profilePath,{
      channel:'chromium',executablePath:process.env.SYP_W01_CHROMIUM_EXE||undefined,
      headless:true,viewport:{width:1180,height:900},ignoreDefaultArgs:['--disable-extensions'],
      args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath]
    });
    let worker=context.serviceWorkers().find(candidateWorker=>candidateWorker.url().endsWith('/service-worker.js'));
    if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    await page.goto('chrome-extension://'+extensionId+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.activateW01PendingPreview==='function');
    const active=await page.evaluate(input=>window.activateW01PendingPreview(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,routes:serializeRoutes(candidate)
    });
    assert.equal(active.dataRevision,candidate.dataRevision);
    const invalidRoutes=serializeRoutes(candidateR2);
    invalidRoutes['/data/'+candidateR2.dataRevision+'/skills.json']=Buffer.from('tampered').toString('base64');
    const invalidRejected=await page.evaluate(async input=>{
      try{await window.activateW01PendingPreview(input);return false;}catch{return true;}
    },{gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,routes:invalidRoutes});
    assert.equal(invalidRejected,true);
    const activeAfterInvalid=await page.evaluate(input=>new Promise(resolve=>{
      chrome.runtime.sendMessage({type:'W01_GET_STATUS',gameReleaseId:input.gameReleaseId},resolve);
    }),{gameReleaseId:GAME_RELEASE_ID});
    assert.equal(activeAfterInvalid.active.dataRevision,candidate.dataRevision);
    const updated=await page.evaluate(input=>window.activateW01PendingPreview(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,routes:serializeRoutes(candidateR2)
    });
    assert.equal(updated.dataRevision,candidateR2.dataRevision);
    const rollback=await page.evaluate(input=>new Promise(resolve=>{
      chrome.runtime.sendMessage({type:'W01_ROLLBACK',gameReleaseId:input.gameReleaseId,
        dataRevision:input.dataRevision},resolve);
    }),{gameReleaseId:GAME_RELEASE_ID,dataRevision:candidate.dataRevision});
    assert.equal(rollback.ok,true);
    assert.equal(rollback.active.dataRevision,candidate.dataRevision);
    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.waitForFunction(()=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes('0.0.3'));
    const notice=await page.locator('#data-status').textContent();
    assert.ok(notice.includes('待審資料'));
    assert.ok(notice.includes('代碼快照與文字版本相容性尚未核實'));
    const official=page.locator('#content-cards .official-copy').first();
    assert.ok((await official.textContent()).includes('官方繁體中文原始字串'));
    assert.ok((await official.textContent()).includes('合成冷卻 {cooldown:%s} 秒。'));
    assert.ok((await official.textContent()).includes('合成冷卻 35 秒。'));
    assert.equal(await official.locator('script,em').count(),0);
    await page.screenshot({path:screenshot,fullPage:true});
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(consoleErrors,[]);
    t.diagnostic(JSON.stringify({
      devBuild:'unpacked MV3 extension; private persistent profile',
      playwrightVersion,projectDeclaredPlaywright:'1.62.1',chromeVersion:context.browser().version(),
      packageKind:candidate.version.package_kind,dataRevision:candidate.dataRevision,
      pendingPreviewCompatibilityNoticeVisible:true,
      nativeOfficialSourceAndResolvedTextVisible:true,
      invalidUpdatePreservedR1:true,validNativeR2UpdatedAndRolledBack:true,
      htmlTextRenderedLiterally:true,consoleErrors,pageErrors,screenshot
    },null,2));
  }catch(error){
    if(error.message.includes('spawn UNKNOWN')){
      t.diagnostic('Bundled Chromium could not start: '+error.message);
      t.skip('Loaded-extension native renderer test unavailable because Chromium failed to start.');
      return;
    }
    throw error;
  }finally{
    if(context) await context.close();
  }
});

// Scenario: Given a validated four-tier native blessing presentation with sparse details in extension-origin IndexedDB.
// Purpose: Keep official text and authored details synchronized while hiding empty sections across LV4, LV1, LV2, LV3, and LV4.
test('InterT14_BlessingTierSelectorKeepsOfficialTextAndDetailsOnTheSameTier',async t=>{
  const {playwright,version:playwrightVersion}=loadPlaywright();
  const built=buildDevExtension({includeTestHarness:true});
  const profilePath=path.join(built.outputRoot,'profile');
  const screenshot=path.join(built.outputRoot,'preview-blessing-tier-selector.png');
  const candidate=tieredNativeRelease({dataRevision:'7'.repeat(64),contentVersion:'0.0.74'});
  rewriteDomain(candidate,'blessings',document=>{
    const presentation=document.records.find(record=>record.kind==='presentation'&&
      record.entityRef==='fixture:blessing:a');
    const tierFour=presentation.payload.tierPresentations.options.find(option=>option.tier===4);
    tierFour.detailSections.effects.push({itemId:'fixture-tier-zero-value',text:'0',
      claimRefs:['fixture:blessing:tier-4-percent']});
    presentation.payload.detailSections=JSON.parse(JSON.stringify(tierFour.detailSections));
  });
  let context;
  const pageErrors=[];
  const consoleErrors=[];
  try{
    context=await playwright.chromium.launchPersistentContext(profilePath,{
      channel:'chromium',executablePath:process.env.SYP_W01_CHROMIUM_EXE||undefined,
      headless:true,viewport:{width:1180,height:1000},ignoreDefaultArgs:['--disable-extensions'],
      args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath]
    });
    let worker=context.serviceWorkers().find(item=>item.url().endsWith('/service-worker.js'));
    if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    await page.goto('chrome-extension://'+extensionId+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.activateW01PendingPreview==='function');
    const active=await page.evaluate(input=>window.activateW01PendingPreview(input),{
      gameVersion:GAME_VERSION,gameReleaseId:GAME_RELEASE_ID,routes:serializeRoutes(candidate)
    });
    assert.equal(active.dataRevision,candidate.dataRevision);
    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.waitForFunction(()=>document.body.dataset.w01State==='active'&&
      document.querySelector('#content-cards .tier-selected-presentation'));
    const card=page.locator('#content-cards .entity-card').filter({hasText:'示意祝福'}).first();
    const selector=card.locator('select[aria-label="祝福階級"]');
    assert.equal(await selector.locator('option').count(),4);
    assert.deepEqual(await selector.locator('option').allTextContents(),['LV1','LV2','LV3','LV4']);
    assert.equal(await selector.inputValue(),'4');
    assert.ok((await card.textContent()).includes('可取得階級：未知'));
    const initialSelected=card.locator('.tier-selected-presentation');
    assert.deepEqual(await initialSelected.locator('.detail-section h4').allTextContents(),['效果','計算']);
    assert.ok(!(await initialSelected.locator('.detail-section .empty-value').allTextContents())
      .includes('—'));
    assert.ok((await initialSelected.locator('.detail-section li').allTextContents()).includes('0'));
    assert.equal(await card.locator('.official-copy').count(),1,
      'the tiered blessing renders one selected official presentation at a time');

    const expected=[
      {tier:4,percent:'+20%',effect:'Synthetic tier 4 movement effect at +20%.'},
      {tier:1,percent:'+17%',effect:'Synthetic tier 1 movement effect at +17%.'},
      {tier:2,percent:'+18%',effect:'Synthetic tier 2 movement effect at +18%.'},
      {tier:3,percent:'+19%',effect:'Synthetic tier 3 movement effect at +19%.'},
      {tier:4,percent:'+20%',effect:'Synthetic tier 4 movement effect at +20%.'}
    ];
    for(const step of expected){
      await selector.selectOption(String(step.tier));
      const selected=card.locator('.tier-selected-presentation');
      const text=await selected.textContent();
      assert.ok(text.includes('目前選取：LV'+String(step.tier)));
      assert.ok(text.includes(step.percent));
      assert.ok(text.includes(step.effect));
      assert.ok(text.includes('Synthetic active duration 2 seconds.'));
      assert.ok(text.includes('持續 2 秒。'));
      const sectionHeadings=await selected.locator('.detail-section h4').allTextContents();
      assert.deepEqual(sectionHeadings,['效果','計算'],
        'Only populated detail sections should appear, in their original order.');
      const emptySectionValues=await selected.locator('.detail-section .empty-value').allTextContents();
      assert.ok(!emptySectionValues.includes('—'),'Empty detail sections must not display a dash.');
      if(step.tier===4)
        assert.ok((await selected.locator('.detail-section li').allTextContents()).includes('0'),
          'A non-empty zero value must remain visible.');
    }
    assert.equal(await card.locator('.tier-selected-presentation .detail-section h4').count(),2);
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(consoleErrors,[]);
    await page.screenshot({path:screenshot,fullPage:true});
    t.diagnostic(JSON.stringify({devBuild:'unpacked MV3 extension; private persistent profile',
      packageKind:candidate.version.package_kind,dataRevision:candidate.dataRevision,
      playwrightVersion,projectDeclaredPlaywright:'1.62.1',chromeVersion:context.browser().version(),
      selectorOptions:['LV1','LV2','LV3','LV4'],defaultTier:4,sequence:[4,1,2,3,4],
      officialTextAndDetailsStaySynchronized:true,obtainableTiersRemainUnknown:true,
      visibleDetailSectionHeadings:['效果','計算'],emptySectionsHidden:true,zeroValueVisibleForTier4:true,
      consoleErrors,pageErrors,screenshot},null,2));
  }catch(error){
    if(error.message.includes('spawn UNKNOWN')){
      t.diagnostic('Bundled Chromium could not start: '+error.message);
      t.skip('Loaded-extension tier selector test unavailable because Chromium failed to start.');
      return;
    }
    throw error;
  }finally{
    if(context) await context.close();
  }
});
