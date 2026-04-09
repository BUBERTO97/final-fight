import * as THREE from 'three';

// --- Constants & Config ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FLOOR_Y = 500;
const GRAVITY = 0.6;

// --- Audio Setup ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

const menuMusic = new Audio('/songs/menu_2.mp3');
menuMusic.loop = true;
menuMusic.volume = 1;

const gameMusicPlaylist = [
    '/songs/game_1.mp3',
    '/songs/game_2.mp3',
    '/songs/game_3.mp3'
];
let gameMusicIndex = 0;
let gameMusicAudio = null;
let gameMusicGain = null;
let gameMusicSource = null;
let gameMusicPlaying = false;
const FADE_IN_DURATION = 2; // seconds

function startGameMusic() {
    if (gameMusicPlaying) return;
    gameMusicPlaying = true;
    gameMusicIndex = 0;
    playGameTrack(gameMusicIndex);
}

function playGameTrack(index) {
    if (!gameMusicPlaying) return;
    if (gameMusicAudio) {
        gameMusicAudio.pause();
        gameMusicAudio.removeEventListener('ended', onGameTrackEnded);
    }
    if (gameMusicSource) {
        try { gameMusicSource.disconnect(); } catch(e) {}
        gameMusicSource = null;
    }

    gameMusicAudio = new Audio(gameMusicPlaylist[index]);
    gameMusicAudio.loop = false;

    if (audioCtx.state === 'suspended') audioCtx.resume();
    gameMusicSource = audioCtx.createMediaElementSource(gameMusicAudio);
    gameMusicGain = audioCtx.createGain();
    gameMusicGain.gain.setValueAtTime(0, audioCtx.currentTime);
    gameMusicGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + FADE_IN_DURATION);

    gameMusicSource.connect(gameMusicGain);
    gameMusicGain.connect(audioCtx.destination);

    gameMusicAudio.addEventListener('ended', onGameTrackEnded);
    gameMusicAudio.play().catch(e => console.warn('Game music play failed:', e));
}

function onGameTrackEnded() {
    if (!gameMusicPlaying) return;
    gameMusicIndex = (gameMusicIndex + 1) % gameMusicPlaylist.length;
    playGameTrack(gameMusicIndex);
}

function stopGameMusic() {
    gameMusicPlaying = false;
    if (gameMusicAudio) gameMusicAudio.pause();
}

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
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
let ws;

// --- Game State ---
let gameState = 'MENU';
let myPlayerId = null;
let roomCode = null;
let players = {};
let myCharacter = null;
let gameMode = '1v1';
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const keys = {};
let maxPlayers = 3;

const CHARACTERS = {
    ShadowAssassin: { ultimateSkill: function (player) { player.action = 'ultimate'; player.actionTimer = 20; } },
    FrostMage: { ultimateSkill: function (player) { player.action = 'ultimate'; player.actionTimer = 40; } },
    FlameBerserker: { ultimateSkill: function (player) { player.action = 'ultimate'; player.actionTimer = 60; } },
    TechGuardian: { ultimateSkill: function (player) { player.action = 'ultimate'; player.actionTimer = 60; } },
    StormArcher: { ultimateSkill: function (player) { player.action = 'ultimate'; player.actionTimer = 30; } }
};

async function loadCharacterData() {
    const chars = ['ShadowAssassin', 'FrostMage', 'FlameBerserker', 'TechGuardian', 'StormArcher'];
    const promises = chars.map(async (charKey) => {
        try {
            const response = await fetch(`/characters/${charKey}.json`);
            if (response.ok) {
                Object.assign(CHARACTERS[charKey], await response.json());
            }
        } catch (e) {
            console.error(e);
        }
    });
    await Promise.all(promises);
    buildCharacterSelectUI();
}

// --- Three.js Setup ---
console.log("Initializing Three.js...");
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.OrthographicCamera(0, 800, 0, 600, 0.1, 1000);
camera.position.z = 100;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// UI Groups
const screens = {
    start: new THREE.Group(),
    menu: new THREE.Group(),
    lobby: new THREE.Group(),
    select: new THREE.Group(),
    hud: new THREE.Group(),
    gameOver: new THREE.Group(),
    gameWorld: new THREE.Group()
};
Object.values(screens).forEach(s => {
    s.visible = false;
    scene.add(s);
});

const texLoader = new THREE.TextureLoader();

