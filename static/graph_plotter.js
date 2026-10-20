const formulaInput = document.getElementById('graphFormulaInput');
const plotButton = document.getElementById('graphPlotButton');
const graphCanvas = document.getElementById('graphCanvas');
const graphFeedback = document.getElementById('graphFeedback');
const zoomInButton = document.getElementById('graphZoomIn');
const zoomOutButton = document.getElementById('graphZoomOut');
const resetButton = document.getElementById('graphReset');
const checkFormulaButton = document.getElementById('graphCheckFormula');
const graphConfig = window.GRAPH_PLOTTER_CONFIG || {};

const graphState = {
    scale: 40,
    originX: graphCanvas ? graphCanvas.width / 2 : 450,
    originY: graphCanvas ? graphCanvas.height / 2 : 260,
    minScale: 12,
    maxScale: 220,
    fn: null,
    isDragging: false,
    lastPointer: null
};

function compileFormula(source) {
    let expression = String(source || '').trim().toLowerCase();
    expression = expression.replace(/^y\s*=\s*/, '');
    expression = expression.replace(/,/g, '.');
    expression = expression.replace(/\^/g, '**');
    expression = expression.replace(/\bpi\b/g, 'Math.PI');
    expression = expression.replace(/\be\b/g, 'Math.E');

    const functions = ['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'exp', 'floor', 'ceil', 'round'];
    functions.forEach((name) => {
        expression = expression.replace(new RegExp(`\\b${name}\\s*\\(`, 'g'), `Math.${name}(`);
    });

    const identifierCheck = expression
        .replace(/Math\.(sin|cos|tan|sqrt|abs|log|exp|floor|ceil|round|PI|E)/g, '')
        .replace(/\bx\b/g, '');
    if (/[A-Za-z_$]/.test(identifierCheck) || /[^0-9+\-*/().\s]/.test(identifierCheck)) {
        throw new Error('Формула содержит неподдерживаемые символы.');
    }

    return new Function('x', `"use strict"; return ${expression};`);
}

function screenToWorld(px, py) {
    return {
        x: (px - graphState.originX) / graphState.scale,
        y: (graphState.originY - py) / graphState.scale
    };
}

function worldToScreen(x, y) {
    return {
        x: graphState.originX + x * graphState.scale,
        y: graphState.originY - y * graphState.scale
    };
}

function niceStep() {
    const targetPixels = 72;
    const rawStep = targetPixels / graphState.scale;
    const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / power;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return multiplier * power;
}

function drawGrid(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const step = niceStep();
    const left = screenToWorld(0, 0).x;
    const right = screenToWorld(width, 0).x;
    const bottom = screenToWorld(0, height).y;
    const top = screenToWorld(0, 0).y;
    const firstX = Math.floor(left / step) * step;
    const firstY = Math.floor(bottom / step) * step;

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath();
    for (let x = firstX; x <= right; x += step) {
        const px = worldToScreen(x, 0).x;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
    }
    for (let y = firstY; y <= top; y += step) {
        const py = worldToScreen(0, y).y;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
    }
    ctx.stroke();

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const axisY = worldToScreen(0, 0).y;
    const axisX = worldToScreen(0, 0).x;
    ctx.moveTo(0, axisY);
    ctx.lineTo(width, axisY);
    ctx.moveTo(axisX, 0);
    ctx.lineTo(axisX, height);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = '12px Rubik, Arial, sans-serif';
    for (let x = firstX; x <= right; x += step) {
        if (Math.abs(x) < step / 1000) continue;
        const px = worldToScreen(x, 0).x;
        if (px > 4 && px < width - 24 && axisY > 0 && axisY < height) {
            ctx.fillText(formatTick(x), px + 3, Math.min(height - 6, Math.max(14, axisY + 14)));
        }
    }
    for (let y = firstY; y <= top; y += step) {
        if (Math.abs(y) < step / 1000) continue;
        const py = worldToScreen(0, y).y;
        if (py > 12 && py < height - 4 && axisX > 0 && axisX < width) {
            ctx.fillText(formatTick(y), Math.min(width - 34, Math.max(5, axisX + 5)), py - 4);
        }
    }
}

function formatTick(value) {
    if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(1);
    return Number(value.toFixed(4)).toString();
}

function drawGraph() {
    if (!graphCanvas) return;

    const ctx = graphCanvas.getContext('2d');
    const width = graphCanvas.width;
    const height = graphCanvas.height;
    drawGrid(ctx, width, height);

    if (!graphState.fn) return;

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 3;
    ctx.beginPath();

    let drawing = false;
    let points = 0;
    for (let px = 0; px <= width; px += 1) {
        const x = screenToWorld(px, 0).x;
        const y = Number(graphState.fn(x));
        const py = worldToScreen(0, y).y;

        if (!Number.isFinite(y) || py < -height * 2 || py > height * 3) {
            drawing = false;
            continue;
        }

        if (!drawing) {
            ctx.moveTo(px, py);
            drawing = true;
        } else {
            ctx.lineTo(px, py);
        }
        points += 1;
    }

    ctx.stroke();
    graphFeedback.textContent = points
        ? `График построен. Масштаб: ${Math.round(graphState.scale)} px/ед.`
        : 'Не удалось построить график для этой формулы.';
}

function plotFormula() {
    if (!graphCanvas || !formulaInput) return;

    try {
        graphState.fn = compileFormula(formulaInput.value);
        drawGraph();
    } catch (error) {
        graphState.fn = null;
        drawGraph();
        graphFeedback.textContent = error.message;
    }
}

function zoomAt(canvasX, canvasY, factor) {
    const before = screenToWorld(canvasX, canvasY);
    graphState.scale = Math.min(graphState.maxScale, Math.max(graphState.minScale, graphState.scale * factor));
    graphState.originX = canvasX - before.x * graphState.scale;
    graphState.originY = canvasY + before.y * graphState.scale;
    drawGraph();
}

function canvasPoint(event) {
    const rect = graphCanvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (graphCanvas.width / rect.width),
        y: (event.clientY - rect.top) * (graphCanvas.height / rect.height)
    };
}

