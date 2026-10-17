'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildDevExtension}=require('../../scripts/w01/build-dev-extension.cjs');
const {
  DEV_ORIGIN,REQUIRED_KINDS,inspectSharedPackage
}=require('./shared-package-helpers.cjs');
const {loadPlaywright}=require('./playwright-runtime.cjs');

const enabled=process.env.SYP_W01_LIVE_PREVIEW==='1';
const packageDirectory=process.env.SYP_W01_EXPECTED_PACKAGE_DIR;
const reuseBuildRoot=process.env.SYP_W01_REUSE_DEV_BUILD;
const expectedProgramSha256=process.env.SYP_W01_EXPECTED_PROGRAM_SHA256;
const priorDataRevision=process.env.SYP_W01_PRIOR_DATA_REVISION;
const liveStage=process.env.SYP_W01_LIVE_STAGE||'r1-baseline';
const transitionToR2=liveStage==='r2-transition';

const DETAIL_SECTION_LABELS=[
  ['effects','效果'],
  ['conditions','條件'],
  ['calculation','計算'],
  ['notes','補充說明'],
  ['extra','額外說明']
];

async function verifyDetailSections(container,sections,entity){
  const populatedEntries=DETAIL_SECTION_LABELS.filter(([key])=>
    sections&&Array.isArray(sections[key])&&sections[key].length>0
  );
  const labels=populatedEntries.map(([,label])=>label);
  const detailSections=container.locator('.detail-section');
  assert.deepEqual(await detailSections.locator('h4').allTextContents(),labels,
    entity+' section headings must match its populated JSON sections in order.');
  for(let index=0;index<populatedEntries.length;index++){
    const [key,label]=populatedEntries[index];
    const renderedTextNodes=await detailSections.nth(index).locator('li span').allTextContents();
    for(const item of sections[key]){
      if(typeof item.text==='string')
        assert.ok(renderedTextNodes.includes(item.text),
          entity+' '+label+' text must appear in the rendered detail content.');
    }
  }
  const emptyValues=await detailSections.locator('.empty-value').allTextContents();
  assert.ok(!emptyValues.includes('—'),entity+' must not display an empty-section dash.');
  return {entity,labels,detailTextMatched:true,emptySectionsHidden:true};
}

