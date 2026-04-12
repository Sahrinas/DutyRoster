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

function isEncryptedBlob(data) {
    return data && data.__encrypted === true && typeof data.data === 'string';
}

function loadFileData(filePath) {
    const raw = readJsonFile(filePath);
    if (isEncryptedBlob(raw)) return raw; // pass through encrypted blob as-is
    return normalizeData(raw);
}

function loadData() {
    migrateLegacyDataIfNeeded();
    try {
        const data = loadFileData(dataPath);
        lastKnownData = data;
        return { data, source: 'primary' };
    }
    catch {
        try {
            if (fs.existsSync(tempDataPath)) {
                console.warn('[Storage] Recovering from temporary data file');
                const data = loadFileData(tempDataPath);
                writeDataFiles(JSON.stringify(data, null, 2));
                lastKnownData = data;
                return { data, source: 'temp' };
            }
        }
        catch {}
        try {
            console.warn('[Storage] Primary data file missing or unreadable, trying backup');
            const data = loadFileData(backupDataPath);
            writeDataFiles(JSON.stringify(data, null, 2));
            lastKnownData = data;
            return { data, source: 'backup' };
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
        let toSave;
        if (isEncryptedBlob(data)) {
            toSave = data; // store encrypted blob as-is
        } else {
            toSave = normalizeData(data); // legacy plaintext
        }
        const serialized = JSON.stringify(toSave, null, 2);
        lastKnownData = toSave;
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
autoUpdater.autoDownload = false; // we control downloads manually
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = console;
autoUpdater.allowPrerelease = false;

let autoUpdateEnabled = true; // synced from renderer setting

let updateState = {
    status: 'idle',
    manual: false,
};
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateReadyToInstall = false;
let installAttemptInProgress = false;

function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

function closeAllWindowsForUpdate() {
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
            win.close();
        }
        catch {}
    }

    setTimeout(() => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            try {
                win.destroy();
            }
            catch {}
        }
    }, 750);
}

function setUpdateState(patch) {
    updateState = {
        ...updateState,
        ...patch,
    };
    sendToRenderer('update-status', updateState);
}

function isMajorOrMinorUpdate(currentVersion, newVersion) {
    const parse = (v) => (v || '').replace(/[^0-9.]/g, '').split('.').map(Number);
    const [curMaj, curMin] = parse(currentVersion);
    const [newMaj, newMin] = parse(newVersion);
    if (isNaN(curMaj) || isNaN(newMaj)) return true; // unknown → be safe, require restart
    if (newMaj > curMaj) return true;
    if (newMaj === curMaj && newMin > curMin) return true;
    return false; // patch only
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
        updateReadyToInstall = false;
        const message = err?.message || 'Ukendt fejl';
        if (message.includes('404') || message.includes('latest.yml')) {
            setUpdateState({ status: 'up-to-date', manual: false, message: null });
            return;
        }
        setUpdateState({ status: 'error', manual, message });
    });
}

function startDownload(isManual) {
    if (updateDownloadInFlight) return;
    updateDownloadInFlight = true;
    updateReadyToInstall = false;
    setUpdateState({
        status: 'downloading',
        manual: isManual,
        percent: 0,
        message: null,
    });
    autoUpdater.downloadUpdate().catch((err) => {
        updateDownloadInFlight = false;
        setUpdateState({
            status: 'download-error',
            manual: isManual,
            message: err?.message || 'Kunne ikke hente opdateringen',
            percent: null,
        });
    });
}

function setupAutoUpdater() {
    autoUpdater.on('before-quit-for-update', () => {
        console.log('[Updater] before-quit-for-update emitted');
    });

    autoUpdater.on('checking-for-update', () => {
        setUpdateState({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        updateCheckInFlight = false;
        updateReadyToInstall = false;
        if (autoUpdateEnabled) {
            // Silent background download — skip 'available' state entirely
            setUpdateState({ status: 'downloading', manual: false, percent: 0, version: info.version, message: null });
            startDownload(false);
        } else {
            setUpdateState({ status: 'available', version: info.version, releaseDate: info.releaseDate, percent: null, message: null });
        }
    });

    autoUpdater.on('update-not-available', () => {
        updateCheckInFlight = false;
        updateReadyToInstall = false;
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
        updateReadyToInstall = true;
        const requiresRestart = isMajorOrMinorUpdate(app.getVersion(), info.version);
        if (!requiresRestart) {
            autoUpdater.autoInstallOnAppQuit = true;
        }
        setUpdateState({
            status: 'ready',
            version: info.version,
            percent: 100,
            message: null,
            requiresRestart,
        });
    });

    autoUpdater.on('error', (err) => {
        updateCheckInFlight = false;
        updateDownloadInFlight = false;
        updateReadyToInstall = false;
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

    if (!app.isPackaged) {
        setUpdateState({
            status: 'error',
            manual: true,
            message: 'Installering virker kun i den installerede app, ikke via npm start.',
        });
        return;
    }

    if (typeof autoUpdater.isUpdaterActive === 'function' && !autoUpdater.isUpdaterActive()) {
        setUpdateState({
            status: 'error',
            manual: true,
            message: 'Updater er ikke aktiv i denne build.',
        });
        return;
    }

    if (!updateReadyToInstall) {
        setUpdateState({
            status: 'error',
            manual: true,
            message: 'Der er ingen downloadet opdatering klar til installation endnu.',
        });
        return;
    }

    if (installAttemptInProgress) return;
    installAttemptInProgress = true;

    try {
        autoUpdater.autoInstallOnAppQuit = true;
        setUpdateState({
            status: 'installing',
            manual: true,
            message: 'Lukker appen og starter installationen...',
        });

        setTimeout(() => {
            try {
                autoUpdater.quitAndInstall(false, true);
            }
            catch (err) {
                console.error('[Updater] quitAndInstall immediate error', err);
            }

            closeAllWindowsForUpdate();

            setTimeout(() => {
                try {
                    app.quit();
                }
                catch (err) {
                    console.error('[Updater] app.quit fallback error', err);
                    installAttemptInProgress = false;
                    setUpdateState({ status: 'error', manual: true, message: err?.message || 'Ukendt fejl' });
                }
            }, 400);
        }, 100);
    }
    catch (err) {
        installAttemptInProgress = false;
        console.error('[Updater] quitAndInstall error', err);
        setUpdateState({ status: 'error', manual: true, message: err?.message || 'Ukendt fejl' });
    }
});

ipcMain.on('check-for-updates', () => {
    checkForUpdates(true);
});

ipcMain.on('download-update', () => {
    if (['available', 'download-error'].includes(updateState.status)) {
        startDownload(true);
    }
});

ipcMain.on('set-auto-update', (_e, val) => {
    autoUpdateEnabled = Boolean(val);
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
        width: 1600,
        height: 900,
        minWidth: 1000,
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
            mainWindow.maximize();
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
