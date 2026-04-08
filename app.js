const { createApp, ref, computed, watch, nextTick } = Vue;

const STORAGE_KEY = 'dutyRoster';

// Load saved data synchronously from localStorage first (quick start),
// then overwrite from file storage if available (Electron)
function loadSavedSync() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
}

function hasMeaningfulData(data) {
    if (!data || typeof data !== 'object') return false;
    return Boolean(
        (Array.isArray(data.employees) && data.employees.length) ||
        (Array.isArray(data.recurrences) && data.recurrences.length) ||
        (Array.isArray(data.standby) && data.standby.length) ||
        (data.assignments && Object.keys(data.assignments).length) ||
        (data.notes && Object.keys(data.notes).length) ||
        (Array.isArray(data.activeDays) && data.activeDays.join(',') !== '0,1,2,3,4') ||
        data.weekOffset ||
        data.monthOffset ||
        data.viewMode === 'month'
    );
}

createApp({
    setup() {
        const dayNames = ['Mandag', 'Tirsdag', 'Onsdag', 'Tordag', 'Fredag', 'Lørdag', 'Søndag'];
        const dataReady = ref(false);

        const saved = loadSavedSync();

        // Initialize settings first with defaults
        const defaultSettings = { 
            slotsPerDay: 2, 
            maxConsecutive: 5,
            activeDays: [0, 1, 2, 3, 4],
            colorTheme: 'dark',
            accentColor: 'cyan',
            showEmployeeCount: true,
            showNotePrompts: true
        };
        
        // Merge saved settings with defaults
        const savedSettings = saved.settings && typeof saved.settings === 'object' ? saved.settings : {};
        const settings = ref({
            slotsPerDay: savedSettings.slotsPerDay ?? defaultSettings.slotsPerDay,
            maxConsecutive: savedSettings.maxConsecutive ?? defaultSettings.maxConsecutive,
            activeDays: Array.isArray(savedSettings.activeDays) ? savedSettings.activeDays : defaultSettings.activeDays,
            colorTheme: savedSettings.colorTheme ?? defaultSettings.colorTheme,
            accentColor: savedSettings.accentColor ?? defaultSettings.accentColor,
            showEmployeeCount: savedSettings.showEmployeeCount ?? defaultSettings.showEmployeeCount,
            showNotePrompts: savedSettings.showNotePrompts ?? defaultSettings.showNotePrompts
        });

        const employees = ref(saved.employees || []);
        const activeDays = ref(Array.isArray(saved.activeDays) ? saved.activeDays : settings.value.activeDays);
        const weekOffset = ref(saved.weekOffset || 0);
        const monthOffset = ref(saved.monthOffset || 0);
        const viewMode = ref(saved.viewMode || 'week'); // 'week' | 'month'
        const assignments = ref(saved.assignments || {});
        const recurrences = ref(saved.recurrences || []);
        const notes = ref(saved.notes || {});
        const standby = ref(saved.standby || []); // [{ empId, comment }]
        const newEmployeeName = ref('');
        const editingEmpId = ref(null);
        const editingEmpName = ref('');
        const dragState = ref(null);
        const slotDragOver = ref(null);
        const recurMenu = ref(null);
        const searchQuery = ref('');
        const undoStack = ref([]);
        const redoStack = ref([]);
        const MAX_UNDO = 30;
        const toast = ref(null);
        let toastTimer = null;
        const showSetup = ref(false);
        const setupStep = ref(1);
        const setupConfig = ref({ 
            slotsPerDay: 2, 
            maxConsecutive: 5, 
            activeDays: [0, 1, 2, 3, 4] 
        });
        const showSettings = ref(false);

        const slotsPerDay = computed(() => settings.value.slotsPerDay);
        const maxConsecutive = computed(() => settings.value.maxConsecutive);

        function showToast(message, type = 'info') {
            if (toastTimer) clearTimeout(toastTimer);
            toast.value = { message, type };
            toastTimer = setTimeout(() => { toast.value = null; }, 2600);
        }

        // Sync setupConfig with current settings when setup is opened
        watch(() => showSetup.value, (isOpen) => {
            if (isOpen) {
                setupConfig.value.slotsPerDay = settings.value.slotsPerDay;
                setupConfig.value.maxConsecutive = settings.value.maxConsecutive;
                setupConfig.value.activeDays = [...settings.value.activeDays];
                setupStep.value = 1;
            }
        });

        // Sync activeDays and settings.activeDays
        watch(activeDays, () => {
            if (JSON.stringify(activeDays.value) !== JSON.stringify(settings.value.activeDays)) {
                settings.value.activeDays = [...activeDays.value];
            }
        }, { deep: true });

        // ===== AUTO UPDATE =====
        const appVersion = ref(null);
        const updateStatus = ref(null);
        const manualUpdateCheck = ref(false);

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

        async function installUpdate() {
            showToast('Installing update...', 'info');
            flushPersistSync();
            setTimeout(async () => {
                if (!window.electronAPI || !window.electronAPI.installUpdate) {
                    showToast('Installationsfunktion ikke tilgængelig.', 'error');
                    return;
                }
                const result = await window.electronAPI.installUpdate({ silent: false, force: true });
                if (!result?.success) {
                    showToast('Kunne ikke installere opdatering: ' + (result?.message || 'Ukendt fejl'), 'error');
                }
            }, 500);
        }

        function checkForUpdates() {
            if (!window.electronAPI) {
                showToast('Opdateringer kan kun tjekkes i app-tilstand', 'error');
                return;
            }
            manualUpdateCheck.value = true;
            updateStatus.value = { status: 'checking' };
            window.electronAPI.checkForUpdates();
        }

        if (window.electronAPI) {
            window.electronAPI.onAppVersion((v) => { appVersion.value = v; });
            window.electronAPI.onUpdateStatus((data) => {
                updateStatus.value = data;
                if (data.status === 'up-to-date' && manualUpdateCheck.value) {
                    manualUpdateCheck.value = false;
                    showToast('Du har den nyeste version', 'success');
                }
                if (['available', 'downloading', 'ready', 'error'].includes(data.status)) {
                    manualUpdateCheck.value = false;
                }
            });
        }

        // ===== PERSIST =====
        function getStateSnapshot() {
            return {
                employees: employees.value, activeDays: activeDays.value,
                weekOffset: weekOffset.value, monthOffset: monthOffset.value,
                viewMode: viewMode.value, assignments: assignments.value,
                recurrences: recurrences.value, notes: notes.value,
                standby: standby.value, settings: settings.value,
            };
        }

        let persistEnabled = false;
        let lastSnapshotJson = '';
        let saveInFlight = false;
        let queuedPersist = false;

        function serializeSnapshot(data) {
            return JSON.stringify(data);
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
                    if (queuedPersist) {
                        queuedPersist = false;
                        persist(stateSnapshotJson.value);
                    }
                });
        }

        const stateSnapshotJson = computed(() => serializeSnapshot(getStateSnapshot()));
        watch(stateSnapshotJson, (snapshotJson) => {
            persist(snapshotJson);
        });

        // Load from Electron file storage, then enable persistence
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
        }

        if (window.electronAPI?.loadData) {
            window.electronAPI.loadData().then((result) => {
                const fileData = result?.data || result;
                const fileSource = result?.source || 'primary';
                const localData = saved;
                const shouldMigrateLocal =
                    fileSource === 'default' &&
                    hasMeaningfulData(localData) &&
                    !hasMeaningfulData(fileData);

                if (shouldMigrateLocal) {
                    applyData(localData);
                } else if (fileData) {
                    applyData(fileData);
                }

                lastSnapshotJson = serializeSnapshot(getStateSnapshot());
                dataReady.value = true;
                nextTick(() => {
                    persistEnabled = true;
                    if (shouldMigrateLocal) {
                        flushPersistSync();
                    } else {
                        persist(stateSnapshotJson.value);
                    }
                });
            });
        } else {
            lastSnapshotJson = serializeSnapshot(getStateSnapshot());
            dataReady.value = true;
            persistEnabled = true;
            nextTick(() => {
                persist(stateSnapshotJson.value);
            });
        }

        // Show setup on first run
        if (!localStorage.getItem('setupShown') && !hasMeaningfulData(saved)) {
            showSetup.value = true;
        }

        // ===== UNDO / REDO =====
        function saveUndo() {
            undoStack.value.push(JSON.parse(JSON.stringify(assignments.value)));
            if (undoStack.value.length > MAX_UNDO) undoStack.value.shift();
            redoStack.value = [];
        }
        function undo() {
            if (undoStack.value.length === 0) return;
            redoStack.value.push(JSON.parse(JSON.stringify(assignments.value)));
            assignments.value = undoStack.value.pop();
            showToast('Fortrudt', 'info');
        }
        function redo() {
            if (redoStack.value.length === 0) return;
            undoStack.value.push(JSON.parse(JSON.stringify(assignments.value)));
            assignments.value = redoStack.value.pop();
            showToast('Gentaget', 'info');
        }

        // ===== SETTINGS =====
        function saveSettings() {
            // Validate
            if (settings.value.slotsPerDay < 1 || settings.value.slotsPerDay > 5) {
                showToast('Vagter per dag skal være mellem 1 og 5', 'error');
                return;
            }
            if (settings.value.maxConsecutive < 1 || settings.value.maxConsecutive > 10) {
                showToast('Maks dage i træk skal være mellem 1 og 10', 'error');
                return;
            }
            // Sync activeDays with settings
            activeDays.value = [...settings.value.activeDays];
            persist();
            showSettings.value = false;
            showToast('Indstillinger gemt', 'success');
        }

        // ===== SETUP WIZARD =====
        function nextSetupStep() {
            if (setupStep.value < 4) setupStep.value++;
        }
        function prevSetupStep() {
            if (setupStep.value > 1) setupStep.value--;
        }
        function toggleDayInArray(arr, dayIndex) {
            const idx = arr.indexOf(dayIndex);
            if (idx >= 0) arr.splice(idx, 1);
            else { arr.push(dayIndex); arr.sort((a, b) => a - b); }
        }
        function toggleSetupDay(dayIndex) { toggleDayInArray(setupConfig.value.activeDays, dayIndex); }
        function toggleSettingsDay(dayIndex) {
            toggleDayInArray(settings.value.activeDays, dayIndex);
            // Immediately sync to main activeDays for real-time updates
            activeDays.value = [...settings.value.activeDays];
        }
        function finishSetup() {
            // Apply setup config to settings
            settings.value.slotsPerDay = setupConfig.value.slotsPerDay;
            settings.value.maxConsecutive = setupConfig.value.maxConsecutive;
            settings.value.activeDays = [...setupConfig.value.activeDays];
            
            // Also update the main app refs
            activeDays.value = [...setupConfig.value.activeDays];
            
            // Mark setup as done
            localStorage.setItem('setupShown', 'true');
            showSetup.value = false;
            setupStep.value = 1;
            
            persist();
            showToast('Velkom! Din opsætning er gemt.', 'success');
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
                if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
                if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); }
                const tag = document.activeElement?.tagName;
                const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
                if (!isInput && !e.ctrlKey && !e.metaKey) {
                    if (e.key === 'ArrowLeft')  { e.preventDefault(); navPrev(); }
                    if (e.key === 'ArrowRight') { e.preventDefault(); navNext(); }
                }
                if (e.key === 'Escape') {
                    if (recurMenu.value)         recurMenu.value = null;
                    else if (showSettings.value) showSettings.value = false;
                    else if (showSetup.value)    showSetup.value = false;
                }
            });
            window.addEventListener('beforeunload', flushPersistSync);
            window.addEventListener('pagehide', flushPersistSync);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flushPersistSync();
            });
        }

        // ===== DATE HELPERS =====
        function formatDate(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function formatDisplay(date) {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        function parseDate(dateStr) {
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d);
        }

        function weeksBetween(d1, d2) {
            const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 12);
            const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 12);
            return Math.round((b - a) / 86400000) / 7;
        }

        const todayKey = formatDate(new Date());

        // ===== WEEK DATES =====
        function getWeekDates(offset) {
            const now = new Date();
            const monday = new Date(now);
            const dow = now.getDay();
            monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow) + offset * 7);
            monday.setHours(0, 0, 0, 0);
            return dayNames.map((_, i) => {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                return d;
            });
        }

        // ===== MONTH DATES =====
        function getMonthDates(offset) {
            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            const year = target.getFullYear();
            const month = target.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dates = [];
            for (let d = 1; d <= daysInMonth; d++) {
                dates.push(new Date(year, month, d));
            }
            return dates;
        }

        // ===== VIEW MODE =====
        function setViewMode(mode) {
            if (viewMode.value === mode) return;
            // Convert offset when switching
            if (mode === 'month') {
                const dates = getWeekDates(weekOffset.value);
                const ref = dates[0];
                const now = new Date();
                monthOffset.value = (ref.getFullYear() - now.getFullYear()) * 12 + (ref.getMonth() - now.getMonth());
            } else {
                // switching to week from month — go to first week of that month
                const now = new Date();
                const target = new Date(now.getFullYear(), now.getMonth() + monthOffset.value, 1);
                const dow = target.getDay();
                const mondayOfFirst = new Date(target);
                mondayOfFirst.setDate(target.getDate() - (dow === 0 ? 6 : dow - 1));
                const todayMonday = new Date(now);
                const todayDow = now.getDay();
                todayMonday.setDate(now.getDate() - (todayDow === 0 ? 6 : todayDow - 1));
                todayMonday.setHours(0, 0, 0, 0);
                mondayOfFirst.setHours(0, 0, 0, 0);
                weekOffset.value = Math.round((mondayOfFirst - todayMonday) / (7 * 86400000));
            }
            viewMode.value = mode;
        }

        function navPrev() {
            if (viewMode.value === 'week') weekOffset.value--;
            else monthOffset.value--;
        }

        function navNext() {
            if (viewMode.value === 'week') weekOffset.value++;
            else monthOffset.value++;
        }

        function goToday() {
            weekOffset.value = 0;
            monthOffset.value = 0;
        }

        const isCurrentPeriod = computed(() => {
            return viewMode.value === 'week' ? weekOffset.value === 0 : monthOffset.value === 0;
        });

        const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
        const longMonthNames = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

        const periodLabel = computed(() => {
            if (viewMode.value === 'week') {
                const dates = getWeekDates(weekOffset.value);
                return `${formatDisplay(dates[0])} \u2013 ${formatDisplay(dates[6])}, ${dates[0].getFullYear()}`;
            } else {
                const now = new Date();
                const target = new Date(now.getFullYear(), now.getMonth() + monthOffset.value, 1);
                const mName = longMonthNames[target.getMonth()];
                return `${mName.charAt(0).toUpperCase() + mName.slice(1)} ${target.getFullYear()}`;
            }
        });

        const visibleDays = computed(() => {
            if (viewMode.value === 'week') {
                const dates = getWeekDates(weekOffset.value);
                return activeDays.value.map(i => ({
                    index: i,
                    name: dayNames[i],
                    dateKey: formatDate(dates[i]),
                    display: formatDisplay(dates[i]),
                    dayNum: dates[i].getDate(),
                }));
            } else {
                const dates = getMonthDates(monthOffset.value);
                return dates
                    .filter(d => activeDays.value.includes((d.getDay() + 6) % 7))
                    .map(d => {
                        const dayIndex = (d.getDay() + 6) % 7;
                        return {
                            index: dayIndex,
                            name: dayNames[dayIndex],
                            dateKey: formatDate(d),
                            display: formatDisplay(d),
                            dayNum: d.getDate(),
                        };
                    });
            }
        });

        // Group visible days by week (for month view)
        function getISOWeek(date) {
            const d = new Date(date.getTime());
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
            const week1 = new Date(d.getFullYear(), 0, 4);
            return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        }

        const weekGroups = computed(() => {
            if (viewMode.value !== 'month') return [];
            const groups = [];
            let currentWeek = null;
            let currentGroup = null;

            visibleDays.value.forEach(dayInfo => {
                const d = parseDate(dayInfo.dateKey);
                const wn = getISOWeek(d);
                if (wn !== currentWeek) {
                    currentWeek = wn;
                    currentGroup = { weekNum: wn, days: [] };
                    groups.push(currentGroup);
                }
                currentGroup.days.push(dayInfo);
            });
            return groups;
        });

        // Map day index (Mon=0..Sun=6) to its column position in the grid (1-based)
        function getDayColumn(dayIndex) {
            const pos = activeDays.value.indexOf(dayIndex);
            return pos >= 0 ? pos + 1 : 1;
        }

        // ===== RECURRENCES =====
        // Seeded random: consistent per rule + week so the random day doesn't change on re-render
        function seededRandom(seed) {
            let x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        }

        function applyRecurrencesForDates(datesToCheck) {
            // Group dates by ISO week and month for random-day rules
            const weekMap = new Map();
            const monthMap = new Map();
            datesToCheck.forEach(dayInfo => {
                const date = parseDate(dayInfo.dateKey);
                const isoWeek = getISOWeek(date);
                const weekKey = date.getFullYear() + '-W' + isoWeek;
                if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
                weekMap.get(weekKey).push(dayInfo);
                const monthKey = date.getFullYear() + '-M' + (date.getMonth() + 1);
                if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
                monthMap.get(monthKey).push(dayInfo);
            });

            datesToCheck.forEach(dayInfo => {
                const date = parseDate(dayInfo.dateKey);
                const dayIndex = dayInfo.index;
                recurrences.value.forEach(rule => {
                    const isRandom = rule.frequency.startsWith('random-');
                    if (!isRandom && rule.dayOfWeek !== dayIndex) return;
                    const start = parseDate(rule.startDate);

                    // For random rules, get the base frequency
                    const baseFreq = isRandom ? rule.frequency.replace('random-', '') : rule.frequency;

                    // Normalize both dates to their Monday for week-based calculations
                    const monday = new Date(date);
                    monday.setDate(date.getDate() - dayIndex);
                    const startDayIndex = (start.getDay() + 6) % 7;
                    const startMonday = new Date(start);
                    startMonday.setDate(start.getDate() - startDayIndex);
                    const weeks = weeksBetween(startMonday, monday);
                    if (weeks < 0) return;
                    const wholeWeeks = Math.round(weeks);
                    const startMonthNum = start.getFullYear() * 12 + start.getMonth();
                    const monthNum = date.getFullYear() * 12 + date.getMonth();

                    if (isRandom) {
                        if (baseFreq === 'monthly') {
                            if (monthNum === startMonthNum) return;
                        } else if (wholeWeeks === 0) {
                            return;
                        }
                    }

                    let matches = false;
                    if (baseFreq === 'weekly') matches = wholeWeeks >= 0;
                    else if (baseFreq === 'biweekly') matches = wholeWeeks % 2 === 0;
                    else if (baseFreq === 'triweekly') matches = wholeWeeks % 3 === 0;
                    else if (baseFreq === 'monthly') {
                        if (isRandom) {
                            // For random-monthly, match once per month.
                            matches = monthNum > startMonthNum;
                        } else {
                            matches = date.getDate() === start.getDate();
                        }
                    }
                    if (!matches) return;

                    if (isRandom) {
                        if (baseFreq === 'monthly') {
                            // Pick a random active day in the month
                            const monthKey = date.getFullYear() + '-M' + (date.getMonth() + 1);
                            const monthDays = monthMap.get(monthKey) || [];
                            if (monthDays.length === 0) return;
                            const monthNum = date.getFullYear() * 12 + date.getMonth();
                            const seed = rule.employeeId * 9973 + monthNum * 7919 + (rule.slotIndex + 1) * 5381;
                            const pick = Math.floor(seededRandom(seed) * monthDays.length);
                            if (monthDays[pick].dateKey !== dayInfo.dateKey) return;
                        } else {
                            // Pick a random active day in the week
                            const isoWeek = getISOWeek(date);
                            const weekKey = date.getFullYear() + '-W' + isoWeek;
                            const weekDays = weekMap.get(weekKey) || [];
                            if (weekDays.length === 0) return;
                            const seed = rule.employeeId * 9973 + wholeWeeks * 7919 + (rule.slotIndex + 1) * 5381;
                            const pick = Math.floor(seededRandom(seed) * weekDays.length);
                            if (weekDays[pick].dateKey !== dayInfo.dateKey) return;
                        }
                    }

                    if (!employees.value.find(e => e.id === rule.employeeId)) return;
                    if (!assignments.value[dayInfo.dateKey]) assignments.value[dayInfo.dateKey] = new Array(slotsPerDay.value).fill(null);
                    const slots = assignments.value[dayInfo.dateKey];
                    if (slots.includes(rule.employeeId)) return;
                    let targetSlot = rule.slotIndex;
                    if (isRandom) {
                        // Preferred open slot order: slot 1 first, then slot 2.
                        const preferredSlots = [0, 1];
                        targetSlot = preferredSlots.find(i => i < slotsPerDay.value && slots[i] == null);
                        if (targetSlot === undefined) return;
                    } else {
                        if (slots[rule.slotIndex] != null) return;
                    }
                    slots.splice(targetSlot, 1, rule.employeeId);
                });
            });
        }

        // Navigation: apply recurrences without undo (just revealing already-set rules)
        watch([weekOffset, monthOffset, viewMode], () => {
            nextTick(() => applyRecurrencesForDates(visibleDays.value));
        }, { immediate: true });

        // Recurrence rule changes: save undo first so the resulting assignments can be reverted
        watch(recurrences, () => {
            saveUndo();
            nextTick(() => applyRecurrencesForDates(visibleDays.value));
        }, { deep: true });

        function colorClass(id) { return 'color-' + (id % 12); }

        function sortByName(list) {
            return [...list].sort((a, b) => a.name.localeCompare(b.name, 'da', { sensitivity: 'base' }));
        }

        // ===== EMPLOYEES =====
        function addEmployee() {
            const name = newEmployeeName.value.trim();
            if (!name) return;
            const id = employees.value.length > 0 ? employees.value.reduce((m, e) => Math.max(m, e.id), -1) + 1 : 0;
            employees.value.push({ id, name });
            newEmployeeName.value = '';
        }

        function removeEmployee(id) {
            const emp = employees.value.find(e => e.id === id);
            if (!emp) return;
            if (!window.confirm(`Fjern "${emp.name}"? Dette kan ikke fortrydes.`)) return;
            employees.value = employees.value.filter(e => e.id !== id);
            standby.value = standby.value.filter(s => s.empId !== id);
            for (const key in assignments.value) {
                assignments.value[key] = assignments.value[key].map(eid => eid === id ? null : eid);
            }
            recurrences.value = recurrences.value.filter(r => r.employeeId !== id);
        }

        function startRename(emp) {
            editingEmpId.value = emp.id;
            editingEmpName.value = emp.name;
            nextTick(() => { document.querySelector('.rename-input')?.focus(); });
        }
        function confirmRename() {
            const name = editingEmpName.value.trim();
            if (name && editingEmpId.value !== null) {
                const emp = employees.value.find(e => e.id === editingEmpId.value);
                if (emp) emp.name = name;
            }
            editingEmpId.value = null;
            editingEmpName.value = '';
        }
        function cancelRename() {
            editingEmpId.value = null;
            editingEmpName.value = '';
        }

        // ===== STANDBY =====
        const standbyIds = computed(() => new Set(standby.value.map(s => s.empId)));

        function moveToStandby(empId) {
            if (standbyIds.value.has(empId)) return;
            standby.value.push({ empId, comment: '' });
        }

        function activateFromStandby(empId) {
            standby.value = standby.value.filter(s => s.empId !== empId);
        }

        function updateStandbyComment(empId, comment) {
            const entry = standby.value.find(s => s.empId === empId);
            if (entry) entry.comment = comment;
        }

        function getStandbyEmployee(empId) {
            return employees.value.find(e => e.id === empId) || null;
        }

        const standbyList = computed(() => {
            return [...standby.value]
                .filter(s => employees.value.some(e => e.id === s.empId))
                .sort((a, b) => {
                    const aName = getStandbyEmployee(a.empId)?.name || '';
                    const bName = getStandbyEmployee(b.empId)?.name || '';
                    return aName.localeCompare(bName, 'da', { sensitivity: 'base' });
                });
        });

        const activeEmployees = computed(() => {
            return sortByName(employees.value.filter(e => !standbyIds.value.has(e.id)));
        });

        const filteredEmployees = computed(() => {
            const q = searchQuery.value.toLowerCase().trim();
            const active = activeEmployees.value;
            if (!q) return active;
            return active.filter(e => e.name.toLowerCase().includes(q));
        });

        // ===== DUTY COUNTER =====
        const visibleMonths = computed(() => {
            const seen = new Map();
            visibleDays.value.forEach(d => {
                const dt = parseDate(d.dateKey);
                const key = dt.getFullYear() + '-' + dt.getMonth();
                if (!seen.has(key)) seen.set(key, { month: dt.getMonth(), year: dt.getFullYear() });
            });
            return [...seen.values()];
        });

        // Pre-compute per-employee monthly counts as a single pass over all assignments.
        // Shape: Map<empId, Map<"year-month", count>>
        const monthlyStatsByEmp = computed(() => {
            const result = new Map();
            for (const dateKey in assignments.value) {
                const slots = assignments.value[dateKey];
                if (!slots) continue;
                const d = parseDate(dateKey);
                const mk = d.getFullYear() + '-' + d.getMonth();
                slots.forEach(id => {
                    if (id == null) return;
                    if (!result.has(id)) result.set(id, new Map());
                    const empMap = result.get(id);
                    empMap.set(mk, (empMap.get(mk) || 0) + 1);
                });
            }
            return result;
        });

        function getMonthlyStats(empId) {
            const empMap = monthlyStatsByEmp.value.get(empId) || new Map();
            return visibleMonths.value.map(({ month, year }) => {
                const mk = year + '-' + month;
                const count = empMap.get(mk) || 0;
                return { key: mk, short: shortMonthNames[month], label: longMonthNames[month] + ' ' + year, count };
            });
        }

        function getMonthDutyCount(empId) {
            const empMap = monthlyStatsByEmp.value.get(empId) || new Map();
            let total = 0;
            empMap.forEach(v => { total += v; });
            return total;
        }

        // ===== DAY TOGGLE =====
        function toggleDay(index) { toggleDayInArray(activeDays.value, index); }

        // ===== ASSIGNMENT HELPERS =====
        function getAssignedEmployee(dateKey, slotIndex) {
            const slots = assignments.value[dateKey];
            if (!slots) return null;
            const empId = slots[slotIndex];
            if (empId == null) return null;
            return employees.value.find(e => e.id === empId) || null;
        }

        function isDayFull(dateKey) {
            const slots = assignments.value[dateKey];
            if (!slots) return false;
            return slots.filter(id => id != null).length >= slotsPerDay.value;
        }

        function hasAnyAssignment(dateKey) {
            const slots = assignments.value[dateKey];
            if (!slots) return false;
            return slots.some(id => id != null);
        }

        function getFilledCount(dateKey) {
            const slots = assignments.value[dateKey];
            if (!slots) return 0;
            return slots.filter(id => id != null).length;
        }

        function unassign(dateKey, slotIndex) {
            saveUndo();
            const emp = getAssignedEmployee(dateKey, slotIndex);
            if (emp) {
                const date = parseDate(dateKey);
                const dayOfWeek = (date.getDay() + 6) % 7;
                recurrences.value = recurrences.value.filter(r =>
                    !(r.employeeId === emp.id && r.slotIndex === slotIndex &&
                      (r.dayOfWeek === dayOfWeek || r.frequency.startsWith('random-')))
                );
            }
            if (assignments.value[dateKey]) assignments.value[dateKey][slotIndex] = null;
        }

        // ===== DRAG & DROP =====
        function onDragStartFromPool(event, employeeId) {
            dragState.value = { employeeId, fromSlot: null };
            event.dataTransfer.setData('text/plain', JSON.stringify(dragState.value));
            event.dataTransfer.effectAllowed = 'move';
        }

        function onDragStartFromSlot(event, employeeId, dateKey, slotIndex) {
            dragState.value = { employeeId, fromSlot: { date: dateKey, index: slotIndex } };
            event.dataTransfer.setData('text/plain', JSON.stringify(dragState.value));
            event.dataTransfer.effectAllowed = 'move';
        }

        function onDropToSlot(event, targetDate, targetSlot) {
            event.preventDefault();
            slotDragOver.value = null;
            saveUndo();
            let data;
            try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
            const { employeeId, fromSlot, fromStandby } = data;
            if (fromStandby) activateFromStandby(employeeId);
            const isSameDay = fromSlot && fromSlot.date === targetDate;
            const holdingShift = event.shiftKey;
            if (isSameDay && !holdingShift) {
                if (!assignments.value[targetDate]) assignments.value[targetDate] = new Array(slotsPerDay.value).fill(null);
                const existing = assignments.value[targetDate][targetSlot];
                assignments.value[targetDate][targetSlot] = employeeId;
                assignments.value[targetDate][fromSlot.index] = existing;
                return;
            }
            const current = assignments.value[targetDate] || [];
            if (current.includes(employeeId)) return;
            if (fromSlot && !holdingShift && assignments.value[fromSlot.date]) {
                assignments.value[fromSlot.date][fromSlot.index] = null;
            }
            if (!assignments.value[targetDate]) assignments.value[targetDate] = new Array(slotsPerDay.value).fill(null);
            assignments.value[targetDate][targetSlot] = employeeId;
        }

        function onDropToPool(event) {
            event.preventDefault();
            let data;
            try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
            if (data.fromStandby) {
                activateFromStandby(data.employeeId);
                return;
            }
            if (data.fromSlot && assignments.value[data.fromSlot.date]) {
                saveUndo();
                assignments.value[data.fromSlot.date][data.fromSlot.index] = null;
            }
        }

        function onDragStartFromStandby(event, empId) {
            dragState.value = { employeeId: empId, fromStandby: true };
            event.dataTransfer.setData('text/plain', JSON.stringify(dragState.value));
            event.dataTransfer.effectAllowed = 'move';
        }

        function onDropToStandby(event) {
            event.preventDefault();
            standbyDragOver.value = false;
            let data;
            try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
            if (data.fromStandby) return; // already in standby
            // Remove from slot if dragged from one
            if (data.fromSlot && assignments.value[data.fromSlot.date]) {
                saveUndo();
                assignments.value[data.fromSlot.date][data.fromSlot.index] = null;
            }
            moveToStandby(data.employeeId);
        }

        const standbyDragOver = ref(false);

        // ===== NOTES =====
        function getNote(dateKey) { return notes.value[dateKey] || ''; }
        function setNote(dateKey, value) { notes.value[dateKey] = value; }

        // ===== CONFLICTS =====
        const conflicts = computed(() => {
            const warns = [];
            // Check across all visible days
            const allDays = visibleDays.value;
            // Build a sorted list of all dateKeys in the visible range
            const allDateKeys = allDays.map(d => d.dateKey);

            employees.value.forEach(emp => {
                let consecutive = 0;
                let longestRun = 0;
                let lastDate = null;

                allDateKeys.forEach(dk => {
                    const slots = assignments.value[dk];
                    const assigned = slots && slots.includes(emp.id);
                    if (assigned) {
                        const cur = parseDate(dk);
                        if (lastDate) {
                            const diff = Math.round((cur - lastDate) / 86400000);
                            if (diff === 1) consecutive++;
                            else consecutive = 1;
                        } else {
                            consecutive = 1;
                        }
                        if (consecutive > longestRun) longestRun = consecutive;
                        lastDate = cur;
                    } else {
                        consecutive = 0;
                        lastDate = null;
                    }
                });

                if (longestRun >= settings.value.maxConsecutive) {
                    warns.push(`${emp.name} har ${longestRun} dage i træk`);
                }
            });
            return warns;
        });

        // ===== CLEAR PERIOD =====
        function clearPeriod() {
            const label = viewMode.value === 'week' ? 'ugen' : 'måneden';
            if (!window.confirm(`Ryd alle tildelinger for ${label}?`)) return;
            saveUndo();
            visibleDays.value.forEach(d => {
                if (assignments.value[d.dateKey]) {
                    assignments.value[d.dateKey] = new Array(slotsPerDay.value).fill(null);
                }
            });
            showToast('Periode ryddet', 'info');
        }

        // ===== AUTO-FILL =====
        function autoFill() {
            const active = activeEmployees.value;
            if (active.length === 0) { showToast('Tilføj medics først', 'error'); return; }
            saveUndo();
            const dutyCounts = {};
            active.forEach(e => { dutyCounts[e.id] = getMonthDutyCount(e.id); });
            visibleDays.value.forEach(d => {
                if (!assignments.value[d.dateKey]) assignments.value[d.dateKey] = new Array(slotsPerDay.value).fill(null);
                const slots = assignments.value[d.dateKey];
                for (let s = 0; s < slotsPerDay.value; s++) {
                    if (slots[s] != null) continue;
                    const candidates = active
                        .filter(e => !slots.includes(e.id))
                        .sort((a, b) => (dutyCounts[a.id] || 0) - (dutyCounts[b.id] || 0));
                    if (candidates.length > 0) {
                        const pick = candidates[0];
                        slots.splice(s, 1, pick.id);
                        dutyCounts[pick.id] = (dutyCounts[pick.id] || 0) + 1;
                    }
                }
            });
            showToast('Auto-fyld udført', 'success');
        }

        // ===== RECURRENCE MENU =====
        function getRecurrence(dateKey, slotIndex) {
            const emp = getAssignedEmployee(dateKey, slotIndex);
            if (!emp) return null;
            const date = parseDate(dateKey);
            const dayOfWeek = (date.getDay() + 6) % 7;
            const rule = recurrences.value.find(r =>
                r.employeeId === emp.id &&
                (r.slotIndex === slotIndex || r.frequency.startsWith('random-')) &&
                (r.dayOfWeek === dayOfWeek || r.frequency.startsWith('random-'))
            );
            return rule ? rule.frequency : null;
        }

        const RECURRENCE_META = {
            'weekly':           { label: 'Gentages hver uge',           short: '1U'  },
            'biweekly':         { label: 'Gentages hver 2. uge',        short: '2U'  },
            'triweekly':        { label: 'Gentages hver 3. uge',        short: '3U'  },
            'monthly':          { label: 'Gentages hver måned',         short: '1M'  },
            'random-weekly':    { label: 'Tilfældig dag hver uge',      short: '~1U' },
            'random-biweekly':  { label: 'Tilfældig dag hver 2. uge',   short: '~2U' },
            'random-triweekly': { label: 'Tilfældig dag hver 3. uge',   short: '~3U' },
            'random-monthly':   { label: 'Tilfældig dag hver måned',    short: '~1M' },
        };
        function getRecurrenceLabel(freq) { return RECURRENCE_META[freq]?.label ?? ''; }
        function getRecurrenceShort(freq) { return RECURRENCE_META[freq]?.short ?? ''; }

        function openRecurMenu(dateKey, slotIndex, event) {
            const rect = event.currentTarget.getBoundingClientRect();
            recurMenu.value = { dateKey, slotIndex, x: rect.left, y: rect.bottom + 8 };
        }

        function setRecurrence(frequency) {
            const { dateKey, slotIndex } = recurMenu.value;
            const emp = getAssignedEmployee(dateKey, slotIndex);
            if (!emp) { recurMenu.value = null; return; }
            const date = parseDate(dateKey);
            const dayOfWeek = (date.getDay() + 6) % 7;
            // Remove any existing recurrence for this employee+slot (both fixed and random)
            recurrences.value = recurrences.value.filter(r =>
                !(r.employeeId === emp.id && r.slotIndex === slotIndex && (
                    r.dayOfWeek === dayOfWeek || r.frequency.startsWith('random-')
                ))
            );
            if (frequency) {
                recurrences.value.push({ employeeId: emp.id, dayOfWeek, slotIndex, frequency, startDate: dateKey });
            }
            recurMenu.value = null;
        }

        // ===== CSV EXPORT =====
        function exportCSV() {
            const days = visibleDays.value;
            if (days.length === 0) return;
            let csv = 'Dag,Dato';
            for (let s = 1; s <= slotsPerDay.value; s++) csv += `,Slot ${s}`;
            csv += ',Note\n';
            days.forEach(d => {
                let row = `"${d.name}","${d.dateKey}"`;
                for (let s = 0; s < slotsPerDay.value; s++) {
                    const emp = getAssignedEmployee(d.dateKey, s);
                    row += `,"${emp ? emp.name : ''}"`;
                }
                row += `,"${(notes.value[d.dateKey] || '').replace(/"/g, '""')}"`;
                csv += row + '\n';
            });
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.download = 'vagtplan-' + days[0].dateKey + '.csv';
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('CSV eksporteret', 'success');
        }

        // ===== CSV IMPORT =====
        function importCSV(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result.replace(/^\uFEFF/, ''); // strip BOM
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                if (lines.length < 2) return;

                // Parse header to find slot columns
                const header = parseCSVRow(lines[0]);
                const slotCols = [];
                const datCol = header.findIndex(h => h.toLowerCase() === 'dato' || h.toLowerCase() === 'date');
                const noteCol = header.findIndex(h => h.toLowerCase() === 'note' || h.toLowerCase() === 'noter');
                for (let i = 0; i < header.length; i++) {
                    if (/^slot\s*\d+$/i.test(header[i].trim())) slotCols.push(i);
                }
                if (datCol < 0 || slotCols.length === 0) {
                    showToast('CSV-format ikke genkendt', 'error');
                    event.target.value = '';
                    return;
                }

                saveUndo();
                let imported = 0;

                for (let li = 1; li < lines.length; li++) {
                    const cols = parseCSVRow(lines[li]);
                    if (cols.length <= datCol) continue;

                    // Parse the date - try common formats
                    const dateKey = parseDateCol(cols[datCol].trim());
                    if (!dateKey) continue;

                    // Ensure assignment array exists
                    if (!assignments.value[dateKey]) {
                        assignments.value[dateKey] = new Array(slotsPerDay.value).fill(null);
                    }

                    slotCols.forEach((col, slotIdx) => {
                        if (slotIdx >= slotsPerDay.value) return;
                        const empName = (cols[col] || '').trim();
                        if (!empName) return;

                        // Find or create employee
                        let emp = employees.value.find(e => e.name.toLowerCase() === empName.toLowerCase());
                        if (!emp) {
                            const id = employees.value.length > 0 ? employees.value.reduce((m, e) => Math.max(m, e.id), -1) + 1 : 0;
                            emp = { id, name: empName };
                            employees.value.push(emp);
                        }
                        assignments.value[dateKey].splice(slotIdx, 1, emp.id);
                        imported++;
                    });

                    // Import note if present
                    if (noteCol >= 0 && cols[noteCol] && cols[noteCol].trim()) {
                        notes.value[dateKey] = cols[noteCol].trim();
                    }
                }

                showToast(`Importeret ${imported} tildelinger`, 'success');
                event.target.value = '';
            };
            reader.readAsText(file);
        }

        function parseCSVRow(line) {
            const cols = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                    else if (ch === '"') inQuotes = false;
                    else current += ch;
                } else {
                    if (ch === '"') inQuotes = true;
                    else if (ch === ',' || ch === ';') { cols.push(current); current = ''; }
                    else current += ch;
                }
            }
            cols.push(current);
            return cols;
        }

        function parseDateCol(val) {
            // Try YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
            // Try DD/MM/YYYY or DD-MM-YYYY
            let m = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
            if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
            // Try "Mon DD" display format from export (e.g. "Apr 7")
            const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
            m = val.match(/^([a-zA-Z]{3})\s+(\d{1,2})$/);
            if (m) {
                const mon = months[m[1].toLowerCase()];
                if (mon) {
                    const year = new Date().getFullYear();
                    return `${year}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
                }
            }
            return null;
        }

        // ===== IMAGE EXPORT =====
        const chipColors = [
            { bg: '#1a1850', text: '#a5b4fc', border: '#4338ca' },
            { bg: '#0c2a4a', text: '#67e8f9', border: '#0891b2' },
            { bg: '#0a2e24', text: '#6ee7b7', border: '#059669' },
            { bg: '#1a3010', text: '#bef264', border: '#65a30d' },
            { bg: '#2a2508', text: '#fde047', border: '#ca8a04' },
            { bg: '#2e1a08', text: '#fdba74', border: '#ea580c' },
            { bg: '#2e0a2a', text: '#f0abfc', border: '#c026d3' },
            { bg: '#1e0a3a', text: '#d8b4fe', border: '#9333ea' },
            { bg: '#2e0a20', text: '#f9a8d4', border: '#db2777' },
            { bg: '#0a2420', text: '#5eead4', border: '#14b8a6' },
            { bg: '#2e0a14', text: '#fda4af', border: '#e11d48' },
            { bg: '#0a1e30', text: '#7dd3fc', border: '#0284c7' },
        ];

        function exportImage() {
            const days = visibleDays.value;
            if (days.length === 0) return;

            const dpr = window.devicePixelRatio || 1;
            // In month view, use a tighter grid
            const isMonth = viewMode.value === 'month';
            const cols = isMonth ? activeDays.value.length : days.length;
            const rows = isMonth ? weekGroups.value.length : 1;
            const colWidth = isMonth ? 170 : 220;
            const headerHeight = 100;
            const dayHeaderH = 42;
            const slotH = 38;
            const slotGap = 6;
            const slotLabelH = 16;
            const dayPadding = 10;
            const noteH = 24;
            const cardGap = 12;
            const marginX = 30;
            const marginY = 24;

            const cardInnerH = dayHeaderH + dayPadding + (slotLabelH + slotH + slotGap) * slotsPerDay.value + noteH + dayPadding;
            const weekLabelH = isMonth ? 22 : 0;
            const colHeaderH_est = isMonth ? 20 : 0;
            const totalW = marginX * 2 + cols * colWidth + (cols - 1) * cardGap;
            const totalH = headerHeight + colHeaderH_est + (cardInnerH + weekLabelH + cardGap) * rows + marginY * 2;

            const canvas = document.createElement('canvas');
            canvas.width = totalW * dpr;
            canvas.height = totalH * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            const bgGrad = ctx.createLinearGradient(0, 0, totalW, totalH);
            bgGrad.addColorStop(0, '#030812');
            bgGrad.addColorStop(1, '#0a1628');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, totalW, totalH);

            ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
            ctx.lineWidth = 0.5;
            for (let x = 0; x < totalW; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, totalH); ctx.stroke(); }
            for (let y = 0; y < totalH; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(totalW, y); ctx.stroke(); }

            ctx.font = '700 22px Orbitron, sans-serif';
            ctx.fillStyle = '#eef6ff';
            ctx.textAlign = 'center';
            ctx.fillText('Vagtplan', totalW / 2, marginY + 30);

            ctx.font = '500 13px Orbitron, sans-serif';
            ctx.fillStyle = '#4a6a8a';
            ctx.fillText(periodLabel.value.toUpperCase(), totalW / 2, marginY + 55);

            const lineGrad = ctx.createLinearGradient(totalW / 2 - 150, 0, totalW / 2 + 150, 0);
            lineGrad.addColorStop(0, 'transparent'); lineGrad.addColorStop(0.5, '#00f0ff'); lineGrad.addColorStop(1, 'transparent');
            ctx.strokeStyle = lineGrad; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(totalW / 2 - 150, marginY + 68); ctx.lineTo(totalW / 2 + 150, marginY + 68); ctx.stroke();

            const colHeaderH = isMonth ? 20 : 0;
            const startY = headerHeight + marginY + colHeaderH;

            // Draw column headers for month view
            if (isMonth) {
                ctx.font = '600 9px Orbitron, sans-serif';
                ctx.fillStyle = 'rgba(0, 240, 255, 0.5)';
                ctx.textAlign = 'center';
                activeDays.value.forEach((dayIdx, col) => {
                    const x = marginX + col * (colWidth + cardGap) + colWidth / 2;
                    ctx.fillText(dayNames[dayIdx].slice(0, 3).toUpperCase(), x, headerHeight + marginY + 12);
                });
            }

            // Build flat list with row/col positions
            const cardPositions = [];
            if (isMonth) {
                weekGroups.value.forEach((week, rowIdx) => {
                    // Draw week label
                    const labelY = startY + rowIdx * (cardInnerH + weekLabelH + cardGap);
                    ctx.font = '600 9px Orbitron, sans-serif';
                    ctx.fillStyle = '#4a6a8a';
                    ctx.textAlign = 'left';
                    ctx.fillText('UGE ' + week.weekNum, marginX, labelY + 12);
                    // Line
                    const lineStartX = marginX + ctx.measureText('UGE ' + week.weekNum + '  ').width;
                    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)'; ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(lineStartX, labelY + 8); ctx.lineTo(marginX + cols * colWidth + (cols - 1) * cardGap, labelY + 8); ctx.stroke();

                    week.days.forEach((dayInfo) => {
                        const col = activeDays.value.indexOf(dayInfo.index);
                        cardPositions.push({
                            dayInfo,
                            x: marginX + col * (colWidth + cardGap),
                            y: labelY + weekLabelH,
                        });
                    });
                });
            } else {
                days.forEach((dayInfo, i) => {
                    cardPositions.push({
                        dayInfo,
                        x: marginX + i * (colWidth + cardGap),
                        y: startY,
                    });
                });
            }

            cardPositions.forEach(({ dayInfo, x, y: cardY }) => {
                const y = cardY;
                const full = isDayFull(dayInfo.dateKey);
                const isToday = dayInfo.dateKey === todayKey;
                const accentColor = full ? '#00ff88' : isToday ? '#ffe600' : '#00f0ff';

                ctx.fillStyle = 'rgba(8, 18, 40, 0.9)';
                roundRect(ctx, x, y, colWidth, cardInnerH, 10);
                ctx.fill();
                ctx.strokeStyle = full ? 'rgba(0, 255, 136, 0.3)' : isToday ? 'rgba(255, 230, 0, 0.3)' : 'rgba(0, 240, 255, 0.15)';
                ctx.lineWidth = 1;
                roundRect(ctx, x, y, colWidth, cardInnerH, 10);
                ctx.stroke();

                const topGrad = ctx.createLinearGradient(x, 0, x + colWidth, 0);
                topGrad.addColorStop(0, 'transparent'); topGrad.addColorStop(0.5, accentColor); topGrad.addColorStop(1, 'transparent');
                ctx.strokeStyle = topGrad; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(x + 12, y); ctx.lineTo(x + colWidth - 12, y); ctx.stroke();

                if (full) {
                    ctx.fillStyle = 'rgba(0, 255, 136, 0.06)';
                    roundRectTop(ctx, x + 1, y + 1, colWidth - 2, dayHeaderH, 9);
                    ctx.fill();
                }

                const fontSize = isMonth ? 10 : 12;
                ctx.font = `700 ${fontSize}px Orbitron, sans-serif`;
                ctx.fillStyle = '#eef6ff';
                ctx.textAlign = 'left';
                const label = isMonth ? dayInfo.name.slice(0, 3).toUpperCase() : dayInfo.name.toUpperCase();
                ctx.fillText(label, x + 12, y + 24);

                if (full) {
                    const nw = ctx.measureText(label + ' ').width;
                    ctx.fillStyle = '#00ff88';
                    ctx.fillText('\u2713', x + 12 + nw, y + 24);
                }

                ctx.font = `600 ${isMonth ? 9 : 11}px Orbitron, sans-serif`;
                ctx.fillStyle = '#00f0ff'; ctx.textAlign = 'right';
                ctx.shadowColor = 'rgba(0, 240, 255, 0.4)'; ctx.shadowBlur = 10;
                ctx.fillText(dayInfo.display, x + colWidth - 12, y + 24);
                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

                ctx.strokeStyle = 'rgba(0, 240, 255, 0.1)'; ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.moveTo(x + 6, y + dayHeaderH); ctx.lineTo(x + colWidth - 6, y + dayHeaderH); ctx.stroke();

                let slotY = y + dayHeaderH + dayPadding;
                for (let s = 0; s < slotsPerDay.value; s++) {
                    ctx.font = '600 8px Orbitron, sans-serif'; ctx.fillStyle = '#4a6a8a'; ctx.textAlign = 'left';
                    ctx.fillText('SLOT ' + (s + 1), x + 14, slotY + 10);
                    slotY += slotLabelH;
                    const emp = getAssignedEmployee(dayInfo.dateKey, s);
                    const slotX = x + 8;
                    const slotW = colWidth - 16;
                    if (emp) {
                        const c = chipColors[emp.id % 12];
                        ctx.fillStyle = c.bg; roundRect(ctx, slotX, slotY, slotW, slotH, 6); ctx.fill();
                        ctx.strokeStyle = c.border; ctx.lineWidth = 1; roundRect(ctx, slotX, slotY, slotW, slotH, 6); ctx.stroke();
                        ctx.font = `600 ${isMonth ? 12 : 15}px Rajdhani, sans-serif`;
                        ctx.fillStyle = c.text; ctx.textAlign = 'left';
                        ctx.fillText(emp.name, slotX + 8, slotY + (isMonth ? 24 : 26));
                    } else {
                        ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)'; ctx.lineWidth = 1;
                        roundRect(ctx, slotX, slotY, slotW, slotH, 6); ctx.stroke(); ctx.setLineDash([]);
                    }
                    slotY += slotH + slotGap;
                }

                const note = notes.value[dayInfo.dateKey];
                if (note) {
                    ctx.font = '400 10px Rajdhani, sans-serif'; ctx.fillStyle = '#5a7a9a'; ctx.textAlign = 'left';
                    const trimmed = note.length > (isMonth ? 18 : 30) ? note.slice(0, isMonth ? 18 : 30) + '...' : note;
                    ctx.fillText(trimmed, x + 12, slotY + 12);
                }
            });

            ctx.font = '400 10px Rajdhani, sans-serif'; ctx.fillStyle = 'rgba(74, 106, 138, 0.4)'; ctx.textAlign = 'right';
            ctx.fillText('Genereret ' + new Date().toLocaleDateString('da-DK', { year: 'numeric', month: 'short', day: 'numeric' }), totalW - marginX, totalH - 10);

            const link = document.createElement('a');
            link.download = 'vagtplan-' + days[0].dateKey + '.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('Billede eksporteret', 'success');
        }

        function roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
        }

        function roundRectTop(ctx, x, y, w, h, r) {
            ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h);
            ctx.lineTo(x, y + h); ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
        }

        return {
            dayNames, slotsPerDay, employees, activeDays, weekOffset, monthOffset,
            viewMode, assignments, recurrences, notes, newEmployeeName, dragState,
            slotDragOver, recurMenu, searchQuery, undoStack, redoStack, toast, showSetup, setupStep, setupConfig, showSettings, settings, maxConsecutive,
            appVersion, updateStatus, manualUpdateCheck, installUpdate, checkForUpdates, periodLabel, visibleDays,
            weekGroups, todayKey, isCurrentPeriod, filteredEmployees, conflicts,
            standby, standbyList, standbyIds, standbyDragOver,
            moveToStandby, activateFromStandby, updateStandbyComment,
            getStandbyEmployee, onDragStartFromStandby, onDropToStandby,
            colorClass, getDayColumn, setViewMode, navPrev, navNext, goToday,
            addEmployee, removeEmployee, editingEmpId, editingEmpName, startRename, confirmRename, cancelRename, toggleDay, getAssignedEmployee,
            isDayFull, hasAnyAssignment, getFilledCount, getMonthlyStats,
            getMonthDutyCount, unassign, onDragStartFromPool, onDragStartFromSlot,
            onDropToSlot, onDropToPool, exportImage, exportCSV, importCSV, autoFill,
            clearPeriod, undo, redo, getNote, setNote, getRecurrence, getRecurrenceLabel,
            getRecurrenceShort, openRecurMenu, setRecurrence, saveSettings,
            nextSetupStep, prevSetupStep, toggleSetupDay, toggleSettingsDay, finishSetup,
        };
    }
}).mount('#app');
