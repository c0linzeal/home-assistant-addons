// The only doorway between the page and the rest of the app.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('hunch', {
  init: () => ipcRenderer.invoke('init'),
  search: (q) => ipcRenderer.invoke('search', q),
  browse: (scope) => ipcRenderer.invoke('browse', scope),
  details: (p) => ipcRenderer.invoke('details', p),
  thumb: (p, size) => ipcRenderer.invoke('thumb', p, size),
  open: (p) => ipcRenderer.invoke('open', p),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  copyPath: (p) => ipcRenderer.invoke('copyPath', p),
  contextMenu: (p) => ipcRenderer.invoke('contextMenu', p),
  startDrag: (p) => ipcRenderer.send('startDrag', p),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  rescan: () => ipcRenderer.invoke('rescan'),
  retag: () => ipcRenderer.invoke('retag'),
  status: () => ipcRenderer.invoke('status'),
  tryDemo: () => ipcRenderer.invoke('tryDemo'),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  onStatus: on('status'),
  onChanged: on('changed'),
  onFocus: on('focus'),
});
