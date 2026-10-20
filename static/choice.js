const choiceConfig = window.CHOICE_CONFIG;
const feedback = document.getElementById('choiceFeedback');
const buttons = Array.from(document.querySelectorAll('.choice-button'));
const submitButton = document.getElementById('choiceSubmit');
let attempts = 0;
let solved = false;

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function saveLocalResult(answer, isCorrect, message) {
    await fetch('/api/local-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            block_id: choiceConfig.blockId,
            answer,
            solved: isCorrect,
            feedback: message
        })
    });
}

function setFeedback(text, status) {
    feedback.textContent = text;
    feedback.className = `muted-text choice-feedback ${status || ''}`;
}

function disableChoices() {
    buttons.forEach((item) => {
        item.disabled = true;
        item.querySelectorAll('input').forEach((input) => input.disabled = true);
    });
    if (submitButton) {
        submitButton.disabled = true;
    }
}

async function handleAnswer(answer, targetButton = null) {
    if (solved || attempts >= choiceConfig.maxAttempts) return;

    attempts += 1;
    const hash = await sha256(`${choiceConfig.salt}:${answer}`);
    const isCorrect = hash === choiceConfig.answerHash;

    if (targetButton) {
        targetButton.classList.add(isCorrect ? 'correct' : 'incorrect');
    }

    if (isCorrect) {
        solved = true;
        disableChoices();
        const message = 'Верно. Ответ выбран правильно.';
        setFeedback(message, 'correct');
        await saveLocalResult(answer, true, message);
        return;
    }

    const message = attempts >= choiceConfig.maxAttempts
        ? 'Попытки закончились. Вернись к теории и проверь ключевое понятие.'
        : `Пока неверно. Подумай ещё раз. Попыток: ${attempts}/${choiceConfig.maxAttempts}`;

    if (attempts >= choiceConfig.maxAttempts) {
        disableChoices();
    }
    setFeedback(message, 'incorrect');
    await saveLocalResult(answer, false, message);
}

if (choiceConfig.mode === 'multiple_choice') {
    submitButton.addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('.choice-checkbox input:checked'))
            .map((input) => input.value)
            .sort();
        await handleAnswer(selected.join(','));
    });
} else {
    buttons.forEach((button) => {
        button.addEventListener('click', async () => {
            await handleAnswer(button.dataset.answer, button);
        });
    });
}
