const geometryConfig = window.GEOMETRY_TASK_CONFIG;
const geometryCanvas = document.getElementById('geometryCanvas');
const geometryAnswerForm = document.getElementById('geometryAnswerForm');
const geometryAnswerInput = document.getElementById('geometryAnswerInput');
const geometryFeedback = document.getElementById('geometryFeedback');

let geometryAttempts = 0;
let geometrySolved = false;

function geometryNumber(value, fallback = 0) {
    const parsed = Number(String(value || '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeGeometryAnswer(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/,/g, '.')
        .replace(/\s+/g, '')
        .replace(/^\+/, '');
}

async function geometrySha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function saveGeometryResult(answer, isCorrect, message) {
    await fetch('/api/local-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            block_id: geometryConfig.blockId,
            answer,
            solved: isCorrect,
            feedback: message
        })
    });
}

function setGeometryFeedback(text, status) {
    geometryFeedback.textContent = text;
    geometryFeedback.className = `muted-text choice-feedback ${status || ''}`;
}

function drawLabel(ctx, text, x, y) {
    ctx.fillStyle = '#111827';
    ctx.font = '16px Rubik, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
}

function drawGeometry() {
    if (!geometryCanvas) return;
    const ctx = geometryCanvas.getContext('2d');
    const width = geometryCanvas.width;
    const height = geometryCanvas.height;
    const a = geometryNumber(geometryConfig.params?.a, 6);
    const b = geometryNumber(geometryConfig.params?.b, 4);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
    ctx.lineWidth = 4;

    if (geometryConfig.shape === 'custom') {
        (geometryConfig.shapes || []).forEach((shape) => drawCustomShape(ctx, shape));
        if (!geometryConfig.shapes || !geometryConfig.shapes.length) {
            drawLabel(ctx, 'Фигура пока не задана', width / 2, height / 2);
        }
        return;
    }

    if (geometryConfig.shape === 'circle') {
        const radius = Math.min(width, height) * 0.28;
        const cx = width / 2;
        const cy = height / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + radius, cy);
        ctx.stroke();
        drawLabel(ctx, `r = ${a}`, cx + radius / 2, cy - 12);
        return;
    }

    if (geometryConfig.shape === 'triangle') {
        const left = width * 0.22;
        const right = width * 0.78;
        const bottom = height * 0.76;
        const top = height * 0.18;
        const mid = width * 0.5;
        ctx.beginPath();
        ctx.moveTo(left, bottom);
        ctx.lineTo(right, bottom);
        ctx.lineTo(mid, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mid, top);
        ctx.lineTo(mid, bottom);
        ctx.stroke();
        drawLabel(ctx, `основание = ${a}`, width / 2, bottom + 28);
        drawLabel(ctx, `высота = ${b}`, mid + 58, (top + bottom) / 2);
        return;
    }

    const rectW = width * 0.58;
    const rectH = height * 0.46;
    const x = (width - rectW) / 2;
    const y = (height - rectH) / 2;
    ctx.fillRect(x, y, rectW, rectH);
    ctx.strokeRect(x, y, rectW, rectH);
    drawLabel(ctx, `a = ${a}`, width / 2, y + rectH + 28);
    drawLabel(ctx, `b = ${b}`, x + rectW + 46, y + rectH / 2);
}

function drawCustomShape(ctx, shape) {
    ctx.save();
    ctx.strokeStyle = shape.stroke || '#2563eb';
    ctx.fillStyle = shape.fill || 'rgba(37, 99, 235, 0.12)';
    ctx.lineWidth = 4;
    if (shape.type === 'rectangle') {
        ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === 'circle') {
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    } else if (shape.type === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(shape.x, shape.y - shape.h / 2);
        ctx.lineTo(shape.x - shape.w / 2, shape.y + shape.h / 2);
        ctx.lineTo(shape.x + shape.w / 2, shape.y + shape.h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (shape.type === 'line') {
        ctx.beginPath();
        if ('x1' in shape) {
            ctx.moveTo(shape.x1, shape.y1);
            ctx.lineTo(shape.x2, shape.y2);
        } else {
            ctx.moveTo(shape.x - shape.w / 2, shape.y);
            ctx.lineTo(shape.x + shape.w / 2, shape.y);
        }
        ctx.stroke();
    } else if (shape.type === 'label') {
        ctx.fillStyle = '#111827';
        ctx.font = '16px Rubik, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(shape.text || 'подпись', shape.x, shape.y);
    }
    ctx.restore();
}

function disableGeometry() {
    geometryAnswerInput.disabled = true;
    geometryAnswerForm.querySelector('button').disabled = true;
}

geometryAnswerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (geometrySolved || geometryAttempts >= geometryConfig.maxAttempts) return;

    const normalizedAnswer = normalizeGeometryAnswer(geometryAnswerInput.value);
    if (!normalizedAnswer) {
        setGeometryFeedback('Введи ответ перед проверкой.', 'incorrect');
        return;
    }

    geometryAttempts += 1;
    const hash = await geometrySha256(`${geometryConfig.salt}:${normalizedAnswer}`);
    const isCorrect = hash === geometryConfig.answerHash;

    if (isCorrect) {
        geometrySolved = true;
        disableGeometry();
        const message = 'Верно. Расчет совпал.';
        setGeometryFeedback(message, 'correct');
        await saveGeometryResult(normalizedAnswer, true, message);
        return;
    }

    const message = geometryAttempts >= geometryConfig.maxAttempts
        ? 'Попытки закончились. Проверь формулу и единицы измерения.'
        : `Пока неверно. Проверь расчет по рисунку. Попыток: ${geometryAttempts}/${geometryConfig.maxAttempts}`;

    if (geometryAttempts >= geometryConfig.maxAttempts) {
        disableGeometry();
    }
    setGeometryFeedback(message, 'incorrect');
    await saveGeometryResult(normalizedAnswer, false, message);
});

drawGeometry();
