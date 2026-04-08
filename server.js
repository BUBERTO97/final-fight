const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Game State
const rooms = new Map();

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

wss.on('connection', (ws) => {
    let currentRoom = null;
    let playerId = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return;
        }

        if (data.type === 'HOST') {
            const roomCode = generateRoomCode();
            playerId = 'player1';
            currentRoom = roomCode;
            
            rooms.set(roomCode, {
                players: {
                    [playerId]: { ws, x: 200, y: 300, hp: 100, character: null, isReady: false, facingRight: true, action: 'idle' }
                },
                state: 'LOBBY'
            });

            ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode, playerId }));
        }

        if (data.type === 'JOIN') {
            const roomCode = data.roomCode;
            if (rooms.has(roomCode)) {
                const room = rooms.get(roomCode);
                if (Object.keys(room.players).length < 2) {
                    playerId = 'player2';
                    currentRoom = roomCode;
                    room.players[playerId] = { ws, x: 600, y: 300, hp: 100, character: null, isReady: false, facingRight: false, action: 'idle' };
                    
                    ws.send(JSON.stringify({ type: 'JOINED', roomCode, playerId }));
                    
                    // Notify player 1
                    room.players['player1'].ws.send(JSON.stringify({ type: 'PLAYER_JOINED' }));
                } else {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
                }
            } else {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
            }
        }

        if (data.type === 'SELECT_CHARACTER') {
            if (currentRoom && rooms.has(currentRoom)) {
                const room = rooms.get(currentRoom);
                if(room.players[playerId]) {
                    room.players[playerId].character = data.character;
                    room.players[playerId].isReady = true;

                    // Check if both ready
                    const p1 = room.players['player1'];
                    const p2 = room.players['player2'];
                    
                    if (p1 && p2 && p1.isReady && p2.isReady) {
                        room.state = 'PLAYING';
                        
                        const startState = {
                            player1: { x: p1.x, y: p1.y, hp: p1.hp, character: p1.character, facingRight: p1.facingRight, action: p1.action },
                            player2: { x: p2.x, y: p2.y, hp: p2.hp, character: p2.character, facingRight: p2.facingRight, action: p2.action }
                        };

                        p1.ws.send(JSON.stringify({ type: 'GAME_START', state: startState }));
                        p2.ws.send(JSON.stringify({ type: 'GAME_START', state: startState }));
                    }
                }
            }
        }

        if (data.type === 'UPDATE_STATE') {
            if (currentRoom && rooms.has(currentRoom)) {
                const room = rooms.get(currentRoom);
                if (room.state === 'PLAYING' && room.players[playerId]) {
                    const p = room.players[playerId];
                    p.x = data.x;
                    p.y = data.y;
                    p.facingRight = data.facingRight;
                    p.action = data.action;
                    
                    // Broadcast to other player
                    const otherPlayerId = playerId === 'player1' ? 'player2' : 'player1';
                    if (room.players[otherPlayerId]) {
                        room.players[otherPlayerId].ws.send(JSON.stringify({
                            type: 'STATE_UPDATE',
                            playerId: playerId,
                            x: p.x,
                            y: p.y,
                            facingRight: p.facingRight,
                            action: p.action
                        }));
                    }
                }
            }
        }
        
        if (data.type === 'ATTACK_HIT') {
             if (currentRoom && rooms.has(currentRoom)) {
                const room = rooms.get(currentRoom);
                if (room.state === 'PLAYING') {
                    const targetId = data.targetId;
                    const damage = data.damage;
                    if (room.players[targetId]) {
                        room.players[targetId].hp -= damage;
                        if(room.players[targetId].hp < 0) room.players[targetId].hp = 0;
                        
                        // Broadcast new HP
                        const p1 = room.players['player1'];
                        const p2 = room.players['player2'];
                        
                        const msg = JSON.stringify({
                            type: 'HP_UPDATE',
                            player1: p1.hp,
                            player2: p2.hp
                        });
                        
                        p1.ws.send(msg);
                        p2.ws.send(msg);
                    }
                }
             }
        }

    });

    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            const otherPlayerId = playerId === 'player1' ? 'player2' : 'player1';
            
            if (room.players[otherPlayerId]) {
                room.players[otherPlayerId].ws.send(JSON.stringify({ type: 'PLAYER_DISCONNECTED' }));
            }
            rooms.delete(currentRoom);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
