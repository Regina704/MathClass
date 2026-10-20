const stepSolutionConfig = window.STEP_SOLUTION_CONFIG;
const stepSolutionForm = document.getElementById('stepSolutionForm');
const stepSolutionFeedback = document.getElementById('stepSolutionFeedback');
const stepInputs = Array.from(document.querySelectorAll('[data-step-index]'));

let stepAttempts = 0;
let stepSolved = false;

async function checkStepSolution(answers) {
    const response = await fetch('/api/step-solution-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            block_id: stepSolutionConfig.blockId,
            answers
        })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Не удалось проверить решение');
    }
    return data;
}

function setStepFeedback(text, status) {
    stepSolutionFeedback.textContent = text;
    stepSolutionFeedback.className = `muted-text choice-feedback ${status || ''}`;
}

function disableStepSolution() {
    stepInputs.forEach((input) => {
        input.disabled = true;
    });
    stepSolutionForm.querySelector('button').disabled = true;
}

stepSolutionForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (stepSolved || stepAttempts >= stepSolutionConfig.maxAttempts) return;

    const answers = stepInputs.map((input) => input.value);
    if (answers.some((answer) => !answer.trim())) {
        setStepFeedback('Заполни все шаги перед проверкой.', 'incorrect');
        return;
    }

    stepAttempts += 1;
    try {
        const result = await checkStepSolution(answers);
        result.results.forEach((item) => {
            const input = stepInputs[item.index];
            if (!input) return;
            input.classList.toggle('correct', item.correct);
            input.classList.toggle('incorrect', !item.correct);
        });

        if (result.solved) {
            stepSolved = true;
            disableStepSolution();
            setStepFeedback(result.message, 'correct');
            return;
        }

        const message = stepAttempts >= stepSolutionConfig.maxAttempts
            ? `Попытки закончились. ${result.message}`
            : `${result.message} Попыток: ${stepAttempts}/${stepSolutionConfig.maxAttempts}`;
        if (stepAttempts >= stepSolutionConfig.maxAttempts) {
            disableStepSolution();
        }
        setStepFeedback(message, 'incorrect');
    } catch (error) {
        setStepFeedback(error.message, 'incorrect');
    }
});
