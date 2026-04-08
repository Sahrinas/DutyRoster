const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const packageJson = require('./package.json');

// ===== FILE-BASED STORAGE =====
const stableUserDataDir = path.join(
    app.getPath('appData'),
    packageJson.build?.productName || packageJson.productName || packageJson.name || 'Vagtplan'
);

try {
    app.setPath('userData', stableUserDataDir);
}
catch (e) {
    console.warn('[Storage] Failed to override userData path:', e);
}

const dataPath = path.join(app.getPath('userData'), 'roster-data.json');
const backupDataPath = path.join(app.getPath('userData'), 'roster-data.backup.json');
const tempDataPath = path.join(app.getPath('userData'), 'roster-data.tmp.json');
let lastKnownData = null;
const DEFAULT_STATE = Object.freeze({
    employees: [],
    activeDays: [0, 1, 2, 3, 4],
    weekOffset: 0,
    monthOffset: 0,
    viewMode: 'week',
    assignments: {},
    recurrences: [],
    notes: {},
    standby: [],
    settings: {},
});

function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeData(data) {
    const source = data && typeof data === 'object' ? data : {};
    return {
        employees: Array.isArray(source.employees) ? source.employees : [],
        activeDays: Array.isArray(source.activeDays) ? source.activeDays : [0, 1, 2, 3, 4],
        weekOffset: Number.isInteger(source.weekOffset) ? source.weekOffset : 0,
        monthOffset: Number.isInteger(source.monthOffset) ? source.monthOffset : 0,
        viewMode: source.viewMode === 'month' ? 'month' : 'week',
        assignments: source.assignments && typeof source.assignments === 'object' && !Array.isArray(source.assignments) ? source.assignments : {},
        recurrences: Array.isArray(source.recurrences) ? source.recurrences : [],
        notes: source.notes && typeof source.notes === 'object' && !Array.isArray(source.notes) ? source.notes : {},
        standby: Array.isArray(source.standby) ? source.standby : [],
        settings: source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings) ? source.settings : {},
    };
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeDataFiles(serialized) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(tempDataPath, serialized, 'utf-8');
    fs.writeFileSync(dataPath, serialized, 'utf-8');
    fs.writeFileSync(backupDataPath, serialized, 'utf-8');
    try {
        fs.unlinkSync(tempDataPath);
    }
    catch {}
}

