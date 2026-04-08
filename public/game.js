// --- Constants & Config ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FLOOR_Y = 500;
const GRAVITY = 0.6;

// --- Audio Setup ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playHitSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(150, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

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
    hud: document.getElementById('game-hud'),
    gameOver: document.getElementById('game-over-screen')
};

// --- Character Configurations ---
// Logic is kept here, but stats and visuals are loaded from JSON
const CHARACTERS = {
    PixelKnight: {
        ultimateSkill: function(player) {
            // Dash slice
            player.vx = player.facingRight ? 20 : -20;
            player.action = 'ultimate';
            player.actionTimer = 20;
        }
    },
    Mage: {
        ultimateSkill: function(player) {
            // Circular explosion
            player.action = 'ultimate';
            player.actionTimer = 30;
        }
    },
    Tank: {
        ultimateSkill: function(player) {
            // Temporary shield
            player.action = 'ultimate';
            player.actionTimer = 60;
        }
    }
};

// --- Preload Idle Sprites ---
const globalIdleSprites = {};

// --- Load Character Data ---
async function loadCharacterData() {
    const promises = Object.keys(CHARACTERS).map(async (charKey) => {
        try {
            const response = await fetch(`/characters/${charKey}.json`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            
            // Merge JSON data into CHARACTERS object
            Object.assign(CHARACTERS[charKey], data);
            
            // Preload idle sprite
            const img = new Image();
            img.src = `/sprites/${charKey}_idle.svg`;
            globalIdleSprites[charKey] = img;
        } catch (error) {
            console.error(`Failed to load data for ${charKey}:`, error);
        }
    });
    await Promise.all(promises);
    renderCharacterCards();
}

function renderCharacterCards() {
    const container = document.querySelector('.character-list');
    if (!container) return;
    
    container.innerHTML = ''; // Clear existing
    
    Object.keys(CHARACTERS).forEach(charKey => {
        const char = CHARACTERS[charKey];
        if (!char.name) return; // Skip if data not loaded
        
        const card = document.createElement('div');
        card.className = 'char-card';
        card.dataset.char = charKey;
        
        card.innerHTML = `
            <h3>${char.name}</h3>
            <p>${char.description || ''}</p>
            <div class="ult-name" data-tooltip="${char.ultimateDescription || ''}">Ult: ${char.ultimateName || ''}</div>
        `;
        
        card.addEventListener('click', () => {
            document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            myCharacter = charKey;
            
            ws.send(JSON.stringify({
                type: 'SELECT_CHARACTER',
                character: myCharacter
            }));
            
            document.getElementById('select-message').innerText = 'Ready! Waiting for opponent...';
        });
        
        container.appendChild(card);
    });
}

// --- Sprite Class ---
/*
 * The Sprite class handles loading SVG files from the /sprites/ directory.
 * It uses character configuration from JSON for dimensions and fallback colors.
 */
class Sprite {
    constructor(characterName) {
        this.characterName = characterName;
        this.images = {};
        this.loaded = false;
        this.config = CHARACTERS[characterName] || {};
        
        // Use preloaded idle sprite if available
        if (globalIdleSprites[characterName]) {
            this.images['idle'] = globalIdleSprites[characterName];
        }

        // Define states we want to load
        const states = ['idle', 'run', 'attack', 'ultimate'];
        let loadedCount = 0;
        
        states.forEach(state => {
            // Skip idle if already set from global cache
            if (state === 'idle' && this.images['idle']) {
                loadedCount++;
                return;
            }

            const img = new Image();
            img.src = `/sprites/${characterName}_${state}.svg`;
            img.onload = () => {
                loadedCount++;
                if (loadedCount === states.length) this.loaded = true;
            };
            img.onerror = () => {
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
            // Fallback: use color from JSON
            const color = this.config.color || fallbackColor;
            ctx.fillStyle = color;
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
        this.hitTimer = 0;
        this.sprite = new Sprite(charConfig.name);
        this.attackCooldown = 0;
        this.ultimateCooldown = 0;
    }

    update(keys) {
        if (this.hitTimer > 0) this.hitTimer--;
        if (this.attackCooldown > 0) this.attackCooldown--;
        if (this.ultimateCooldown > 0) this.ultimateCooldown--;

        if (this.actionTimer > 0) {
            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.action = 'idle';
            }
        }

        // Only allow movement if not in a heavy action and not hit
        if ((this.action === 'idle' || this.action === 'run') && this.hitTimer === 0) {
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
            if (keys[' '] && this.attackCooldown === 0) {
                this.action = 'attack';
                this.actionTimer = 15;
                this.attackCooldown = 30; // ~0.5 seconds at 60fps
                this.checkAttackHit();
            }

            // Ultimate
            if (keys['e'] && this.ultimateCooldown === 0) {
                this.config.ultimateSkill(this);
                this.ultimateCooldown = 300; // 5 seconds at 60fps
            }
        }

        // Apply Physics
        this.vy += GRAVITY;
        
        // Apply horizontal friction if hit (stunned)
        if (this.hitTimer > 0) {
            this.vx *= 0.9;
        }

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

        // Hit Flash Overlay
        if (this.hitTimer > 0) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
            ctx.fillRect(this.x, this.y, this.width, this.height);
        }

        // Draw Player Name and Character above head
        ctx.fillStyle = 'white';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(this.id, this.x + this.width / 2, this.y - 22);
        ctx.fillStyle = '#f1c40f'; // Gold color for character name
        ctx.font = '8px "Press Start 2P"';
        ctx.fillText(this.config.name, this.x + this.width / 2, this.y - 10);

        // Draw Attack Visuals
        if (this.action === 'attack') {
            const progress = 1 - (this.actionTimer / 15);
            ctx.save();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            
            const cx = this.facingRight ? this.x + this.width : this.x;
            const cy = this.y + this.height / 2;
            
            const startAngle = this.facingRight ? -Math.PI / 2 : Math.PI / 2;
            const endAngle = this.facingRight ? -Math.PI / 2 + (Math.PI * progress) : Math.PI / 2 - (Math.PI * progress);
            
            ctx.arc(cx, cy, 35, startAngle, endAngle, !this.facingRight);
            ctx.stroke();
            ctx.restore();
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
                if (players['player1'] && data.player1 < players['player1'].hp) {
                    players['player1'].hitTimer = 15;
                    playHitSound();
                    
                    // Apply knockback if it's me
                    if (myPlayerId === 'player1' && players['player2']) {
                        const dir = players['player1'].x > players['player2'].x ? 1 : -1;
                        players['player1'].vx = dir * 8;
                        players['player1'].vy = -4;
                    }
                }
                if (players['player2'] && data.player2 < players['player2'].hp) {
                    players['player2'].hitTimer = 15;
                    playHitSound();

                    // Apply knockback if it's me
                    if (myPlayerId === 'player2' && players['player1']) {
                        const dir = players['player2'].x > players['player1'].x ? 1 : -1;
                        players['player2'].vx = dir * 8;
                        players['player2'].vy = -4;
                    }
                }
                if (players['player1']) players['player1'].hp = data.player1;
                if (players['player2']) players['player2'].hp = data.player2;
                updateHUD();
                break;
            case 'ERROR':
                alert(data.message);
                break;
            case 'GAME_OVER':
                gameState = 'GAME_OVER';
                canvas.style.display = 'none';
                if (data.winner === myPlayerId) {
                    document.getElementById('game-over-title').innerText = 'You Win!';
                    document.getElementById('game-over-title').style.color = '#2ecc71';
                } else {
                    document.getElementById('game-over-title').innerText = 'Game Over';
                    document.getElementById('game-over-title').style.color = '#e74c3c';
                }
                showScreen('gameOver');
                break;
            case 'PLAYER_DISCONNECTED':
                if (gameState === 'PLAYING' || gameState === 'LOBBY' || gameState === 'SELECT') {
                    alert('Opponent disconnected!');
                    window.location.reload();
                }
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

document.getElementById('btn-game-over-ok').addEventListener('click', () => {
    if (ws) {
        ws.close();
    }
    players = {};
    myPlayerId = null;
    roomCode = null;
    myCharacter = null;
    gameState = 'MENU';
    
    // Reset UI
    document.getElementById('select-message').innerText = 'Waiting for opponent...';
    document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
    
    showScreen('menu');
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
async function init() {
    await loadCharacterData();
    showScreen('menu');
}
init();
