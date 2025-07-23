const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));
let players = {};
let game = {
    currentWord: '',
    drawerId: null,
    gameStarted: false,
    roundTimer: 60,
    timerInterval: null,
    roundActive: false,
    wordHints: [],
    lastDrawerSocketId: null,
    drawingHistory: []
};
const words = ['apple', 'banana', 'car', 'house', 'tree', 'sun', 'moon', 'star', 'cat', 'dog', 'book', 'chair', 'table', 'flower', 'cloud', 'pizza', 'robot', 'bicycle', 'guitar', 'mountain', 'ocean', 'rainbow', 'computer', 'keyboard', 'headphones', 'coffee', 'camera'];
let playerCounter = 0;
function assignPlayerUsername() {
    playerCounter++;
    return `Player ${playerCounter}`;
}
function startNewRound() {
    const playerIds = Object.keys(players);
    if (playerIds.length === 0) {
        console.log("No players to start a round.");
        game.gameStarted = false;
        io.emit('chatMessage', { user: 'Server', text: 'Waiting for players to join...' });
        return;
    }
    if (game.timerInterval)  clearInterval(game.timerInterval);
    game.drawingHistory = [];
    game.currentWord = words[Math.floor(Math.random() * words.length)];
    game.wordHints = Array(game.currentWord.length).fill('_');
    let nextDrawerIndex = 0;
    if (game.lastDrawerSocketId && playerIds.includes(game.lastDrawerSocketId)) {
        const lastDrawerCurrentIndex = playerIds.indexOf(game.lastDrawerSocketId);
        nextDrawerIndex = (lastDrawerCurrentIndex + 1) % playerIds.length;
    }
    game.drawerId = playerIds[nextDrawerIndex];
    game.lastDrawerSocketId = game.drawerId;
    if (!game.gameStarted) 
        for (const id in players)  
            players[id].score = 0;
    game.gameStarted = true;
    game.roundActive = true;
    game.roundTimer = 60;
    io.emit('gameStarted', {
        drawerId: game.drawerId,
        wordLength: game.currentWord.length,
        hint: game.wordHints.join(' '),
        players: players
    });
    io.emit('chatMessage', { user: 'Server', text: `New round started! ${players[game.drawerId].username} is drawing.` });
    io.emit('chatMessage', { user: 'Server', text: `Word has ${game.currentWord.length} letters.` });
    io.to(game.drawerId).emit('wordToDraw', game.currentWord);
    game.timerInterval = setInterval(() => {
        game.roundTimer--;
        io.emit('timerUpdate', game.roundTimer);
        if (game.roundTimer <= 0) endRound('Time is up!');
    }, 1000);
    console.log(`New round: Drawer is ${players[game.drawerId].username}, Word: ${game.currentWord}`);
}
function endRound(reason) {
    if (game.timerInterval) clearInterval(game.timerInterval);
    game.roundActive = false;
    game.currentWord = '';
    game.drawingHistory = [];
    io.emit('roundOver', { reason: reason });
    io.emit('chatMessage', { user: 'Server', text: `${reason} Starting new round in 5 seconds...` });
    io.emit('clearCanvas');
    setTimeout(startNewRound, 5000);
}
io.on('connection', (socket) => {
    const username = assignPlayerUsername();
    players[socket.id] = { username: username, score: 0, isDrawing: false };
    console.log(`User connected: ${username} (${socket.id})`);
    socket.emit('chatMessage', { user: 'Server', text: `Welcome, ${username}! Waiting for game to start...` });
    io.emit('updatePlayers', players);
    if (game.gameStarted && game.roundActive) {
        socket.emit('gameStarted', {
            drawerId: game.drawerId,
            wordLength: game.currentWord.length,
            hint: game.wordHints.join(' '),
            players: players
        });
        socket.emit('timerUpdate', game.roundTimer);
        socket.emit('chatMessage', { user: 'Server', text: `A game is in progress. ${players[game.drawerId].username} is drawing.` });
        for (const drawingData of game.drawingHistory)
            socket.emit('drawing', drawingData);
    }
    socket.on('startGame', () => {
        if (!game.gameStarted) {
            io.emit('chatMessage', { user: 'Server', text: `${username} started the game!` });
            startNewRound();
        } 
        else socket.emit('chatMessage', { user: 'Server', text: 'Game is already in progress.' });
    });
    socket.on('drawing', (data) => {
        if (socket.id === game.drawerId && game.roundActive) {
            game.drawingHistory.push(data);
            socket.broadcast.emit('drawing', data);
        }
    });
    socket.on('guess', (guess) => {
        if (socket.id !== game.drawerId && game.roundActive) {
            const trimmedGuess = guess.trim().toLowerCase();
            io.emit('chatMessage', { user: players[socket.id].username, text: guess });
            if (trimmedGuess === game.currentWord.toLowerCase()) {
                players[socket.id].score += 10;
                io.emit('chatMessage', { user: 'Server', text: `${players[socket.id].username} guessed the word! It was "${game.currentWord}".` });
                io.emit('updatePlayers', players);
                endRound('Word guessed!');
            }
        } 
        else if (socket.id === game.drawerId) socket.emit('chatMessage', { user: 'Server', text: 'You are the drawer, you cannot guess!' });
        else socket.emit('chatMessage', { user: 'Server', text: 'The round is not active or you are not allowed to guess.' });
    });
    socket.on('clearCanvas', () => {
        if (socket.id === game.drawerId && game.roundActive) {
            game.drawingHistory = [];
            io.emit('clearCanvas');
            io.emit('chatMessage', { user: 'Server', text: `${players[game.drawerId].username} cleared the canvas.` });
        }
    });
    socket.on('changeColor', (color) => {
        if (socket.id === game.drawerId && game.roundActive) io.emit('changeColor', color);
    });
    socket.on('changeLineWidth', (width) => {
        if (socket.id === game.drawerId && game.roundActive) io.emit('changeLineWidth', width);
    });
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${players[socket.id]?.username || 'Unknown'} (${socket.id})`);
        const disconnectedUsername = players[socket.id]?.username || 'A player';
        if (socket.id === game.drawerId) endRound('Drawer disconnected!');
        if (socket.id === game.lastDrawerSocketId) game.lastDrawerSocketId = null;
        delete players[socket.id];
        io.emit('updatePlayers', players);
        io.emit('chatMessage', { user: 'Server', text: `${disconnectedUsername} has left the game.` });
        if (Object.keys(players).length === 0) {
            if (game.timerInterval) clearInterval(game.timerInterval);
            game = {
                currentWord: '',
                drawerId: null,
                gameStarted: false,
                roundTimer: 60,
                timerInterval: null,
                roundActive: false,
                wordHints: [],
                lastDrawerSocketId: null,
                drawingHistory: []
            };
            io.emit('chatMessage', { user: 'Server', text: 'All players disconnected. Game reset.' });
        }
    });
});
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open your browser to http://localhost:${PORT}`);
});
