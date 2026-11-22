import {
  app,BrowserWindow,dialog,ipcMain,Menu,nativeImage,powerMonitor,
  protocol,safeStorage,shell,Tray
} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppAssetHandler} from './appProtocol.mjs';
import {createDesktopCredentialStore} from './credentialStore.mjs';
import {createBridgeDesktopFolderProvider} from './folderProvider.mjs';
import {createDesktopRootsStore} from './rootsStore.mjs';
import {createBridgeDesktopWorker} from './worker.mjs';
import {createBridgeTrayPng} from './trayIcon.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const STAGING_API='https://freept-bridge-staging.onrender.com';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;

protocol.registerSchemesAsPrivileged([{
  scheme:'capacitor',
  privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}
}]);

const gotLock=app.requestSingleInstanceLock();
if(!gotLock)app.quit();

let mainWindow=null,tray=null,worker=null,workerDeviceId=null,isQuitting=false;
let rootsStore=null,credentialStore=null;

function showWindow(){
  if(!mainWindow||mainWindow.isDestroyed())return;
  if(mainWindow.isMinimized())mainWindow.restore();
  mainWindow.show();mainWindow.focus();
  if(process.platform==='darwin')app.dock?.show();
}

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1180,height:780,minWidth:760,minHeight:560,show:!process.argv.includes('--hidden'),
    title:'FreePT',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,nodeIntegration:false,sandbox:true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('will-navigate',(event,url)=>{
    let allowed=false;
    try{
      const parsed=new URL(url);
      allowed=parsed.protocol==='capacitor:'&&parsed.hostname==='localhost';
      if(!allowed&&parsed.protocol==='https:')void shell.openExternal(url);
    }catch{}
    if(!allowed)event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https:\/\//i.test(url))void shell.openExternal(url);
    return {action:'deny'};
  });
  mainWindow.on('close',event=>{
    if(!isQuitting){event.preventDefault();mainWindow.hide();}
  });
  void mainWindow.loadURL('capacitor://localhost/');
  if(process.argv.includes('--hidden')){
    mainWindow.hide();
    if(process.platform==='darwin')app.dock?.hide();
  }
  return mainWindow;
}

function createTray(){
  if(tray)return;
  tray=new Tray(nativeImage.createFromBuffer(createBridgeTrayPng()));
  tray.setToolTip('FreePT Bridge');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Apri FreePT',click:showWindow},
    {type:'separator'},
    {label:'Esci',click:()=>app.quit()}
  ]));
  tray.on('click',showWindow);
}

async function ownerRequest({action,payload,accessToken}={}){
  if(!['enroll','delete'].includes(action)||
     typeof accessToken!=='string'||accessToken.length<20)
    throw Error('bridge_owner_invalid_request');
  let body;
  if(action==='enroll'){
    const label=process.platform==='win32'?'PC Windows':
      process.platform==='darwin'?'PC macOS':'PC';
    body={label};
  }else{
    if(!payload||Object.keys(payload).length!==1||!UUID.test(payload.deviceId))
      throw Error('bridge_owner_invalid_device');
    body={deviceId:payload.deviceId};
  }
  let result;
  try{
    result=await fetch(STAGING_API+'/bridge/owner/'+action,{
      method:'POST',headers:{
        'content-type':'application/json','authorization':'Bearer '+accessToken
      },body:JSON.stringify(body),cache:'no-store',redirect:'error'
    });
  }catch{throw Error('bridge_owner_backend_unavailable');}
  if(!result?.ok)throw Error(
    result?.status===401||result?.status===403
      ?'bridge_owner_denied':'bridge_owner_request_failed'
  );
  try{return await result.json();}catch{throw Error('bridge_owner_invalid_response');}
}

function setLoginAtStartup(){
  try{
    if(app.isPackaged)app.setLoginItemSettings({openAtLogin:true,args:['--hidden']});
  }catch{/* Device remains usable in the current session. */}
}

async function createWorker(){
  const credentials=await credentialStore.status();
  const roots=await rootsStore.get();
  if(!credentials.provisioned||!roots.length)
    throw Error('bridge_tx_permission_or_device_missing');
  const folderProvider=await createBridgeDesktopFolderProvider({roots});
  worker=createBridgeDesktopWorker({
    baseUrl:STAGING_API,deviceId:credentials.deviceId,
    getDeviceSecret:()=>credentialStore.getDeviceSecret(),folderProvider
  });
  workerDeviceId=credentials.deviceId;
  return worker;
}

async function startWorker(){
  const credentials=await credentialStore.status();
  if(worker&&workerDeviceId!==credentials.deviceId){
    await worker.stop();worker=null;workerDeviceId=null;
  }
  if(!worker)await createWorker();
  const result=worker.start();
  setLoginAtStartup();
  return result;
}

function installHandlers(){
  ipcMain.handle('bridge:files:status',async()=>{
    const roots=await rootsStore.get();
    return {granted:roots.length>0};
  });
  ipcMain.handle('bridge:files:request',async()=>{
    const existing=await rootsStore.get();
    if(existing.length)return {granted:true};
    const selection=await dialog.showOpenDialog(mainWindow||undefined,{
      properties:['openDirectory','multiSelections','showHiddenFiles']
    });
    if(selection.canceled||!selection.filePaths?.length)return {granted:false};
    try{
      const saved=await rootsStore.replace(selection.filePaths);
      return {granted:saved.count>0};
    }catch{return {granted:false};}
  });
  ipcMain.handle('bridge:credentials:status',()=>credentialStore.status());
  ipcMain.handle('bridge:credentials:provision',(_event,credentials)=>
    credentialStore.provision(credentials));
  ipcMain.handle('bridge:credentials:clear',async()=>{
    if(worker)await worker.stop();
    worker=null;workerDeviceId=null;
    return credentialStore.clear();
  });
  ipcMain.handle('bridge:owner:request',(_event,request)=>ownerRequest(request));
  ipcMain.handle('bridge:tx:start',()=>startWorker());
  ipcMain.handle('bridge:tx:stop',async()=>{
    if(worker)await worker.stop();
    return {stopped:true};
  });
  ipcMain.handle('bridge:tx:status',()=>{
    const state=worker?.status();
    let scheduled=false;
    try{scheduled=app.isPackaged&&app.getLoginItemSettings().openAtLogin===true;}catch{}
    return {running:state?.running===true,scheduled};
  });
}

if(gotLock){
  app.on('second-instance',showWindow);
  app.whenReady().then(async()=>{
    rootsStore=createDesktopRootsStore({
      filePath:path.join(app.getPath('userData'),'bridge-roots.json')
    });
    credentialStore=createDesktopCredentialStore({
      filePath:path.join(app.getPath('userData'),'bridge-credentials.json'),safeStorage
    });
    await protocol.handle('capacitor',createAppAssetHandler({
      appRoot:path.join(app.getAppPath(),'dist')
    }));
    installHandlers();
    createTray();
    createWindow();
    try{
      const credentials=await credentialStore.status();
      if(credentials.provisioned&&(await rootsStore.get()).length)
        await startWorker();
    }catch{/* Missing access or credentials never trigger a new prompt. */}
    powerMonitor.on('resume',async()=>{
      if(!worker)return;
      try{
        await worker.stop();
        await startWorker();
      }catch{}
    });
  });
  app.on('activate',()=>{
    if(BrowserWindow.getAllWindows().length===0)createWindow();
    else showWindow();
  });
  app.on('before-quit',event=>{
    if(isQuitting)return;
    isQuitting=true;
    if(worker){
      event.preventDefault();
      void worker.stop().finally(()=>app.quit());
    }
  });
}
