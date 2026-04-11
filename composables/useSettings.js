const { ref, computed, watch } = Vue;

import { SETUP_SHOWN_KEY, defaultSettings, toggleDayInArray } from './shared.js';

export function useSettings({ saved, activeDays, persist, showToast }) {
    const savedSettings = saved.settings && typeof saved.settings === 'object' ? saved.settings : {};
    const settings = ref({
        slotsPerDay: savedSettings.slotsPerDay ?? defaultSettings.slotsPerDay,
        maxConsecutive: savedSettings.maxConsecutive ?? defaultSettings.maxConsecutive,
        activeDays: Array.isArray(savedSettings.activeDays) ? savedSettings.activeDays : defaultSettings.activeDays,
        colorTheme: savedSettings.colorTheme ?? defaultSettings.colorTheme,
        accentColor: savedSettings.accentColor ?? defaultSettings.accentColor,
        showEmployeeCount: savedSettings.showEmployeeCount ?? defaultSettings.showEmployeeCount,
        showNotePrompts: savedSettings.showNotePrompts ?? defaultSettings.showNotePrompts,
        recurrenceHorizonMonths: savedSettings.recurrenceHorizonMonths ?? defaultSettings.recurrenceHorizonMonths,
    });

    const showSetup = ref(false);
    const setupStep = ref(1);
    const setupConfig = ref({
        slotsPerDay: settings.value.slotsPerDay,
        maxConsecutive: settings.value.maxConsecutive,
        activeDays: [...settings.value.activeDays],
    });
    const showSettings = ref(false);

    const slotsPerDay = computed(() => settings.value.slotsPerDay);
    const maxConsecutive = computed(() => settings.value.maxConsecutive);
    const recurrenceHorizonMonths = computed(() => settings.value.recurrenceHorizonMonths);

    watch(() => showSetup.value, (isOpen) => {
        if (!isOpen) return;
        setupConfig.value.slotsPerDay = settings.value.slotsPerDay;
        setupConfig.value.maxConsecutive = settings.value.maxConsecutive;
        setupConfig.value.activeDays = [...settings.value.activeDays];
        setupStep.value = 1;
    });

    watch(activeDays, () => {
        if (JSON.stringify(activeDays.value) === JSON.stringify(settings.value.activeDays)) return;
        settings.value.activeDays = [...activeDays.value];
    }, { deep: true });

    function saveSettings() {
        if (settings.value.slotsPerDay < 1 || settings.value.slotsPerDay > 5) {
            showToast('Vagter per dag skal v\u00E6re mellem 1 og 5', 'error');
            return;
        }

        if (settings.value.maxConsecutive < 1 || settings.value.maxConsecutive > 10) {
            showToast('Maks dage i tr\u00E6k skal v\u00E6re mellem 1 og 10', 'error');
            return;
        }

        if (settings.value.recurrenceHorizonMonths < 1 || settings.value.recurrenceHorizonMonths > 60) {
            showToast('Gentagelseshorisont skal v\u00E6re mellem 1 og 60 m\u00E5neder', 'error');
            return;
        }

        activeDays.value = [...settings.value.activeDays];
        persist();
        showSettings.value = false;
        showToast('Indstillinger gemt', 'success');
    }

    function nextSetupStep() {
        if (setupStep.value < 4) setupStep.value++;
    }

    function prevSetupStep() {
        if (setupStep.value > 1) setupStep.value--;
    }

    function toggleSetupDay(dayIndex) {
        toggleDayInArray(setupConfig.value.activeDays, dayIndex);
    }

    function toggleSettingsDay(dayIndex) {
        toggleDayInArray(settings.value.activeDays, dayIndex);
        activeDays.value = [...settings.value.activeDays];
    }

    function finishSetup() {
        settings.value.slotsPerDay = setupConfig.value.slotsPerDay;
        settings.value.maxConsecutive = setupConfig.value.maxConsecutive;
        settings.value.activeDays = [...setupConfig.value.activeDays];
        activeDays.value = [...setupConfig.value.activeDays];
        localStorage.setItem(SETUP_SHOWN_KEY, 'true');
        showSetup.value = false;
        setupStep.value = 1;
        persist();
        showToast('Velkom! Din ops\u00E6tning er gemt.', 'success');
    }

    return {
        settings,
        slotsPerDay,
        maxConsecutive,
        recurrenceHorizonMonths,
        showSetup,
        setupStep,
        setupConfig,
        showSettings,
        saveSettings,
        nextSetupStep,
        prevSetupStep,
        toggleSetupDay,
        toggleSettingsDay,
        finishSetup,
    };
}
