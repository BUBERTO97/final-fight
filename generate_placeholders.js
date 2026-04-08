import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

const characters = [
  {
    id: 'shadow',
    jsonId: 'shadow_assassin',
    color: '#2c3e50',
    eyeColor: '#9b59b6',
    animations: [
      { name: 'idle', frames: 4 },
      { name: 'run', frames: 6 },
      { name: 'attack', frames: 5 },
      { name: 'ultimate', frames: 7 }
    ]
  },
  {
    id: 'frost',
    jsonId: 'frost_mage',
    color: '#3498db',
    eyeColor: '#ecf0f1',
    animations: [
      { name: 'idle', frames: 4 },
      { name: 'run', frames: 6 },
      { name: 'attack', frames: 5 },
      { name: 'ultimate', frames: 8 }
    ]
  },
  {
    id: 'flame',
    jsonId: 'flame_berserker',
    color: '#e74c3c',
    eyeColor: '#f1c40f',
    animations: [
      { name: 'idle', frames: 4 },
      { name: 'run', frames: 6 },
      { name: 'attack', frames: 6 },
      { name: 'ultimate', frames: 8 }
    ]
  },
  {
    id: 'tech',
    jsonId: 'tech_guardian',
    color: '#1abc9c',
    eyeColor: '#f39c12',
    animations: [
      { name: 'idle', frames: 3 },
      { name: 'run', frames: 5 },
      { name: 'attack', frames: 4 },
      { name: 'ultimate', frames: 6 }
    ]
  },
  {
    id: 'storm',
    jsonId: 'storm_archer',
    color: '#f1c40f',
    eyeColor: '#3498db',
    animations: [
      { name: 'idle', frames: 4 },
      { name: 'run', frames: 6 },
      { name: 'attack', frames: 5 },
      { name: 'ultimate', frames: 7 }
    ]
  }
];

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 64;

function drawCharacter(ctx, x, y, char, animName, frameIndex, totalFrames) {
    // Base body
    ctx.fillStyle = char.color;
    
    // Animate bobbing
    let yOffset = 0;
    if (animName === 'idle') {
        yOffset = Math.sin((frameIndex / totalFrames) * Math.PI * 2) * 2;
    } else if (animName === 'run') {
        yOffset = Math.abs(Math.sin((frameIndex / totalFrames) * Math.PI * 2)) * -4;
    }
    
    ctx.fillRect(x + 16, y + 16 + yOffset, 32, 48 - yOffset);
    
    // Eyes
    ctx.fillStyle = char.eyeColor;
    ctx.fillRect(x + 36, y + 24 + yOffset, 4, 4);
    ctx.fillRect(x + 44, y + 24 + yOffset, 4, 4);
    
    // Animation specific details
    if (animName === 'attack') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + 48, y + 32 + yOffset, 16, 4); // Weapon thrust
    } else if (animName === 'ultimate') {
        ctx.fillStyle = char.eyeColor;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x + 32, y + 32 + yOffset, 24 + Math.sin((frameIndex / totalFrames) * Math.PI * 2) * 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

function generateSpriteSheet(char, anim) {
    const width = FRAME_WIDTH * anim.frames;
    const height = FRAME_HEIGHT;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    for (let i = 0; i < anim.frames; i++) {
        drawCharacter(ctx, i * FRAME_WIDTH, 0, char, anim.name, i, anim.frames);
    }
    
    const outPath = `./public/sprites/${char.id}_${anim.name}.png`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`Generated ${outPath}`);
}

function generatePortrait(char) {
    const canvas = createCanvas(128, 128);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 128, 128);
    
    ctx.fillStyle = char.color;
    ctx.fillRect(32, 32, 64, 96);
    
    ctx.fillStyle = char.eyeColor;
    ctx.fillRect(72, 48, 8, 8);
    ctx.fillRect(88, 48, 8, 8);
    
    const outPath = `./public/ui/portraits/${char.jsonId}.png`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`Generated ${outPath}`);
}

function generateIcon(char) {
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 64, 64);
    
    ctx.fillStyle = char.color;
    ctx.fillRect(16, 16, 32, 48);
    
    ctx.fillStyle = char.eyeColor;
    ctx.fillRect(36, 24, 4, 4);
    ctx.fillRect(44, 24, 4, 4);
    
    const outPath = `./public/ui/icons/${char.jsonId}_icon.png`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    console.log(`Generated ${outPath}`);
}

function main() {
    for (const char of characters) {
        for (const anim of char.animations) {
            generateSpriteSheet(char, anim);
        }
        generatePortrait(char);
        generateIcon(char);
    }
    console.log("Done generating all placeholder art.");
}

main();
