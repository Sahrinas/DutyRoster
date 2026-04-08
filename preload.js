const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_e, data) => callback(data)),
    onAppVersion: (callback) => ipcRenderer.on('app-version', (_e, version) => callback(version)),
    installUpdate: (options) => ipcRenderer.invoke('install-update', options),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    loadData: () => ipcRenderer.invoke('load-data'),
    saveData: (data) => ipcRenderer.invoke('save-data', data),
    saveDataSync: (data) => ipcRenderer.sendSync('save-data-sync', data),
});
