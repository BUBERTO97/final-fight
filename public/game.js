// --- Constants & Config ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FLOOR_Y = 500;
const GRAVITY = 0.6;

// --- WebSocket Setup ---
// In AI Studio, we connect to the same host
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
let ws;

// --- Game State ---
let gameState = 'MENU'; // MENU, LOBBY, SELECT, PLAYING
let myPlayerId = null;
let roomCode = null;
let players = {};
let myCharacter = null;

// --- DOM Elements ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
// Ensure pixel art stays crisp
ctx.imageSmoothingEnabled = false;

const screens = {
    menu: document.getElementById('main-menu'),
    lobby: document.getElementById('lobby-screen'),
    select: document.getElementById('character-select'),
    hud: document.getElementById('game-hud')
};

// --- Character Configurations ---
const CHARACTERS = {
    PixelKnight: {
        name: 'PixelKnight',
        hp: 100,
        attackDamage: 10,
        speed: 5,
        jumpForce: 12,
        width: 50,
        height: 70,
        color: '#e74c3c', // Fallback color if SVG fails
        ultimateSkill: function(player) {
            // Dash slice
            player.vx = player.facingRight ? 20 : -20;
            player.action = 'ultimate';
            player.actionTimer = 20;
        }
    },
    Mage: {
        name: 'Mage',
        hp: 80,
        attackDamage: 15,
        speed: 4,
        jumpForce: 10,
        width: 40,
        height: 70,
        color: '#9b59b6',
        ultimateSkill: function(player) {
            // Circular explosion
            player.action = 'ultimate';
            player.actionTimer = 30;
        }
    },
    Tank: {
        name: 'Tank',
        hp: 150,
        attackDamage: 8,
        speed: 3,
        jumpForce: 9,
        width: 70,
        height: 80,
        color: '#2ecc71',
        ultimateSkill: function(player) {
            // Temporary shield
            player.action = 'ultimate';
            player.actionTimer = 60;
        }
    }
};

// --- Sprite Class ---
/*
 * The Sprite class handles loading SVG files from the /sprites/ directory.
 * If the SVG file doesn't exist, it falls back to drawing a colored rectangle.
 * In a real project, you would place files like 'PixelKnight_idle.svg' in the /public/sprites/ folder.
 */
class Sprite {
    constructor(characterName) {
        this.characterName = characterName;
        this.images = {};
        this.loaded = false;
        
        // Define states we want to load
        const states = ['idle', 'run', 'attack', 'ultimate'];
        let loadedCount = 0;
        
        states.forEach(state => {
            const img = new Image();
            // Pathing assumes /sprites/ folder at the root of the server
            img.src = `/sprites/${characterName}_${state}.svg`;
            img.onload = () => {
                loadedCount++;
                if (loadedCount === states.length) this.loaded = true;
            };
            img.onerror = () => {
                // If SVG fails to load, we just won't draw it (fallback to rect)
                loadedCount++;
                if (loadedCount === states.length) this.loaded = true;
            };
            this.images[state] = img;
        });
    }

    draw(ctx, x, y, width, height, state, facingRight, fallbackColor) {
        const img = this.images[state] || this.images['idle'];
        
        ctx.save();
        
        // Flip context if facing left
        if (!facingRight) {
            ctx.translate(x + width, y);
            ctx.scale(-1, 1);
            x = 0;
            y = 0;
        }
        
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, x, y, width, height);
        } else {
            // Fallback to colored rectangle if SVG is missing
            ctx.fillStyle = fallbackColor;
            ctx.fillRect(x, y, width, height);
            
            // Draw a little eye to show direction
            ctx.fillStyle = 'white';
            ctx.fillRect(x + width - 15, y + 10, 10, 10);
            ctx.fillStyle = 'black';
            ctx.fillRect(x + width - 10, y + 15, 5, 5);
        }
        
        ctx.restore();
    }
}

