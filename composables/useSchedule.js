const { computed } = Vue;

import {
    dayNames,
    shortMonthNames,
    longMonthNames,
    formatDate,
    formatDisplay,
    parseDate,
    getISOWeek,
} from './shared.js';

export function useSchedule({ activeDays, weekOffset, monthOffset, viewMode }) {
    const todayKey = formatDate(new Date());

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

    function setViewMode(mode) {
        if (viewMode.value === mode) return;

        if (mode === 'month') {
            const dates = getWeekDates(weekOffset.value);
            const ref = dates[0];
            const now = new Date();
            monthOffset.value = (ref.getFullYear() - now.getFullYear()) * 12 + (ref.getMonth() - now.getMonth());
        } else {
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

    const isCurrentPeriod = computed(() => (
        viewMode.value === 'week' ? weekOffset.value === 0 : monthOffset.value === 0
    ));

    const periodLabel = computed(() => {
        if (viewMode.value === 'week') {
            const dates = getWeekDates(weekOffset.value);
            return `${formatDisplay(dates[0])} \u2013 ${formatDisplay(dates[6])}, ${dates[0].getFullYear()}`;
        }

        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth() + monthOffset.value, 1);
        const mName = longMonthNames[target.getMonth()];
        return `${mName.charAt(0).toUpperCase() + mName.slice(1)} ${target.getFullYear()}`;
    });

    const visibleDays = computed(() => {
        if (viewMode.value === 'week') {
            const dates = getWeekDates(weekOffset.value);
            return activeDays.value.map((i) => ({
                index: i,
                name: dayNames[i],
                dateKey: formatDate(dates[i]),
                display: formatDisplay(dates[i]),
                dayNum: dates[i].getDate(),
            }));
        }

        return getMonthDates(monthOffset.value)
            .filter((d) => activeDays.value.includes((d.getDay() + 6) % 7))
            .map((d) => {
                const dayIndex = (d.getDay() + 6) % 7;
                return {
                    index: dayIndex,
                    name: dayNames[dayIndex],
                    dateKey: formatDate(d),
                    display: formatDisplay(d),
                    dayNum: d.getDate(),
                };
            });
    });

    const weekGroups = computed(() => {
        if (viewMode.value !== 'month') return [];

        const groups = [];
        let currentWeek = null;
        let currentGroup = null;

        visibleDays.value.forEach((dayInfo) => {
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

    function getDayColumn(dayIndex) {
        const pos = activeDays.value.indexOf(dayIndex);
        return pos >= 0 ? pos + 1 : 1;
    }

    return {
        dayNames,
        shortMonthNames,
        longMonthNames,
        todayKey,
        getWeekDates,
        getMonthDates,
        setViewMode,
        navPrev,
        navNext,
        goToday,
        isCurrentPeriod,
        periodLabel,
        visibleDays,
        weekGroups,
        getDayColumn,
        formatDate,
        formatDisplay,
        parseDate,
        getISOWeek,
    };
}
