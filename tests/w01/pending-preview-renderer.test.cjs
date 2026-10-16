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
function makeVersionedPendingPackage(candidate,contentVersion){
  const revision=crypto.createHash('sha256')
    .update('SYP-311 W01 local pending preview '+candidate.entry.data_revision+' '+contentVersion).digest('hex');
  const manifest=JSON.parse(JSON.stringify(candidate.manifest));
  manifest.contentVersion=contentVersion;
  manifest.dataRevision=revision;
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
    routes.set('/data/'+revision+'/'+file.path,file.bytes);
  }
  return {version,manifest,entry:version.game_releases[0],routes};
}

// Scenario: Load the exact Web 0.0.16 candidate into a private unpacked extension profile, then attempt a bad update, a valid update, and rollback.
// Purpose: Verify actual IndexedDB/service-worker integration and the weapon view rendered by preview.html without representing route-adapter bytes as live HTTPS evidence.
test('InterT15_PendingPreviewCandidateRendersChainaxeRowsAndPreservesRollback',{
  skip:!packageDirectory?'Set SYP_W01_PENDING_PACKAGE_DIR to the frozen Web 0.0.16 pending-preview package.':false
},async t=>{
  const candidate=inspectSharedPackage(packageDirectory);
  const newer=makeVersionedPendingPackage(candidate,'0.0.17');
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
    rollback:path.join(built.outputRoot,'pending-preview-rollback.png')
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
    assert.equal(activated.contentVersion,'0.0.16');
    assert.equal(activated.dataRevision,candidate.entry.data_revision);
    assert.equal(activated.manifestSha256,candidate.manifestSha256);

    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.waitForFunction(()=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes('0.0.16'));
    const weaponDocument=JSON.parse(candidate.files.weapons.bytes.toString('utf8'));
    for(const [entityId,expectedMark] of [
      ['darktide:weapon:chainaxe:p1-m1','Mk IV'],['darktide:weapon:chainaxe:p1-m2','Mk XII']
    ]){
      const presentation=weaponDocument.records.find(record=>record.owner==='web'&&record.kind==='presentation'&&
        record.entityRef===entityId);
      assert.ok(presentation&&presentation.payload.weaponView,'Candidate is missing the '+expectedMark+' weapon view.');
      const view=presentation.payload.weaponView;
      const card=page.locator('[data-entity-ref="'+entityId+'"]');
      assert.ok((await card.locator('.weapon-mark').textContent()).includes(expectedMark));
      assert.equal(view.statSections.length,5,expectedMark+' must preserve all five numeric stat groups.');
      assert.ok(view.statSections.some(section=>section.sourceStat==='chainaxe_defence_stat'&&section.label==='防禦'),
        expectedMark+' must include the Defence stat group.');
      assert.deepEqual(await card.locator('.weapon-stat-section').evaluateAll(nodes=>
        nodes.map(section=>section.dataset.sourceStat)),view.statSections.map(section=>section.sourceStat));
      assert.deepEqual(await card.locator('.weapon-stat-section h5').allTextContents(),
        view.statSections.map(section=>section.label));
      const expectedRowCount=view.statSections.reduce((sum,section)=>sum+section.rows.length,0);
      assert.equal(expectedRowCount,19,expectedMark+' must have 19 candidate stat rows.');
      assert.equal(await card.locator('.weapon-stat-row').count(),expectedRowCount);
      for(let sectionIndex=0;sectionIndex<view.statSections.length;sectionIndex++){
        const expectedSection=view.statSections[sectionIndex];
        const renderedSection=card.locator('.weapon-stat-section').nth(sectionIndex);
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
      const renderedWeaponText=await card.locator('.weapon-view').innerText();
      assert.ok(renderedWeaponText.includes(expectedMark==='Mk IV'?'113.00':'118.50'),
        expectedMark+' must show attack power without an engineering unit.');
      assert.match(renderedWeaponText,/0\.97 耐力／秒/,expectedMark+' must localize stamina rate units.');
      assert.match(renderedWeaponText,/3\.00 次/,expectedMark+' must localize dodge count units.');
      assert.match(renderedWeaponText,/[+-]4\.00%/,expectedMark+' must render signed percentage modifiers.');
      assert.match(renderedWeaponText,/\+0\.00%/,expectedMark+' must preserve a positive sign for zero modifiers.');
      assert.doesNotMatch(renderedWeaponText,/(?:attack-power-point|stamina-point|dodge-count|\bpercent\b|\bratio\b)/i,
        expectedMark+' must not expose typed unit identifiers.');
      const renderedModes=await card.locator('.weapon-attack-mode').evaluateAll(nodes=>nodes.map(mode=>({
        mode:mode.dataset.mode,
        segments:[...mode.querySelectorAll('.attack-segment')].map(segment=>({
          index:Number(segment.textContent.match(/第(\d+)段/)[1]),
          targetRole:segment.dataset.targetRole,text:segment.textContent
        }))
      })));
      assert.deepEqual(renderedModes.map(mode=>({mode:mode.mode,
        segments:mode.segments.map(segment=>({index:segment.index,targetRole:segment.targetRole}))})),
        view.attackModes.map(mode=>({mode:mode.mode,segments:mode.segments})));
      const expectedSegmentLabels=view.attackModes.flatMap(mode=>mode.segments.map(segment=>
        '第'+String(segment.index)+'段 · '+(segment.targetRole==='single-target'?'單體目標':'群體順劈')));
      assert.deepEqual(renderedModes.flatMap(mode=>mode.segments.map(segment=>segment.text)),expectedSegmentLabels);
    }
    assert.equal(await page.locator('.weapon-stat-row .comparison-value').count(),76);
    assert.ok((await page.locator('#snapshot-metadata').textContent()).includes('pending-preview'));
    assert.ok((await page.locator('#data-status').textContent()).includes('待審'));
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
    assert.ok((await page.locator('#snapshot-metadata').textContent()).includes('0.0.16'));
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
    await page.waitForFunction(()=>window.W01Preview&&window.W01Preview.getLastActivation()&&
      window.W01Preview.getLastActivation().ok===true&&
      document.getElementById('snapshot-metadata').textContent.includes('0.0.17'));
    await worker.evaluate(()=>{self.fetch=self.__w01OriginalFetch;delete self.__w01OriginalFetch;});
    const rollback=await page.evaluate(input=>new Promise(resolve=>{
      chrome.runtime.sendMessage({type:'W01_ROLLBACK',gameReleaseId:input.gameReleaseId,
        dataRevision:input.dataRevision},resolve);
    }),{gameReleaseId:candidate.manifest.gameReleaseId,dataRevision:candidate.entry.data_revision});
    assert.equal(rollback.ok,true);
    assert.equal(rollback.active.packageKind,'pending-preview');
    assert.equal(rollback.active.contentVersion,'0.0.16');
    await page.reload();
    await page.waitForFunction(()=>document.body.dataset.w01State==='active'&&
      document.getElementById('snapshot-metadata').textContent.includes('0.0.16'));
    assert.equal(await page.locator('[data-entity-ref="darktide:weapon:chainaxe:p1-m1"] .weapon-stat-row').count(),19);
    await page.screenshot({path:screenshots.rollback,fullPage:true});

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
      failedUpdateRetained016:true,validLocalUpdateDisplayed017:true,rollbackRestored016:true,
      candidateDataLoadedViaLocalRouteAdapter:true,liveHttpsRequests:0,
      browserRequestOrigins:[...new Set(browserRequestOrigins)],consoleErrors,pageErrors,screenshots
    },null,2));
  }finally{
    if(context) await context.close();
    process.chdir(originalWorkingDirectory);
  }
});
