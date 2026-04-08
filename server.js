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
            
            const maxPlayers = data.maxPlayers || 2;
            const gameMode = data.gameMode || '1v1';
            
            rooms.set(roomCode, {
                maxPlayers: maxPlayers,
                gameMode: gameMode,
                players: {
                    [playerId]: { ws, x: 200, y: 300, hp: 100, character: null, isReady: false, facingRight: true, action: 'idle' }
                },
                state: 'LOBBY'
            });

            ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode, playerId, maxPlayers, gameMode }));
        }

        if (data.type === 'JOIN') {
            const roomCode = data.roomCode;
            if (rooms.has(roomCode)) {
                const room = rooms.get(roomCode);
                const currentPlayersCount = Object.keys(room.players).length;
                
                if (currentPlayersCount < room.maxPlayers) {
                    playerId = `player${currentPlayersCount + 1}`;
                    currentRoom = roomCode;
                    
                    // Distribute starting positions
                    const startX = 200 + (currentPlayersCount * 150);
                    room.players[playerId] = { ws, x: startX, y: 300, hp: 100, character: null, isReady: false, facingRight: currentPlayersCount % 2 === 0, action: 'idle' };
                    
                    ws.send(JSON.stringify({ type: 'JOINED', roomCode, playerId, maxPlayers: room.maxPlayers, gameMode: room.gameMode }));
                    
                    // Notify all other players
                    Object.keys(room.players).forEach(pid => {
                        if (pid !== playerId) {
                            room.players[pid].ws.send(JSON.stringify({ 
                                type: 'PLAYER_JOINED', 
                                currentPlayers: currentPlayersCount + 1, 
                                maxPlayers: room.maxPlayers 
                            }));
                        }
                    });
                    
                    // If room is full, transition to SELECT_CHARACTER for everyone
                    if (currentPlayersCount + 1 === room.maxPlayers) {
                        Object.values(room.players).forEach(p => {
                            p.ws.send(JSON.stringify({ type: 'ALL_PLAYERS_JOINED' }));
                        });
                    }
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

                    // Check if all ready
                    const allReady = Object.values(room.players).every(p => p.isReady);
                    
                    if (allReady && Object.keys(room.players).length === room.maxPlayers) {
                        room.state = 'PLAYING';
                        
                        const startState = {};
                        Object.keys(room.players).forEach(pid => {
                            const p = room.players[pid];
                            startState[pid] = { x: p.x, y: p.y, hp: p.hp, character: p.character, facingRight: p.facingRight, action: p.action };
                        });

                        Object.values(room.players).forEach(p => {
                            p.ws.send(JSON.stringify({ type: 'GAME_START', state: startState }));
                        });
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
                    
                    // Broadcast to all other players
                    Object.keys(room.players).forEach(pid => {
                        if (pid !== playerId) {
                            room.players[pid].ws.send(JSON.stringify({
                                type: 'STATE_UPDATE',
                                playerId: playerId,
                                x: p.x,
                                y: p.y,
                                facingRight: p.facingRight,
                                action: p.action
                            }));
                        }
                    });
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
                        if (room.players[targetId].hp < 0) room.players[targetId].hp = 0;
                        
                        // Check how many players are alive
                        const alivePlayers = Object.keys(room.players).filter(pid => room.players[pid].hp > 0);
                        
                        const hpData = {};
                        Object.keys(room.players).forEach(pid => {
                            hpData[pid] = room.players[pid].hp;
                        });

                        const msg = JSON.stringify({
                            type: 'HP_UPDATE',
                            hpData: hpData
                        });
                        
                        Object.values(room.players).forEach(p => p.ws.send(msg));

                        if(alivePlayers.length <= 1) {
                            room.state = 'GAME_OVER';
                            
                            const winnerId = alivePlayers.length === 1 ? alivePlayers[0] : 'Draw';
                            const gameOverMsg = JSON.stringify({
                                type: 'GAME_OVER',
                                winner: winnerId
                            });
                            
                            Object.values(room.players).forEach(p => p.ws.send(gameOverMsg));
                        }
                    }
                }
             }
        }

    });

    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            
            Object.keys(room.players).forEach(pid => {
                if (pid !== playerId && room.players[pid].ws.readyState === WebSocket.OPEN) {
                    room.players[pid].ws.send(JSON.stringify({ type: 'PLAYER_DISCONNECTED' }));
                }
            });
            rooms.delete(currentRoom);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
