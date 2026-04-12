const { ref, computed } = Vue;

export function useAssignments({
    assignments,
    recurrences,
    notes,
    employees,
    activeEmployees,
    visibleDays,
    slotsPerDay,
    settings,
    dragState,
    parseDate,
    getMonthDutyCount,
    activateFromStandby,
    showToast,
    viewMode,
}) {
    const slotDragOver = ref(null);
    const undoStack = ref([]);
    const redoStack = ref([]);
    const MAX_UNDO = 30;

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

    function getAssignedEmployee(dateKey, slotIndex) {
        const slots = assignments.value[dateKey];
        if (!slots) return null;
        const empId = slots[slotIndex];
        if (empId == null) return null;
        return employees.value.find((employee) => employee.id === empId) || null;
    }

    function isDayFull(dateKey) {
        const slots = assignments.value[dateKey];
        if (!slots) return false;
        return slots.filter((id) => id != null).length >= slotsPerDay.value;
    }

    function hasAnyAssignment(dateKey) {
        const slots = assignments.value[dateKey];
        if (!slots) return false;
        return slots.some((id) => id != null);
    }

    function getFilledCount(dateKey) {
        const slots = assignments.value[dateKey];
        if (!slots) return 0;
        return slots.filter((id) => id != null).length;
    }

    function unassign(dateKey, slotIndex) {
        saveUndo();
        const emp = getAssignedEmployee(dateKey, slotIndex);
        if (emp) {
            const date = parseDate(dateKey);
            const dayOfWeek = (date.getDay() + 6) % 7;
            recurrences.value = recurrences.value.filter((rule) => !(
                rule.employeeId === emp.id &&
                rule.slotIndex === slotIndex &&
                (rule.dayOfWeek === dayOfWeek || rule.frequency.startsWith('random-'))
            ));
        }

        if (assignments.value[dateKey]) assignments.value[dateKey][slotIndex] = null;
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
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
            return;
        }

        const { employeeId, fromSlot, fromStandby } = data;
        if (fromStandby) activateFromStandby(employeeId);

        const isSameDay = fromSlot && fromSlot.date === targetDate;
        const holdingShift = event.shiftKey;
        if (isSameDay && !holdingShift) {
            if (!assignments.value[targetDate]) {
                assignments.value[targetDate] = new Array(slotsPerDay.value).fill(null);
            }
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

        if (!assignments.value[targetDate]) {
            assignments.value[targetDate] = new Array(slotsPerDay.value).fill(null);
        }
        assignments.value[targetDate][targetSlot] = employeeId;
    }

    function onDropToPool(event) {
        event.preventDefault();

        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
            return;
        }

        if (data.fromStandby) {
            activateFromStandby(data.employeeId);
            return;
        }

        if (data.fromSlot && assignments.value[data.fromSlot.date]) {
            saveUndo();
            assignments.value[data.fromSlot.date][data.fromSlot.index] = null;
        }
    }

    function getNote(dateKey) {
        return notes.value[dateKey] || '';
    }

    function setNote(dateKey, value) {
        notes.value[dateKey] = value;
    }

    const conflicts = computed(() => {
        const warnings = [];
        const allDateKeys = visibleDays.value.map((day) => day.dateKey);

        employees.value.forEach((employee) => {
            let consecutive = 0;
            let longestRun = 0;
            let lastDate = null;

            allDateKeys.forEach((dateKey) => {
                const slots = assignments.value[dateKey];
                const assigned = slots && slots.includes(employee.id);
                if (assigned) {
                    const currentDate = parseDate(dateKey);
                    if (lastDate) {
                        const diff = Math.round((currentDate - lastDate) / 86400000);
                        consecutive = diff === 1 ? consecutive + 1 : 1;
                    } else {
                        consecutive = 1;
                    }
                    if (consecutive > longestRun) longestRun = consecutive;
                    lastDate = currentDate;
                } else {
                    consecutive = 0;
                    lastDate = null;
                }
            });

            if (longestRun >= settings.value.maxConsecutive) {
                warnings.push(`${employee.name} har ${longestRun} dage i tr\u00E6k`);
            }
        });

        return warnings;
    });

    function clearPeriod() {
        const label = viewMode.value === 'week' ? 'ugen' : 'm\u00E5neden';
        if (!window.confirm(`Ryd alle tildelinger for ${label}?`)) return;

        saveUndo();
        visibleDays.value.forEach((day) => {
            if (assignments.value[day.dateKey]) {
                assignments.value[day.dateKey] = new Array(slotsPerDay.value).fill(null);
            }
        });
        showToast('Periode ryddet', 'info');
    }

    function autoFill() {
        const active = activeEmployees.value;
        if (active.length === 0) {
            showToast('Tilf\u00F8j ' + (settings.value.employeeLabel || 'medics').toLowerCase() + 's f\u00F8rst', 'error');
            return;
        }

        saveUndo();
        const dutyCounts = {};
        active.forEach((employee) => {
            dutyCounts[employee.id] = getMonthDutyCount(employee.id);
        });

        visibleDays.value.forEach((day) => {
            if (!assignments.value[day.dateKey]) {
                assignments.value[day.dateKey] = new Array(slotsPerDay.value).fill(null);
            }

            const slots = assignments.value[day.dateKey];
            for (let slotIndex = 0; slotIndex < slotsPerDay.value; slotIndex++) {
                if (slots[slotIndex] != null) continue;

                const candidates = active
                    .filter((employee) => !slots.includes(employee.id))
                    .sort((a, b) => (dutyCounts[a.id] || 0) - (dutyCounts[b.id] || 0));

                if (candidates.length === 0) continue;
                const pick = candidates[0];
                slots.splice(slotIndex, 1, pick.id);
                dutyCounts[pick.id] = (dutyCounts[pick.id] || 0) + 1;
            }
        });

        showToast('Auto-fyld udf\u00F8rt', 'success');
    }

    return {
        slotDragOver,
        undoStack,
        redoStack,
        saveUndo,
        undo,
        redo,
        getAssignedEmployee,
        isDayFull,
        hasAnyAssignment,
        getFilledCount,
        unassign,
        onDragStartFromSlot,
        onDropToSlot,
        onDropToPool,
        getNote,
        setNote,
        conflicts,
        clearPeriod,
        autoFill,
    };
}
