/**
 * Brücke zwischen Fenster und Hauptprozess.
 *
 * Bewusst schmal: die Seite bekommt genau die sieben Aufrufe, die sie braucht,
 * und keinen Zugriff auf Node. Alles andere läuft wie im Browser.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('locked', {
  platform: 'electron',
  beginAuth:  () => ipcRenderer.invoke('auth:begin'),
  awaitAuth:  () => ipcRenderer.invoke('auth:await'),
  postForm:   (url, body) => ipcRenderer.invoke('http:postForm', url, body),
  readData:   () => ipcRenderer.invoke('data:read'),
  writeData:  (text) => ipcRenderer.invoke('data:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  appVersion: () => ipcRenderer.invoke('app:version'),
});
