export function useExport({
    visibleDays,
    viewMode,
    activeDays,
    weekGroups,
    slotsPerDay,
    periodLabel,
    notes,
    dayNames,
    todayKey,
    employees,
    assignments,
    getAssignedEmployee,
    isDayFull,
    saveUndo,
    showToast,
}) {
    function exportCSV() {
        const days = visibleDays.value;
        if (days.length === 0) return;

        let csv = 'Dag,Dato';
        for (let slot = 1; slot <= slotsPerDay.value; slot++) csv += `,Slot ${slot}`;
        csv += ',Note\n';

        days.forEach((day) => {
            let row = `"${day.name}","${day.dateKey}"`;
            for (let slotIndex = 0; slotIndex < slotsPerDay.value; slotIndex++) {
                const emp = getAssignedEmployee(day.dateKey, slotIndex);
                row += `,"${emp ? emp.name : ''}"`;
            }
            row += `,"${(notes.value[day.dateKey] || '').replace(/"/g, '""')}"`;
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

    function importCSV(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const text = loadEvent.target.result.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/).filter((line) => line.trim());
            if (lines.length < 2) return;

            const header = parseCSVRow(lines[0]);
            const slotCols = [];
            const dateCol = header.findIndex((value) => value.toLowerCase() === 'dato' || value.toLowerCase() === 'date');
            const noteCol = header.findIndex((value) => value.toLowerCase() === 'note' || value.toLowerCase() === 'noter');
            for (let i = 0; i < header.length; i++) {
                if (/^slot\s*\d+$/i.test(header[i].trim())) slotCols.push(i);
            }

            if (dateCol < 0 || slotCols.length === 0) {
                showToast('CSV-format ikke genkendt', 'error');
                event.target.value = '';
                return;
            }

            saveUndo();
            let imported = 0;

            for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
                const cols = parseCSVRow(lines[lineIndex]);
                if (cols.length <= dateCol) continue;

                const dateKey = parseDateCol(cols[dateCol].trim());
                if (!dateKey) continue;

                if (!assignments.value[dateKey]) {
                    assignments.value[dateKey] = new Array(slotsPerDay.value).fill(null);
                }

                slotCols.forEach((col, slotIndex) => {
                    if (slotIndex >= slotsPerDay.value) return;
                    const empName = (cols[col] || '').trim();
                    if (!empName) return;

                    let emp = employees.value.find((employee) => employee.name.toLowerCase() === empName.toLowerCase());
                    if (!emp) {
                        const id = employees.value.length > 0
                            ? employees.value.reduce((maxId, employee) => Math.max(maxId, employee.id), -1) + 1
                            : 0;
                        emp = { id, name: empName };
                        employees.value.push(emp);
                    }

                    assignments.value[dateKey].splice(slotIndex, 1, emp.id);
                    imported++;
                });

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
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
                continue;
            }

            if (ch === '"') inQuotes = true;
            else if (ch === ',' || ch === ';') {
                cols.push(current);
                current = '';
            } else current += ch;
        }

        cols.push(current);
        return cols;
    }

    function parseDateCol(val) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

        let match = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
        if (match) {
            return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
        }

        const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        match = val.match(/^([a-zA-Z]{3})\s+(\d{1,2})$/);
        if (!match) return null;

        const month = months[match[1].toLowerCase()];
        if (!month) return null;

        const year = new Date().getFullYear();
        return `${year}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }

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
        const colHeaderH = isMonth ? 20 : 0;
        const totalW = marginX * 2 + cols * colWidth + (cols - 1) * cardGap;
        const totalH = headerHeight + colHeaderH + (cardInnerH + weekLabelH + cardGap) * rows + marginY * 2;

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
        for (let x = 0; x < totalW; x += 60) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, totalH);
            ctx.stroke();
        }
        for (let y = 0; y < totalH; y += 60) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(totalW, y);
            ctx.stroke();
        }

        ctx.font = '700 22px Orbitron, sans-serif';
        ctx.fillStyle = '#eef6ff';
        ctx.textAlign = 'center';
        ctx.fillText('Vagtplan', totalW / 2, marginY + 30);

        ctx.font = '500 13px Orbitron, sans-serif';
        ctx.fillStyle = '#4a6a8a';
        ctx.fillText(periodLabel.value.toUpperCase(), totalW / 2, marginY + 55);

        const lineGrad = ctx.createLinearGradient(totalW / 2 - 150, 0, totalW / 2 + 150, 0);
        lineGrad.addColorStop(0, 'transparent');
        lineGrad.addColorStop(0.5, '#00f0ff');
        lineGrad.addColorStop(1, 'transparent');
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(totalW / 2 - 150, marginY + 68);
        ctx.lineTo(totalW / 2 + 150, marginY + 68);
        ctx.stroke();

        const startY = headerHeight + marginY + colHeaderH;
        if (isMonth) {
            ctx.font = '600 9px Orbitron, sans-serif';
            ctx.fillStyle = 'rgba(0, 240, 255, 0.5)';
            ctx.textAlign = 'center';
            activeDays.value.forEach((dayIdx, col) => {
                const x = marginX + col * (colWidth + cardGap) + colWidth / 2;
                ctx.fillText(dayNames[dayIdx].slice(0, 3).toUpperCase(), x, headerHeight + marginY + 12);
            });
        }

        const cardPositions = [];
        if (isMonth) {
            weekGroups.value.forEach((week, rowIdx) => {
                const labelY = startY + rowIdx * (cardInnerH + weekLabelH + cardGap);
                ctx.font = '600 9px Orbitron, sans-serif';
                ctx.fillStyle = '#4a6a8a';
                ctx.textAlign = 'left';
                ctx.fillText('UGE ' + week.weekNum, marginX, labelY + 12);

                const lineStartX = marginX + ctx.measureText('UGE ' + week.weekNum + '  ').width;
                ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(lineStartX, labelY + 8);
                ctx.lineTo(marginX + cols * colWidth + (cols - 1) * cardGap, labelY + 8);
                ctx.stroke();

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

        cardPositions.forEach(({ dayInfo, x, y }) => {
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
            topGrad.addColorStop(0, 'transparent');
            topGrad.addColorStop(0.5, accentColor);
            topGrad.addColorStop(1, 'transparent');
            ctx.strokeStyle = topGrad;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x + 12, y);
            ctx.lineTo(x + colWidth - 12, y);
            ctx.stroke();

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
            ctx.fillStyle = '#00f0ff';
            ctx.textAlign = 'right';
            ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
            ctx.shadowBlur = 10;
            ctx.fillText(dayInfo.display, x + colWidth - 12, y + 24);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;

            ctx.strokeStyle = 'rgba(0, 240, 255, 0.1)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x + 6, y + dayHeaderH);
            ctx.lineTo(x + colWidth - 6, y + dayHeaderH);
            ctx.stroke();

            let slotY = y + dayHeaderH + dayPadding;
            for (let slotIndex = 0; slotIndex < slotsPerDay.value; slotIndex++) {
                ctx.font = '600 8px Orbitron, sans-serif';
                ctx.fillStyle = '#4a6a8a';
                ctx.textAlign = 'left';
                ctx.fillText('SLOT ' + (slotIndex + 1), x + 14, slotY + 10);
                slotY += slotLabelH;

                const emp = getAssignedEmployee(dayInfo.dateKey, slotIndex);
                const slotX = x + 8;
                const slotW = colWidth - 16;
                if (emp) {
                    const color = chipColors[emp.id % 12];
                    ctx.fillStyle = color.bg;
                    roundRect(ctx, slotX, slotY, slotW, slotH, 6);
                    ctx.fill();
                    ctx.strokeStyle = color.border;
                    ctx.lineWidth = 1;
                    roundRect(ctx, slotX, slotY, slotW, slotH, 6);
                    ctx.stroke();
                    ctx.font = `600 ${isMonth ? 12 : 15}px Rajdhani, sans-serif`;
                    ctx.fillStyle = color.text;
                    ctx.textAlign = 'left';
                    ctx.fillText(emp.name, slotX + 8, slotY + (isMonth ? 24 : 26));
                } else {
                    ctx.setLineDash([4, 3]);
                    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
                    ctx.lineWidth = 1;
                    roundRect(ctx, slotX, slotY, slotW, slotH, 6);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                slotY += slotH + slotGap;
            }

            const note = notes.value[dayInfo.dateKey];
            if (!note) return;

            ctx.font = '400 10px Rajdhani, sans-serif';
            ctx.fillStyle = '#5a7a9a';
            ctx.textAlign = 'left';
            const trimmed = note.length > (isMonth ? 18 : 30)
                ? note.slice(0, isMonth ? 18 : 30) + '...'
                : note;
            ctx.fillText(trimmed, x + 12, slotY + 12);
        });

        ctx.font = '400 10px Rajdhani, sans-serif';
        ctx.fillStyle = 'rgba(74, 106, 138, 0.4)';
        ctx.textAlign = 'right';
        ctx.fillText(
            'Genereret ' + new Date().toLocaleDateString('da-DK', { year: 'numeric', month: 'short', day: 'numeric' }),
            totalW - marginX,
            totalH - 10
        );

        const link = document.createElement('a');
        link.download = 'vagtplan-' + days[0].dateKey + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('Billede eksporteret', 'success');
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function roundRectTop(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    return {
        exportCSV,
        importCSV,
        exportImage,
    };
}
