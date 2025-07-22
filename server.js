// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Initialize Socket.io with CORS settings for development
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for development. In production, specify your frontend URL.
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the current directory (where index.html is located)
app.use(express.static(__dirname));

// Game State Variables
let players = {}; // Stores player data: { socketId: { username, score, isDrawing } }
let game = {
    currentWord: '',
    drawerId: null, // Socket ID of the current drawer
    gameStarted: false,
    roundTimer: 60, // Seconds per round
    timerInterval: null,
    roundActive: false,
    wordHints: [] // For future hint functionality
};

const words = ['apple', 'banana', 'car', 'house', 'tree', 'sun', 'moon', 'star', 'cat', 'dog', 'book', 'chair', 'table', 'flower', 'cloud', 'pizza', 'robot', 'bicycle', 'guitar', 'mountain', 'ocean', 'rainbow', 'computer', 'keyboard', 'headphones', 'coffee', 'camera'];

/**
 * Generates a random username for a new player.
 * @returns {string} A unique username.
 */
function generateUsername() {
    const adjectives = ['Happy', 'Silly', 'Clever', 'Brave', 'Quick', 'Daring', 'Witty'];
    const nouns = ['Panda', 'Tiger', 'Lion', 'Fox', 'Eagle', 'Wolf', 'Bear'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${randomAdj}${randomNoun}${Math.floor(Math.random() * 100)}`;
}

/**
 * Starts a new game round.
 * Selects a new word, assigns a drawer, and starts the timer.
 */
function startNewRound() {
    if (Object.keys(players).length === 0) {
        console.log("No players to start a round.");
        game.gameStarted = false;
        io.emit('chatMessage', { user: 'Server', text: 'Waiting for players to join...' });
        return;
    }

    // Stop any existing timer
    if (game.timerInterval) {
        clearInterval(game.timerInterval);
    }

    // Select a random word
    game.currentWord = words[Math.floor(Math.random() * words.length)];
    game.wordHints = Array(game.currentWord.length).fill('_'); // Initialize hints

    // Determine the next drawer (simple round-robin for now)
    const playerIds = Object.keys(players);
    let nextDrawerIndex = 0;
    if (game.drawerId) {
        const currentDrawerIndex = playerIds.indexOf(game.drawerId);
        nextDrawerIndex = (currentDrawerIndex + 1) % playerIds.length;
    }
    game.drawerId = playerIds[nextDrawerIndex];

    // Reset scores for all players if this is the very first round of a game, or starting a new game
    // For simplicity, we reset scores at the start of a "game" not each round.
    // If you want per-round scoring, you'd adjust this.
    if (!game.gameStarted) {
        for (const id in players) {
            players[id].score = 0;
        }
    }

    game.gameStarted = true;
    game.roundActive = true;
    game.roundTimer = 60; // Reset timer for new round

    // Inform all players that a new round has started
    io.emit('gameStarted', {
        drawerId: game.drawerId,
        wordLength: game.currentWord.length,
        hint: game.wordHints.join(' '), // Initial hint
        players: players // Send updated player list with scores
    });
    io.emit('chatMessage', { user: 'Server', text: `New round started! ${players[game.drawerId].username} is drawing.` });
    io.emit('chatMessage', { user: 'Server', text: `Word has ${game.currentWord.length} letters.` });

    // Send the word to the drawer only
    io.to(game.drawerId).emit('wordToDraw', game.currentWord);

    // Start the round timer
    game.timerInterval = setInterval(() => {
        game.roundTimer--;
        io.emit('timerUpdate', game.roundTimer);

        if (game.roundTimer <= 0) {
            endRound('Time is up!');
        }
    }, 1000);

    console.log(`New round: Drawer is ${players[game.drawerId].username}, Word: ${game.currentWord}`);
}

/**
 * Ends the current game round.
 * @param {string} reason - The reason the round ended (e.g., 'Time is up!', 'Word guessed!').
 */
function endRound(reason) {
    if (game.timerInterval) {
        clearInterval(game.timerInterval);
    }
    game.roundActive = false;
    game.drawerId = null; // No one is drawing
    game.currentWord = ''; // Clear the word

    io.emit('roundOver', { reason: reason });
    io.emit('chatMessage', { user: 'Server', text: `${reason} Starting new round in 5 seconds...` });

    // Clear canvas for everyone
    io.emit('clearCanvas');

    // Start a new round after a short delay
    setTimeout(startNewRound, 5000);
}

// Socket.io connection handling
io.on('connection', (socket) => {
    const username = generateUsername();
    players[socket.id] = { username: username, score: 0, isDrawing: false };
    console.log(`User connected: ${username} (${socket.id})`);

    // Emit initial game state and player list to the newly connected client
    socket.emit('chatMessage', { user: 'Server', text: `Welcome, ${username}! Waiting for game to start...` });
    io.emit('updatePlayers', players); // Update all clients with new player list

    // Handle 'startGame' event from a client
    socket.on('startGame', () => {
        if (!game.gameStarted) { // Only start if game is not already active
            io.emit('chatMessage', { user: 'Server', text: `${username} started the game!` });
            startNewRound();
        } else {
            socket.emit('chatMessage', { user: 'Server', text: 'Game is already in progress.' });
        }
    });

    // Handle 'drawing' event from the drawer
    socket.on('drawing', (data) => {
        if (socket.id === game.drawerId && game.roundActive) {
            // Broadcast drawing data to all other connected clients
            socket.broadcast.emit('drawing', data);
        }
    });

    // Handle 'guess' event from guessers
    socket.on('guess', (guess) => {
        if (socket.id !== game.drawerId && game.roundActive) { // Only allow non-drawers to guess
            const trimmedGuess = guess.trim().toLowerCase();
            io.emit('chatMessage', { user: players[socket.id].username, text: guess }); // Echo guess to chat

            if (trimmedGuess === game.currentWord.toLowerCase()) {
                players[socket.id].score += 10; // Award points for correct guess
                io.emit('chatMessage', { user: 'Server', text: `${players[socket.id].username} guessed the word! It was "${game.currentWord}".` });
                io.emit('updatePlayers', players); // Update scores on clients
                endRound('Word guessed!');
            } else {
                // Optionally add logic for hints here based on incorrect guesses
            }
        } else if (socket.id === game.drawerId) {
            socket.emit('chatMessage', { user: 'Server', text: 'You are the drawer, you cannot guess!' });
        } else {
            socket.emit('chatMessage', { user: 'Server', text: 'The round is not active or you are not allowed to guess.' });
        }
    });

    // Handle 'clearCanvas' event from the drawer
    socket.on('clearCanvas', () => {
        if (socket.id === game.drawerId && game.roundActive) {
            io.emit('clearCanvas'); // Broadcast clear canvas to all
            io.emit('chatMessage', { user: 'Server', text: `${players[game.drawerId].username} cleared the canvas.` });
        }
    });

    // Handle 'changeColor' event from the drawer
    socket.on('changeColor', (color) => {
        if (socket.id === game.drawerId && game.roundActive) {
            io.emit('changeColor', color); // Broadcast color change to all
        }
    });

    // Handle 'changeLineWidth' event from the drawer
    socket.on('changeLineWidth', (width) => {
        if (socket.id === game.drawerId && game.roundActive) {
            io.emit('changeLineWidth', width); // Broadcast line width change to all
        }
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${players[socket.id]?.username || 'Unknown'} (${socket.id})`);
        const disconnectedUsername = players[socket.id]?.username || 'A player';
        delete players[socket.id]; // Remove player from the list

        io.emit('updatePlayers', players); // Update all clients with new player list
        io.emit('chatMessage', { user: 'Server', text: `${disconnectedUsername} has left the game.` });

        // If the disconnected player was the drawer, end the round
        if (socket.id === game.drawerId) {
            endRound('Drawer disconnected!');
        }
        // If no players left, reset game state
        if (Object.keys(players).length === 0) {
            if (game.timerInterval) {
                clearInterval(game.timerInterval);
            }
            game = {
                currentWord: '',
                drawerId: null,
                gameStarted: false,
                roundTimer: 60,
                timerInterval: null,
                roundActive: false,
                wordHints: []
            };
            io.emit('chatMessage', { user: 'Server', text: 'All players disconnected. Game reset.' });
        }
    });
});
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open your browser to http://localhost:${PORT}`);
});
