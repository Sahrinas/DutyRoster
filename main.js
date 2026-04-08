const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;
let splash;

// ===== AUTO UPDATER CONFIG =====
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = console;

function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

function setupAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
        sendToRenderer('update-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        sendToRenderer('update-status', {
            status: 'available',
            version: info.version,
        });
    });

    autoUpdater.on('update-not-available', () => {
        sendToRenderer('update-status', { status: 'up-to-date' });
    });

    autoUpdater.on('download-progress', (progress) => {
        sendToRenderer('update-status', {
            status: 'downloading',
            percent: Math.round(progress.percent),
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        sendToRenderer('update-status', {
            status: 'ready',
            version: info.version,
        });
    });

    autoUpdater.on('error', (err) => {
        sendToRenderer('update-status', {
            status: 'error',
            message: err?.message || 'Ukendt fejl',
        });
    });

    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {});
    }, 3000);
}

ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
});

ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdates().catch(() => {});
});

// ===== SPLASH SCREEN =====
function createSplash() {
    splash = new BrowserWindow({
        width: 420,
        height: 320,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    splash.loadFile('splash.html');
    splash.center();
}

// ===== MAIN WINDOW =====
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        show: false,
        title: 'Vagtplan',
        icon: path.join(__dirname, 'icon.ico'),
        autoHideMenuBar: true,
        backgroundColor: '#060d1b',
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#060d1b',
            symbolColor: '#5a7a9a',
            height: 38,
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadFile('index.html');

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('did-finish-load', () => {
        sendToRenderer('app-version', app.getVersion());
    });

    // When main window is ready, close splash and show main
    mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
            if (splash && !splash.isDestroyed()) {
                splash.close();
                splash = null;
            }
            mainWindow.show();
        }, 1800);
    });

    setupAutoUpdater();
}

app.whenReady().then(() => {
    createSplash();
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