function createUIButton(text, w, h, bg, x, y, onClick, onDown, onUp) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const cctx = cvs.getContext('2d');
    cctx.fillStyle = bg;
    cctx.fillRect(0, 0, w, h);
    cctx.strokeStyle = '#fff';
    cctx.lineWidth = 4;
    cctx.strokeRect(0, 0, w, h);
    cctx.fillStyle = '#fff';
    cctx.font = `14px "Press Start 2P", monospace`;
    cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    cctx.fillText(text, w/2, h/2);

    const tex = new THREE.CanvasTexture(cvs);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x + w/2, y + h/2, 10);
    mesh.userData = { onClick, onDown, onUp };
    return mesh;
}

function createUIText(text, size, color, w, h, x, y) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const cctx = cvs.getContext('2d');
    cctx.fillStyle = color;
    cctx.font = `${size}px "Press Start 2P", monospace`;
    cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    cctx.fillText(text, w/2, h/2);

    const tex = new THREE.CanvasTexture(cvs);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x + w/2, y + h/2, 5);
    
    mesh.userData = { cvs, cctx, tex, w, h, color, size };
    return mesh;
}

function updateUIText(mesh, text) {
    const data = mesh.userData;
    data.cctx.clearRect(0,0,data.w,data.h);
    data.cctx.fillStyle = data.color;
    data.cctx.fillText(text, data.w/2, data.h/2);
    data.tex.needsUpdate = true;
}

// Build UI Elements
screens.start.add(createUIText("PIXEL FIGHTER", 36, "#e74c3c", 600, 100, 100, 200));
screens.start.add(createUIButton("Click to Start", 250, 60, "#3498db", 275, 350, () => {
    showScreen('menu');
    if (audioCtx.state === 'suspended') audioCtx.resume();
    menuMusic.play().catch(()=>{});
}));

screens.menu.add(createUIText("PIXEL FIGHTER", 24, "#fff", 800, 50, 0, 50));

const hiddenCode = document.getElementById('hidden-room-code');
const hiddenName = document.getElementById('hidden-player-name');

const modeBtn = createUIButton("Mode: 1v1", 250, 50, "#333", 275, 150, () => {
    gameMode = gameMode === '1v1' ? 'deathmatch' : '1v1';
    const ctx = modeBtn.material.map.image.getContext('2d');
    ctx.fillStyle = "#333"; ctx.fillRect(0,0,250,50);
    ctx.strokeStyle = "#fff"; ctx.strokeRect(0,0,250,50);
    ctx.fillStyle = "#fff"; ctx.fillText(`Mode: ${gameMode}`, 125, 25);
    modeBtn.material.map.needsUpdate = true;
});
screens.menu.add(modeBtn);

screens.menu.add(createUIButton("Host Game", 250, 50, "#27ae60", 275, 220, () => {
    connectWebSocket();
    ws.onopen = () => ws.send(JSON.stringify({ type: 'HOST', gameMode, maxPlayers }));
}));

const joinCodeText = createUIText("[CODE]", 16, "#f1c40f", 250, 50, 275, 350);
screens.menu.add(joinCodeText);

screens.menu.add(createUIButton("Enter Code", 250, 50, "#e67e22", 275, 410, () => {
    hiddenCode.focus();
}));

screens.menu.add(createUIButton("Join Room", 250, 50, "#3498db", 275, 480, () => {
    if (hiddenCode.value.length === 4) {
        connectWebSocket();
        ws.onopen = () => ws.send(JSON.stringify({ type: 'JOIN', roomCode: hiddenCode.value }));
    } else {
        alert("Enter 4-digit code first!");
    }
}));

hiddenCode.addEventListener('input', () => {
    updateUIText(joinCodeText, hiddenCode.value || "[CODE]");
});

const lobbyText = createUIText("Room Code: ----", 24, "#fff", 800, 50, 0, 200);
const lobbyWait = createUIText("Waiting for P2...", 16, "#ccc", 800, 50, 0, 300);
screens.lobby.add(lobbyText);
screens.lobby.add(lobbyWait);

const selNameText = createUIText("[NAME]", 16, "#f1c40f", 200, 50, 300, 100);
screens.select.add(selNameText);
screens.select.add(createUIText("Select Character", 20, "#fff", 800, 50, 0, 50));
screens.select.add(createUIButton("Set Name", 150, 40, "#e67e22", 325, 150, () => {
    hiddenName.focus();
}));

hiddenName.addEventListener('input', () => {
    updateUIText(selNameText, hiddenName.value || "[NAME]");
});

const selStatus = createUIText("Waiting...", 16, "#ccc", 800, 50, 0, 500);
screens.select.add(selStatus);

