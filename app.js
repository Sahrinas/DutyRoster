const { createApp, ref, watch } = Vue;

import { loadSavedSync, hasMeaningfulData, SETUP_SHOWN_KEY, toggleDayInArray } from './composables/shared.js';
import { useSettings } from './composables/useSettings.js';
import { useSchedule } from './composables/useSchedule.js';
import { usePersist } from './composables/usePersist.js';
import { useUpdater } from './composables/useUpdater.js';
import { useEmployees } from './composables/useEmployees.js';
import { useAssignments } from './composables/useAssignments.js';
import { useRecurrences } from './composables/useRecurrences.js';
import { useExport } from './composables/useExport.js';

createApp({
    setup() {
        const saved = loadSavedSync();

        const employees = ref(saved.employees || []);
        const activeDays = ref(Array.isArray(saved.activeDays) ? saved.activeDays : [0, 1, 2, 3, 4]);
        const weekOffset = ref(saved.weekOffset || 0);
        const monthOffset = ref(saved.monthOffset || 0);
        const viewMode = ref(saved.viewMode || 'week');
        const assignments = ref(saved.assignments || {});
        const recurrences = ref(saved.recurrences || []);
        const notes = ref(saved.notes || {});
        const standby = ref(saved.standby || []);
        const dragState = ref(null);
        const searchQuery = ref('');
        const toast = ref(null);

        let toastTimer = null;
        function showToast(message, type = 'info') {
            if (toastTimer) clearTimeout(toastTimer);
            toast.value = { message, type };
            toastTimer = setTimeout(() => {
                toast.value = null;
            }, 2600);
        }

        let persistApi;

        const settingsApi = useSettings({
            saved,
            activeDays,
            persist: () => persistApi?.persist(),
            showToast,
        });

        const scheduleApi = useSchedule({
            activeDays,
            weekOffset,
            monthOffset,
            viewMode,
        });

        let employeesApi;
        const activeEmployeesBridge = ref([]);

        const assignmentsApi = useAssignments({
            assignments,
            recurrences,
            notes,
            employees,
            activeEmployees: activeEmployeesBridge,
            visibleDays: scheduleApi.visibleDays,
            slotsPerDay: settingsApi.slotsPerDay,
            settings: settingsApi.settings,
            dragState,
            parseDate: scheduleApi.parseDate,
            getMonthDutyCount: () => 0,
            activateFromStandby: (empId) => employeesApi?.activateFromStandby(empId),
            showToast,
            viewMode,
        });

        employeesApi = useEmployees({
            employees,
            standby,
            assignments,
            recurrences,
            searchQuery,
            dragState,
            visibleDays: scheduleApi.visibleDays,
            parseDate: scheduleApi.parseDate,
            shortMonthNames: scheduleApi.shortMonthNames,
            longMonthNames: scheduleApi.longMonthNames,
            saveUndo: () => assignmentsApi.saveUndo(),
        });

        const recurrenceApi = useRecurrences({
            recurrences,
            assignments,
            employees,
            visibleDays: scheduleApi.visibleDays,
            weekOffset,
            monthOffset,
            viewMode,
            slotsPerDay: settingsApi.slotsPerDay,
            parseDate: scheduleApi.parseDate,
            getISOWeek: scheduleApi.getISOWeek,
            getAssignedEmployee: assignmentsApi.getAssignedEmployee,
            saveUndo: assignmentsApi.saveUndo,
        });

        persistApi = usePersist({
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
            settings: settingsApi.settings,
        });

        const updaterApi = useUpdater({
            showToast,
            flushPersistSync: persistApi.flushPersistSync,
        });

        const exportApi = useExport({
            visibleDays: scheduleApi.visibleDays,
            viewMode,
            activeDays,
            weekGroups: scheduleApi.weekGroups,
            slotsPerDay: settingsApi.slotsPerDay,
            periodLabel: scheduleApi.periodLabel,
            notes,
            dayNames: scheduleApi.dayNames,
            todayKey: scheduleApi.todayKey,
            employees,
            assignments,
            getAssignedEmployee: assignmentsApi.getAssignedEmployee,
            isDayFull: assignmentsApi.isDayFull,
            saveUndo: assignmentsApi.saveUndo,
            showToast,
        });

        persistApi.initializePersistence();

        if (!localStorage.getItem(SETUP_SHOWN_KEY) && !hasMeaningfulData(saved)) {
            settingsApi.showSetup.value = true;
        }

        function toggleDay(index) {
            toggleDayInArray(activeDays.value, index);
        }

        watch(employeesApi.activeEmployees, (value) => {
            activeEmployeesBridge.value = value;
        }, { immediate: true });

        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                    event.preventDefault();
                    assignmentsApi.undo();
                }
                if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
                    event.preventDefault();
                    assignmentsApi.redo();
                }
                if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Z') {
                    event.preventDefault();
                    assignmentsApi.redo();
                }

                const tag = document.activeElement?.tagName;
                const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
                if (!isInput && !event.ctrlKey && !event.metaKey) {
                    if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        scheduleApi.navPrev();
                    }
                    if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        scheduleApi.navNext();
                    }
                }

                if (event.key === 'Escape') {
                    if (recurrenceApi.recurMenu.value) recurrenceApi.recurMenu.value = null;
                    else if (settingsApi.showSettings.value) settingsApi.showSettings.value = false;
                    else if (settingsApi.showSetup.value) settingsApi.showSetup.value = false;
                }
            });

            window.addEventListener('beforeunload', persistApi.flushPersistSync);
            window.addEventListener('pagehide', persistApi.flushPersistSync);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') persistApi.flushPersistSync();
            });
        }

        return {
            ...scheduleApi,
            ...settingsApi,
            ...updaterApi,
            ...employeesApi,
            ...assignmentsApi,
            ...recurrenceApi,
            ...exportApi,
            employees,
            activeDays,
            weekOffset,
            monthOffset,
            viewMode,
            assignments,
            recurrences,
            notes,
            standby,
            dragState,
            searchQuery,
            toast,
            dataReady: persistApi.dataReady,
            toggleDay,
        };
    },
}).mount('#app');
