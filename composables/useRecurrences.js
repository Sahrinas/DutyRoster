const { ref, watch, nextTick } = Vue;

import { seededRandom, weeksBetween } from './shared.js';

const RECURRENCE_META = {
    weekly: { label: 'Gentages hver uge', short: '1U' },
    biweekly: { label: 'Gentages hver 2. uge', short: '2U' },
    triweekly: { label: 'Gentages hver 3. uge', short: '3U' },
    monthly: { label: 'Gentages hver m\u00E5ned', short: '1M' },
    'random-weekly': { label: 'Tilf\u00E6ldig dag hver uge', short: '~1U' },
    'random-biweekly': { label: 'Tilf\u00E6ldig dag hver 2. uge', short: '~2U' },
    'random-triweekly': { label: 'Tilf\u00E6ldig dag hver 3. uge', short: '~3U' },
    'random-monthly': { label: 'Tilf\u00E6ldig dag hver m\u00E5ned', short: '~1M' },
};

export function useRecurrences({
    recurrences,
    assignments,
    employees,
    visibleDays,
    weekOffset,
    monthOffset,
    viewMode,
    slotsPerDay,
    parseDate,
    getISOWeek,
    getAssignedEmployee,
    saveUndo,
}) {
    const recurMenu = ref(null);

    function applyRecurrencesForDates(datesToCheck) {
        const weekMap = new Map();
        const monthMap = new Map();

        datesToCheck.forEach((dayInfo) => {
            const date = parseDate(dayInfo.dateKey);
            const isoWeek = getISOWeek(date);
            const weekKey = date.getFullYear() + '-W' + isoWeek;
            if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
            weekMap.get(weekKey).push(dayInfo);

            const monthKey = date.getFullYear() + '-M' + (date.getMonth() + 1);
            if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
            monthMap.get(monthKey).push(dayInfo);
        });

        datesToCheck.forEach((dayInfo) => {
            const date = parseDate(dayInfo.dateKey);
            const dayIndex = dayInfo.index;

            recurrences.value.forEach((rule) => {
                const isRandom = rule.frequency.startsWith('random-');
                if (!isRandom && rule.dayOfWeek !== dayIndex) return;

                const start = parseDate(rule.startDate);
                const baseFreq = isRandom ? rule.frequency.replace('random-', '') : rule.frequency;

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
                    matches = isRandom ? monthNum > startMonthNum : date.getDate() === start.getDate();
                }
                if (!matches) return;

                if (isRandom) {
                    if (baseFreq === 'monthly') {
                        const monthKey = date.getFullYear() + '-M' + (date.getMonth() + 1);
                        const monthDays = monthMap.get(monthKey) || [];
                        if (monthDays.length === 0) return;
                        const seed = rule.employeeId * 9973 + monthNum * 7919 + (rule.slotIndex + 1) * 5381;
                        const pick = Math.floor(seededRandom(seed) * monthDays.length);
                        if (monthDays[pick].dateKey !== dayInfo.dateKey) return;
                    } else {
                        const isoWeek = getISOWeek(date);
                        const weekKey = date.getFullYear() + '-W' + isoWeek;
                        const weekDays = weekMap.get(weekKey) || [];
                        if (weekDays.length === 0) return;
                        const seed = rule.employeeId * 9973 + wholeWeeks * 7919 + (rule.slotIndex + 1) * 5381;
                        const pick = Math.floor(seededRandom(seed) * weekDays.length);
                        if (weekDays[pick].dateKey !== dayInfo.dateKey) return;
                    }
                }

                if (!employees.value.find((employee) => employee.id === rule.employeeId)) return;
                if (!assignments.value[dayInfo.dateKey]) {
                    assignments.value[dayInfo.dateKey] = new Array(slotsPerDay.value).fill(null);
                }

                const slots = assignments.value[dayInfo.dateKey];
                if (slots.includes(rule.employeeId)) return;

                let targetSlot = rule.slotIndex;
                if (isRandom) {
                    const preferredSlots = [0, 1];
                    targetSlot = preferredSlots.find((slotIndex) => (
                        slotIndex < slotsPerDay.value && slots[slotIndex] == null
                    ));
                    if (targetSlot === undefined) return;
                } else if (slots[rule.slotIndex] != null) {
                    return;
                }

                slots.splice(targetSlot, 1, rule.employeeId);
            });
        });
    }

    watch([weekOffset, monthOffset, viewMode], () => {
        nextTick(() => applyRecurrencesForDates(visibleDays.value));
    }, { immediate: true });

    watch(recurrences, () => {
        saveUndo();
        nextTick(() => applyRecurrencesForDates(visibleDays.value));
    }, { deep: true });

    function getRecurrence(dateKey, slotIndex) {
        const emp = getAssignedEmployee(dateKey, slotIndex);
        if (!emp) return null;

        const date = parseDate(dateKey);
        const dayOfWeek = (date.getDay() + 6) % 7;
        const rule = recurrences.value.find((item) => (
            item.employeeId === emp.id &&
            (item.slotIndex === slotIndex || item.frequency.startsWith('random-')) &&
            (item.dayOfWeek === dayOfWeek || item.frequency.startsWith('random-'))
        ));
        return rule ? rule.frequency : null;
    }

    function getRecurrenceLabel(freq) {
        return RECURRENCE_META[freq]?.label ?? '';
    }

    function getRecurrenceShort(freq) {
        return RECURRENCE_META[freq]?.short ?? '';
    }

    function openRecurMenu(dateKey, slotIndex, event) {
        const rect = event.currentTarget.getBoundingClientRect();
        recurMenu.value = { dateKey, slotIndex, x: rect.left, y: rect.bottom + 8 };
    }

    function setRecurrence(frequency) {
        const { dateKey, slotIndex } = recurMenu.value;
        const emp = getAssignedEmployee(dateKey, slotIndex);
        if (!emp) {
            recurMenu.value = null;
            return;
        }

        const date = parseDate(dateKey);
        const dayOfWeek = (date.getDay() + 6) % 7;
        recurrences.value = recurrences.value.filter((rule) => !(
            rule.employeeId === emp.id &&
            rule.slotIndex === slotIndex &&
            (rule.dayOfWeek === dayOfWeek || rule.frequency.startsWith('random-'))
        ));

        if (frequency) {
            recurrences.value.push({
                employeeId: emp.id,
                dayOfWeek,
                slotIndex,
                frequency,
                startDate: dateKey,
            });
        }

        recurMenu.value = null;
    }

    return {
        recurMenu,
        getRecurrence,
        getRecurrenceLabel,
        getRecurrenceShort,
        openRecurMenu,
        setRecurrence,
    };
}