// Build HUD
if (isMobile) {
    // D-Pad
    screens.hud.add(createUIButton("▲", 60, 60, "rgba(255,255,255,0.2)", 100, 400, null, () => keys['arrowup'] = true, () => keys['arrowup'] = false));
    screens.hud.add(createUIButton("◀", 60, 60, "rgba(255,255,255,0.2)", 30, 470, null, () => keys['arrowleft'] = true, () => keys['arrowleft'] = false));
    screens.hud.add(createUIButton("▶", 60, 60, "rgba(255,255,255,0.2)", 170, 470, null, () => keys['arrowright'] = true, () => keys['arrowright'] = false));
    
    // Actions
    screens.hud.add(createUIButton("A", 80, 80, "rgba(231,76,60,0.3)", 650, 450, null, () => keys[' '] = true, () => keys[' '] = false));
    screens.hud.add(createUIButton("U", 80, 80, "rgba(241,196,15,0.3)", 550, 450, null, () => keys['e'] = true, () => keys['e'] = false));
}

function buildCharacterSelectUI() {
    let xOffset = 25;
    Object.keys(CHARACTERS).forEach(charKey => {
        const char = CHARACTERS[charKey];
        const name = char.name ? char.name.split(' ')[0] : charKey;
        const btn = createUIButton(name, 140, 140, "#333", xOffset, 250, () => {
            myCharacter = charKey;
            const playerName = hiddenName.value.trim() || myPlayerId || 'Player';
            ws.send(JSON.stringify({ type: 'SELECT_CHARACTER', character: myCharacter, playerName }));
            updateUIText(selStatus, "Ready! Waiting...");
        });
        screens.select.add(btn);
        xOffset += 155;
    });
}

const goTitle = createUIText("GAME OVER", 48, "#e74c3c", 800, 100, 0, 200);
screens.gameOver.add(goTitle);
screens.gameOver.add(createUIButton("OK", 150, 50, "#3498db", 325, 350, () => {
    if (ws) ws.close();
    players = {}; myPlayerId = null; roomCode = null; myCharacter = null;
    showScreen('menu');
}));

// Game World
const floorMat = new THREE.MeshBasicMaterial({ color: 0x27ae60, side: THREE.DoubleSide });
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(800, 600 - FLOOR_Y), floorMat);
floorMesh.position.set(400, FLOOR_Y + (600 - FLOOR_Y)/2, 0);
screens.gameWorld.add(floorMesh);

class Sprite {
    constructor(charKey) {
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(50, 70), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide }));
        this.texMap = {};
        this.config = CHARACTERS[charKey] || {};
        const states = ['idle', 'run', 'attack', 'ultimate'];
        states.forEach(s => {
            const src = this.config.visual?.sprites?.[s]?.src || `sprites/${charKey.toLowerCase().split(' ')[0]}_${s}.svg`;
            if(src) {
                texLoader.load('/' + src, tex => {
                    tex.minFilter = THREE.NearestFilter;
                    tex.magFilter = THREE.NearestFilter;
                    this.texMap[s] = tex;
                    if (s === 'idle') this.mesh.material.map = this.texMap['idle'];
                });
            }
        });
    }

    draw(x, y, state, facingRight) {
        if (this.texMap[state]) {
            this.mesh.material.map = this.texMap[state];
        } else if (this.texMap['idle']) {
            this.mesh.material.map = this.texMap['idle'];
        }
        this.mesh.scale.x = facingRight ? 1 : -1;
        this.mesh.position.set(x + 25, y + 35, 1);
    }
}

class Player {
    constructor(id, x, y, charConfig, playerName) {
        this.id = id; this.x = x; this.y = y; this.vx = 0; this.vy = 0;
        this.hp = 100; this.maxHp = 100;
        this.facingRight = true; this.action = 'idle';
        this.actionTimer = 0; this.hitTimer = 0;
        this.ultimateCooldown = 0; this.attackCooldown = 0;
        this.sprite = new Sprite(charConfig.id || "ShadowAssassin");
        screens.gameWorld.add(this.sprite.mesh);

        this.nameMesh = createUIText(playerName || id, 10, "#fff", 150, 20, 0, 0);
        screens.gameWorld.add(this.nameMesh);
        
        this.hpMesh = new THREE.Mesh(new THREE.PlaneGeometry(50, 5), new THREE.MeshBasicMaterial({ color: 0x2ecc71, side: THREE.DoubleSide }));
        screens.gameWorld.add(this.hpMesh);
    }
    
