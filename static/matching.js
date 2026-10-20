const matchingConfig = window.MATCHING_CONFIG;
const matchingBoard = document.getElementById('matchingBoard');
const matchingLines = document.getElementById('matchingLines');
const matchingFeedback = document.getElementById('matchingFeedback');
const matchingSubmit = document.getElementById('matchingSubmit');
const matchingClear = document.getElementById('matchingClear');
const leftNodes = Array.from(document.querySelectorAll('.matching-node-left'));
const rightNodes = Array.from(document.querySelectorAll('.matching-node-right'));

let matchingAttempts = 0;
let matchingSolved = false;
let selectedLeft = null;
let dragLine = null;
let suppressLeftClickUntil = 0;
const connections = new Map();

function matchingEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
}

async function matchingSha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function saveMatchingResult(answer, isCorrect, message) {
    await fetch('/api/local-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            block_id: matchingConfig.blockId,
            answer,
            solved: isCorrect,
            feedback: message
        })
    });
}

function setMatchingFeedback(text, status) {
    matchingFeedback.textContent = text;
    matchingFeedback.className = `muted-text choice-feedback ${status || ''}`;
}

function pointForNode(node, side) {
    const boardRect = matchingBoard.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
        x: side === 'left' ? nodeRect.right - boardRect.left : nodeRect.left - boardRect.left,
        y: nodeRect.top + nodeRect.height / 2 - boardRect.top
    };
}

function curvePath(from, to) {
    const distance = Math.max(70, Math.abs(to.x - from.x) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
}

function createSvgPath(className) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', className);
    path.setAttribute('fill', 'none');
    matchingLines.appendChild(path);
    return path;
}

function resizeSvg() {
    if (!matchingBoard || !matchingLines) return;
    const rect = matchingBoard.getBoundingClientRect();
    matchingLines.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    matchingLines.setAttribute('width', rect.width);
    matchingLines.setAttribute('height', rect.height);
}

function rightNodeByValue(value) {
    return document.querySelector(`.matching-node-right[data-right="${matchingEscape(value)}"]`);
}

function leftNodeByValue(value) {
    return document.querySelector(`.matching-node-left[data-left="${matchingEscape(value)}"]`);
}

function drawConnections(status) {
    resizeSvg();
    matchingLines.innerHTML = '';
    connections.forEach((rightValue, leftValue) => {
        const leftNode = leftNodeByValue(leftValue);
        const rightNode = rightNodeByValue(rightValue);
        if (!leftNode || !rightNode) return;

        const path = createSvgPath(`matching-line ${status || ''}`);
        path.setAttribute('data-left', leftValue);
        path.setAttribute('data-right', rightValue);
        path.setAttribute('d', curvePath(pointForNode(leftNode, 'left'), pointForNode(rightNode, 'right')));
    });
}

function refreshNodeState(status) {
    leftNodes.forEach((node) => {
        const hasConnection = connections.has(node.dataset.left);
        node.classList.toggle('connected', hasConnection);
        node.classList.toggle('selected', selectedLeft === node);
        node.classList.remove('correct', 'incorrect');
        if (status && hasConnection) node.classList.add(status);
    });
    rightNodes.forEach((node) => {
        const hasConnection = Array.from(connections.values()).includes(node.dataset.right);
        node.classList.toggle('connected', hasConnection);
        node.classList.remove('correct', 'incorrect');
        if (status && hasConnection) node.classList.add(status);
    });
}

function redraw(status) {
    drawConnections(status);
    refreshNodeState(status);
}

function connectNodes(leftNode, rightNode) {
    if (matchingSolved || !leftNode || !rightNode) return;
    const leftValue = leftNode.dataset.left;
    const rightValue = rightNode.dataset.right;

    for (const [connectedLeft, connectedRight] of connections.entries()) {
        if (connectedRight === rightValue && connectedLeft !== leftValue) {
            connections.delete(connectedLeft);
        }
    }

    connections.set(leftValue, rightValue);
    selectedLeft = null;
    redraw();
}

function clearConnections() {
    if (matchingSolved) return;
    connections.clear();
    selectedLeft = null;
    redraw();
    setMatchingFeedback(`Попыток: ${matchingAttempts}/${matchingConfig.maxAttempts}`, '');
}

