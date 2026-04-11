const { createApp, ref, computed, watch } = Vue;

import { loadSavedSync, hasMeaningfulData, SETUP_SHOWN_KEY, toggleDayInArray } from './composables/shared.js';
import { isAuthSetup, createAuthKey, unlockAuthKey, encryptData, decryptData } from './composables/useAuth.js';
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
        const rawSaved = loadSavedSync();

        // Auth state
        const authReady = isAuthSetup();
        const cryptoKey = ref(null);
        const isUnlocked = ref(false);

        // Login screen state
        const loginPassword = ref('');
        const loginError = ref('');
        const loginLoading = ref(false);

        // Setup password step state
        const setupPassword = ref('');
        const setupPasswordConfirm = ref('');
        const setupPasswordError = ref('');
        const setupPasswordLoading = ref(false);

        // Always start with defaults — data applied after auth via initializePersistence
        const employees = ref([]);
        const activeDays = ref([0, 1, 2, 3, 4]);
        const weekOffset = ref(0);
        const monthOffset = ref(0);
        const viewMode = ref('week');
        const assignments = ref({});
        const recurrences = ref([]);
        const notes = ref({});
        const standby = ref([]);
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

        // Pass empty saved so settings start from defaults; applyData fills them after auth
        const settingsApi = useSettings({
            saved: {},
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
            recurrenceHorizonMonths: settingsApi.recurrenceHorizonMonths,
            parseDate: scheduleApi.parseDate,
            getISOWeek: scheduleApi.getISOWeek,
            getAssignedEmployee: assignmentsApi.getAssignedEmployee,
            saveUndo: assignmentsApi.saveUndo,
        });

        persistApi = usePersist({
            saved: {},
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
            cryptoKey,
            encryptFn: encryptData,
            decryptFn: decryptData,
        });

        const updaterApi = useUpdater({
            showToast,
            flushPersistSync: persistApi.flushPersistSync,
            autoUpdate: settingsApi.autoUpdate,
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

        // Decrypt the raw localStorage blob and initialize persistence
        async function initAfterAuth(key, decryptedSaved) {
            cryptoKey.value = key;
            isUnlocked.value = true;
            await persistApi.initializePersistence(decryptedSaved);
        }

        async function decryptSaved(key) {
            if (!rawSaved || !rawSaved.__encrypted) return rawSaved || null;
            try {
                const plain = await decryptData(key, rawSaved.data);
                return JSON.parse(plain);
            } catch {
                return null;
            }
        }

        // Login handler (returning users)
        async function doLogin() {
            if (!loginPassword.value) return;
            loginLoading.value = true;
            loginError.value = '';
            const key = await unlockAuthKey(loginPassword.value);
            if (!key) {
                loginLoading.value = false;
                loginError.value = 'Forkert adgangskode';
                return;
            }
            const decrypted = await decryptSaved(key);
            loginLoading.value = false;
            await initAfterAuth(key, decrypted);
        }

        // Password creation handler — called from setup step 2
        async function completePasswordStep() {
            // If already unlocked (e.g. user navigated back), just advance
            if (isUnlocked.value) {
                settingsApi.setupStep.value++;
                return;
            }
            if (setupPassword.value.length < 8) {
                setupPasswordError.value = 'Adgangskode skal v\u00E6re mindst 8 tegn';
                return;
            }
            if (setupPassword.value !== setupPasswordConfirm.value) {
                setupPasswordError.value = 'Adgangskoderne matcher ikke';
                return;
            }
            setupPasswordLoading.value = true;
            setupPasswordError.value = '';
            const key = await createAuthKey(setupPassword.value);
            setupPasswordLoading.value = false;
            settingsApi.setupStep.value++;
            await initAfterAuth(key, null);
        }

        // Override nextSetupStep: step 2 triggers password creation
        async function nextSetupStep() {
            if (settingsApi.setupStep.value === 2) {
                await completePasswordStep();
                return;
            }
            settingsApi.nextSetupStep();
        }

        // Show setup for first-time users (no auth set up), login for returning users
        if (!authReady) {
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
                }

                if (event.key === 'Enter' && authReady && !isUnlocked.value) {
                    doLogin();
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
            // Auth
            authReady,
            isUnlocked,
            loginPassword,
            loginError,
            loginLoading,
            doLogin,
            setupPassword,
            setupPasswordConfirm,
            setupPasswordError,
            setupPasswordLoading,
            nextSetupStep, // overrides settingsApi.nextSetupStep
        };
    },
}).mount('#app');