    update() {
        if (this.hitTimer > 0) this.hitTimer--;
        if (this.ultimateCooldown > 0) this.ultimateCooldown--;
        if (this.attackCooldown > 0) this.attackCooldown--;
        if (this.actionTimer > 0) {
            this.actionTimer--;
            if (this.actionTimer === 0) this.action = 'idle';
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vy += GRAVITY;
        if (this.y > FLOOR_Y - 70) {
            this.y = FLOOR_Y - 70;
            this.vy = 0;
        }

        if (this.hitTimer > 0) {
            this.sprite.mesh.material.color.setHex(0xff3333);
        } else {
            this.sprite.mesh.material.color.setHex(0xffffff);
        }
    }

    draw() {
        this.sprite.draw(this.x, this.y, this.action, this.facingRight);
        this.nameMesh.position.set(this.x + 25, this.y - 10, 5);
        this.hpMesh.position.set(this.x + 25, this.y - 20, 5);
        this.hpMesh.scale.x = Math.max(0, this.hp / 100);
        this.hpMesh.position.x = this.x + 25 - (50 - 50 * this.hpMesh.scale.x)/2;
    }

    destroy() {
        screens.gameWorld.remove(this.sprite.mesh);
        screens.gameWorld.remove(this.nameMesh);
        screens.gameWorld.remove(this.hpMesh);
    }
}

function showScreen(name) {
    Object.values(screens).forEach(s => s.visible = false);
    if(screens[name]) screens[name].visible = true;
    
    if (name === 'gameWorld' || name === 'hud') {
        screens.gameWorld.visible = true;
        screens.hud.visible = true;
        scene.background = new THREE.Color(0x87CEEB);
        menuMusic.pause();
        startGameMusic();
    } else {
        scene.background = new THREE.Color(0x111111);
        stopGameMusic();
        if (menuMusic.paused && name !== 'start') menuMusic.play().catch(()=>{});
    }
}

window.addEventListener('keydown', e => { 
    keys[e.key.toLowerCase()] = true; 
    // If in menu and user starts typing numbers, focus room code
    if (gameState === 'MENU' && screens.menu.visible && /^[0-9]$/.test(e.key) && document.activeElement !== hiddenCode) {
        hiddenCode.focus();
    }
    // If in character select and user starts typing, focus player name
    if (gameState === 'MENU' && screens.select.visible && /^[a-zA-Z0-9]$/.test(e.key) && document.activeElement !== hiddenName) {
        hiddenName.focus();
    }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function clearKeys() {
    Object.keys(keys).forEach(k => keys[k] = false);
}
window.addEventListener('pointerup', clearKeys);
window.addEventListener('pointerleave', clearKeys);

window.addEventListener('pointerdown', e => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const visibleScreens = Object.values(screens).filter(s => s.visible);
    let intersects = [];
    // Only intersect with the top-most visible screen to save performance
    for (let i = visibleScreens.length - 1; i >= 0; i--) {
        const s = visibleScreens[i];
        intersects = raycaster.intersectObjects(s.children, true);
        if (intersects.length > 0) break;
    }

    if (intersects.length > 0) {
        for(let i=0; i<intersects.length; i++){
            const obj = intersects[i].object;
            if (obj.userData) {
                if (obj.userData.onClick) obj.userData.onClick();
                if (obj.userData.onDown) obj.userData.onDown();
                obj.userData.isDown = true;
                break;
            }
        }
    }
});

window.addEventListener('pointerup', e => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const visibleScreens = Object.values(screens).filter(s => s.visible);
    visibleScreens.forEach(s => {
        s.children.forEach(obj => {
            if (obj.userData && obj.userData.isDown) {
                if (obj.userData.onUp) obj.userData.onUp();
                obj.userData.isDown = false;
            }
        });
    });
    clearKeys();
});

let lastWidth = 0, lastHeight = 0;
function resize() {
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    if (window.innerWidth === lastWidth && window.innerHeight === lastHeight) return;
    
    lastWidth = window.innerWidth;
    lastHeight = window.innerHeight;
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    
    const targetAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
    if (aspect >= targetAspect) { // Window is wider
        const width = CANVAS_HEIGHT * aspect;
        camera.left = -(width - CANVAS_WIDTH)/2;
        camera.right = CANVAS_WIDTH + (width - CANVAS_WIDTH)/2;
        camera.top = 0;
        camera.bottom = CANVAS_HEIGHT;
    } else {
        const height = CANVAS_WIDTH / aspect;
        camera.left = 0;
        camera.right = CANVAS_WIDTH;
        camera.top = -(height - CANVAS_HEIGHT)/2;
        camera.bottom = CANVAS_HEIGHT + (height - CANVAS_HEIGHT)/2;
    }
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        switch (data.type) {
            case 'ROOM_CREATED':
            case 'JOINED':
                roomCode = data.roomCode;
                myPlayerId = data.playerId;
                updateUIText(lobbyText, `Room Code: ${roomCode}`);
                if (data.maxPlayers > 2) {
                    updateUIText(lobbyWait, `Waiting for players...`);
                }
                showScreen(data.type==='JOINED' ? 'select' : 'lobby');
                break;
            case 'ALL_PLAYERS_JOINED':
                showScreen('select');
                break;
            case 'GAME_START':
                Object.values(players).forEach(p => p.destroy());
                players = {};
                Object.keys(data.state).forEach(pid => {
                    players[pid] = new Player(pid, data.state[pid].x, data.state[pid].y, CHARACTERS[data.state[pid].character] || {id: data.state[pid].character}, data.state[pid].playerName);
                });
                gameState = 'PLAYING';
                showScreen('gameWorld');
                break;
            case 'STATE_UPDATE':
                if (players[data.playerId]) {
                    const p = players[data.playerId];
                    p.x = data.x; p.y = data.y;
                    p.facingRight = data.facingRight;
                    p.action = data.action;
                }
                break;
            case 'HP_UPDATE':
                if (data.hpData) {
                    Object.keys(data.hpData).forEach(pid => {
                        if (players[pid] && data.hpData[pid] < players[pid].hp) {
                            players[pid].hitTimer = 15;
                            playHitSound();
                            if (myPlayerId === pid) {
                                // Simple knockback
                                players[pid].vy = -4; 
                            }
                        }
                        if (players[pid]) players[pid].hp = data.hpData[pid];
                    });
                }
                break;
            case 'GAME_OVER':
                gameState = 'GAME_OVER';
                updateUIText(goTitle, data.winner === myPlayerId ? "YOU WIN" : "GAME OVER");
                showScreen('gameOver');
                break;
        }
    }
}

