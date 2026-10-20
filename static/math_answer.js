const mathAnswerConfig = window.MATH_ANSWER_CONFIG;
const mathAnswerForm = document.getElementById('mathAnswerForm');
const mathAnswerInput = document.getElementById('mathAnswerInput');
const mathAnswerFeedback = document.getElementById('mathAnswerFeedback');

let mathAnswerAttempts = 0;
let mathAnswerSolved = false;

async function mathAnswerSha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function normalizeMathAnswer(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/,/g, '.')
        .replace(/\s+/g, '')
        .replace(/^x=/, '')
        .replace(/^\+/, '');
}

async function saveMathAnswerResult(answer, isCorrect, message) {
    await fetch('/api/local-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            block_id: mathAnswerConfig.blockId,
            answer,
            solved: isCorrect,
            feedback: message
        })
    });
}

function setMathAnswerFeedback(text, status) {
    mathAnswerFeedback.textContent = text;
    mathAnswerFeedback.className = `muted-text choice-feedback ${status || ''}`;
}

function disableMathAnswer() {
    mathAnswerInput.disabled = true;
    mathAnswerForm.querySelector('button').disabled = true;
}

mathAnswerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mathAnswerSolved || mathAnswerAttempts >= mathAnswerConfig.maxAttempts) return;

    const normalizedAnswer = normalizeMathAnswer(mathAnswerInput.value);
    if (!normalizedAnswer) {
        setMathAnswerFeedback('Введи ответ перед проверкой.', 'incorrect');
        return;
    }

    mathAnswerAttempts += 1;
    const answerHash = await mathAnswerSha256(`${mathAnswerConfig.salt}:${normalizedAnswer}`);
    const isCorrect = answerHash === mathAnswerConfig.answerHash;

    if (isCorrect) {
        mathAnswerSolved = true;
        disableMathAnswer();
        const message = 'Верно. Ответ совпал.';
        setMathAnswerFeedback(message, 'correct');
        await saveMathAnswerResult(normalizedAnswer, true, message);
        return;
    }

    const message = mathAnswerAttempts >= mathAnswerConfig.maxAttempts
        ? 'Попытки закончились. Вернись к теории и проверь вычисления.'
        : `Пока неверно. Проверь шаги решения. Попыток: ${mathAnswerAttempts}/${mathAnswerConfig.maxAttempts}`;

    if (mathAnswerAttempts >= mathAnswerConfig.maxAttempts) {
        disableMathAnswer();
    }
    setMathAnswerFeedback(message, 'incorrect');
    await saveMathAnswerResult(normalizedAnswer, false, message);
});
