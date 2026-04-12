const { ref, computed, watch } = Vue;

import { SETUP_SHOWN_KEY, defaultSettings, toggleDayInArray, dayNames, TUTORIAL_STEPS } from './shared.js';

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
        autoUpdate: savedSettings.autoUpdate ?? defaultSettings.autoUpdate,
        employeeLabel: savedSettings.employeeLabel ?? defaultSettings.employeeLabel,
        slotNames: Array.isArray(savedSettings.slotNames)
            ? [...savedSettings.slotNames]
            : [...defaultSettings.slotNames],
        customDayNames: Array.isArray(savedSettings.customDayNames)
            ? [...savedSettings.customDayNames]
            : defaultSettings.customDayNames,
    });

    const showSetup = ref(false);
    const setupStep = ref(1);
    const setupConfig = ref({
        slotsPerDay: settings.value.slotsPerDay,
        maxConsecutive: settings.value.maxConsecutive,
        activeDays: [...settings.value.activeDays],
        employeeLabel: settings.value.employeeLabel,
    });
    const showSettings = ref(false);

    const slotsPerDay = computed(() => settings.value.slotsPerDay);
    const maxConsecutive = computed(() => settings.value.maxConsecutive);
    const recurrenceHorizonMonths = computed(() => settings.value.recurrenceHorizonMonths);
    const autoUpdate = computed(() => settings.value.autoUpdate);
    const effectiveDayNames = computed(() =>
        Array.isArray(settings.value.customDayNames) ? settings.value.customDayNames : dayNames
    );

    const showTutorial = ref(false);
    const tutorialStep = ref(0);
    const currentTutorialStep = computed(() => TUTORIAL_STEPS[tutorialStep.value] ?? TUTORIAL_STEPS[0]);

    function startTutorial() {
        showTutorial.value = true;
        tutorialStep.value = 0;
    }

    function nextTutorialStep() {
        if (tutorialStep.value < TUTORIAL_STEPS.length - 1) {
            tutorialStep.value++;
        } else {
            showTutorial.value = false;
            tutorialStep.value = 0;
        }
    }

    function skipTutorial() {
        showTutorial.value = false;
        tutorialStep.value = 0;
    }

    watch(() => showSetup.value, (isOpen) => {
        if (!isOpen) return;
        setupConfig.value.slotsPerDay = settings.value.slotsPerDay;
        setupConfig.value.maxConsecutive = settings.value.maxConsecutive;
        setupConfig.value.activeDays = [...settings.value.activeDays];
        setupConfig.value.employeeLabel = settings.value.employeeLabel;
        setupStep.value = 1;
    });

    watch(activeDays, () => {
        if (JSON.stringify(activeDays.value) === JSON.stringify(settings.value.activeDays)) return;
        settings.value.activeDays = [...activeDays.value];
    }, { deep: true });

    watch(() => settings.value.slotsPerDay, (newCount) => {
        const names = settings.value.slotNames;
        if (newCount > names.length) {
            for (let i = names.length + 1; i <= newCount; i++) {
                names.push('Vagt ' + i);
            }
        } else if (newCount < names.length) {
            names.splice(newCount);
        }
    });

    watch(() => showSettings.value, (isOpen) => {
        if (!isOpen) return;
        if (!Array.isArray(settings.value.customDayNames)) {
            settings.value.customDayNames = [...effectiveDayNames.value];
        }
    });

    const accentMap = {
        cyan:   { accent: '#06b6d4', dim: 'rgba(6,182,212,0.12)',   glow: '0 0 20px rgba(6,182,212,0.15)',   hover: '#22d3ee' },
        blue:   { accent: '#3b82f6', dim: 'rgba(59,130,246,0.12)',  glow: '0 0 20px rgba(59,130,246,0.15)',  hover: '#60a5fa' },
        green:  { accent: '#22c55e', dim: 'rgba(34,197,94,0.12)',   glow: '0 0 20px rgba(34,197,94,0.15)',   hover: '#4ade80' },
        purple: { accent: '#a855f7', dim: 'rgba(168,85,247,0.12)',  glow: '0 0 20px rgba(168,85,247,0.15)',  hover: '#c084fc' },
    };

    const themeMap = {
        dark: {
            '--bg-0': '#060d1b', '--bg-1': '#0a1628', '--bg-2': '#0f1d32', '--bg-3': '#162440',
            '--bg-panel': 'rgba(10,22,40,0.92)',
            '--border': 'rgba(59,130,246,0.08)', '--border-hover': 'rgba(59,130,246,0.2)',
            '--text': '#94a3b8', '--text-bright': '#e2e8f0', '--text-dim': '#475569',
        },
        light: {
            '--bg-0': '#f0f4f8', '--bg-1': '#e2e8f0', '--bg-2': '#cbd5e1', '--bg-3': '#b0bccc',
            '--bg-panel': 'rgba(240,244,248,0.95)',
            '--border': 'rgba(0,0,0,0.1)', '--border-hover': 'rgba(0,0,0,0.25)',
            '--text': '#334155', '--text-bright': '#0f172a', '--text-dim': '#94a3b8',
        },
    };

    function applyTheme() {
        if (typeof document === 'undefined') return;
        const root = document.documentElement.style;
        const accent = accentMap[settings.value.accentColor] ?? accentMap.cyan;
        root.setProperty('--accent', accent.accent);
        root.setProperty('--accent-dim', accent.dim);
        root.setProperty('--accent-glow', accent.glow);
        root.setProperty('--accent-hover', accent.hover);
        const theme = themeMap[settings.value.colorTheme] ?? themeMap.dark;
        for (const [key, val] of Object.entries(theme)) {
            root.setProperty(key, val);
        }
    }

    watch(() => [settings.value.colorTheme, settings.value.accentColor], applyTheme, { immediate: true });

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
        if (setupStep.value < 5) setupStep.value++;
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

    function finishSetup(skipTutorialFlag = false) {
        settings.value.slotsPerDay = setupConfig.value.slotsPerDay;
        settings.value.maxConsecutive = setupConfig.value.maxConsecutive;
        settings.value.activeDays = [...setupConfig.value.activeDays];
        settings.value.employeeLabel = setupConfig.value.employeeLabel || defaultSettings.employeeLabel;
        activeDays.value = [...setupConfig.value.activeDays];
        localStorage.setItem(SETUP_SHOWN_KEY, 'true');
        showSetup.value = false;
        setupStep.value = 1;
        persist();
        showToast('Velkom! Din ops\u00E6tning er gemt.', 'success');
        if (!skipTutorialFlag) startTutorial();
    }

    return {
        settings,
        slotsPerDay,
        maxConsecutive,
        recurrenceHorizonMonths,
        autoUpdate,
        effectiveDayNames,
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
        showTutorial,
        tutorialStep,
        currentTutorialStep,
        nextTutorialStep,
        skipTutorial,
    };
}
