function compileLabFormula(source) {
    let expression = String(source || '').trim().toLowerCase();
    expression = expression.replace(/^y\s*=\s*/, '').replace(/,/g, '.').replace(/\^/g, '**');
    expression = expression.replace(/\bpi\b/g, 'Math.PI').replace(/\be\b/g, 'Math.E');
    ['sin', 'cos', 'tan', 'sqrt', 'abs', 'log', 'exp'].forEach((name) => {
        expression = expression.replace(new RegExp(`\\b${name}\\s*\\(`, 'g'), `Math.${name}(`);
    });
    expression = expression.replace(/(?<=\d)(?=x)/g, '*');
    const identifierCheck = expression
        .replace(/Math\.(sin|cos|tan|sqrt|abs|log|exp|PI|E)/g, '')
        .replace(/\bx\b/g, '');
    if (/[A-Za-z_$]/.test(identifierCheck) || /[^0-9+\-*/().\s]/.test(identifierCheck)) {
        throw new Error('Формула содержит неподдерживаемые символы.');
    }
    return new Function('x', `"use strict"; return ${expression};`);
}

function createGraph(canvas, feedback = null) {
    const state = {
        scale: 44,
        originX: canvas.width / 2,
        originY: canvas.height / 2,
        fn: null,
        dragging: false,
        last: null
    };

    const screenToWorld = (px, py) => ({ x: (px - state.originX) / state.scale, y: (state.originY - py) / state.scale });
    const worldToScreen = (x, y) => ({ x: state.originX + x * state.scale, y: state.originY - y * state.scale });
    const cssVar = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    const canvasColor = (fallback) => {
        const color = getComputedStyle(canvas).backgroundColor;
        return color && color !== 'rgba(0, 0, 0, 0)' ? color : fallback;
    };
    const point = (event) => {
        const rect = canvas.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
    };
    const niceStep = () => {
        const raw = 72 / state.scale;
        const power = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / power;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
    };

    function draw() {
        const ctx = canvas.getContext('2d');
        const isLight = document.body.classList.contains('light') || document.documentElement.classList.contains('light');
        const accent = cssVar('--accent', isLight ? '#0aa79a' : '#62f2d2');
        const bg = canvasColor(isLight ? '#f8fbff' : '#07111f');
        const grid = isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(148, 210, 225, 0.13)';
        const axisColor = isLight ? 'rgba(12, 24, 36, 0.68)' : 'rgba(247, 251, 255, 0.58)';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const step = niceStep();
        const left = screenToWorld(0, 0).x;
        const right = screenToWorld(canvas.width, 0).x;
        const bottom = screenToWorld(0, canvas.height).y;
        const top = screenToWorld(0, 0).y;
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.floor(left / step) * step; x <= right; x += step) {
            const px = worldToScreen(x, 0).x;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, canvas.height);
        }
        for (let y = Math.floor(bottom / step) * step; y <= top; y += step) {
            const py = worldToScreen(0, y).y;
            ctx.moveTo(0, py);
            ctx.lineTo(canvas.width, py);
        }
        ctx.stroke();

        const axis = worldToScreen(0, 0);
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, axis.y);
        ctx.lineTo(canvas.width, axis.y);
        ctx.moveTo(axis.x, 0);
        ctx.lineTo(axis.x, canvas.height);
        ctx.stroke();

        if (!state.fn) return;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.shadowColor = accent;
        ctx.shadowBlur = isLight ? 0 : 12;
        ctx.beginPath();
        let drawing = false;
        let count = 0;
        for (let px = 0; px <= canvas.width; px += 1) {
            const x = screenToWorld(px, 0).x;
            const y = Number(state.fn(x));
            const py = worldToScreen(0, y).y;
            if (!Number.isFinite(y) || py < -canvas.height * 2 || py > canvas.height * 3) {
                drawing = false;
                continue;
            }
            if (!drawing) {
                ctx.moveTo(px, py);
                drawing = true;
            } else {
                ctx.lineTo(px, py);
            }
            count += 1;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (feedback) feedback.textContent = count ? 'График построен.' : 'Не удалось построить график.';
    }

    function zoomAt(px, py, factor) {
        const before = screenToWorld(px, py);
        state.scale = Math.max(10, Math.min(240, state.scale * factor));
        state.originX = px - before.x * state.scale;
        state.originY = py + before.y * state.scale;
        draw();
    }

    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        const p = point(event);
        zoomAt(p.x, p.y, event.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
        state.dragging = true;
        state.last = point(event);
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!state.dragging) return;
        const p = point(event);
        state.originX += p.x - state.last.x;
        state.originY += p.y - state.last.y;
        state.last = p;
        draw();
    });
    canvas.addEventListener('pointerup', () => {
        state.dragging = false;
        state.last = null;
    });

    return {
        plot(formula) {
            state.fn = compileLabFormula(formula);
            draw();
        },
        setFunction(fn) {
            state.fn = fn;
            draw();
        },
        reset() {
            state.scale = 44;
            state.originX = canvas.width / 2;
            state.originY = canvas.height / 2;
            draw();
        },
        redraw() {
            draw();
        }
    };
}