let lastSync = 0;
let frameCount = 0;
renderer.setAnimationLoop((time) => {
    frameCount++;
    
    if (gameState === 'PLAYING') {
        const myP = players[myPlayerId];
        if (myP && myP.hp > 0) {
            myP.vx = 0;
            if ((keys['a'] || keys['arrowleft']) && myP.hitTimer===0) { myP.vx = -5; myP.facingRight=false; myP.action='run'; }
            if ((keys['d'] || keys['arrowright']) && myP.hitTimer===0) { myP.vx = 5; myP.facingRight=true; myP.action='run'; }
            if ((keys['w'] || keys['arrowup']) && myP.y >= FLOOR_Y - 70 && myP.hitTimer===0) { myP.vy = -12; }
            if (keys[' '] && myP.hitTimer===0 && myP.attackCooldown === 0) { 
                myP.action='attack'; 
                myP.actionTimer = 15; 
                myP.attackCooldown = 30;
                // send hit
                const target = Object.keys(players).find(id=>id!==myPlayerId);
                if (target) {
                    ws.send(JSON.stringify({
                        type: 'ATTACK_HIT',
                        targetId: target,
                        damage: 10
                    }));
                }
            }
            if (keys['e'] && myP.hitTimer===0 && myP.ultimateCooldown === 0) { 
                myP.vx = 0;
                if (myP.config.ultimateSkill) myP.config.ultimateSkill(myP);
                else { myP.action='ultimate'; myP.actionTimer=20; }
                myP.ultimateCooldown = 100; // placeholder
            }
            if (myP.vx===0 && myP.action!=='attack' && myP.action!=='ultimate') myP.action = 'idle';

            if (time - lastSync > 33) {
                ws.send(JSON.stringify({ type: 'UPDATE_STATE', x: myP.x, y: myP.y, facingRight: myP.facingRight, action: myP.action }));
                lastSync = time;
            }
        }

        Object.values(players).forEach(p => {
            if(p.hp > 0 || p.hitTimer > 0) {
                p.update();
                p.draw();
            } else {
                 p.hpMesh.visible = false;
                 p.nameMesh.visible = false;
                 p.sprite.mesh.visible = false;
            }
        });
    }
    renderer.render(scene, camera);
});

loadCharacterData();
showScreen('start');

document.fonts.ready.then(() => {
    Object.values(screens).forEach(s => {
        s.children.forEach(obj => {
            if (obj.userData && obj.userData.tex) {
                updateUIText(obj, obj.userData.cvs.getContext('2d').measureText("").width === 0 ? "" : ""); // Trigger redraw
                // Actually, let's just rebuild the UI or force update
                if (obj.userData.onClick || obj.userData.onDown) {
                    // It's a button, redraw it
                    const ctx = obj.userData.cvs.getContext('2d');
                    // We don't have the original text stored easily for buttons, 
                    // but we can just set needsUpdate and hope for the best if it was already drawn.
                    // Better: updateUIText already does this for text meshes.
                }
            }
        });
    });
});
