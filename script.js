const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const startGameBtn = document.getElementById('startGameBtn');
const clearCanvasBtn = document.getElementById('clearCanvasBtn');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const wordToDrawDisplay = document.getElementById('wordToDraw');
const currentWordSpan = document.getElementById('currentWordDisplay');
const messageBox = document.getElementById('message');
const drawingTools = document.getElementById('drawingTools');
const colorPicker = document.getElementById('colorPicker');
const lineWidthControl = document.getElementById('lineWidth');
const lineWidthDisplay = document.getElementById('lineWidthDisplay');
const chatBox = document.getElementById('chatBox');
const playerList = document.getElementById('playerList');
const timerDisplay = document.getElementById('timerDisplay');
const timeRemainingSpan = document.getElementById('timeRemaining');
const socket = io();
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentColor = colorPicker.value;
let currentLineWidth = parseInt(lineWidthControl.value);
let mySocketId = null;
let currentDrawerId = null;
function setupDrawingContext(color, width) {
    ctx.strokeStyle = color || currentColor;
    ctx.lineWidth = width || currentLineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
}
function drawLine(data) {
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(data.lastX, data.lastY);
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
}
function startDrawing(e) {
    if (mySocketId !== currentDrawerId) return;
    isDrawing = true;
    [lastX, lastY] = getCanvasCoordinates(e);
    setupDrawingContext();
}
function draw(e) {
    if (!isDrawing || mySocketId !== currentDrawerId) return;
    e.preventDefault();
    const [x, y] = getCanvasCoordinates(e);
    const drawingData = {
        x: x,
        y: y,
        lastX: lastX,
        lastY: lastY,
        color: currentColor,
        width: currentLineWidth
    };
    drawLine(drawingData);
    socket.emit('drawing', drawingData);
    [lastX, lastY] = [x, y];
}
function stopDrawing() {
    isDrawing = false;
}
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } 
    else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
}
function setMessage(msg) {
    messageBox.textContent = msg;
}
function addChatMessage(data) {
    const msgElement = document.createElement('div');
    msgElement.classList.add('chat-message');
    msgElement.textContent = `${data.user}: ${data.text}`;
    if (data.type === 'system') msgElement.classList.add('system');
    else if (data.type === 'drawer') msgElement.classList.add('drawer-message');
    else if (data.type === 'correct') msgElement.classList.add('correct-guess');
    chatBox.appendChild(msgElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}
function updatePlayerList(playersData) {
    playerList.innerHTML = '';
    for (const id in playersData) 
    {
        const player = playersData[id];
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            <span class="player-name">${player.username}</span>
            <span class="player-score">${player.score} points</span>
        `;
        if (id === currentDrawerId) {
            const drawerIndicator = document.createElement('span');
            drawerIndicator.classList.add('drawer-indicator');
            drawerIndicator.textContent = '(Drawing)';
            listItem.querySelector('.player-name').appendChild(drawerIndicator);
        }
        playerList.appendChild(listItem);
    }
}
function toggleDrawingAndGuessing(isMyTurnToDraw) {
    if (isMyTurnToDraw) {
        drawingTools.classList.remove('hidden');
        clearCanvasBtn.classList.remove('hidden');
        chatInput.placeholder = 'Type your guess or chat message...';
    } 
    else {
        drawingTools.classList.add('hidden');
        clearCanvasBtn.classList.add('hidden');
        chatInput.placeholder = 'Type your guess here...';
    }
}
function sendChat() {
    const message = chatInput.value.trim();
    if (message === '') return;
    socket.emit('guess', message);
    chatInput.value = '';
}
socket.on('connect', () => {
    mySocketId = socket.id;
    setMessage('Connected to game server! Waiting for game to start...');
    addChatMessage({ user: 'System', text: 'You are connected.' });
    startGameBtn.classList.remove('hidden');
    startGameBtn.textContent = 'Start Game';
});
socket.on('disconnect', () => {
    setMessage('Disconnected from server. Please refresh.');
    addChatMessage({ user: 'System', text: 'Disconnected from server.' });
    startGameBtn.classList.add('hidden');
    drawingTools.classList.add('hidden');
    clearCanvasBtn.classList.add('hidden');
    wordToDrawDisplay.classList.add('hidden');
    timerDisplay.classList.add('hidden');
    playerList.innerHTML = '';
    clearCanvas();
});
socket.on('chatMessage', (data) => {
    addChatMessage(data);
});
socket.on('updatePlayers', (playersData) => {
    updatePlayerList(playersData);
});
socket.on('gameStarted', (data) => {
    currentDrawerId = data.drawerId;
    startGameBtn.classList.add('hidden');
    wordToDrawDisplay.classList.remove('hidden');
    timerDisplay.classList.remove('hidden');
    currentWordSpan.textContent = data.hint;
    setMessage(`Round started! ${currentDrawerId === mySocketId ? 'You are drawing!' : 'Someone else is drawing.'}`);
    clearCanvas();
    toggleDrawingAndGuessing(mySocketId === currentDrawerId);
    updatePlayerList(data.players);
});
socket.on('wordToDraw', (word) => {
    currentWordSpan.textContent = word;
    setMessage(`It's your turn to draw! Draw: "${word}".`);
});
socket.on('drawing', (data) => {
    drawLine(data);
});
socket.on('clearCanvas', () => {
    clearCanvas();
    setMessage('Canvas cleared by the drawer.');
});
socket.on('changeColor', (color) => {
    currentColor = color;
    setupDrawingContext();
});
socket.on('changeLineWidth', (width) => {
    currentLineWidth = width;
    lineWidthDisplay.textContent = currentLineWidth;
    setupDrawingContext();
});
socket.on('timerUpdate', (time) => {
    timeRemainingSpan.textContent = time;
});
socket.on('roundOver', (data) => {
    setMessage(`Round Over! Reason: ${data.reason}`);
    currentWordSpan.textContent = '';
    timerDisplay.classList.add('hidden');
    toggleDrawingAndGuessing(false);
});
function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    setupDrawingContext();
}
window.addEventListener('load', () => {
    resizeCanvas();
});
window.addEventListener('resize', resizeCanvas);
setupDrawingContext();
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);
canvas.addEventListener('touchstart', startDrawing, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDrawing);
canvas.addEventListener('touchcancel', stopDrawing);
startGameBtn.addEventListener('click', () => {
    socket.emit('startGame');
    setMessage('Starting game...');
});
clearCanvasBtn.addEventListener('click', () => {
    socket.emit('clearCanvas');
    setMessage('You cleared the canvas!');
});
sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});
colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
    setupDrawingContext();
    if (mySocketId === currentDrawerId) socket.emit('changeColor', currentColor);
});
lineWidthControl.addEventListener('input', (e) => {
    currentLineWidth = parseInt(e.target.value);
    lineWidthDisplay.textContent = currentLineWidth;
    setupDrawingContext();
    if (mySocketId === currentDrawerId) socket.emit('changeLineWidth', currentLineWidth);
});