document.querySelectorAll('.lab-tab').forEach((button) => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.lab-tab').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.lab-workspace').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.querySelector(`[data-lab-panel="${button.dataset.labTab}"]`)?.classList.add('active');
        requestAnimationFrame(() => {
            freeGraph.redraw();
            paramGraph.redraw();
        });
    });
});

const freeGraph = createGraph(document.getElementById('labFreeGraph'), document.getElementById('labFreeFeedback'));
const freeFormula = document.getElementById('labFreeFormula');
document.getElementById('labFreePlot')?.addEventListener('click', () => {
    try {
        freeGraph.plot(freeFormula.value);
    } catch (error) {
        document.getElementById('labFreeFeedback').textContent = error.message;
    }
});
document.getElementById('labFreeReset')?.addEventListener('click', () => freeGraph.reset());
freeFormula?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('labFreePlot').click();
});
freeGraph.plot(freeFormula.value);

const paramGraph = createGraph(document.getElementById('paramGraph'));
const paramType = document.getElementById('paramFunctionType');
const paramSliders = document.getElementById('paramSliders');
const paramFormula = document.getElementById('paramFormula');
const paramDefs = {
    linear: {
        formula: (p) => `y = ${fmt(p.a)}x ${signed(p.b)}`,
        params: [['a', -8, 8, 1], ['b', -12, 12, 0]],
        fn: (p, x) => p.a * x + p.b
    },
    quadratic: {
        formula: (p) => `y = ${fmt(p.a)}x² ${signedTerm(p.b, 'x')} ${signed(p.c)}`,
        params: [['a', -5, 5, 1], ['b', -10, 10, 0], ['c', -12, 12, 0]],
        fn: (p, x) => p.a * x * x + p.b * x + p.c
    },
    cubic: {
        formula: (p) => `y = ${fmt(p.a)}x³ ${signedTerm(p.b, 'x²')} ${signedTerm(p.c, 'x')} ${signed(p.d)}`,
        params: [['a', -3, 3, 1], ['b', -5, 5, 0], ['c', -8, 8, 0], ['d', -10, 10, 0]],
        fn: (p, x) => p.a * x ** 3 + p.b * x * x + p.c * x + p.d
    },
    power: {
        formula: (p) => `y = ${fmt(p.a)}(x ${signed(-p.h)})^${fmt(p.n)} ${signed(p.k)}`,
        params: [['a', -5, 5, 1], ['h', -8, 8, 0], ['n', 1, 6, 2], ['k', -10, 10, 0]],
        fn: (p, x) => p.a * Math.pow(x - p.h, Math.round(p.n)) + p.k
    },
    sine: {
        formula: (p) => `y = ${fmt(p.a)}sin(${fmt(p.b)}x ${signed(p.c)}) ${signed(p.d)}`,
        params: [['a', -6, 6, 1], ['b', 0.2, 6, 1], ['c', -6, 6, 0], ['d', -6, 6, 0]],
        fn: (p, x) => p.a * Math.sin(p.b * x + p.c) + p.d
    },
    cosine: {
        formula: (p) => `y = ${fmt(p.a)}cos(${fmt(p.b)}x ${signed(p.c)}) ${signed(p.d)}`,
        params: [['a', -6, 6, 1], ['b', 0.2, 6, 1], ['c', -6, 6, 0], ['d', -6, 6, 0]],
        fn: (p, x) => p.a * Math.cos(p.b * x + p.c) + p.d
    },
    tangent: {
        formula: (p) => `y = ${fmt(p.a)}tan(${fmt(p.b)}x ${signed(p.c)}) ${signed(p.d)}`,
        params: [['a', -4, 4, 1], ['b', 0.2, 4, 1], ['c', -6, 6, 0], ['d', -6, 6, 0]],
        fn: (p, x) => p.a * Math.tan(p.b * x + p.c) + p.d
    },
    hyperbola: {
        formula: (p) => `y = ${fmt(p.a)} / (x ${signed(-p.h)}) ${signed(p.k)}`,
        params: [['a', -10, 10, 1], ['h', -8, 8, 0], ['k', -8, 8, 0]],
        fn: (p, x) => p.a / (x - p.h) + p.k
    },
    root: {
        formula: (p) => `y = ${fmt(p.a)}√(x ${signed(-p.h)}) ${signed(p.k)}`,
        params: [['a', -6, 6, 1], ['h', -8, 8, 0], ['k', -8, 8, 0]],
        fn: (p, x) => x - p.h >= 0 ? p.a * Math.sqrt(x - p.h) + p.k : NaN
    },
    absolute: {
        formula: (p) => `y = ${fmt(p.a)}|x ${signed(-p.h)}| ${signed(p.k)}`,
        params: [['a', -6, 6, 1], ['h', -8, 8, 0], ['k', -8, 8, 0]],
        fn: (p, x) => p.a * Math.abs(x - p.h) + p.k
    },
    exponential: {
        formula: (p) => `y = ${fmt(p.a)}·${fmt(p.b)}^(x ${signed(-p.h)}) ${signed(p.k)}`,
        params: [['a', -5, 5, 1], ['b', 0.2, 5, 2], ['h', -6, 6, 0], ['k', -8, 8, 0]],
        fn: (p, x) => p.a * Math.pow(p.b, x - p.h) + p.k
    },
    logarithm: {
        formula: (p) => `y = ${fmt(p.a)}log_${fmt(p.b)}(x ${signed(-p.h)}) ${signed(p.k)}`,
        params: [['a', -5, 5, 1], ['b', 1.2, 6, 2], ['h', -8, 8, 0], ['k', -8, 8, 0]],
        fn: (p, x) => x - p.h > 0 && p.b > 0 && p.b !== 1 ? p.a * (Math.log(x - p.h) / Math.log(p.b)) + p.k : NaN
    }
};

