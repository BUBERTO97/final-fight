import fs from 'fs';
import path from 'path';

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

function getCharacterSVGContent(char, animName, frameIndex, totalFrames, offsetX) {
    let svg = '';
    const x = offsetX;
    const y = 0;

    // Animate bobbing
    let yOffset = 0;
    if (animName === 'idle') {
        yOffset = Math.sin((frameIndex / totalFrames) * Math.PI * 2) * 2;
    } else if (animName === 'run') {
        yOffset = Math.abs(Math.sin((frameIndex / totalFrames) * Math.PI * 2)) * -4;
    }

    // Base body using SVG path
    const bodyPath = `M ${x + 16} ${y + 16 + yOffset} h 32 v ${48 - yOffset} h -32 Z`;
    svg += `<path d="${bodyPath}" fill="${char.color}" />`;

    // Eyes
    svg += `<path d="M ${x + 36} ${y + 24 + yOffset} h 4 v 4 h -4 Z" fill="${char.eyeColor}" />`;
    svg += `<path d="M ${x + 44} ${y + 24 + yOffset} h 4 v 4 h -4 Z" fill="${char.eyeColor}" />`;

    // Animation specific details
    if (animName === 'attack') {
        svg += `<path d="M ${x + 48} ${y + 32 + yOffset} h 16 v 4 h -16 Z" fill="#ffffff" />`;
    } else if (animName === 'ultimate') {
        const radius = 24 + Math.sin((frameIndex / totalFrames) * Math.PI * 2) * 8;
        svg += `<circle cx="${x + 32}" cy="${y + 32 + yOffset}" r="${radius}" fill="${char.eyeColor}" opacity="0.5" />`;
    }
    return svg;
}

function generateSpriteSheetSVG(char, anim) {
    const width = FRAME_WIDTH * anim.frames;
    const height = FRAME_HEIGHT;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;

    for (let i = 0; i < anim.frames; i++) {
        svg += getCharacterSVGContent(char, anim.name, i, anim.frames, i * FRAME_WIDTH) + '\n';
    }

    svg += `</svg>`;

    const outPath = `./public/sprites/${char.id}_${anim.name}.svg`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg);
    console.log(`Generated ${outPath}`);
}

function generatePortraitSVG(char) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">\n`;
    svg += `<rect width="128" height="128" fill="#222" />\n`;
    svg += `<path d="M 32 32 h 64 v 96 h -64 Z" fill="${char.color}" />\n`;
    svg += `<path d="M 72 48 h 8 v 8 h -8 Z" fill="${char.eyeColor}" />\n`;
    svg += `<path d="M 88 48 h 8 v 8 h -8 Z" fill="${char.eyeColor}" />\n`;
    svg += `</svg>`;

    const outPath = `./public/ui/portraits/${char.jsonId}.svg`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg);
    console.log(`Generated ${outPath}`);
}

function generateIconSVG(char) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n`;
    svg += `<rect width="64" height="64" fill="#222" />\n`;
    svg += `<path d="M 16 16 h 32 v 48 h -32 Z" fill="${char.color}" />\n`;
    svg += `<path d="M 36 24 h 4 v 4 h -4 Z" fill="${char.eyeColor}" />\n`;
    svg += `<path d="M 44 24 h 4 v 4 h -4 Z" fill="${char.eyeColor}" />\n`;
    svg += `</svg>`;

    const outPath = `./public/ui/icons/${char.jsonId}_icon.svg`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg);
    console.log(`Generated ${outPath}`);
}

function main() {
    for (const char of characters) {
        for (const anim of char.animations) {
            generateSpriteSheetSVG(char, anim);
        }
        generatePortraitSVG(char);
        generateIconSVG(char);
    }
    console.log("Done generating all SVG placeholder art.");
}

main();