function sha256(bytes){
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function assertPlainDirectory(directory,label){
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()) throw new Error(label+' must be a plain directory');
}
function inspectDevProgram(extensionPath){
  const files=[];
  function visit(directory){
    const entries=fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const full=path.join(directory,entry.name);
      const stat=fs.lstatSync(full);
      if(stat.isSymbolicLink()) throw new Error('Development extension contains a symbolic link');
      if(stat.isDirectory()) visit(full);
      else if(stat.isFile()){
        const relative=path.relative(extensionPath,full).split(path.sep).join('/');
        const bytes=fs.readFileSync(full);
        files.push({path:relative,sizeBytes:bytes.byteLength,sha256:sha256(bytes)});
      }else throw new Error('Development extension contains a non-file entry');
    }
  }
  visit(extensionPath);
  const aggregate=crypto.createHash('sha256');
  for(const file of files)
    aggregate.update(file.path+'\0'+String(file.sizeBytes)+'\0'+file.sha256+'\0','utf8');
  return {sha256:aggregate.digest('hex'),files};
}
function inspectReusableBuild(rootPath){
  const outputRoot=path.resolve(rootPath);
  const privateRoot=path.resolve(os.tmpdir(),'syp-311-w01');
  if(!outputRoot.startsWith(privateRoot+path.sep))
    throw new Error('Reusable development build must remain under the private W01 Temp root');
  assertPlainDirectory(outputRoot,'Reusable development build root');
  const extensionPath=path.join(outputRoot,'extension');
  const profilePath=path.join(outputRoot,'profile');
  assertPlainDirectory(extensionPath,'Reusable development extension');
  assertPlainDirectory(profilePath,'Reusable persistent profile');
  const manifest=JSON.parse(fs.readFileSync(path.join(extensionPath,'manifest.json'),'utf8'));
  return {outputRoot,extensionPath,profilePath,manifest};
}
function presentationNames(bundle,domainKind,entityKind){
  const document=JSON.parse(bundle.files[domainKind].bytes.toString('utf8'));
  const entities=document.records.filter(record=>record.owner==='source'&&record.kind===entityKind);
  assert.ok(entities.length>0,'Compiled package has no '+entityKind+' records');
  const presentations=entities.map(entity=>document.records.find(record=>record.owner==='web'&&
    record.kind==='presentation'&&record.entityRef===entity.recordId&&record.locale==='zh-TW'))
    .filter(presentation=>presentation&&presentation.payload&&typeof presentation.payload.name==='string');
  assert.ok(presentations.length>0,'Compiled package has no zh-TW '+entityKind+' presentation');
  return presentations;
}
function tieredBlessingPresentations(bundle){
  const document=JSON.parse(bundle.files.blessings.bytes.toString('utf8'));
  return document.records.filter(record=>record.owner==='web'&&record.kind==='presentation'&&
    record.payload&&record.payload.tierPresentations);
}
function summarizePreviewRequest(request){
  let requestPath='unknown';
  try{
    const url=new URL(request.url);
    requestPath=url.origin===DEV_ORIGIN?url.pathname:'non-preview-origin';
  }catch{}
  return {path:requestPath,status:Number.isInteger(request.status)?request.status:null,
    contentType:typeof request.contentType==='string'?request.contentType:null,
    networkError:request.networkError===true||Boolean(request.error),
    error:typeof request.error==='string'?request.error.slice(0,300):null};
}
function termLocalizations(bundle){
  const document=JSON.parse(bundle.files.terms.bytes.toString('utf8'));
  const terms=document.records.filter(record=>record.owner==='source'&&record.kind==='term');
  assert.ok(terms.length>0,'Compiled package has no source term records');
  const localizedTerms=terms.map(term=>document.records.find(record=>record.owner==='web'&&
    record.kind==='term-localization'&&record.entityRef===term.recordId&&record.locale==='zh-TW'))
    .filter(localized=>localized&&localized.payload&&typeof localized.payload.label==='string');
  assert.ok(localizedTerms.length>0,'Compiled package has no zh-TW term localization');
  return localizedTerms;
}