function disableMatching() {
    [...leftNodes, ...rightNodes].forEach((node) => {
        node.disabled = true;
    });
    matchingSubmit.disabled = true;
    if (matchingClear) matchingClear.disabled = true;
}

function getMatchingAnswer() {
    return Array.from(connections.entries())
        .map(([left, right]) => ({ left, right }))
        .sort((a, b) => (a.left < b.left ? -1 : a.left > b.left ? 1 : 0))
        .map((pair) => `${pair.left}=>${pair.right}`)
        .join('|');
}

function clientPoint(event) {
    const source = event.touches ? event.touches[0] : event;
    const boardRect = matchingBoard.getBoundingClientRect();
    return {
        x: source.clientX - boardRect.left,
        y: source.clientY - boardRect.top
    };
}

function beginDrag(leftNode, event) {
    if (matchingSolved) return;
    selectedLeft = leftNode;
    redraw();
    resizeSvg();
    dragLine = createSvgPath('matching-line draft');
    updateDragLine(event);
}

function updateDragLine(event) {
    if (!dragLine || !selectedLeft) return;
    dragLine.setAttribute('d', curvePath(pointForNode(selectedLeft, 'left'), clientPoint(event)));
}

function finishDrag(event) {
    if (!dragLine || !selectedLeft) return;
    const source = event.changedTouches ? event.changedTouches[0] : event;
    const target = document.elementFromPoint(source.clientX, source.clientY)?.closest('.matching-node-right');
    dragLine.remove();
    dragLine = null;
    if (target) {
        suppressLeftClickUntil = Date.now() + 250;
        connectNodes(selectedLeft, target);
    } else {
        selectedLeft = null;
        redraw();
    }
}

function shuffleRightColumn() {
    const column = document.querySelector('.matching-right');
    if (!column) return;
    const nodes = Array.from(column.children);
    for (let index = nodes.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        column.appendChild(nodes[randomIndex]);
        nodes.splice(randomIndex, 1);
    }
}

leftNodes.forEach((node) => {
    node.addEventListener('click', () => {
        if (Date.now() < suppressLeftClickUntil) return;
        if (matchingSolved) return;
        selectedLeft = selectedLeft === node ? null : node;
        redraw();
    });
    node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        node.setPointerCapture(event.pointerId);
        beginDrag(node, event);
    });
    node.addEventListener('pointermove', updateDragLine);
    node.addEventListener('pointerup', finishDrag);
    node.addEventListener('pointercancel', finishDrag);
});

rightNodes.forEach((node) => {
    node.addEventListener('click', () => {
        if (!selectedLeft || matchingSolved) return;
        connectNodes(selectedLeft, node);
    });
});

matchingClear?.addEventListener('click', clearConnections);

matchingSubmit.addEventListener('click', async () => {
    if (matchingSolved || matchingAttempts >= matchingConfig.maxAttempts) return;

    if (connections.size !== leftNodes.length) {
        setMatchingFeedback('Соедини все пары перед проверкой.', 'incorrect');
        return;
    }

    matchingAttempts += 1;
    const answer = getMatchingAnswer();
    const answerHash = await matchingSha256(`${matchingConfig.salt}:${answer}`);
    const isCorrect = answerHash === matchingConfig.answerHash;

    redraw(isCorrect ? 'correct' : 'incorrect');

    if (isCorrect) {
        matchingSolved = true;
        disableMatching();
        const message = 'Верно. Все соответствия выбраны правильно.';
        setMatchingFeedback(message, 'correct');
        await saveMatchingResult(answer, true, message);
        return;
    }

    const message = matchingAttempts >= matchingConfig.maxAttempts
        ? 'Попытки закончились. Вернись к материалу и сравни определения ещё раз.'
        : `Пока не все пары совпали. Проверь связи. Попыток: ${matchingAttempts}/${matchingConfig.maxAttempts}`;

    if (matchingAttempts >= matchingConfig.maxAttempts) {
        disableMatching();
    }
    setMatchingFeedback(message, 'incorrect');
    await saveMatchingResult(answer, false, message);
});

shuffleRightColumn();
resizeSvg();
redraw();
window.addEventListener('resize', () => redraw());
document.addEventListener('scroll', () => redraw(), true);
