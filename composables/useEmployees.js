const { ref, computed, nextTick } = Vue;

import { sortByName } from './shared.js';

export function useEmployees({
    employees,
    standby,
    assignments,
    recurrences,
    searchQuery,
    dragState,
    visibleDays,
    parseDate,
    shortMonthNames,
    longMonthNames,
    saveUndo,
}) {
    const newEmployeeName = ref('');
    const editingEmpId = ref(null);
    const editingEmpName = ref('');
    const standbyDragOver = ref(false);

    function colorClass(emp) {
        if (!emp) return 'color-0';
        const c = emp.color ?? (emp.id % 12);
        return 'color-' + c;
    }

    function addEmployee() {
        const name = newEmployeeName.value.trim();
        if (!name) return;
        const id = employees.value.length > 0 ? employees.value.reduce((m, e) => Math.max(m, e.id), -1) + 1 : 0;
        employees.value.push({ id, name, color: id % 12 });
        newEmployeeName.value = '';
    }

    function updateEmployeeColor(empId) {
        const emp = employees.value.find((e) => e.id === empId);
        if (!emp) return;
        const current = emp.color ?? (emp.id % 12);
        emp.color = (current + 1) % 12;
    }

    function removeEmployee(id) {
        const emp = employees.value.find((employee) => employee.id === id);
        if (!emp) return;
        if (!window.confirm(`Fjern "${emp.name}"? Dette kan ikke fortrydes.`)) return;

        employees.value = employees.value.filter((employee) => employee.id !== id);
        standby.value = standby.value.filter((entry) => entry.empId !== id);

        Object.keys(assignments.value).forEach((key) => {
            assignments.value[key] = assignments.value[key].map((employeeId) => (
                employeeId === id ? null : employeeId
            ));
        });

        recurrences.value = recurrences.value.filter((rule) => rule.employeeId !== id);
    }

    function startRename(emp) {
        editingEmpId.value = emp.id;
        editingEmpName.value = emp.name;
        nextTick(() => {
            document.querySelector('.rename-input')?.focus();
        });
    }

    function confirmRename() {
        const name = editingEmpName.value.trim();
        if (name && editingEmpId.value !== null) {
            const emp = employees.value.find((employee) => employee.id === editingEmpId.value);
            if (emp) emp.name = name;
        }

        editingEmpId.value = null;
        editingEmpName.value = '';
    }

    function cancelRename() {
        editingEmpId.value = null;
        editingEmpName.value = '';
    }

    const standbyIds = computed(() => new Set(standby.value.map((entry) => entry.empId)));

    function moveToStandby(empId) {
        if (standbyIds.value.has(empId)) return;
        standby.value.push({ empId, comment: '' });
    }

    function activateFromStandby(empId) {
        standby.value = standby.value.filter((entry) => entry.empId !== empId);
    }

    function updateStandbyComment(empId, comment) {
        const entry = standby.value.find((item) => item.empId === empId);
        if (entry) entry.comment = comment;
    }

    function getStandbyEmployee(empId) {
        return employees.value.find((employee) => employee.id === empId) || null;
    }

    const standbyList = computed(() => (
        [...standby.value]
            .filter((entry) => employees.value.some((employee) => employee.id === entry.empId))
            .sort((a, b) => {
                const aName = getStandbyEmployee(a.empId)?.name || '';
                const bName = getStandbyEmployee(b.empId)?.name || '';
                return aName.localeCompare(bName, 'da', { sensitivity: 'base' });
            })
    ));

    const activeEmployees = computed(() => sortByName(
        employees.value.filter((employee) => !standbyIds.value.has(employee.id))
    ));

    const filteredEmployees = computed(() => {
        const q = searchQuery.value.toLowerCase().trim();
        if (!q) return activeEmployees.value;
        return activeEmployees.value.filter((employee) => employee.name.toLowerCase().includes(q));
    });

    const visibleMonths = computed(() => {
        const seen = new Map();
        visibleDays.value.forEach((day) => {
            const dt = parseDate(day.dateKey);
            const key = dt.getFullYear() + '-' + dt.getMonth();
            if (!seen.has(key)) {
                seen.set(key, { month: dt.getMonth(), year: dt.getFullYear() });
            }
        });
        return [...seen.values()];
    });

    const monthlyStatsByEmp = computed(() => {
        const result = new Map();
        Object.keys(assignments.value).forEach((dateKey) => {
            const slots = assignments.value[dateKey];
            if (!slots) return;

            const d = parseDate(dateKey);
            const mk = d.getFullYear() + '-' + d.getMonth();
            slots.forEach((id) => {
                if (id == null) return;
                if (!result.has(id)) result.set(id, new Map());
                const empMap = result.get(id);
                empMap.set(mk, (empMap.get(mk) || 0) + 1);
            });
        });
        return result;
    });

    function getMonthlyStats(empId) {
        const empMap = monthlyStatsByEmp.value.get(empId) || new Map();
        return visibleMonths.value.map(({ month, year }) => {
            const mk = year + '-' + month;
            return {
                key: mk,
                short: shortMonthNames[month],
                label: longMonthNames[month] + ' ' + year,
                count: empMap.get(mk) || 0,
            };
        });
    }

    function getMonthDutyCount(empId) {
        const empMap = monthlyStatsByEmp.value.get(empId) || new Map();
        let total = 0;
        empMap.forEach((count) => {
            total += count;
        });
        return total;
    }

    function onDragStartFromPool(event, employeeId) {
        dragState.value = { employeeId, fromSlot: null };
        event.dataTransfer.setData('text/plain', JSON.stringify(dragState.value));
        event.dataTransfer.effectAllowed = 'move';
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
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
            return;
        }

        if (data.fromStandby) return;
        if (data.fromSlot && assignments.value[data.fromSlot.date]) {
            saveUndo();
            assignments.value[data.fromSlot.date][data.fromSlot.index] = null;
        }
        moveToStandby(data.employeeId);
    }

    return {
        newEmployeeName,
        editingEmpId,
        editingEmpName,
        standbyDragOver,
        standbyIds,
        standbyList,
        activeEmployees,
        filteredEmployees,
        colorClass,
        updateEmployeeColor,
        addEmployee,
        removeEmployee,
        startRename,
        confirmRename,
        cancelRename,
        moveToStandby,
        activateFromStandby,
        updateStandbyComment,
        getStandbyEmployee,
        getMonthlyStats,
        getMonthDutyCount,
        onDragStartFromPool,
        onDragStartFromStandby,
        onDropToStandby,
    };
}