function collectTermReferences(sections,references){
  for(const items of Object.values(sections||{})){
    if(!Array.isArray(items)) continue;
    for(const item of items)
      if(item&&typeof item.termRef==='string') references.add(item.termRef);
  }
}
test('InterT13_FixedPreviewUsesRealHttpsAndMatchesCompiledWebPackage',{
  skip:!enabled?'Set SYP_W01_LIVE_PREVIEW=1 only after Web publishes the matching preview package.':
    !packageDirectory?'Set SYP_W01_EXPECTED_PACKAGE_DIR to the independently compiled Web package.':false
},async t=>{
  const expected=inspectSharedPackage(packageDirectory);
  const {playwright,version:playwrightVersion}=loadPlaywright();
  const built=reuseBuildRoot?inspectReusableBuild(reuseBuildRoot):buildDevExtension();
  const profilePath=reuseBuildRoot?built.profilePath:path.join(built.outputRoot,'profile');
  const program=inspectDevProgram(built.extensionPath);
  if(reuseBuildRoot){
    assert.ok(expectedProgramSha256,'Reusable profile runs must pin the existing DEV program hash.');
    assert.equal(program.sha256,expectedProgramSha256,'Reused DEV program bytes changed between package stages.');
  }
  assert.deepEqual(built.manifest.permissions,[]);
  assert.deepEqual(built.manifest.host_permissions,[DEV_ORIGIN+'/*']);
  assert.equal(Object.hasOwn(built.manifest,'content_scripts'),false);
  if(transitionToR2){
    assert.ok(reuseBuildRoot,'R2 transition must reuse the original R1 DEV build and profile.');
    assert.match(priorDataRevision,/^[a-f0-9]{64}$/);
  }

  const runId=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17);
  const screenshotPath=path.join(built.outputRoot,'live-preview-'+liveStage+'-'+runId+'.png');
  const offlineScreenshotPath=transitionToR2?
    path.join(built.outputRoot,'live-preview-offline-r1-'+runId+'.png'):null;
  const rollbackScreenshotPath=transitionToR2?
    path.join(built.outputRoot,'live-preview-rollback-r1-'+runId+'.png'):null;
  const receiptPath=path.join(built.outputRoot,'live-preview-'+liveStage+'-'+runId+'-network-receipt.json');
  let context;
  const pageErrors=[];
  const consoleErrors=[];
  const pageRequestOrigins=[];
  const observedPreviewRequests=[];
  const originalWorkingDirectory=process.cwd();
  const transitionEvidence={offlineFaultAttempted:false,offlineFaultPreservedR1:false,
    validR2Activated:false,rollbackRestoredR1:false};
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
        t.skip('Live preview browser unavailable because the installed Chromium executable failed to start.');
        return;
      }
      throw error;
    }
    let worker=context.serviceWorkers().find(candidate=>candidate.url().endsWith('/service-worker.js'));
    if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
    assert.ok(worker.url().endsWith('/service-worker.js'));
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    page.setDefaultTimeout(90000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('request',request=>{
      const url=new URL(request.url());
      pageRequestOrigins.push(url.protocol+'//'+url.host);
      if(url.origin===DEV_ORIGIN)
        observedPreviewRequests.push({event:'request',path:url.pathname,method:request.method()});
    });
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.origin===DEV_ORIGIN)
        observedPreviewRequests.push({event:'response',path:url.pathname,status:response.status(),
          contentType:response.headers()['content-type']||null});
    });
    page.on('requestfailed',request=>{
      const url=new URL(request.url());
      if(url.origin===DEV_ORIGIN)
        observedPreviewRequests.push({event:'requestfailed',path:url.pathname,
          error:request.failure()&&request.failure().errorText||'request failed'});
    });
    await page.goto('chrome-extension://'+extensionId+'/preview.html');
    await page.locator('#game-version').fill(expected.entry.game_version);
    await page.locator('#game-release-id').fill(expected.manifest.gameReleaseId);

    let offlineFailure=null;
    if(transitionToR2){
      await page.waitForFunction(revision=>document.body.dataset.w01State==='active'&&
        document.getElementById('snapshot-metadata').textContent.includes(revision),priorDataRevision,{timeout:15000});
      const initialRevision=await page.locator('#snapshot-metadata').textContent();
      assert.ok(initialRevision.includes(priorDataRevision),'Existing persistent profile does not contain active R1.');
      const priorStatus=await page.evaluate(gameReleaseId=>window.W01Preview.sendWorker({
        type:'W01_GET_STATUS',gameReleaseId
      }),expected.manifest.gameReleaseId);
      assert.equal(priorStatus.ok,true,'Existing R1 status could not be read from the extension worker.');
      assert.equal(priorStatus.active.dataRevision,priorDataRevision);
      assert.equal(priorStatus.active.gameReleaseId,expected.manifest.gameReleaseId);
      assert.equal(priorStatus.active.gameVersion,expected.entry.game_version);
      assert.equal(priorStatus.active.fixtureOnly,expected.packageKind==='fixture',
        'R1 and R2 must use the same DEV package kind.');
      assert.equal(priorStatus.active.publicationEligible,false);
      await context.setOffline(true);
      await page.locator('#load-preview').click();
      await page.waitForFunction(()=>window.W01Preview&&window.W01Preview.getLastActivation()&&
        window.W01Preview.getLastActivation().ok===false&&document.body.dataset.w01State==='active');
      offlineFailure=await page.evaluate(()=>window.W01Preview.getLastActivation());
      assert.equal(offlineFailure.ok,false);
      assert.ok(offlineFailure.networkRequests.some(request=>request.networkError),
        'Offline R2 attempt did not record the browser network interruption.');
      assert.equal(await page.locator('#error-message').isVisible(),true);
      assert.ok((await page.locator('#snapshot-metadata').textContent()).includes(priorDataRevision),
        'R1 was not kept active after the offline update failure.');
      await page.screenshot({path:offlineScreenshotPath,fullPage:true});
      transitionEvidence.offlineFaultAttempted=true;
      transitionEvidence.offlineFaultPreservedR1=true;
      await context.setOffline(false);
    }

    const previousActivationSignature=await page.evaluate(()=>JSON.stringify(window.W01Preview.getLastActivation()));
    await page.locator('#load-preview').click();
    async function saveFailureDiagnostics(activation,reason){
      let dom={captureError:null};
      try{
        dom=await page.evaluate(()=>{
          const byId=id=>document.getElementById(id);
          const error=byId('error-message');
          const text=id=>{
            const element=byId(id);
            return element&&typeof element.textContent==='string'?element.textContent.trim().slice(0,300):null;
          };
          return {bodyState:document.body.dataset.w01State||null,
            snapshotState:byId('snapshot-state')&&byId('snapshot-state').dataset.state||null,
            dataStatus:text('data-status'),snapshotInfo:text('snapshot-info'),
            errorVisible:Boolean(error&&!error.hidden),errorText:error&&error.textContent?
              error.textContent.trim().slice(0,500):null,
            loadButtonDisabled:Boolean(byId('load-preview')&&byId('load-preview').disabled)};
        });
      }catch(captureError){dom={captureError:String(captureError.message||captureError).slice(0,300)};}
      const diagnosticPath=path.join(built.outputRoot,'live-preview-'+liveStage+'-'+runId+'-failure-diagnostics.json');
      const failureScreenshotPath=path.join(built.outputRoot,'live-preview-'+liveStage+'-'+runId+'-failure.png');
      let screenshot={path:failureScreenshotPath,created:false,sizeBytes:0,sha256:null,error:null};
      try{
        await page.screenshot({path:failureScreenshotPath,fullPage:true});
        const screenshotBytes=fs.readFileSync(failureScreenshotPath);
        screenshot={path:failureScreenshotPath,created:true,sizeBytes:screenshotBytes.byteLength,
          sha256:sha256(screenshotBytes),error:null};
      }catch(screenshotError){screenshot.error=String(screenshotError.message||screenshotError).slice(0,300);}
      const networkRequests=Array.isArray(activation&&activation.networkRequests)?
        activation.networkRequests.map(summarizePreviewRequest):[];
      const diagnostic={schemaVersion:1,testName:'InterT13_FixedPreviewUsesRealHttpsAndMatchesCompiledWebPackage',
        stage:liveStage,reason:String(reason&&reason.message||reason||'activation failed').slice(0,500),
        expected:{contentVersion:expected.entry.content_version,dataRevision:expected.entry.data_revision,
          manifestSha256:expected.manifestSha256},
        activation:{changed:Boolean(activation&&JSON.stringify(activation)!==previousActivationSignature),
          ok:activation&&activation.ok===true,error:activation&&typeof activation.error==='string'?
            activation.error.slice(0,500):null,networkRequestCount:networkRequests.length},
        networkRequests,observedPreviewRequests:[...observedPreviewRequests],
        dom,pageRequestOrigins:[...pageRequestOrigins],errors:{console:[...consoleErrors],page:[...pageErrors]},screenshot};
      fs.writeFileSync(diagnosticPath,JSON.stringify(diagnostic,null,2)+'\n',{flag:'wx'});
      const diagnosticSha256=sha256(fs.readFileSync(diagnosticPath));
      t.diagnostic(JSON.stringify({failureDiagnosticsPath:diagnosticPath,diagnosticSha256,
        screenshotPath:screenshot.created?screenshot.path:null,screenshotSha256:screenshot.sha256,
        bodyState:dom.bodyState||null,errorVisible:dom.errorVisible||false,
        networkRequestCount:networkRequests.length,observedPreviewEventCount:observedPreviewRequests.length,
        consoleErrorCount:consoleErrors.length,pageErrorCount:pageErrors.length},null,2));
    }
    let activation;
    try{
      await page.waitForFunction(input=>{
        const activation=window.W01Preview&&window.W01Preview.getLastActivation();
        if(!activation||JSON.stringify(activation)===input.previousActivationSignature) return false;
        if(activation.ok===true){
          const snapshot=document.getElementById('snapshot-info');
          return document.body.dataset.w01State==='active'&&
            Boolean(snapshot&&snapshot.textContent.includes(input.expectedDataRevision));
        }
        if(activation.ok===false){
          const error=document.getElementById('error-message');
          return Boolean(error&&!error.hidden&&error.textContent.trim());
        }
        return false;
      },{previousActivationSignature,expectedDataRevision:expected.entry.data_revision},{timeout:90000});
      activation=await page.evaluate(()=>window.W01Preview.getLastActivation());
    }catch(waitError){
      activation=await page.evaluate(()=>window.W01Preview&&window.W01Preview.getLastActivation());
      await saveFailureDiagnostics(activation,waitError);
      throw waitError;
    }
    assert.notEqual(JSON.stringify(activation),previousActivationSignature,
      'The live runner observed a stale activation result from an earlier request.');
    if(!activation.ok) await saveFailureDiagnostics(activation,activation.error||'Preview activation failed');
    assert.equal(activation.ok,true,'Fixed Preview activation failed: '+String(activation.error||'unknown'));
    const requests=activation.networkRequests;
    assert.equal(requests.length,6,'Live Preview must request version, manifest, and exactly four domains.');
    const requestPaths=requests.map(request=>{
      const url=new URL(request.url);
      assert.equal(url.origin,DEV_ORIGIN);
      assert.equal(url.protocol,'https:');
      assert.equal(url.username,'');
      assert.equal(url.password,'');
      assert.equal(url.search,'');
      assert.equal(url.hash,'');
      assert.equal(request.status,200);
      assert.match(request.contentType,/application\/json/i);
      return url.pathname;
    });
    const expectedPaths=[
      '/version.json',
      expected.entry.manifest_path,
      ...REQUIRED_KINDS.map(kind=>'/data/'+expected.entry.data_revision+'/'+expected.files[kind].path)
    ];
    assert.deepEqual(requestPaths,expectedPaths);
    assert.equal(requestPaths.some(requestPath=>requestPath.endsWith('/game-changes.json')),false);
    assert.equal(requestPaths.some(requestPath=>/announcement/i.test(requestPath)),false);
    assert.equal(activation.active.gameReleaseId,expected.manifest.gameReleaseId);
    assert.equal(activation.active.gameVersion,expected.entry.game_version);
    assert.equal(activation.active.contentVersion,expected.entry.content_version);
    assert.equal(activation.active.dataRevision,expected.entry.data_revision);
    assert.equal(activation.active.manifestSha256,expected.manifestSha256);
    for(const kind of REQUIRED_KINDS){
      assert.deepEqual(activation.active.fileHashes[kind],{
        sizeBytes:expected.files[kind].sizeBytes,
        sha256:expected.files[kind].sha256
      });
    }
    assert.equal(activation.active.fixtureOnly,expected.packageKind==='fixture');
    assert.equal(activation.active.publicationEligible,false);
    await page.waitForFunction(()=>document.body.dataset.w01State==='active');
    const statusText=await page.locator('#data-status').textContent();
    assert.ok(statusText.includes(expected.packageKind==='fixture'?'合成 Fixture 資料':'待審資料'));
    if(expected.packageKind==='pending-preview')
      assert.ok(statusText.includes('代碼快照與文字版本相容性尚未核實'));
    assert.ok((await page.locator('#snapshot-info').textContent()).includes(expected.entry.data_revision));

    const contentCards=await page.locator('#content-cards').textContent();
    const renderedTextSnapshots=[contentCards];
    const renderedEntityNames=await page.locator('#content-cards .entity-card h3').allTextContents();
    const skillPresentations=presentationNames(expected,'skills','skill');
    const blessingPresentations=presentationNames(expected,'blessings','blessing');
    const weaponPresentations=presentationNames(expected,'weapons','weapon');
    for(const presentation of [...skillPresentations,...blessingPresentations,...weaponPresentations])
      assert.ok(renderedEntityNames.includes(presentation.payload.name));
    const localizedOfficial=skillPresentations[0].payload.official&&
      skillPresentations[0].payload.official.localizations&&
      skillPresentations[0].payload.official.localizations['zh-TW'];
    assert.ok(localizedOfficial&&typeof localizedOfficial.text==='string');
    assert.ok(contentCards.includes(localizedOfficial.text));
    const tierSelectorEvidence=[];
    const detailSectionEvidence=[];
    const requiredFeatures=expected.manifest.compatibility.requiredFeatures;
    const hasTierFeature=requiredFeatures.includes('blessing-tier-presentations-v1');
    const tieredBlessings=tieredBlessingPresentations(expected);
    assert.equal(hasTierFeature,tieredBlessings.length>0,
      'The blessing tier feature must be advertised exactly when tiered presentations are present.');
    if(hasTierFeature){
      assert.ok(requiredFeatures.includes('official-native-localizations-v1'));
      assert.equal(tieredBlessings.length,1,'The W01 shared package has one explicitly selected tier presentation.');
      const presentation=tieredBlessings[0];
      const card=page.locator('#content-cards .entity-card').filter({hasText:presentation.payload.name}).first();
      const selector=card.locator('select[aria-label="祝福階級"]');
      assert.equal(await selector.locator('option').count(),4);
      assert.deepEqual(await selector.locator('option').allTextContents(),['LV1','LV2','LV3','LV4']);
      assert.equal(await selector.inputValue(),'4','Tier four is the initial selection.');
      const selected=card.locator('.tier-selected-presentation');
      for(const tier of [4,1,2,3,4]){
        await selector.selectOption(String(tier));
        const option=presentation.payload.tierPresentations.options.find(item=>item.tier===tier);
        assert.ok(option,'The compiled package is missing the selected tier option.');
        const selectedText=await selected.textContent();
        renderedTextSnapshots.push(selectedText);
        assert.ok(selectedText.includes('目前選取：LV'+String(tier)));
        assert.ok(selectedText.includes(option.official.localizations['zh-TW'].resolvedText),
          'The selected native zh-TW official string must match the same tier option.');
        assert.deepEqual(Object.keys(option.detailSections),DETAIL_SECTION_LABELS.map(([key])=>key),
          'The five-section JSON contract must remain intact for every tier.');
        const detailEvidence=await verifyDetailSections(selected,option.detailSections,presentation.payload.name);
        tierSelectorEvidence.push({tier,officialZhTwMatched:true,...detailEvidence});
      }
    }
    const allEntityCards=page.locator('#content-cards .entity-card');
    const visibleEntityNames=await allEntityCards.locator('h3').allTextContents();
    const visibleEntityKinds=await allEntityCards.locator('.entity-kind').allTextContents();
    const presentationOccurrences=new Map();
    for(const presentation of skillPresentations){
      const key='技能\0'+presentation.payload.name;
      const occurrence=presentationOccurrences.get(key)||0;
      presentationOccurrences.set(key,occurrence+1);
      const matchingIndexes=[];
      for(let index=0;index<visibleEntityNames.length;index++)
        if(visibleEntityNames[index]===presentation.payload.name&&visibleEntityKinds[index]==='技能')
          matchingIndexes.push(index);
      const cardIndex=matchingIndexes[occurrence];
      assert.notEqual(cardIndex,undefined,
        'The compiled skill presentation must map to its rendered entity card.');
      const card=allEntityCards.nth(cardIndex);
      const detailEvidence=await verifyDetailSections(card,presentation.payload.detailSections,presentation.payload.name);
      detailSectionEvidence.push({kind:'skill',...detailEvidence});
    }
    const weaponsDocument=JSON.parse(expected.files.weapons.bytes.toString('utf8'));
    const sourceWeapons=new Map(weaponsDocument.records
      .filter(record=>record.owner==='source'&&record.kind==='weapon')
      .map(record=>[record.recordId,record]));
    let chainaxeCard=null;
    for(const presentation of weaponPresentations){
      const sourceWeapon=sourceWeapons.get(presentation.entityRef);
      assert.ok(sourceWeapon,'The compiled weapon presentation must resolve through its Source record.');
      if(sourceWeapon.payload&&sourceWeapon.payload.familyId==='chainaxe_p1'){
        const view=presentation.payload.weaponView;
        assert.ok(view&&typeof view.markLabel==='string','The chainaxe presentation must provide its own model label.');
        const familyCard=page.locator('#content-cards .entity-card[data-family-id="chainaxe_p1"]');
        assert.equal(await familyCard.count(),1,'The Source chainaxe family must render as one card.');
        const tab=familyCard.locator('[role="tab"]').filter({hasText:view.markLabel});
        assert.equal(await tab.count(),1,'Every chainaxe mark must have one matching tab.');
        await tab.click();
        chainaxeCard=familyCard;
        const panel=familyCard.locator('[role="tabpanel"]');
        renderedTextSnapshots.push(await panel.textContent());
        const detailEvidence=await verifyDetailSections(panel,presentation.payload.detailSections,presentation.payload.name);
        detailSectionEvidence.push({kind:'weapon',...detailEvidence});
      }else{
        const key='武器\0'+presentation.payload.name;
        const occurrence=presentationOccurrences.get(key)||0;
        presentationOccurrences.set(key,occurrence+1);
        const matchingIndexes=[];
        for(let index=0;index<visibleEntityNames.length;index++)
          if(visibleEntityNames[index]===presentation.payload.name&&visibleEntityKinds[index]==='武器')
            matchingIndexes.push(index);
        const cardIndex=matchingIndexes[occurrence];
        assert.notEqual(cardIndex,undefined,
          'The compiled weapon presentation must map to its rendered entity card.');
        const card=allEntityCards.nth(cardIndex);
        const detailEvidence=await verifyDetailSections(card,presentation.payload.detailSections,presentation.payload.name);
        detailSectionEvidence.push({kind:'weapon',...detailEvidence});
      }
    }
    if(chainaxeCard){
      const defaultTab=chainaxeCard.locator('[role="tab"]').filter({hasText:'Mk IV'});
      if(await defaultTab.count()===1) await defaultTab.click();
      renderedTextSnapshots.push(await chainaxeCard.locator('[role="tabpanel"]').textContent());
    }
    const localizedTerms=termLocalizations(expected);
    const referencedTermIds=new Set();
    for(const presentation of [...skillPresentations,...blessingPresentations,...weaponPresentations]){
      collectTermReferences(presentation.payload.detailSections,referencedTermIds);
      for(const option of presentation.payload.tierPresentations&&presentation.payload.tierPresentations.options||[])
        collectTermReferences(option.detailSections,referencedTermIds);
    }
    const renderedTermText=renderedTextSnapshots.join('\n');
    for(const term of localizedTerms){
      if(!referencedTermIds.has(term.entityRef)) continue;
      assert.ok(renderedTermText.includes(term.payload.label),
        'A referenced localized term must render inline in its presentation.');
      if(typeof term.payload.definition==='string')
        assert.ok(renderedTermText.includes(term.payload.definition),
          'The referenced term definition must render inline in its presentation.');
    }
    assert.equal(await page.locator('#terms-content').count(),0);
    if(transitionToR2){
      transitionEvidence.validR2Activated=true;
      await page.screenshot({path:screenshotPath,fullPage:true});
      const rollback=await page.evaluate(input=>new Promise(resolve=>{
        chrome.runtime.sendMessage({type:'W01_ROLLBACK',gameReleaseId:input.gameReleaseId,
          dataRevision:input.dataRevision},resolve);
      }),{gameReleaseId:expected.manifest.gameReleaseId,dataRevision:priorDataRevision});
      assert.equal(rollback.ok,true);
      assert.equal(rollback.active.dataRevision,priorDataRevision);
      await page.reload();
      await page.waitForFunction(revision=>document.body.dataset.w01State==='active'&&
        document.getElementById('snapshot-metadata').textContent.includes(revision),priorDataRevision,{timeout:15000});
      assert.ok((await page.locator('#snapshot-metadata').textContent()).includes(priorDataRevision));
      await page.screenshot({path:rollbackScreenshotPath,fullPage:true});
      transitionEvidence.rollbackRestoredR1=true;
    }else{
      await page.screenshot({path:screenshotPath,fullPage:true});
    }
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(consoleErrors,[]);
    assert.ok(pageRequestOrigins.every(origin=>origin==='chrome-extension://'+extensionId));

    const screenshotBytes=fs.readFileSync(screenshotPath);
    const receipt={
      schemaVersion:1,
      testName:'InterT13_FixedPreviewUsesRealHttpsAndMatchesCompiledWebPackage',
      stage:liveStage,
      createdAt:new Date().toISOString(),
      liveHttps:true,
      networkMocks:false,
      serviceWorkerFetchReplaced:false,
      previewOrigin:DEV_ORIGIN,
      browser:{extensionId,serviceWorker:worker.url(),playwrightVersion,
        projectDeclaredPlaywright:'1.62.1',chromeVersion:context.browser().version()},
      devProgram:{root:built.outputRoot,extensionPath:built.extensionPath,profilePath,
        aggregateSha256:program.sha256,files:program.files},
      package:{buildId:expected.version.build_id,gameReleaseId:expected.manifest.gameReleaseId,
        packageKind:expected.packageKind,gameVersion:expected.entry.game_version,contentVersion:expected.entry.content_version,
        dataRevision:expected.entry.data_revision,manifestSha256:expected.manifestSha256,
        domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,expected.files[kind].sha256])),
        fixtureOnly:activation.active.fixtureOnly,publicationEligible:activation.active.publicationEligible},
      requests:requests.map(request=>({url:request.url,status:request.status,contentType:request.contentType})),
      gameChangesFetched:false,
      announcementsFetched:false,
      rendered:{skills:skillPresentations.length,blessings:blessingPresentations.length,
        weapons:weaponPresentations.length,terms:localizedTerms.length,
        zhTwLocalizedText:true,detailSectionsByEntity:detailSectionEvidence,
        blessingTierSequence:tierSelectorEvidence},
      transition:transitionEvidence,
      errors:{console:consoleErrors,page:pageErrors},
      screenshot:{path:screenshotPath,sizeBytes:screenshotBytes.byteLength,sha256:sha256(screenshotBytes)},
      additionalScreenshots:{offlineFailure:offlineScreenshotPath,rollback:rollbackScreenshotPath}
    };
    if(offlineFailure){
      receipt.transition.offlineRequestCount=offlineFailure.networkRequests.length;
      receipt.transition.offlineNetworkErrorCount=offlineFailure.networkRequests.filter(request=>request.networkError).length;
      receipt.transition.offlineErrorMessage=offlineFailure.error;
    }
    fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    const receiptSha256=sha256(fs.readFileSync(receiptPath));
    t.diagnostic(JSON.stringify({
      liveHttps:true,
      previewOrigin:DEV_ORIGIN,
      extensionId,
      serviceWorker:worker.url(),
      playwrightVersion,
      projectDeclaredPlaywright:'1.62.1',
      chromeVersion:context.browser().version(),
      devProgramSha256:program.sha256,
      outputRoot:built.outputRoot,
      profilePath,
      requestCount:requests.length,
      requestPaths,
      responseStatuses:requests.map(request=>request.status),
      responseContentTypes:requests.map(request=>request.contentType),
      buildId:expected.version.build_id,
      packageKind:expected.packageKind,
      gameReleaseId:expected.manifest.gameReleaseId,
      gameVersion:expected.entry.game_version,
      contentVersion:expected.entry.content_version,
      dataRevision:expected.entry.data_revision,
      manifestSha256:expected.manifestSha256,
      domainHashes:Object.fromEntries(REQUIRED_KINDS.map(kind=>[kind,expected.files[kind].sha256])),
      rendered:receipt.rendered,
      fixtureOnly:activation.active.fixtureOnly,
      publicationEligible:activation.active.publicationEligible,
      gameChangesFetched:false,
      announcementsFetched:false,
      transition:receipt.transition,
      consoleErrors,
      pageErrors,
      screenshotPath,
      receiptPath,
      receiptSha256
    },null,2));
  }finally{
    if(context) await context.close();
    process.chdir(originalWorkingDirectory);
  }
});
