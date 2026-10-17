'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {buildDevExtension}=require('../../scripts/w01/build-dev-extension.cjs');
const {inspectSharedPackage,REQUIRED_KINDS,sha256}=require('./shared-package-helpers.cjs');
const {loadPlaywright}=require('./playwright-runtime.cjs');
const {waitForW01ServiceWorker}=require('./browser-extension.cjs');

const packageDirectory=process.env.SYP_W01_PENDING_PACKAGE_DIR;
function expectedWebDisplay(value,omitStaminaUnit=false){
  let decimal=value.displayValue.decimal;
  if(['fixed-2-signed','multiplier-percent-fixed-2-signed'].includes(value.displayFormat)&&!decimal.startsWith('-'))
    decimal='+'+decimal;
  const suffixByUnit={
    'attack-power-point':'',percent:'%','stamina-point':' 耐力',
    'stamina-point-per-second':' 耐力／秒','dodge-count':' 次',ratio:''
  };
  assert.ok(Object.hasOwn(suffixByUnit,value.displayValue.unit),
    'Candidate uses an unverified display unit: '+value.displayValue.unit);
  const suffix=omitStaminaUnit&&value.displayValue.unit==='stamina-point'?'':suffixByUnit[value.displayValue.unit];
  return decimal+suffix;
}
function encodeRoutes(routes){
  return Object.fromEntries([...routes].map(([pathname,bytes])=>[pathname,Buffer.from(bytes).toString('base64')]));
}
function nextContentVersion(contentVersion){
  const [major,minor,patch]=contentVersion.split('.').map(Number);
  return `${major}.${minor}.${patch+1}`;
}
function makeVersionedPendingPackage(candidate,contentVersion,transformDomainBytes=(_kind,bytes)=>bytes){
  const revision=crypto.createHash('sha256')
    .update('SYP-311 W01 local pending preview '+candidate.entry.data_revision+' '+contentVersion).digest('hex');
  const manifest=JSON.parse(JSON.stringify(candidate.manifest));
  manifest.contentVersion=contentVersion;
  manifest.dataRevision=revision;
  const domainBytes=new Map();
  for(const kind of REQUIRED_KINDS){
    const file=candidate.files[kind];
    const bytes=Buffer.from(transformDomainBytes(kind,Buffer.from(file.bytes)));
    const metadata=manifest.files.find(item=>item.kind===kind);
    metadata.sizeBytes=bytes.byteLength;
    metadata.sha256=sha256(bytes);
    domainBytes.set(kind,bytes);
  }
  const manifestBytes=Buffer.from(JSON.stringify(manifest),'utf8');
  const version=JSON.parse(candidate.versionBytes.toString('utf8'));
  version.data_revision=revision;
  version.build_id=crypto.createHash('sha256').update('W01 local build '+contentVersion).digest('hex');
  version.game_releases=version.game_releases.map(entry=>({...entry,
    content_version:contentVersion,data_revision:revision,
    manifest_path:'/data/'+revision+'/manifest.json',manifest_sha256:sha256(manifestBytes)}));
  const routes=new Map([
    ['/version.json',Buffer.from(JSON.stringify(version),'utf8')],
    ['/data/'+revision+'/manifest.json',manifestBytes]
  ]);
  for(const kind of REQUIRED_KINDS){
    const file=candidate.files[kind];
    routes.set('/data/'+revision+'/'+file.path,domainBytes.get(kind));
  }
  return {version,manifest,entry:version.game_releases[0],routes};
}