function resetView() {
    graphState.scale = 40;
    graphState.originX = graphCanvas.width / 2;
    graphState.originY = graphCanvas.height / 2;
    drawGraph();
}

plotButton?.addEventListener('click', plotFormula);
formulaInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        plotFormula();
    }
});

zoomInButton?.addEventListener('click', () => zoomAt(graphCanvas.width / 2, graphCanvas.height / 2, 1.25));
zoomOutButton?.addEventListener('click', () => zoomAt(graphCanvas.width / 2, graphCanvas.height / 2, 0.8));
resetButton?.addEventListener('click', resetView);
checkFormulaButton?.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/graph-formula-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                block_id: graphConfig.blockId,
                formula: formulaInput.value
            })
        });
        const data = await response.json();
        graphFeedback.textContent = data.message || (data.solved ? 'Верно.' : 'Пока неверно.');
        graphFeedback.className = `muted-text choice-feedback ${data.solved ? 'correct' : 'incorrect'}`;
    } catch (error) {
        graphFeedback.textContent = 'Не удалось проверить формулу.';
        graphFeedback.className = 'muted-text choice-feedback incorrect';
    }
});

graphCanvas?.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = canvasPoint(event);
    zoomAt(point.x, point.y, event.deltaY < 0 ? 1.12 : 0.89);
}, { passive: false });

graphCanvas?.addEventListener('pointerdown', (event) => {
    graphState.isDragging = true;
    graphState.lastPointer = canvasPoint(event);
    graphCanvas.setPointerCapture(event.pointerId);
    graphCanvas.classList.add('is-dragging');
});

graphCanvas?.addEventListener('pointermove', (event) => {
    if (!graphState.isDragging || !graphState.lastPointer) return;
    const point = canvasPoint(event);
    graphState.originX += point.x - graphState.lastPointer.x;
    graphState.originY += point.y - graphState.lastPointer.y;
    graphState.lastPointer = point;
    drawGraph();
});

function endDrag(event) {
    graphState.isDragging = false;
    graphState.lastPointer = null;
    graphCanvas?.releasePointerCapture?.(event.pointerId);
    graphCanvas?.classList.remove('is-dragging');
}

graphCanvas?.addEventListener('pointerup', endDrag);
graphCanvas?.addEventListener('pointercancel', endDrag);
graphCanvas?.addEventListener('pointerleave', () => {
    graphState.isDragging = false;
    graphState.lastPointer = null;
    graphCanvas.classList.remove('is-dragging');
});

plotFormula();
