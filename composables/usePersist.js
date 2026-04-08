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
}) {
    const dataReady = ref(false);

    let persistEnabled = false;
    let lastSnapshotJson = '';
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
        if (data.employees) employees.value = data.employees;
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

    function persist(snapshotJson = serializeSnapshot(getStateSnapshot())) {
        if (!persistEnabled) return;
        if (snapshotJson === lastSnapshotJson) return;

        lastSnapshotJson = snapshotJson;
        localStorage.setItem(STORAGE_KEY, snapshotJson);

        if (!window.electronAPI?.saveData) return;
        if (saveInFlight) {
            queuedPersist = true;
            return;
        }

        saveInFlight = true;
        const data = JSON.parse(snapshotJson);
        window.electronAPI.saveData(data)
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
        const data = getStateSnapshot();
        const snapshotJson = serializeSnapshot(data);
        lastSnapshotJson = snapshotJson;
        queuedPersist = false;
        localStorage.setItem(STORAGE_KEY, snapshotJson);
        if (window.electronAPI?.saveDataSync) {
            return window.electronAPI.saveDataSync(data);
        }
        return true;
    }

    const stateSnapshotJson = computed(() => serializeSnapshot(getStateSnapshot()));
    watch(stateSnapshotJson, (snapshotJson) => {
        persist(snapshotJson);
    });

    function initializePersistence() {
        if (window.electronAPI?.loadData) {
            window.electronAPI.loadData().then((result) => {
                const fileData = result?.data || result;
                const fileSource = result?.source || 'primary';
                const shouldMigrateLocal =
                    fileSource === 'default' &&
                    hasMeaningfulData(saved) &&
                    !hasMeaningfulData(fileData);

                if (shouldMigrateLocal) {
                    applyData(saved);
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
            });
            return;
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