// --- Player Class ---
class Player {
    constructor(id, x, y, charConfig) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.config = charConfig;
        this.hp = charConfig.hp;
        this.maxHp = charConfig.hp;
        this.width = charConfig.width;
        this.height = charConfig.height;
        this.facingRight = true;
        this.action = 'idle'; // idle, run, attack, ultimate
        this.actionTimer = 0;
        this.sprite = new Sprite(charConfig.name);
    }

    update(keys) {
        if (this.actionTimer > 0) {
            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.action = 'idle';
            }
        }

        // Only allow movement if not in a heavy action
        if (this.action === 'idle' || this.action === 'run') {
            // Horizontal Movement
            if (keys['a'] || keys['ArrowLeft']) {
                this.vx = -this.config.speed;
                this.facingRight = false;
                this.action = 'run';
            } else if (keys['d'] || keys['ArrowRight']) {
                this.vx = this.config.speed;
                this.facingRight = true;
                this.action = 'run';
            } else {
                this.vx = 0;
                this.action = 'idle';
            }

            // Jump
            if ((keys['w'] || keys['ArrowUp']) && this.y >= FLOOR_Y - this.height) {
                this.vy = -this.config.jumpForce;
            }

            // Attack
            if (keys[' ']) {
                this.action = 'attack';
                this.actionTimer = 15;
                this.checkAttackHit();
            }

            // Ultimate
            if (keys['e']) {
                this.config.ultimateSkill(this);
            }
        }

        // Apply Physics
        this.vy += GRAVITY;
        this.x += this.vx;
        this.y += this.vy;

        // Floor Collision
        if (this.y > FLOOR_Y - this.height) {
            this.y = FLOOR_Y - this.height;
            this.vy = 0;
        }

        // Wall Collision
        if (this.x < 0) this.x = 0;
        if (this.x > CANVAS_WIDTH - this.width) this.x = CANVAS_WIDTH - this.width;
    }

    checkAttackHit() {
        // Simple Hitbox detection
        const attackRange = 40;
        const hitbox = {
            x: this.facingRight ? this.x + this.width : this.x - attackRange,
            y: this.y + 10,
            width: attackRange,
            height: 50
        };

        const otherId = this.id === 'player1' ? 'player2' : 'player1';
        const other = players[otherId];

        if (other) {
            if (hitbox.x < other.x + other.width &&
                hitbox.x + hitbox.width > other.x &&
                hitbox.y < other.y + other.height &&
                hitbox.y + hitbox.height > other.y) {
                
                // Hit! Send to server
                ws.send(JSON.stringify({
                    type: 'ATTACK_HIT',
                    targetId: otherId,
                    damage: this.config.attackDamage
                }));
            }
        }
    }

    draw(ctx) {
        // Draw Sprite
        this.sprite.draw(ctx, this.x, this.y, this.width, this.height, this.action, this.facingRight, this.config.color);

        // Draw Player Name above head
        ctx.fillStyle = 'white';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(this.id, this.x + this.width / 2, this.y - 10);

        // Draw Attack Hitbox (Debug/Visual)
        if (this.action === 'attack') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            const attackRange = 40;
            const hx = this.facingRight ? this.x + this.width : this.x - attackRange;
            ctx.fillRect(hx, this.y + 10, attackRange, 50);
        }
        
        // Draw Ultimate Visuals
        if (this.action === 'ultimate') {
            if (this.config.name === 'Mage') {
                ctx.beginPath();
                ctx.arc(this.x + this.width/2, this.y + this.height/2, 80 - this.actionTimer*2, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(155, 89, 182, 0.5)';
                ctx.fill();
            } else if (this.config.name === 'Tank') {
                ctx.beginPath();
                ctx.arc(this.x + this.width/2, this.y + this.height/2, 60, 0, Math.PI*2);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)';
                ctx.lineWidth = 5;
                ctx.stroke();
            }
        }
    }
}