function findLegacyDataPaths() {
    const appDataDir = app.getPath('appData');
    const candidates = new Set([
        path.join(appDataDir, packageJson.name || '', 'roster-data.json'),
        path.join(appDataDir, packageJson.productName || '', 'roster-data.json'),
        path.join(appDataDir, packageJson.build?.productName || '', 'roster-data.json'),
        path.join(appDataDir, 'vagtplan', 'roster-data.json'),
        path.join(appDataDir, 'Vagtplan', 'roster-data.json'),
        path.join(appDataDir, 'DutyRoster', 'roster-data.json'),
        path.join(appDataDir, 'dutyroster', 'roster-data.json'),
    ]);

    return [...candidates]
        .filter((candidate) => candidate && candidate !== dataPath && fs.existsSync(candidate))
        .map((candidate) => ({
            path: candidate,
            mtimeMs: fs.statSync(candidate).mtimeMs,
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function migrateLegacyDataIfNeeded() {
    if (fs.existsSync(dataPath)) return;

    const legacyFiles = findLegacyDataPaths();
    if (!legacyFiles.length) {
        console.log('[Storage] No legacy data file found');
        return;
    }

    const source = legacyFiles[0].path;
    try {
        fs.mkdirSync(path.dirname(dataPath), { recursive: true });
        fs.copyFileSync(source, dataPath);
        console.log('[Storage] Migrated data from:', source, 'to:', dataPath);
    }
    catch (e) {
        console.error('[Storage] Failed to migrate data from legacy path:', source, e);
    }
}

function loadData() {
    migrateLegacyDataIfNeeded();
    try {
        const normalized = normalizeData(readJsonFile(dataPath));
        lastKnownData = normalized;
        return { data: normalized, source: 'primary' };
    }
    catch {
        try {
            if (fs.existsSync(tempDataPath)) {
                console.warn('[Storage] Recovering from temporary data file');
                const normalized = normalizeData(readJsonFile(tempDataPath));
                writeDataFiles(JSON.stringify(normalized, null, 2));
                lastKnownData = normalized;
                return { data: normalized, source: 'temp' };
            }
        }
        catch {}
        try {
            console.warn('[Storage] Primary data file missing or unreadable, trying backup');
            const normalized = normalizeData(readJsonFile(backupDataPath));
            writeDataFiles(JSON.stringify(normalized, null, 2));
            lastKnownData = normalized;
            return { data: normalized, source: 'backup' };
        }
        catch {
            const fallback = cloneDefaultState();
            writeDataFiles(JSON.stringify(fallback, null, 2));
            lastKnownData = fallback;
            return { data: fallback, source: 'default' };
        }
    }
}

function saveData(data) {
    try {
        const normalized = normalizeData(data);
        const serialized = JSON.stringify(normalized, null, 2);
        lastKnownData = normalized;
        writeDataFiles(serialized);
        return true;
    }
    catch (e) { console.error('Failed to save data:', e); return false; }
}

ipcMain.handle('load-data', () => {
    console.log('[Storage] Loading from:', dataPath);
    const result = loadData();
    console.log('[Storage] Loaded:', result?.source || 'unknown');
    return result;
});
ipcMain.handle('save-data', (_e, data) => {
    console.log('[Storage] Saving to:', dataPath, '- has data:', !!data);
    return saveData(data);
});
ipcMain.on('save-data-sync', (event, data) => {
    console.log('[Storage] Sync saving to:', dataPath, '- has data:', !!data);
    event.returnValue = saveData(data);
});

let mainWindow;
let splash;

// ===== AUTO UPDATER CONFIG =====
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = console;
autoUpdater.allowPrerelease = false;

let updateState = {
    status: 'idle',
    manual: false,
};
let updateCheckInFlight = false;
let updateDownloadInFlight = false;

function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

function setUpdateState(patch) {
    updateState = {
        ...updateState,
        ...patch,
    };
    sendToRenderer('update-status', updateState);
}

function checkForUpdates(manual = false) {
    if (updateCheckInFlight) {
        if (manual) setUpdateState({ manual: true });
        return;
    }

    updateCheckInFlight = true;
    setUpdateState({
        status: 'checking',
        manual,
        percent: null,
        message: null,
    });

    autoUpdater.checkForUpdates().catch((err) => {
        updateCheckInFlight = false;
        const message = err?.message || 'Ukendt fejl';
        if (message.includes('404') || message.includes('latest.yml')) {
            setUpdateState({ status: 'up-to-date', manual: false, message: null });
            return;
        }
        setUpdateState({ status: 'error', manual, message });
    });
}

function downloadUpdate() {
    if (updateDownloadInFlight || !['available', 'download-error'].includes(updateState.status)) return;

    updateDownloadInFlight = true;
    setUpdateState({
        status: 'downloading',
        manual: true,
        percent: 0,
        message: null,
    });

    autoUpdater.downloadUpdate().catch((err) => {
        updateDownloadInFlight = false;
        setUpdateState({
            status: 'download-error',
            manual: true,
            message: err?.message || 'Kunne ikke hente opdateringen',
            percent: null,
        });
    });
}

function setupAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
        setUpdateState({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        updateCheckInFlight = false;
        setUpdateState({
            status: 'available',
            version: info.version,
            releaseDate: info.releaseDate,
            percent: null,
            message: null,
        });
    });

    autoUpdater.on('update-not-available', () => {
        updateCheckInFlight = false;
        setUpdateState({
            status: 'up-to-date',
            manual: false,
            percent: null,
            message: null,
        });
    });

    autoUpdater.on('download-progress', (progress) => {
        setUpdateState({
            status: 'downloading',
            percent: Math.round(progress.percent),
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        updateDownloadInFlight = false;
        setUpdateState({
            status: 'ready',
            version: info.version,
            percent: 100,
            message: null,
        });
    });

    autoUpdater.on('error', (err) => {
        updateCheckInFlight = false;
        updateDownloadInFlight = false;
        // Silently ignore 404 errors (no release published yet)
        if (err?.message?.includes('404') || err?.message?.includes('latest.yml')) return;
        setUpdateState({
            status: updateState.status === 'downloading' ? 'download-error' : 'error',
            message: err?.message || 'Ukendt fejl',
        });
    });

    setTimeout(() => {
        checkForUpdates(false);
    }, 3000);
}

ipcMain.on('install-update', (_event) => {
    console.log('[Updater] install-update invoked');
    try {
        autoUpdater.quitAndInstall(true, true);
    }
    catch (err) {
        console.error('[Updater] quitAndInstall error', err);
        sendToRenderer('update-status', { status: 'error', message: err?.message || 'Ukendt fejl' });
    }
});

ipcMain.on('check-for-updates', () => {
    checkForUpdates(true);
});

ipcMain.on('download-update', () => {
    downloadUpdate();
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
        sendToRenderer('update-status', updateState);
        // Close splash and show main window after a short delay
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

app.on('before-quit', () => {
    if (!lastKnownData) return;
    console.log('[Storage] before-quit flush');
    saveData(lastKnownData);
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
