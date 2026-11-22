const {contextBridge,ipcRenderer}=require('electron');

const invoke=channel=>payload=>ipcRenderer.invoke(channel,payload);
const desktopBridge=Object.freeze({
  protocol:'freept-desktop-bridge-v1',
  allFiles:Object.freeze({
    status:invoke('bridge:files:status'),
    requestPermission:invoke('bridge:files:request')
  }),
  credentials:Object.freeze({
    status:invoke('bridge:credentials:status'),
    provision:invoke('bridge:credentials:provision'),
    clear:invoke('bridge:credentials:clear'),
    ownerRequest:invoke('bridge:owner:request')
  }),
  txControl:Object.freeze({
    start:invoke('bridge:tx:start'),
    stop:invoke('bridge:tx:stop'),
    status:invoke('bridge:tx:status')
  })
});

contextBridge.exposeInMainWorld('freeptDesktop',desktopBridge);
