// --- Constants & Config ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FLOOR_Y = 500;
const GRAVITY = 0.6;

// --- Audio Setup ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Menu Music
const menuMusic = new Audio('characters/menu_2.mp3');
menuMusic.loop = true;
menuMusic.volume = 1;

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

function updateMusic(screenName) {
    // Resume audio context on interaction
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const menuScreens = ['menu', 'lobby', 'select', 'gameOver'];
    if (menuScreens.includes(screenName)) {
        if (menuMusic.paused) {
            menuMusic.play().catch(e => console.log("Music play blocked until interaction"));
        }
    } else {
        menuMusic.pause();
        menuMusic.currentTime = 0;
    }
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
    start: document.getElementById('start-screen'),
    menu: document.getElementById('main-menu'),
    lobby: document.getElementById('lobby-screen'),
    select: document.getElementById('character-select'),
    hud: document.getElementById('game-hud'),
    gameOver: document.getElementById('game-over-screen')
};

// --- Character Configurations ---
// Logic is kept here, but stats and visuals are loaded from JSON
const CHARACTERS = {
    ShadowAssassin: {
        ultimateSkill: function(player) {
            // Teleport behind closest enemy
            let closestOther = null;
            let minDistance = Infinity;
            Object.keys(players).forEach(pid => {
                if (pid !== player.id && players[pid].hp > 0) {
                    const dist = Math.abs(player.x - players[pid].x);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestOther = players[pid];
                    }
                }
            });
            
            if (closestOther) {
                player.x = closestOther.facingRight ? closestOther.x - 40 : closestOther.x + closestOther.width + 10;
                player.facingRight = closestOther.x > player.x;
                
                // Deal damage
                ws.send(JSON.stringify({
                    type: 'ATTACK_HIT',
                    targetId: closestOther.id,
                    damage: 35
                }));
            }
            player.action = 'ultimate';
            player.actionTimer = 20;
        }
    },
    FrostMage: {
        ultimateSkill: function(player) {
            // Blizzard storm (damages all)
            Object.keys(players).forEach(pid => {
                if (pid !== player.id && players[pid].hp > 0) {
                    ws.send(JSON.stringify({
                        type: 'ATTACK_HIT',
                        targetId: pid,
                        damage: 30
                    }));
                }
            });
            player.action = 'ultimate';
            player.actionTimer = 40;
        }
    },
    FlameBerserker: {
        ultimateSkill: function(player) {
            // Inferno Rage (AoE damage)
            Object.keys(players).forEach(pid => {
                if (pid !== player.id && players[pid].hp > 0) {
                    if (Math.abs(player.x - players[pid].x) < 200) {
                        ws.send(JSON.stringify({
                            type: 'ATTACK_HIT',
                            targetId: pid,
                            damage: 40
                        }));
                    }
                }
            });
            player.action = 'ultimate';
            player.actionTimer = 60;
        }
    },
    TechGuardian: {
        ultimateSkill: function(player) {
            // Barrier Dome (Damages nearby)
            Object.keys(players).forEach(pid => {
                if (pid !== player.id && players[pid].hp > 0) {
                    if (Math.abs(player.x - players[pid].x) < 150) {
                        ws.send(JSON.stringify({
                            type: 'ATTACK_HIT',
                            targetId: pid,
                            damage: 25
                        }));
                    }
                }
            });
            player.action = 'ultimate';
            player.actionTimer = 60;
        }
    },
    StormArcher: {
        ultimateSkill: function(player) {
            // Thunder Rain (Global hit)
            Object.keys(players).forEach(pid => {
                if (pid !== player.id && players[pid].hp > 0) {
                    ws.send(JSON.stringify({
                        type: 'ATTACK_HIT',
                        targetId: pid,
                        damage: 35
                    }));
                }
            });
            player.action = 'ultimate';
            player.actionTimer = 30;
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
            if (data.visual?.sprites?.idle) {
                img.src = `/${data.visual.sprites.idle.src}`;
            } else {
                img.src = `/sprites/${charKey}_idle.svg`;
            }
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
            <img src="/${char.visual?.icon || ''}" alt="${char.name} icon" style="width: 64px; height: 64px; margin-bottom: 10px; border: 2px solid ${char.visual?.themeColor || '#fff'};">
            <h3>${char.name}</h3>
            <p>${char.description || ''}</p>
            <div class="ult-name" data-tooltip="${char.ultimate?.description || ''}">Ult: ${char.ultimate?.name || ''}</div>
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
        this.frameIndex = 0;
        this.lastFrameTime = 0;
        this.currentState = 'idle';
        
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
            if (this.config.visual?.sprites?.[state]) {
                img.src = `/${this.config.visual.sprites[state].src}`;
            } else {
                img.src = `/sprites/${characterName}_${state}.svg`;
            }
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

    draw(ctx, x, y, width, height, state, facingRight, fallbackColor, timestamp = 0) {
        if (this.currentState !== state) {
            this.currentState = state;
            this.frameIndex = 0;
            this.lastFrameTime = timestamp;
        }

        const img = this.images[state] || this.images['idle'];
        const spriteConfig = this.config.visual?.sprites?.[state] || this.config.visual?.sprites?.['idle'];
        
        ctx.save();
        
        // Flip context if facing left
        if (!facingRight) {
            ctx.translate(x + width, y);
            ctx.scale(-1, 1);
            x = 0;
            y = 0;
        }

        if (img && img.complete && img.naturalWidth > 0) {
            if (spriteConfig && spriteConfig.frames > 1) {
                const frames = spriteConfig.frames;
                const fps = spriteConfig.fps || 10;
                const frameDuration = 1000 / fps;
                
                if (timestamp - this.lastFrameTime > frameDuration) {
                    this.frameIndex++;
                    if (this.frameIndex >= frames) {
                        this.frameIndex = spriteConfig.loop ? 0 : frames - 1;
                    }
                    this.lastFrameTime = timestamp;
                }
                
                const frameWidth = img.naturalWidth / frames;
                const frameHeight = img.naturalHeight;
                
                ctx.drawImage(
                    img,
                    this.frameIndex * frameWidth, 0, frameWidth, frameHeight,
                    x, y, width, height
                );
            } else {
                ctx.drawImage(img, x, y, width, height);
            }
        } else {
            // Fallback: use color from JSON
            const color = this.config.visual?.themeColor || fallbackColor;
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
        this.hp = charConfig.stats?.hp || 100;
        this.maxHp = charConfig.stats?.hp || 100;
        this.width = charConfig.dimensions?.width || 50;
        this.height = charConfig.dimensions?.height || 70;
        this.facingRight = true;
        this.action = 'idle'; // idle, run, attack, ultimate
        this.actionTimer = 0;
        this.hitTimer = 0;
        this.sprite = new Sprite(charConfig.id);
        this.attackCooldown = 0;
        this.ultimateCooldown = 0;
        this.maxUltimateCooldown = (charConfig.ultimate?.cooldown || 5) * 60;
    }

    updateTimers() {
        if (this.hitTimer > 0) this.hitTimer--;
        if (this.attackCooldown > 0) this.attackCooldown--;
        if (this.ultimateCooldown > 0) this.ultimateCooldown--;

        if (this.actionTimer > 0) {
            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.action = 'idle';
            }
        }
    }

    update(keys) {
        this.updateTimers();

        // Only allow movement if not in a heavy action and not hit
        if ((this.action === 'idle' || this.action === 'run') && this.hitTimer === 0) {
            // Horizontal Movement
            if (keys['a'] || keys['ArrowLeft']) {
                this.vx = -(this.config.stats?.speed || 5);
                this.facingRight = false;
                this.action = 'run';
            } else if (keys['d'] || keys['ArrowRight']) {
                this.vx = (this.config.stats?.speed || 5);
                this.facingRight = true;
                this.action = 'run';
            } else {
                this.vx = 0;
                this.action = 'idle';
            }

            // Jump
            if ((keys['w'] || keys['ArrowUp']) && this.y >= FLOOR_Y - this.height) {
                this.vy = -(this.config.stats?.jumpForce || 12);
            }

            // Attack
            if (keys[' '] && this.attackCooldown === 0) {
                this.action = 'attack';
                this.actionTimer = 15;
                this.attackCooldown = 30; // ~0.5 seconds at 60fps
                this.vx = 0; // Stop moving
                
                // Automatically face the closest opponent when attacking
                let closestOpponent = null;
                let minDistance = Infinity;
                Object.keys(players).forEach(pid => {
                    if (pid !== this.id && players[pid].hp > 0) {
                        const dist = Math.abs(players[pid].x - this.x);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestOpponent = players[pid];
                        }
                    }
                });
                
                if (closestOpponent) {
                    this.facingRight = closestOpponent.x > this.x;
                }
                
                this.checkAttackHit();
            }

            // Ultimate
            if (keys['e'] && this.ultimateCooldown === 0) {
                this.vx = 0; // Stop moving
                this.config.ultimateSkill(this);
                this.ultimateCooldown = this.maxUltimateCooldown;
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

        Object.keys(players).forEach(otherId => {
            if (otherId === this.id) return;
            
            const other = players[otherId];
            if (other && other.hp > 0) {
                if (hitbox.x < other.x + other.width &&
                    hitbox.x + hitbox.width > other.x &&
                    hitbox.y < other.y + other.height &&
                    hitbox.y + hitbox.height > other.y) {
                    
                    // Hit! Send to server
                    ws.send(JSON.stringify({
                        type: 'ATTACK_HIT',
                        targetId: otherId,
                        damage: this.config.stats?.attackDamage || 10
                    }));
                }
            }
        });
    }

    draw(ctx, timestamp) {
        // Draw Sprite
        this.sprite.draw(ctx, this.x, this.y, this.width, this.height, this.action, this.facingRight, this.config.visual?.themeColor, timestamp);

        // Hit Flash Overlay
        if (this.hitTimer > 0) {
            ctx.save();
            const cx = this.x + this.width / 2;
            const cy = this.y + this.height / 2;
            const progress = this.hitTimer / 15; // 1.0 to 0.0
            const radius = 30 + (1 - progress) * 20; // Expands from 30 to 50
            
            // Impact glow
            ctx.globalCompositeOperation = 'lighter';
            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${progress})`);
            gradient.addColorStop(0.3, `rgba(255, 50, 50, ${progress * 0.8})`);
            gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Impact spikes
            ctx.translate(cx, cy);
            ctx.rotate(progress * Math.PI); // Spin slightly
            ctx.beginPath();
            for(let i=0; i<8; i++) {
                ctx.lineTo(0, i % 2 === 0 ? radius * 1.2 : radius * 0.4);
                ctx.rotate(Math.PI / 4);
            }
            ctx.closePath();
            ctx.fillStyle = `rgba(255, 255, 255, ${progress * 0.9})`;
            ctx.fill();
            
            ctx.restore();
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
            
            const startAngle = -Math.PI / 2;
            const endAngle = this.facingRight ? startAngle + (Math.PI * progress) : startAngle - (Math.PI * progress);
            
            ctx.arc(cx, cy, 35, startAngle, endAngle, !this.facingRight);
            ctx.stroke();
            ctx.restore();
        }
        
        // Draw Ultimate Visuals
        if (this.action === 'ultimate') {
            if (this.config.id === 'FrostMage') {
                ctx.beginPath();
                ctx.arc(this.x + this.width/2, this.y + this.height/2, 80 - this.actionTimer*2, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(93, 173, 226, 0.5)';
                ctx.fill();
            } else if (this.config.id === 'TechGuardian') {
                ctx.beginPath();
                ctx.arc(this.x + this.width/2, this.y + this.height/2, 60, 0, Math.PI*2);
                ctx.strokeStyle = 'rgba(26, 188, 156, 0.8)';
                ctx.lineWidth = 5;
                ctx.stroke();
            } else if (this.config.id === 'FlameBerserker') {
                ctx.beginPath();
                ctx.arc(this.x + this.width/2, this.y + this.height/2, 50, 0, Math.PI*2);
                ctx.strokeStyle = 'rgba(230, 126, 34, 0.8)';
                ctx.lineWidth = 3;
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

// Mobile Detection & Controls
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const mobileControls = document.getElementById('mobile-controls');

function setupMobileControls() {
    if (!isMobile) return;

    mobileControls.style.display = 'flex';
    document.getElementById('btn-fullscreen').style.display = 'block';

    const touchMap = {
        'ctrl-up': 'arrowup',
        'ctrl-down': 'arrowdown',
        'ctrl-left': 'arrowleft',
        'ctrl-right': 'arrowright',
        'ctrl-attack': ' ',
        'ctrl-ult': 'e'
    };

    Object.keys(touchMap).forEach(id => {
        const btn = document.getElementById(id);
        const key = touchMap[id];

        const handleStart = (e) => {
            e.preventDefault();
            keys[key] = true;
        };
        const handleEnd = (e) => {
            e.preventDefault();
            keys[key] = false;
        };

        btn.addEventListener('touchstart', handleStart);
        btn.addEventListener('touchend', handleEnd);
        btn.addEventListener('mousedown', handleStart);
        btn.addEventListener('mouseup', handleEnd);
        btn.addEventListener('mouseleave', handleEnd);
    });

    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log(e));
            lockOrientation();
        } else {
            document.exitFullscreen();
        }
    });
}

async function lockOrientation() {
    if (!isMobile) return;
    try {
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
        }
    } catch (e) {
        console.log("Orientation lock failed:", e);
    }
}

// --- UI Functions ---
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if(screens[screenName]) screens[screenName].classList.add('active');
    
    // Show/Hide mobile controls based on screen
    if (isMobile) {
        if (screenName === 'hud') {
            mobileControls.style.display = 'flex';
        } else {
            mobileControls.style.display = 'none';
        }
    }

    // Update music based on screen
    updateMusic(screenName);
    
    // Update tab title based on screen
    const titles = {
        'menu': 'Main Menu - Pixel Fighter',
        'lobby': 'Lobby - Pixel Fighter',
        'select': 'Character Select - Pixel Fighter',
        'hud': 'Battle! - Pixel Fighter',
        'gameOver': 'Game Over - Pixel Fighter'
    };
    document.title = titles[screenName] || 'Pixel Platform Fighter';
}

function updateHUD() {
    const hudContainer = document.getElementById('hud-container');
    
    // Ensure HUD elements exist for all players
    Object.keys(players).forEach(pid => {
        let playerHud = document.getElementById(`hud-${pid}`);
        if (!playerHud) {
            playerHud = document.createElement('div');
            playerHud.id = `hud-${pid}`;
            playerHud.className = `player-hud ${pid}-hud`;
            playerHud.style.width = Object.keys(players).length > 2 ? '200px' : '300px';
            playerHud.innerHTML = `
                <div class="name">${pid}</div>
                <div class="hp-bar-container">
                    <div id="${pid}-hp-bar" class="hp-bar"></div>
                </div>
                <div class="ult-cooldown-container">
                    <div id="${pid}-ult-bar" class="ult-bar"></div>
                    <span id="${pid}-ult-text" class="ult-text">ULT READY</span>
                </div>
            `;
            hudContainer.appendChild(playerHud);
        }
        
        const p = players[pid];
        const pct = Math.max(0, (p.hp / p.maxHp) * 100);
        document.getElementById(`${pid}-hp-bar`).style.width = `${pct}%`;
        
        const ultPct = p.ultimateCooldown > 0 ? (p.ultimateCooldown / p.maxUltimateCooldown) * 100 : 0;
        document.getElementById(`${pid}-ult-bar`).style.width = `${ultPct}%`;
        document.getElementById(`${pid}-ult-text`).innerText = p.ultimateCooldown > 0 ? `${Math.ceil(p.ultimateCooldown / 60)}s` : 'ULT READY';
    });
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
                if (data.maxPlayers > 2) {
                    document.getElementById('lobby-waiting-text').innerText = `Waiting for players (1/${data.maxPlayers})...`;
                } else {
                    document.getElementById('lobby-waiting-text').innerText = 'Waiting for Player 2...';
                }
                showScreen('lobby');
                break;
            case 'JOINED':
                roomCode = data.roomCode;
                myPlayerId = data.playerId;
                if (data.maxPlayers > 2) {
                    document.getElementById('select-message').innerText = 'Waiting for all players to join...';
                    showScreen('lobby');
                    document.getElementById('display-room-code').innerText = roomCode;
                    document.getElementById('lobby-waiting-text').innerText = `Waiting for players...`;
                } else {
                    showScreen('select');
                }
                break;
            case 'PLAYER_JOINED':
                if (data.maxPlayers > 2) {
                    document.getElementById('lobby-waiting-text').innerText = `Waiting for players (${data.currentPlayers}/${data.maxPlayers})...`;
                } else {
                    showScreen('select');
                }
                break;
            case 'ALL_PLAYERS_JOINED':
                showScreen('select');
                break;
            case 'GAME_START':
                // Initialize players
                Object.keys(data.state).forEach(pid => {
                    const s = data.state[pid];
                    players[pid] = new Player(pid, s.x, s.y, CHARACTERS[s.character]);
                    players[pid].facingRight = s.facingRight;
                });
                
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
                    p.ultimateCooldown = data.ultimateCooldown || 0;
                }
                break;
            case 'HP_UPDATE':
                if (data.hpData) {
                    Object.keys(data.hpData).forEach(pid => {
                        if (players[pid] && data.hpData[pid] < players[pid].hp) {
                            players[pid].hitTimer = 15;
                            playHitSound();
                            
                            // Apply knockback if it's me
                            if (myPlayerId === pid) {
                                // Find closest opponent for knockback direction
                                let closestOpponent = null;
                                let minDistance = Infinity;
                                Object.keys(players).forEach(otherPid => {
                                    if (otherPid !== pid && players[otherPid].hp > 0) {
                                        const dist = Math.abs(players[pid].x - players[otherPid].x);
                                        if (dist < minDistance) {
                                            minDistance = dist;
                                            closestOpponent = players[otherPid];
                                        }
                                    }
                                });
                                
                                if (closestOpponent) {
                                    const dir = players[pid].x > closestOpponent.x ? 1 : -1;
                                    players[pid].vx = dir * 8;
                                    players[pid].vy = -4;
                                }
                            }
                        }
                        if (players[pid]) {
                            players[pid].hp = data.hpData[pid];
                        }
                    });
                }
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
document.getElementById('game-mode').addEventListener('change', (e) => {
    const playersContainer = document.getElementById('players-count-container');
    if (e.target.value === 'deathmatch') {
        playersContainer.style.display = 'block';
    } else {
        playersContainer.style.display = 'none';
    }
});

document.getElementById('btn-host').addEventListener('click', () => {
    const gameMode = document.getElementById('game-mode').value;
    let maxPlayers = 2;
    if (gameMode === 'deathmatch') {
        maxPlayers = parseInt(document.getElementById('max-players').value, 10);
    }
    
    connectWebSocket();
    ws.onopen = () => ws.send(JSON.stringify({ type: 'HOST', gameMode, maxPlayers }));
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
    document.getElementById('hud-container').innerHTML = ''; // Clear dynamic HUD
    
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
                action: myP.action,
                ultimateCooldown: myP.ultimateCooldown
            }));
            lastSync = timestamp;
        }
    }
    
    // Update Remote Player Timers
    Object.keys(players).forEach(pid => {
        if (pid !== myPlayerId) {
            players[pid].updateTimers();
        }
    });

    // Draw Players
    Object.values(players).forEach(p => {
        if (p.hp > 0 || p.hitTimer > 0) { // Draw if alive or still showing hit effect
            p.draw(ctx, timestamp);
        }
    });

    updateHUD();
    requestAnimationFrame(gameLoop);
}

// Initialize
async function init() {
    await loadCharacterData();
    setupMobileControls();
    showScreen('start');
    
    // Start music and lock orientation on first interaction
    document.getElementById('btn-start-game').addEventListener('click', () => {
        showScreen('menu');
        if (menuMusic.paused) {
            menuMusic.play().catch(e => {});
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        lockOrientation();
    }, { once: true });
}
init();
