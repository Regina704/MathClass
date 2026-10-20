// ================== ГЛОБАЛЬНОЕ СОСТОЯНИЕ ==================
let pyodideWorker = null;
let pyodideMain = null;
let isRunning = false;
let isPygameRunning = false;
let interruptBuffer = null;
let currentRunId = 0;
let workerReadyPromise = null;
let activeInputView = null;
let activeInputElement = null;

const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const checkBtn = document.getElementById('checkBtn');
const labSaveBtn = document.getElementById('labSaveBtn');
const outputTextDiv = document.getElementById('outputText');
let outputCanvas = document.getElementById('canvas');
const rightPanel = document.getElementById('rightPanel');
const mainResizeHandle = document.getElementById('mainResizeHandle');
const consoleSection = document.querySelector('.console-section');
const chatSection = document.querySelector('.chat-section');
const consoleChatResizeHandle = document.getElementById('consoleChatResizeHandle');
const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const taskSlider = document.getElementById('taskSlider');
const sliderTab = document.getElementById('sliderTab');
const successOverlay = document.getElementById('successOverlay');
const themeToggle = document.getElementById('themeToggle');
const sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
const labProject = window.LAB_PROJECT || null;

// Буфер прерываний доступен только на страницах с cross-origin isolation.
if (typeof SharedArrayBuffer !== 'undefined') {
    interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
}

// ================== MONACO ==================
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.34.1/min/vs' } });
require(['vs/editor/editor.main'], function() {
    applySavedTheme();
    const starterCode = window.LESSON_CONFIG?.starterCode || `name = input("Имя: ")
print("Привет,", name)`;
    window.editor = monaco.editor.create(document.getElementById('editor'), {
        value: starterCode,
        language: 'python',
        theme: document.body.classList.contains('light') ? 'vs' : 'vs-dark',
        automaticLayout: true
    });
    initResizeHandles();
});

// ================== УТИЛИТЫ ==================
function isPygameCode(code) {
    return /import\s+pygame/.test(code);
}

function appendOutput(text, isError = false) {
    const span = document.createElement('span');
    if (isError) span.style.color = 'red';
    span.innerText += text;
    outputTextDiv.appendChild(span);
    outputTextDiv.scrollTop = outputTextDiv.scrollHeight;
}

function getEditorCode() {
    return window.editor ? window.editor.getValue() : '';
}

