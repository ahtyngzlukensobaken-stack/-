




const { contextBridge, ipcRenderer, webUtils } = require('electron');


const EVENTS = ['install-progress', 'game-log', 'game-crash', 'content-updated', 'launcher-update', 'java-progress', 'social', 'voice', 'voice-key'];

contextBridge.exposeInMainWorld('pv', {
  call: (channel, payload) => ipcRenderer.invoke('pv', channel, payload),
  
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  on: (event, handler) => {
    if (!EVENTS.includes(event)) throw new Error('Unknown event: ' + event);
    const listener = (_e, data) => handler(data);
    ipcRenderer.on(event, listener);
    
    return () => ipcRenderer.removeListener(event, listener);
  },
});
