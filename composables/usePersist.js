const { ref, computed, watch, nextTick } = Vue;

import { STORAGE_KEY, hasMeaningfulData } from './shared.js';

export function usePersist({
    saved,
    employees,
    activeDays,
    weekOffset,
    monthOffset,
    viewMode,
    assignments,
    recurrences,
    notes,
    standby,
    settings,
    cryptoKey,
    encryptFn,
    decryptFn,
}) {
    const dataReady = ref(false);

    let persistEnabled = false;
    let lastSnapshotJson = '';
    let lastPersistedBlob = null; // cached for sync flush
    let saveInFlight = false;
    let queuedPersist = false;

    function getStateSnapshot() {
        return {
            employees: employees.value,
            activeDays: activeDays.value,
            weekOffset: weekOffset.value,
            monthOffset: monthOffset.value,
            viewMode: viewMode.value,
            assignments: assignments.value,
            recurrences: recurrences.value,
            notes: notes.value,
            standby: standby.value,
            settings: settings.value,
        };
    }

    function serializeSnapshot(data) {
        return JSON.stringify(data);
    }

    function applyData(data) {
        if (!data) return;
        if (data.employees) {
            employees.value = data.employees.map((emp) =>
                'color' in emp ? emp : { ...emp, color: emp.id % 12 }
            );
        }
        if (data.activeDays) activeDays.value = data.activeDays;
        if (data.weekOffset != null) weekOffset.value = data.weekOffset;
        if (data.monthOffset != null) monthOffset.value = data.monthOffset;
        if (data.viewMode) viewMode.value = data.viewMode;
        if (data.assignments) assignments.value = data.assignments;
        if (data.recurrences) recurrences.value = data.recurrences;
        if (data.notes) notes.value = data.notes;
        if (data.standby) standby.value = data.standby;
        if (data.settings && typeof data.settings === 'object') {
            settings.value = { ...settings.value, ...data.settings };
        }
    }

    async function buildEncryptedBlob(snapshotJson) {
        if (!cryptoKey.value) return snapshotJson; // fallback (no key yet)
        const encrypted = await encryptFn(cryptoKey.value, snapshotJson);
        return { __encrypted: true, data: encrypted };
    }

    async function persist(snapshotJson) {
        if (!persistEnabled) return;
        if (snapshotJson === lastSnapshotJson) return;
        lastSnapshotJson = snapshotJson;

        const blob = await buildEncryptedBlob(snapshotJson);
        lastPersistedBlob = blob;

        const blobStr = typeof blob === 'string' ? blob : JSON.stringify(blob);
        localStorage.setItem(STORAGE_KEY, blobStr);

        if (!window.electronAPI?.saveData) return;
        if (saveInFlight) {
            queuedPersist = true;
            return;
        }

        saveInFlight = true;
        window.electronAPI.saveData(blob)
            .catch((error) => {
                console.error('[Storage] Async save failed:', error);
            })
            .finally(() => {
                saveInFlight = false;
                if (!queuedPersist) return;
                queuedPersist = false;
                persist(stateSnapshotJson.value);
            });
    }

    function flushPersistSync() {
        if (!persistEnabled) return true; // not authenticated yet — do not overwrite encrypted data

        const snapshotJson = serializeSnapshot(getStateSnapshot());
        queuedPersist = false;

        // Use cached encrypted blob; fall back to plaintext only if no encrypted blob exists yet
        const blob = lastPersistedBlob ?? snapshotJson;
        lastSnapshotJson = snapshotJson;

        const blobStr = typeof blob === 'string' ? blob : JSON.stringify(blob);
        localStorage.setItem(STORAGE_KEY, blobStr);

        if (window.electronAPI?.saveDataSync) {
            return window.electronAPI.saveDataSync(blob);
        }
        return true;
    }

    async function decryptBlob(raw, key) {
        if (!raw) return null;
        if (raw.__encrypted && raw.data && key) {
            try {
                const plainJson = await decryptFn(key, raw.data);
                return JSON.parse(plainJson);
            } catch (e) {
                console.error('[Storage] Decryption failed:', e);
                return null;
            }
        }
        // Legacy plaintext object
        if (raw.__encrypted) return null; // encrypted but no key — can't decrypt
        return raw;
    }

    const stateSnapshotJson = computed(() => serializeSnapshot(getStateSnapshot()));
    watch(stateSnapshotJson, (snapshotJson) => {
        persist(snapshotJson);
    });

    async function initializePersistence(decryptedSaved) {
        if (window.electronAPI?.loadData) {
            const result = await window.electronAPI.loadData();
            const fileDataRaw = result?.data || result;
            const fileSource = result?.source || 'primary';

            const fileData = await decryptBlob(fileDataRaw, cryptoKey.value);

            const shouldMigrateLocal =
                fileSource === 'default' &&
                hasMeaningfulData(decryptedSaved) &&
                !hasMeaningfulData(fileData);

            if (shouldMigrateLocal) {
                applyData(decryptedSaved);
            } else if (fileData) {
                applyData(fileData);
            }

            lastSnapshotJson = serializeSnapshot(getStateSnapshot());
            dataReady.value = true;
            nextTick(() => {
                persistEnabled = true;
                if (shouldMigrateLocal) flushPersistSync();
                else persist(stateSnapshotJson.value);
            });
            return;
        }

        // No Electron — use decrypted localStorage data
        if (decryptedSaved && hasMeaningfulData(decryptedSaved)) {
            applyData(decryptedSaved);
        }
        lastSnapshotJson = serializeSnapshot(getStateSnapshot());
        dataReady.value = true;
        persistEnabled = true;
        nextTick(() => {
            persist(stateSnapshotJson.value);
        });
    }

    return {
        dataReady,
        getStateSnapshot,
        serializeSnapshot,
        persist,
        flushPersistSync,
        initializePersistence,
    };
}