function appendChatMessage(role, text) {
    if (!chatMessages) return;
    const message = document.createElement('div');
    message.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'Вы' : role === 'system' ? '✓' : 'AI';

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = text;

    message.appendChild(avatar);
    message.appendChild(content);
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function notifyByte(eventDetail) {
    window.dispatchEvent(new CustomEvent('byte:task-check', {
        detail: {
            blockId: window.LESSON_CONFIG?.blockId || null,
            taskText: window.LESSON_CONFIG?.taskText || '',
            code: getEditorCode(),
            ...eventDetail
        }
    }));
}

function setTaskStatus(status) {
    taskSlider.classList.remove('correct', 'incorrect');
    if (status) {
        taskSlider.classList.add(status);
    }
}

function showSuccessOverlay() {
    successOverlay.classList.add('show');
    window.setTimeout(() => successOverlay.classList.remove('show'), 1800);
}

async function saveLabProjectCode() {
    if (!labProject || !labSaveBtn) return;
    const previousText = labSaveBtn.textContent;
    labSaveBtn.disabled = true;
    labSaveBtn.textContent = '…';
    try {
        const response = await fetch(`/api/laboratory/projects/${labProject.id}/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: getEditorCode() })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Не удалось сохранить проект');
        }
        labSaveBtn.textContent = '✓';
        window.setTimeout(() => {
            labSaveBtn.textContent = previousText;
        }, 1200);
    } catch (error) {
        appendOutput(`\nОшибка сохранения проекта: ${error.message}\n`, true);
        labSaveBtn.textContent = previousText;
    } finally {
        window.setTimeout(() => {
            labSaveBtn.disabled = false;
        }, 250);
    }
}

function setTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light', isLight);
    localStorage.setItem('matematichno-theme', isLight ? 'light' : 'dark');
    themeToggle.textContent = isLight ? '☀' : '☾';
    themeToggle.title = isLight ? 'Включить тёмную тему' : 'Включить светлую тему';

    if (window.monaco && window.editor) {
        monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark');
    }
}

function applySavedTheme() {
    const savedTheme = localStorage.getItem('matematichno-theme') || 'dark';
    setTheme(savedTheme);
}

function appendInputPrompt(promptText, inputBuffer) {
    const view = new Int32Array(inputBuffer);
    activeInputView = view;

    const line = document.createElement('div');
    line.className = 'console-input-line';

    const prompt = document.createElement('span');
    prompt.innerText = promptText || '';

    const input = document.createElement('input');
    input.autofocus = true;
    input.spellcheck = false;

    line.appendChild(prompt);
    line.appendChild(input);
    outputTextDiv.appendChild(line);
    outputTextDiv.scrollTop = outputTextDiv.scrollHeight;
    input.focus();
    activeInputElement = input;

    input.addEventListener('keydown', function handler(e) {
        if (e.key !== 'Enter') return;

        const value = input.value;
        const maxLength = view.length - 2;
        const safeValue = value.slice(0, maxLength);

        view[1] = safeValue.length;
        for (let i = 0; i < safeValue.length; i++) {
            view[2 + i] = safeValue.charCodeAt(i);
        }

        line.innerText = `${promptText || ''}${value}\n`;
        activeInputView = null;
        activeInputElement = null;
        Atomics.store(view, 0, 1);
        Atomics.notify(view, 0);
        input.removeEventListener('keydown', handler);
    });
}

function setIsRunningState(running) {
    isRunning = running;
    stopBtn.disabled = !running;
}

setIsRunningState(false);

window.__pygameShouldStop = () => (interruptBuffer && interruptBuffer[0] === 2) || !isPygameRunning;

function refreshEditorLayout() {
    if (window.editor) {
        window.editor.layout();
    }
}

function restoreEditorFocus() {
    window.setTimeout(() => {
        if (window.editor) {
            window.editor.focus();
            window.editor.layout();
        }
    }, 0);
}

function resetPygameCanvas() {
    if (!outputCanvas || !outputCanvas.parentNode) return;

    const freshCanvas = outputCanvas.cloneNode(false);
    freshCanvas.id = 'canvas';
    freshCanvas.style.display = 'none';
    outputCanvas.replaceWith(freshCanvas);
    outputCanvas = freshCanvas;
}

function initResizeHandles() {
    if (mainResizeHandle && rightPanel) {
        mainResizeHandle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            mainResizeHandle.classList.add('dragging');
            mainResizeHandle.setPointerCapture(event.pointerId);

            const onMove = (moveEvent) => {
                const minRightWidth = 280;
                const maxRightWidth = Math.floor(window.innerWidth * 0.75);
                const nextWidth = Math.min(
                    Math.max(window.innerWidth - moveEvent.clientX, minRightWidth),
                    maxRightWidth
                );
                rightPanel.style.width = `${nextWidth}px`;
                refreshEditorLayout();
            };

            const onUp = () => {
                mainResizeHandle.classList.remove('dragging');
                mainResizeHandle.removeEventListener('pointermove', onMove);
                mainResizeHandle.removeEventListener('pointerup', onUp);
                refreshEditorLayout();
            };

            mainResizeHandle.addEventListener('pointermove', onMove);
            mainResizeHandle.addEventListener('pointerup', onUp);
        });
    }

    if (consoleChatResizeHandle && consoleSection && chatSection && rightPanel) {
        consoleChatResizeHandle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            consoleChatResizeHandle.classList.add('dragging');
            consoleChatResizeHandle.setPointerCapture(event.pointerId);

            const panelRect = rightPanel.getBoundingClientRect();
            const minConsoleHeight = 120;
            const minChatHeight = 120;

            const onMove = (moveEvent) => {
                const headerOffset = consoleSection.querySelector('.console-header').offsetHeight;
                const availableHeight = panelRect.height - consoleChatResizeHandle.offsetHeight;
                const nextConsoleHeight = Math.min(
                    Math.max(moveEvent.clientY - panelRect.top, minConsoleHeight),
                    availableHeight - minChatHeight
                );
                consoleSection.style.flex = 'none';
                consoleSection.style.height = `${Math.max(nextConsoleHeight, headerOffset + 40)}px`;
                chatSection.style.height = `${availableHeight - nextConsoleHeight}px`;
                refreshEditorLayout();
            };

            const onUp = () => {
                consoleChatResizeHandle.classList.remove('dragging');
                consoleChatResizeHandle.removeEventListener('pointermove', onMove);
                consoleChatResizeHandle.removeEventListener('pointerup', onUp);
            };

            consoleChatResizeHandle.addEventListener('pointermove', onMove);
            consoleChatResizeHandle.addEventListener('pointerup', onUp);
        });
    }
}

// ================== STOP ==================
function stopExecution() {
    currentRunId++;
    if (interruptBuffer) {
        interruptBuffer[0] = 2;
    }
    if (activeInputView) {
        Atomics.store(activeInputView, 0, 2);
        Atomics.notify(activeInputView, 0);
        activeInputView = null;
    }
    if (activeInputElement) {
        activeInputElement.disabled = true;
        activeInputElement = null;
    }
    if (isPygameRunning) {
        isPygameRunning = false;
    } else if (pyodideWorker) {
        pyodideWorker.postMessage({ type: 'interrupt' });
    }
    setIsRunningState(false);
}

// ================== WORKER ==================
function createWorker() {
    const code = `
let pyodide;
let interruptBuffer;
let ready = false;
let currentRunId = null;
let stdoutBuffer = '';
let stderrBuffer = '';
let lastStdoutFlush = 0;
let lastStderrFlush = 0;
const installedRuntimePackages = new Set();
const stdoutDecoder = new TextDecoder('utf-8');
const stderrDecoder = new TextDecoder('utf-8');

function flushStdout(force = false) {
    if (force) {
        stdoutBuffer += stdoutDecoder.decode();
    }
    if (!stdoutBuffer) return;
    const now = performance.now();
    if (!force && stdoutBuffer.length < 256 && now - lastStdoutFlush < 16) return;
    self.postMessage({ type: 'stdout', text: stdoutBuffer, runId: currentRunId });
    stdoutBuffer = '';
    lastStdoutFlush = now;
}

function flushStderr(force = false) {
    if (force) {
        stderrBuffer += stderrDecoder.decode();
    }
    if (!stderrBuffer) return;
    const now = performance.now();
    if (!force && stderrBuffer.length < 256 && now - lastStderrFlush < 16) return;
    self.postMessage({ type: 'stderr', text: stderrBuffer, runId: currentRunId });
    stderrBuffer = '';
    lastStderrFlush = now;
}

function decodeStdoutByte(byte) {
    return stdoutDecoder.decode(new Uint8Array([byte]), { stream: true });
}

function decodeStderrByte(byte) {
    return stderrDecoder.decode(new Uint8Array([byte]), { stream: true });
}

self.readInput = (promptText) => {
    flushStdout(true);
    flushStderr(true);

    const inputBuffer = new SharedArrayBuffer(16384);
    const view = new Int32Array(inputBuffer);
    Atomics.store(view, 0, 0);

    self.postMessage({
        type: 'input',
        prompt: String(promptText ?? ''),
        buffer: inputBuffer,
        runId: currentRunId
    });

    while (Atomics.load(view, 0) === 0) {
        Atomics.wait(view, 0, 0, 100);
        if (interruptBuffer && interruptBuffer[0] === 2) {
            throw new Error('KeyboardInterrupt');
        }
    }

    if (Atomics.load(view, 0) === 2) {
        throw new Error('KeyboardInterrupt');
    }

    const length = Atomics.load(view, 1);
    let value = '';
    for (let i = 0; i < length; i++) {
        value += String.fromCharCode(Atomics.load(view, 2 + i));
    }
    return value;
};

async function installRuntimeHooks() {
    pyodide.setStdout({
        raw: (byte) => {
            stdoutBuffer += decodeStdoutByte(byte);
            flushStdout(byte === 10);
        }
    });

    pyodide.setStderr({
        raw: (byte) => {
            stderrBuffer += decodeStderrByte(byte);
            flushStderr(byte === 10);
        }
    });

    await pyodide.runPythonAsync(\`
import builtins
from js import readInput

def __browser_input(prompt=""):
    return readInput(str(prompt))

builtins.input = __browser_input
\`);
}

function needsVkApi(code) {
    return new RegExp('(^|\\\\n)\\\\s*(import\\\\s+vk_api\\\\b|from\\\\s+vk_api\\\\b)').test(code);
}

async function ensureRuntimePackages(code) {
    if (!needsVkApi(code) || installedRuntimePackages.has('vk_api')) return;
    self.postMessage({ type: 'stdout', text: 'Устанавливаю библиотеку vk_api...\\n', runId: currentRunId });
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');
    try {
        await micropip.install('vk-api');
    } catch (firstError) {
        await micropip.install('vk_api');
    }
    installedRuntimePackages.add('vk_api');
    self.postMessage({ type: 'stdout', text: 'vk_api установлена.\\n', runId: currentRunId });
}

self.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === 'init') {
        importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');
        pyodide = await loadPyodide();
        if (interruptBuffer) {
            pyodide.setInterruptBuffer(interruptBuffer);
        }
        await installRuntimeHooks();
        ready = true;
        self.postMessage({ type: 'ready' });
    }

    if (msg.type === 'setInterrupt') {
        interruptBuffer = msg.buffer;
        if (pyodide) {
            pyodide.setInterruptBuffer(interruptBuffer);
        }
    }

    if (msg.type === 'interrupt') {
        if (interruptBuffer) {
            interruptBuffer[0] = 2;
        }
    }

    if (msg.type === 'run') {
        if (!ready || !pyodide) {
            self.postMessage({ type: 'error', text: 'Python environment not ready', runId: msg.runId });
            return;
        }
        currentRunId = msg.runId;
        stdoutBuffer = '';
        stderrBuffer = '';
        try {
            await ensureRuntimePackages(msg.code);
            await pyodide.runPythonAsync(msg.code);
            flushStdout(true);
            flushStderr(true);
            self.postMessage({ type: 'done', runId: msg.runId });
        } catch (e) {
            flushStdout(true);
            flushStderr(true);
            let errorText = e.message || String(e);
            if (needsVkApi(msg.code)) {
                errorText += '\\n\\nПримечание: vk_api запускается внутри браузера через Pyodide. Импорт библиотеки поддерживается, но реальные запросы к VK могут блокироваться CORS или требовать серверного запуска, чтобы безопасно хранить токен.';
            }
            self.postMessage({ type: 'error', text: errorText, runId: msg.runId });
        }
    }
};
`;

    const blob = new Blob([code]);
    pyodideWorker = new Worker(URL.createObjectURL(blob));

    pyodideWorker.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === 'ready') {
            if (interruptBuffer) {
                pyodideWorker.postMessage({ type: 'setInterrupt', buffer: interruptBuffer });
            }
            if (workerReadyPromise) workerReadyPromise.resolve();
            return;
        }

        if (msg.runId !== undefined && msg.runId !== currentRunId) return;

        if (msg.type === 'stdout') appendOutput(msg.text);
        if (msg.type === 'stderr') appendOutput(msg.text, true);
        if (msg.type === 'input') appendInputPrompt(msg.prompt, msg.buffer);
        if (msg.type === 'done') setIsRunningState(false);
        if (msg.type === 'error') {
            appendOutput(msg.text + '\\n', true);
            setIsRunningState(false);
        }
    };

    pyodideWorker.postMessage({ type: 'init' });
    workerReadyPromise = {};
    workerReadyPromise.promise = new Promise((resolve) => {
        workerReadyPromise.resolve = resolve;
    });
}

// ================== PYGAME ==================
async function initPyodideMain() {
    if (pyodideMain) return;

    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js';
        script.onload = async () => {
            pyodideMain = await loadPyodide();
            await pyodideMain.loadPackage(['micropip']);
            const micropip = pyodideMain.pyimport('micropip');
            await micropip.install('pygame-ce');
            const stdoutDecoder = new TextDecoder('utf-8');
            const stderrDecoder = new TextDecoder('utf-8');
            let stdoutBuffer = '';
            let stderrBuffer = '';
            pyodideMain.setStdout({
                raw: (byte) => {
                    stdoutBuffer += stdoutDecoder.decode(new Uint8Array([byte]), { stream: true });
                    if (byte === 10) {
                        appendOutput(stdoutBuffer);
                        stdoutBuffer = '';
                    }
                }
            });
            pyodideMain.setStderr({
                raw: (byte) => {
                    stderrBuffer += stderrDecoder.decode(new Uint8Array([byte]), { stream: true });
                    if (byte === 10) {
                        appendOutput(stderrBuffer, true);
                        stderrBuffer = '';
                    }
                }
            });
            resolve();
        };
        document.head.appendChild(script);
    });
}

function transformPygameCode(code) {
    const lines = code.replace(/\r\n/g, '\n').split('\n');
    const syncBlockIndents = [];
    const transformedLines = [
        'import asyncio',
        'import os',
        'import time as __browser_time',
        'import warnings',
        'from js import __pygameShouldStop',
        'os.environ["PYGAME_HIDE_SUPPORT_PROMPT"] = "1"',
        'warnings.filterwarnings("ignore", message="no fc_cache font cache file.*")',
        '',
        'def __browser_should_stop():',
        '    return bool(__pygameShouldStop())',
        '',
        'async def __browser_sleep(seconds=0):',
        '    end_time = __browser_time.monotonic() + max(float(seconds or 0), 0)',
        '    while True:',
        '        if __browser_should_stop():',
        '            return False',
        '        remaining = end_time - __browser_time.monotonic()',
        '        if remaining <= 0:',
        '            break',
        '        await asyncio.sleep(min(remaining, 0.05))',
        '    return not __browser_should_stop()',
        '',
        'async def __main__():',
        '    import time',
        ''
    ];

    for (const line of lines) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        while (
            syncBlockIndents.length &&
            trimmed &&
            indent.length <= syncBlockIndents[syncBlockIndents.length - 1]
        ) {
            syncBlockIndents.pop();
        }

        const insideSyncBlock = syncBlockIndents.length > 0;
        if (/^\s*(def|class)\s+.*:\s*(#.*)?$/.test(line)) {
            syncBlockIndents.push(indent.length);
            transformedLines.push('    ' + line);
            continue;
        }

        const sleepMatch = line.match(/^(\s*)(time\.)?sleep\s*\((.*)\)\s*$/);
        const clockTickMatch = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_\.]*)\.tick\s*\((.*)\)\s*$/);
        const pygameDelayMatch = line.match(/^(\s*)pygame\.time\.(wait|delay)\s*\((.*)\)\s*$/);

        if (!insideSyncBlock && sleepMatch) {
            transformedLines.push(`    ${sleepMatch[1]}if not await __browser_sleep(${sleepMatch[3] || '0'}):`);
            transformedLines.push(`    ${sleepMatch[1]}    return`);
            continue;
        }

        if (!insideSyncBlock && clockTickMatch) {
            const fpsExpression = clockTickMatch[3] || '60';
            transformedLines.push(`    ${clockTickMatch[1]}if not await __browser_sleep(1 / max(float(${fpsExpression} or 60), 1)):`);
            transformedLines.push(`    ${clockTickMatch[1]}    return`);
            continue;
        }

        if (!insideSyncBlock && pygameDelayMatch) {
            transformedLines.push(`    ${pygameDelayMatch[1]}if not await __browser_sleep((${pygameDelayMatch[3] || '0'}) / 1000):`);
            transformedLines.push(`    ${pygameDelayMatch[1]}    return`);
            continue;
        }

        transformedLines.push('    ' + line);

        if (!insideSyncBlock && /^\s*(while|for)\s+.*:\s*(#.*)?$/.test(line)) {
            transformedLines.push(`    ${indent}    if __browser_should_stop():`);
            transformedLines.push(`    ${indent}        break`);
            transformedLines.push(`    ${indent}    await asyncio.sleep(0)`);
        }
    }

    transformedLines.push('');
    transformedLines.push('await __main__()');
    return transformedLines.join('\n');
}

