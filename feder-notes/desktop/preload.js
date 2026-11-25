// Stellt der Oberfläche nur genau eine Fähigkeit bereit: HTTP-Anfragen für den Nextcloud-Sync.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('federNative', {
  platform: 'electron',
  http: req => ipcRenderer.invoke('http', req),
});