// --- Input Handling ---
const keys = {};
window.addEventListener('keydown', e => {
    // Prevent default scrolling for space and arrows
    if(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) > -1) {
        e.preventDefault();
    }
    keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

// --- UI Functions ---
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if(screens[screenName]) screens[screenName].classList.add('active');
}

function updateHUD() {
    if (players['player1']) {
        const p1 = players['player1'];
        const pct = Math.max(0, (p1.hp / p1.maxHp) * 100);
        document.getElementById('p1-hp-bar').style.width = `${pct}%`;
    }
    if (players['player2']) {
        const p2 = players['player2'];
        const pct = Math.max(0, (p2.hp / p2.maxHp) * 100);
        document.getElementById('p2-hp-bar').style.width = `${pct}%`;
    }
}

// --- Networking ---
function connectWebSocket() {
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'ROOM_CREATED':
                roomCode = data.roomCode;
                myPlayerId = data.playerId;
                document.getElementById('display-room-code').innerText = roomCode;
                showScreen('lobby');
                break;
            case 'JOINED':
                roomCode = data.roomCode;
                myPlayerId = data.playerId;
                showScreen('select');
                break;
            case 'PLAYER_JOINED':
                showScreen('select');
                break;
            case 'GAME_START':
                // Initialize players
                const s1 = data.state.player1;
                const s2 = data.state.player2;
                players['player1'] = new Player('player1', s1.x, s1.y, CHARACTERS[s1.character]);
                players['player2'] = new Player('player2', s2.x, s2.y, CHARACTERS[s2.character]);
                
                showScreen('hud');
                canvas.style.display = 'block';
                gameState = 'PLAYING';
                requestAnimationFrame(gameLoop);
                break;
            case 'STATE_UPDATE':
                if (players[data.playerId]) {
                    const p = players[data.playerId];
                    p.x = data.x;
                    p.y = data.y;
                    p.facingRight = data.facingRight;
                    p.action = data.action;
                }
                break;
            case 'HP_UPDATE':
                if (players['player1']) players['player1'].hp = data.player1;
                if (players['player2']) players['player2'].hp = data.player2;
                updateHUD();
                break;
            case 'ERROR':
                alert(data.message);
                break;
            case 'PLAYER_DISCONNECTED':
                alert('Opponent disconnected!');
                window.location.reload();
                break;
        }
    };
}

// --- Event Listeners ---
document.getElementById('btn-host').addEventListener('click', () => {
    connectWebSocket();
    ws.onopen = () => ws.send(JSON.stringify({ type: 'HOST' }));
});

document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('input-room-code').value;
    if (code.length === 4) {
        connectWebSocket();
        ws.onopen = () => ws.send(JSON.stringify({ type: 'JOIN', roomCode: code }));
    }
});

document.querySelectorAll('.char-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        myCharacter = card.dataset.char;
        
        ws.send(JSON.stringify({
            type: 'SELECT_CHARACTER',
            character: myCharacter
        }));
        
        document.getElementById('select-message').innerText = 'Ready! Waiting for opponent...';
    });
});

// --- Game Loop ---
let lastSync = 0;
function gameLoop(timestamp) {
    if (gameState !== 'PLAYING') return;

    // Clear Canvas
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Floor
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(0, FLOOR_Y, CANVAS_WIDTH, CANVAS_HEIGHT - FLOOR_Y);

    // Update Local Player
    if (players[myPlayerId]) {
        const myP = players[myPlayerId];
        myP.update(keys);

        // Sync state to server at ~30fps
        if (timestamp - lastSync > 33) {
            ws.send(JSON.stringify({
                type: 'UPDATE_STATE',
                x: myP.x,
                y: myP.y,
                facingRight: myP.facingRight,
                action: myP.action
            }));
            lastSync = timestamp;
        }
    }

    // Draw Players
    if (players['player1']) players['player1'].draw(ctx);
    if (players['player2']) players['player2'].draw(ctx);

    requestAnimationFrame(gameLoop);
}

// Initialize
showScreen('menu');