async function runPygame(code) {
    await initPyodideMain();

    const canvas = outputCanvas;
    canvas.id = 'canvas';
    pyodideMain.canvas.setCanvas2D(canvas);

    outputCanvas.style.display = 'block';
    outputTextDiv.style.display = 'none';
    isPygameRunning = true;

    const transformedCode = transformPygameCode(code);
    let stoppedByUser = false;
    let finalFrame = null;

    try {
        await pyodideMain.runPythonAsync(transformedCode);
        stoppedByUser = interruptBuffer && interruptBuffer[0] === 2;
    } catch (e) {
        stoppedByUser = interruptBuffer && interruptBuffer[0] === 2;
        if (e.message && !e.message.includes('KeyboardInterrupt')) {
            outputTextDiv.style.display = 'block';
            appendOutput(e.message, true);
        }
    } finally {
        isPygameRunning = false;
        if (!stoppedByUser && outputCanvas.width > 0 && outputCanvas.height > 0) {
            try {
                finalFrame = outputCanvas.toDataURL('image/png');
            } catch (_) {
                finalFrame = null;
            }
        }
        try {
            await pyodideMain.runPythonAsync(`
import pygame

try:
    pygame.event.set_grab(False)
except Exception:
    pass

try:
    pygame.mouse.set_visible(True)
except Exception:
    pass

try:
    pygame.mixer.quit()
except Exception:
    pass

try:
    pygame.display.quit()
except Exception:
    pass

try:
    pygame.quit()
except Exception:
            pass
`);
        } catch (_) {
            // Pygame may be only partially initialized after a failed import or early syntax error.
        }
        if (stoppedByUser) {
            outputTextDiv.style.display = 'block';
            resetPygameCanvas();
        } else {
            if (finalFrame) {
                const context = outputCanvas.getContext('2d');
                const image = new Image();
                image.onload = () => {
                    outputCanvas.width = image.width;
                    outputCanvas.height = image.height;
                    context.drawImage(image, 0, 0);
                };
                image.src = finalFrame;
            }
            outputCanvas.style.display = 'block';
        }
        restoreEditorFocus();
        setIsRunningState(false);
    }
}