function fmt(value) {
    return Number(value).toFixed(1).replace(/\.0$/, '');
}

function signed(value) {
    return value >= 0 ? `+ ${fmt(value)}` : `− ${fmt(Math.abs(value))}`;
}

function signedTerm(value, variable) {
    return value >= 0 ? `+ ${fmt(value)}${variable}` : `− ${fmt(Math.abs(value))}${variable}`;
}

function renderParamSliders() {
    const def = paramDefs[paramType.value];
    paramSliders.innerHTML = '';
    def.params.forEach(([name, min, max, value]) => {
        const label = document.createElement('label');
        label.className = 'lab-slider';
        label.innerHTML = `<span>${name}: <strong data-param-value="${name}">${value}</strong></span><input type="range" min="${min}" max="${max}" step="0.1" value="${value}" data-param="${name}">`;
        paramSliders.appendChild(label);
    });
    updateParamGraph();
}

function currentParams() {
    const params = {};
    paramSliders.querySelectorAll('[data-param]').forEach((input) => {
        params[input.dataset.param] = Number(input.value);
        paramSliders.querySelector(`[data-param-value="${input.dataset.param}"]`).textContent = fmt(input.value);
    });
    return params;
}

function updateParamGraph() {
    const def = paramDefs[paramType.value];
    const params = currentParams();
    paramFormula.textContent = def.formula(params);
    paramGraph.setFunction((x) => def.fn(params, x));
}

paramType?.addEventListener('change', renderParamSliders);
paramSliders?.addEventListener('input', updateParamGraph);
renderParamSliders();

window.addEventListener('matematichno-theme-change', () => {
    freeGraph.redraw();
    paramGraph.redraw();
});
