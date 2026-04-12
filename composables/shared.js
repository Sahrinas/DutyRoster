export const STORAGE_KEY = 'dutyRoster';
export const SETUP_SHOWN_KEY = 'setupShown';

export const defaultSettings = {
    slotsPerDay: 2,
    maxConsecutive: 5,
    activeDays: [0, 1, 2, 3, 4],
    colorTheme: 'dark',
    accentColor: 'cyan',
    showEmployeeCount: true,
    showNotePrompts: true,
    recurrenceHorizonMonths: 12,
    autoUpdate: true,
    employeeLabel: '',
    slotNames: ['Vagt 1', 'Vagt 2'],
    customDayNames: null,
};

export const TUTORIAL_STEPS = [
    { target: 'tutorial-employee-input', title: 'Tilf\u00F8j medarbejdere',
      body: 'Skriv et navn og tryk Enter for at tilf\u00F8je din f\u00F8rste medarbejder til listen.' },
    { target: 'tutorial-employee-pool', title: 'Medarbejderliste',
      body: 'Tr\u00E6k en chip herfra over til en vagt-slot for at tildele en vagt.' },
    { target: 'tutorial-roster', title: 'Vagt-slots',
      body: 'Hvert kort er en dag. Slip en medarbejder i et slot \u2014 klik cirkelp\u00E6len for faste vagter.' },
    { target: 'tutorial-toolbar', title: 'V\u00E6rkt\u00F8jslinje',
      body: 'Auto-fyld fordeler automatisk. Eksporter som billede eller CSV. Fortryd med Ctrl+Z.' },
    { target: 'tutorial-settings-btn', title: 'Indstillinger',
      body: '\u00C5bn indstillinger for at \u00E6ndre vagtnumre, dagnavne, udseende og meget mere.' },
    { target: null, title: 'Du er klar! \uD83C\uDF89',
      body: 'Du kender nu de vigtigste funktioner. God forn\u00F8jelse med planl\u00E6gningen!' },
];

export const dayNames = ['Mandag', 'Tirsdag', 'Onsdag', 'Tordag', 'Fredag', 'L\u00F8rdag', 'S\u00F8ndag'];
export const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
export const longMonthNames = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

export function loadSavedSync() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function hasMeaningfulData(data) {
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

export function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function formatDisplay(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function parseDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function weeksBetween(d1, d2) {
    const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 12);
    const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 12);
    return Math.round((b - a) / 86400000) / 7;
}

export function getISOWeek(date) {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

export function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

export function toggleDayInArray(arr, dayIndex) {
    const idx = arr.indexOf(dayIndex);
    if (idx >= 0) {
        arr.splice(idx, 1);
        return;
    }

    arr.push(dayIndex);
    arr.sort((a, b) => a - b);
}

export function sortByName(list) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'da', { sensitivity: 'base' }));
}
