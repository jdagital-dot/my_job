const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFiles: () => ipcRenderer.invoke('resource:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('resource:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('resource:openPath', p),
  showInFolder: (p) => ipcRenderer.invoke('resource:showInFolder', p),
  pathExists: (p) => ipcRenderer.invoke('resource:pathExists', p),
})

contextBridge.exposeInMainWorld('electron', { isElectron: true })
