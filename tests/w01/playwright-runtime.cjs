'use strict';

const path=require('node:path');
function loadPlaywright(){
  const moduleRoot=process.env.SYP_W01_PLAYWRIGHT_ROOT;
  const resolveOptions=moduleRoot?{paths:[moduleRoot]}:undefined;
  const packagePath=require.resolve('playwright/package.json',resolveOptions);
  const playwrightPath=require.resolve('playwright',resolveOptions);
  return {playwright:require(playwrightPath),version:require(packagePath).version};
}
function headlessShellPath(){
  return process.env.SYP_W01_HEADLESS_SHELL||path.join(require('node:os').homedir(),
    'AppData','Local','ms-playwright','chromium_headless_shell-1248',
    'chrome-headless-shell-win64','chrome-headless-shell.exe');
}
module.exports={loadPlaywright,headlessShellPath};