// Scenario: Load the exact Web 0.0.17 candidate into a private unpacked extension profile, then attempt a bad update, a valid update, and rollback.
// Purpose: Verify actual IndexedDB/service-worker integration and the weapon view rendered by preview.html without representing route-adapter bytes as live HTTPS evidence.
test('InterT15_PendingPreviewCandidateRendersChainaxeRowsAndPreservesRollback',{
  skip:!packageDirectory?'Set SYP_W01_PENDING_PACKAGE_DIR to the frozen Web 0.0.17 pending-preview package.':false
},async t=>{
  const candidate=inspectSharedPackage(packageDirectory);
  const newerVersion=nextContentVersion(candidate.entry.content_version);
  const invalidVersion=nextContentVersion(newerVersion);
  const newer=makeVersionedPendingPackage(candidate,newerVersion);
  const invalidChainaxe=makeVersionedPendingPackage(candidate,invalidVersion,(kind,bytes)=>{
    if(kind!=='weapons') return bytes;
    const document=JSON.parse(bytes.toString('utf8'));
    const chainaxe= document.records.find(record=>record.owner==='source'&&record.kind==='weapon'&&
      record.payload.familyId==='chainaxe_p1'&&record.payload.markId==='chainaxe_p1_m2');
    assert.ok(chainaxe,'The malformed package must include the expected Mk XII Source identity.');
    const presentation=document.records.find(record=>record.owner==='web'&&record.kind==='presentation'&&
      record.entityRef===chainaxe.recordId&&record.locale==='zh-TW');
    assert.ok(presentation,'The malformed package must include the expected Mk XII presentation.');
    presentation.payload.name='損壞的武器名稱';
    return Buffer.from(JSON.stringify(document),'utf8');
  });
  const badRoutes=new Map(newer.routes);
  const badSkillsPath='/data/'+newer.entry.data_revision+'/'+candidate.files.skills.path;
  const originalSkills=badRoutes.get(badSkillsPath).toString('utf8');
  const tamperedSkills=originalSkills.replace('"schemaVersion": "2.0.0"','"schemaVersion": "2.0.1"');
  assert.notEqual(tamperedSkills,originalSkills);
  assert.equal(Buffer.byteLength(tamperedSkills),Buffer.byteLength(originalSkills));
  badRoutes.set(badSkillsPath,Buffer.from(tamperedSkills,'utf8'));

  const {playwright,version:playwrightVersion}=loadPlaywright();
  const built=buildDevExtension({includeTestHarness:true});
  const profilePath=path.join(built.outputRoot,'pending-preview-profile');
  const screenshots={
    chainaxes:path.join(built.outputRoot,'pending-preview-chainaxes.png'),
    failedUpdate:path.join(built.outputRoot,'pending-preview-failed-update.png'),
    rollback:path.join(built.outputRoot,'pending-preview-rollback.png'),
    malformedFamily:path.join(built.outputRoot,'pending-preview-malformed-family.png')
  };
  let context;
  const pageErrors=[];
  const consoleErrors=[];
  const browserRequestOrigins=[];
  const originalWorkingDirectory=process.cwd();
  try{
    process.chdir(built.outputRoot);
    try{
      const headless=process.env.SYP_W01_HEADLESS!=='0';
      context=await playwright.chromium.launchPersistentContext(profilePath,{
        channel:'chromium',executablePath:process.env.SYP_W01_CHROMIUM_EXE||undefined,
        headless,viewport:{width:1280,height:1000},ignoreDefaultArgs:['--disable-extensions'],
        args:['--disable-extensions-except='+built.extensionPath,'--load-extension='+built.extensionPath,
          ...(headless?[]:['--start-minimized','--window-position=-32000,-32000'])]
      });
    }catch(error){
      if(error.message.includes('spawn UNKNOWN')){
        t.diagnostic('Bundled Chromium could not start: '+error.message);
        t.skip('Loaded-extension candidate renderer unavailable because Chromium failed to start.');
        return;
      }
      throw error;
    }
    const worker=await waitForW01ServiceWorker(t,context,built.extensionPath);
    if(!worker) return;
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('request',request=>{
      const url=new URL(request.url());
      browserRequestOrigins.push(url.protocol+'//'+url.host);
    });

    await page.goto('chrome-extension://'+extensionId+'/idb-harness.html');
    await page.waitForFunction(()=>typeof window.activateW01PendingPreview==='function');
    const activated=await page.evaluate(input=>window.activateW01PendingPreview(input),{
      gameVersion:candidate.entry.game_version,gameReleaseId:candidate.manifest.gameReleaseId,
      routes:encodeRoutes(candidate.routes)
    });
    assert.equal(activated.packageKind,'pending-preview');
    assert.equal(activated.contentVersion,candidate.entry.content_version);
    assert.equal(activated.dataRevision,candidate.entry.data_revision);
    assert.equal(activated.manifestSha256,candidate.manifestSha256);

    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.waitForFunction(version=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes(version),candidate.entry.content_version);
    const weaponDocument=JSON.parse(candidate.files.weapons.bytes.toString('utf8'));
    const chainaxeEntities=weaponDocument.records.filter(record=>record.owner==='source'&&record.kind==='weapon'&&
      record.payload.familyId==='chainaxe_p1');
    assert.equal(chainaxeEntities.length,2,'The package must include both Source marks in the chainaxe family.');
    const chainaxeByMark=new Map();
    for(const entity of chainaxeEntities){
      const presentation=weaponDocument.records.find(record=>record.owner==='web'&&record.kind==='presentation'&&
        record.entityRef===entity.recordId&&record.locale==='zh-TW');
      assert.ok(presentation&&presentation.payload.weaponView,
        'Every Source chainaxe mark must have its own zh-TW weapon view.');
      assert.ok(!chainaxeByMark.has(entity.payload.markId),'Source chainaxe mark ids must be unique.');
      chainaxeByMark.set(entity.payload.markId,{entity,presentation,view:presentation.payload.weaponView});
    }
    assert.deepEqual([...chainaxeByMark.keys()].sort(),['chainaxe_p1_m1','chainaxe_p1_m2']);
    const card=page.locator('#content-cards .entity-card[data-family-id="chainaxe_p1"]');
    assert.equal(await card.count(),1,'Both marks must render in one chainaxe family card.');
    assert.equal(await card.locator('h3').textContent(),'突擊鏈斧');
    const tabs=card.locator('[role="tab"]');
    assert.equal(await tabs.count(),2);
    assert.deepEqual(await tabs.allTextContents(),['Mk IV','Mk XII']);
    assert.equal(await tabs.nth(0).getAttribute('aria-selected'),'true',
      'Mk IV is the default model.');
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'false');

    const assertActiveMark=async markId=>{
      const expected=chainaxeByMark.get(markId);
      assert.ok(expected,'The package must provide the requested Source mark.');
      const {view}=expected;
      const panel=card.locator('[role="tabpanel"]');
      const activeWeaponView=panel.locator('.weapon-view');
      assert.equal(await panel.getAttribute('data-mark-id'),markId);
      assert.equal(await activeWeaponView.locator('.weapon-mark').textContent(),view.markLabel);
      assert.equal(await activeWeaponView.locator('.weapon-view-note').textContent(),view.note,
        view.markLabel+' must render the note belonging to the selected mark.');
      assert.deepEqual((await activeWeaponView.locator('h4').allTextContents()).slice(0,3),
        ['武器標示',view.attackHeading,view.comparisonHeading]);
      assert.equal(view.statSections.length,5,view.markLabel+' must preserve all five stat groups.');
      assert.deepEqual(await activeWeaponView.locator('.weapon-stat-section').evaluateAll(nodes=>
        nodes.map(section=>section.dataset.sourceStat)),view.statSections.map(section=>section.sourceStat));
      assert.deepEqual(await activeWeaponView.locator('.weapon-stat-section h5').allTextContents(),
        view.statSections.map(section=>section.label));
      const expectedRowCount=view.statSections.reduce((sum,section)=>sum+section.rows.length,0);
      assert.equal(expectedRowCount,19,view.markLabel+' must have 19 candidate stat rows.');
      assert.equal(await activeWeaponView.locator('.weapon-stat-row').count(),expectedRowCount);
      for(let sectionIndex=0;sectionIndex<view.statSections.length;sectionIndex++){
        const expectedSection=view.statSections[sectionIndex];
        const renderedSection=activeWeaponView.locator('.weapon-stat-section').nth(sectionIndex);
        assert.equal(await renderedSection.locator('tbody tr').count(),expectedSection.rows.length);
        assert.deepEqual(await renderedSection.locator('thead th').allTextContents(),['素質','60%','80%']);
        for(let rowIndex=0;rowIndex<expectedSection.rows.length;rowIndex++){
          const expectedRow=expectedSection.rows[rowIndex];
          const renderedRow=renderedSection.locator('tbody tr').nth(rowIndex);
          assert.equal(await renderedRow.locator('th').first().textContent(),expectedRow.label);
          assert.deepEqual(expectedRow.values.map(value=>value.claimRef),expectedRow.claimRefs,
            'Renderer input must retain each exact claim reference.');
          assert.deepEqual(await renderedRow.locator('td').allTextContents(),
            expectedRow.values.map(value=>expectedWebDisplay(value,expectedRow.label==='耐力')));
        }
      }
      const renderedModes=await activeWeaponView.locator('.weapon-attack-mode').evaluateAll(nodes=>nodes.map(mode=>({
        mode:mode.dataset.mode,
        segments:[...mode.querySelectorAll('.attack-segment')].map(segment=>({
          index:Number(segment.textContent.match(/第(\d+)段/)[1]),
          targetRole:segment.dataset.targetRole,text:segment.textContent
        }))
      })));
      assert.deepEqual(renderedModes.map(mode=>({mode:mode.mode,
        segments:mode.segments.map(segment=>({index:segment.index,targetRole:segment.targetRole}))})),
        view.attackModes.map(mode=>({mode:mode.mode,segments:mode.segments})));
      assert.deepEqual(renderedModes.flatMap(mode=>mode.segments.map(segment=>segment.text)),
        view.attackModes.flatMap(mode=>mode.segments.map(segment=>
          '第'+String(segment.index)+'段 · '+(segment.targetRole==='single-target'?'單體目標':'群體順劈'))));
    };

    await assertActiveMark('chainaxe_p1_m1');
    await tabs.nth(0).focus();
    await tabs.nth(0).press('ArrowRight');
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true',
      'ArrowRight must select the next chainaxe model.');
    await assertActiveMark('chainaxe_p1_m2');
    await tabs.nth(1).press('ArrowLeft');
    assert.equal(await tabs.nth(0).getAttribute('aria-selected'),'true',
      'ArrowLeft must return to Mk IV.');
    await assertActiveMark('chainaxe_p1_m1');
    assert.equal(await card.locator('.weapon-stat-row .comparison-value').count(),38,
      'Only the selected model’s 19 by two comparison cells should be present.');
    assert.ok((await page.locator('#snapshot-metadata').textContent()).includes('pending-preview'));
    const statusText=await page.locator('#data-status').textContent();
    assert.ok(statusText.includes('待審資料'));
    assert.ok(statusText.includes('此套件含待審記錄'));
    assert.ok(statusText.includes('已核准的 W01 範圍'));
    assert.doesNotMatch(statusText,/代碼快照與文字版本相容性尚未核實/);
    assert.doesNotMatch(statusText,/SYP-333|claim|action\/profile|Psyker/);
    assert.equal(await page.locator('#data-status a').getAttribute('href'),
      'https://syuantsai.atlassian.net/browse/SYP-333?focusedCommentId=11852');
    assert.equal(await page.locator('#data-status a').textContent(),'W01 驗收紀錄');
    await page.screenshot({path:screenshots.chainaxes,fullPage:true});

    await page.locator('#game-version').fill(candidate.entry.game_version);
    await page.locator('#game-release-id').fill(candidate.manifest.gameReleaseId);
    await worker.evaluate(routes=>{
      self.__w01OriginalFetch=self.fetch;
      self.fetch=async input=>{
        const url=new URL(String(input)),encoded=routes[url.pathname];
        if(url.origin!==W01SharedLoader.DEV_ORIGIN||typeof encoded!=='string')
          return new Response('not found',{status:404,headers:{'Content-Type':'text/plain'}});
        const binary=atob(encoded),bytes=new Uint8Array(binary.length);
        for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
        return new Response(bytes,{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
      };
    },encodeRoutes(badRoutes));
    await page.locator('#load-preview').click();
    await page.waitForFunction(()=>window.W01Preview&&window.W01Preview.getLastActivation()&&
      window.W01Preview.getLastActivation().ok===false&&
      document.getElementById('error-message').textContent.toLowerCase().includes('hash mismatch'));
    const failed=await page.evaluate(()=>window.W01Preview.getLastActivation());
    assert.match(failed.error,/hash mismatch/);
    assert.ok((await page.locator('#snapshot-metadata').textContent()).includes(candidate.entry.content_version));
    assert.match(await page.locator('#error-message').textContent(),/hash mismatch/);
    await page.screenshot({path:screenshots.failedUpdate,fullPage:true});

    await worker.evaluate(()=>{self.fetch=self.__w01OriginalFetch;delete self.__w01OriginalFetch;});
    await worker.evaluate(routes=>{
      self.__w01OriginalFetch=self.fetch;
      self.fetch=async input=>{
        const url=new URL(String(input)),encoded=routes[url.pathname];
        if(url.origin!==W01SharedLoader.DEV_ORIGIN||typeof encoded!=='string')
          return new Response('not found',{status:404,headers:{'Content-Type':'text/plain'}});
        const binary=atob(encoded),bytes=new Uint8Array(binary.length);
        for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
        return new Response(bytes,{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
      };
    },encodeRoutes(newer.routes));
    await page.locator('#load-preview').click();
    await page.waitForFunction(version=>window.W01Preview&&window.W01Preview.getLastActivation()&&
      window.W01Preview.getLastActivation().ok===true&&
      document.getElementById('snapshot-metadata').textContent.includes(version),newer.entry.content_version);
    await worker.evaluate(()=>{self.fetch=self.__w01OriginalFetch;delete self.__w01OriginalFetch;});
    const rollback=await page.evaluate(input=>new Promise(resolve=>{
      chrome.runtime.sendMessage({type:'W01_ROLLBACK',gameReleaseId:input.gameReleaseId,
        dataRevision:input.dataRevision},resolve);
    }),{gameReleaseId:candidate.manifest.gameReleaseId,dataRevision:candidate.entry.data_revision});
    assert.equal(rollback.ok,true);
    assert.equal(rollback.active.packageKind,'pending-preview');
    assert.equal(rollback.active.contentVersion,candidate.entry.content_version);
    await page.reload();
    await page.waitForFunction(version=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes(version),candidate.entry.content_version);
    assert.equal(await page.locator('#content-cards [data-family-id="chainaxe_p1"] [role="tabpanel"] .weapon-stat-row').count(),19);
    await page.screenshot({path:screenshots.rollback,fullPage:true});

    await worker.evaluate(routes=>{
      self.__w01OriginalFetch=self.fetch;
      self.fetch=async input=>{
        const url=new URL(String(input)),encoded=routes[url.pathname];
        if(url.origin!==W01SharedLoader.DEV_ORIGIN||typeof encoded!=='string')
          return new Response('not found',{status:404,headers:{'Content-Type':'text/plain'}});
        const binary=atob(encoded),bytes=new Uint8Array(binary.length);
        for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
        return new Response(bytes,{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
      };
    },encodeRoutes(invalidChainaxe.routes));
    await page.locator('#game-version').fill(invalidChainaxe.entry.game_version);
    await page.locator('#game-release-id').fill(invalidChainaxe.manifest.gameReleaseId);
    await page.locator('#load-preview').click();
    await page.waitForFunction(()=>window.W01Preview&&window.W01Preview.getLastActivation()&&
      window.W01Preview.getLastActivation().ok===true&&document.body.dataset.w01State==='error',null,{timeout:7000});
    const malformedActivation=await page.evaluate(()=>window.W01Preview.getLastActivation());
    assert.equal(malformedActivation.ok,true,'The test must reach the renderer with an integrity-valid package.');
    const malformedManifestBytes=invalidChainaxe.routes.get(invalidChainaxe.entry.manifest_path);
    assert.equal(sha256(malformedManifestBytes),invalidChainaxe.entry.manifest_sha256,
      'The malformed family must be wrapped in a hash-valid manifest.');
    const malformedManifest=JSON.parse(malformedManifestBytes.toString('utf8'));
    const malformedWeaponMetadata=malformedManifest.files.find(file=>file.kind==='weapons');
    const malformedWeaponBytes=invalidChainaxe.routes.get('/data/'+invalidChainaxe.entry.data_revision+
      '/'+malformedWeaponMetadata.path);
    assert.equal(sha256(malformedWeaponBytes),malformedWeaponMetadata.sha256,
      'The malformed weapon document must match its manifest hash.');
    assert.ok((await page.locator('#snapshot-metadata').textContent()).includes(invalidChainaxe.entry.content_version));
    assert.equal(await page.locator('#content-cards [data-family-id="chainaxe_p1"]').count(),0,
      'An incomplete chainaxe family must not render as a successful family card.');
    assert.equal(await page.locator('#content-cards [data-entity-ref^="darktide:weapon:chainaxe:"]').count(),0,
      'An incomplete known family must not fall back to individual successful weapon cards.');
    assert.equal(await page.locator('#snapshot-info').isVisible(),false,
      'A package rejected by the renderer must not leave successful snapshot metadata visible.');
    assert.equal(await page.locator('#integrity-details').isVisible(),false,
      'The previous snapshot integrity receipt must not appear to certify the rejected package.');
    assert.match(await page.locator('#error-message').textContent(),/鏈斧型號/);
    await page.screenshot({path:screenshots.malformedFamily,fullPage:true});

    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(consoleErrors,[]);
    assert.ok(browserRequestOrigins.every(origin=>'chrome-extension://'+extensionId===origin));
    t.diagnostic(JSON.stringify({
      devBuild:'unpacked MV3 extension with a private persistent profile',extensionId,
      playwrightVersion,chromeVersion:context.browser().version(),serviceWorker:worker.url(),
      packageRoot:candidate.root,packageKind:candidate.version.package_kind,
      contentVersion:candidate.entry.content_version,dataRevision:candidate.entry.data_revision,
      manifestSha256:candidate.manifestSha256,
      domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,candidate.files[kind].sha256])),
      chainaxeRowsPerMark:{mkIV:19,mkXII:19},
      singleAndMultiTargetSegmentsRendered:true,
      failedUpdatePreservedCandidateVersion:candidate.entry.content_version,
      validLocalUpdateDisplayedVersion:newer.entry.content_version,
      rollbackRestoredCandidateVersion:candidate.entry.content_version,
      hashValidMalformedChainaxeRejected:true,
      candidateDataLoadedViaLocalRouteAdapter:true,liveHttpsRequests:0,
      browserRequestOrigins:[...new Set(browserRequestOrigins)],consoleErrors,pageErrors,screenshots
    },null,2));
  }finally{
    if(context) await context.close();
    process.chdir(originalWorkingDirectory);
  }
});
