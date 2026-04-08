const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_e, data) => callback(data)),
    onAppVersion: (callback) => ipcRenderer.on('app-version', (_e, version) => callback(version)),
    installUpdate: () => ipcRenderer.send('install-update'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
});
