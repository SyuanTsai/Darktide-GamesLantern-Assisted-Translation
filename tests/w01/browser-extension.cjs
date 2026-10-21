'use strict';

const EXPECTED_DEV_EXTENSION_NAME='GLAT Shared Data Loader W01 DEV';

async function waitForW01ServiceWorker(t,context,extensionPath){
  let worker=context.serviceWorkers().find(candidate=>candidate.url().endsWith('/service-worker.js'));
  if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:5000}).catch(()=>null);
  if(worker) return worker;

  let loadedExtensions=null;
  const page=await context.newPage();
  try{
    await page.goto('chrome://extensions/');
    loadedExtensions=await page.evaluate(()=>new Promise(resolve=>{
      if(!chrome.management||typeof chrome.management.getAll!=='function'){
        resolve(null);
        return;
      }
      chrome.management.getAll(extensions=>resolve(extensions.map(extension=>({
        id:extension.id,name:extension.name,enabled:extension.enabled
      }))));
    }));
  }catch{
    loadedExtensions=null;
  }finally{
    await page.close();
  }

  if(Array.isArray(loadedExtensions)&&!loadedExtensions.some(extension=>extension.name===EXPECTED_DEV_EXTENSION_NAME)){
    t.diagnostic(JSON.stringify({
      browserVersion:context.browser().version(),
      expectedExtension:EXPECTED_DEV_EXTENSION_NAME,
      extensionPath,
      loadedExtensions
    },null,2));
    t.skip('The configured Chrome profile did not load the unpacked W01 extension; extension-page evidence is unavailable.');
    return null;
  }
  throw new Error('The W01 extension is listed by Chrome but its service worker did not register.');
}

module.exports={EXPECTED_DEV_EXTENSION_NAME,waitForW01ServiceWorker};