// ================== RUN ==================
async function executeCode() {
    const code = getEditorCode();
    if (!code.trim()) return;

    outputTextDiv.innerHTML = '';
    outputTextDiv.style.display = 'block';
    outputCanvas.style.display = 'none';
    setIsRunningState(true);
    currentRunId++;
    if (!interruptBuffer) {
        appendOutput('Эта страница открыта без SharedArrayBuffer. Обнови страницу, чтобы включились заголовки изоляции для запуска Python.\\n', true);
        setIsRunningState(false);
        return;
    }
    interruptBuffer[0] = 0;

    if (isPygameCode(code)) {
        runPygame(code);
    } else {
        if (!pyodideWorker || !workerReadyPromise) {
            createWorker();
        }
        await workerReadyPromise.promise;
        pyodideWorker.postMessage({ type: 'run', code: code, runId: currentRunId });
    }
}

async function restartCode() {
    if (isRunning) {
        stopExecution();
        await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    executeCode();
}

async function sendChatMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    userInput.value = '';
    appendChatMessage('user', message);
    sendBtn.disabled = true;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                session_id: sessionId,
                code: getEditorCode(),
                block_id: window.LESSON_CONFIG?.blockId || null
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Не удалось получить ответ');
        }
        appendChatMessage('assistant', data.reply);
    } catch (error) {
        appendChatMessage('system', `Ошибка чата: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
        userInput.focus();
    }
}

async function checkSolution() {
    const code = getEditorCode().trim();
    if (!code) {
        appendChatMessage('system', 'Сначала напиши решение в редакторе.');
        setTaskStatus('incorrect');
        notifyByte({
            status: 'empty',
            solved: false,
            message: 'Сначала напиши решение в редакторе.'
        });
        return;
    }

    checkBtn.disabled = true;
    setTaskStatus(null);
    appendChatMessage('system', 'Проверяю решение...');
    notifyByte({
        status: 'checking',
        message: 'Проверяю решение...'
    });

    try {
        const response = await fetch('/api/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                block_id: window.LESSON_CONFIG?.blockId || null
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Не удалось проверить решение');
        }

        if (data.solved) {
            setTaskStatus('correct');
            showSuccessOverlay();
            appendChatMessage('assistant', data.message || 'Отлично, задача решена верно. Ты хорошо справился.');
            notifyByte({
                status: 'checked',
                solved: true,
                message: data.message || 'Отлично, задача решена верно. Ты хорошо справился.'
            });
        } else {
            setTaskStatus('incorrect');
            appendChatMessage('assistant', data.message || 'Пока решение не проходит проверку. Посмотри на условие и проверь, что функция возвращает новый список только с чётными числами.');
            notifyByte({
                status: 'checked',
                solved: false,
                message: data.message || 'Пока решение не проходит проверку. Посмотри на условие и проверь задачу ещё раз.'
            });
        }
    } catch (error) {
        setTaskStatus('incorrect');
        appendChatMessage('system', `Ошибка проверки: ${error.message}`);
        notifyByte({
            status: 'error',
            solved: false,
            message: `Ошибка проверки: ${error.message}`
        });
    } finally {
        checkBtn.disabled = false;
        restoreEditorFocus();
    }
}

runBtn.onclick = restartCode;
stopBtn.onclick = stopExecution;
if (labProject && checkBtn) {
    checkBtn.style.display = 'none';
}
if (!labProject && checkBtn) {
    checkBtn.onclick = checkSolution;
}
if (labSaveBtn) {
    labSaveBtn.onclick = saveLabProjectCode;
}
if (sendBtn && userInput) {
    sendBtn.onclick = sendChatMessage;
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            sendChatMessage();
        }
    });
}
sliderTab.onclick = () => {
    taskSlider.classList.toggle('open');
    const isOpen = taskSlider.classList.contains('open');
    sliderTab.title = isOpen ? 'Скрыть задачу' : 'Показать задачу';
    sliderTab.setAttribute('aria-label', sliderTab.title);
    refreshEditorLayout();
};
themeToggle.onclick = () => {
    setTheme(document.body.classList.contains('light') ? 'dark' : 'light');
};
