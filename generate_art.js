import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const characters = [
  {
    id: 'shadow',
    jsonId: 'shadow_assassin',
    desc: 'dark ninja assassin, slim agile body, hooded figure, glowing purple eyes, dual daggers, shadow aura trailing behind movements',
    palette: 'black, dark purple, deep blue highlights',
    style: 'stealthy, mysterious, high contrast',
    animations: [
      { name: 'idle', frames: 4, desc: 'subtle breathing with shadow flicker' },
      { name: 'run', frames: 6, desc: 'fast ninja sprint with motion blur shadows' },
      { name: 'attack', frames: 5, desc: 'rapid dual dagger slashes' },
      { name: 'ultimate', frames: 7, desc: 'teleport dash with shadow clones' }
    ]
  },
  {
    id: 'frost',
    jsonId: 'frost_mage',
    desc: 'ice mage, slender robed character, glowing blue staff, floating icy crystals orbiting, hood with frost particles',
    palette: 'light blue, white, cyan, soft glow',
    style: 'magical, cold, elegant',
    animations: [
      { name: 'idle', frames: 4, desc: 'floating ice shards rotating slowly' },
      { name: 'run', frames: 6, desc: 'gliding movement with frost trail' },
      { name: 'attack', frames: 5, desc: 'casting ice projectile from staff' },
      { name: 'ultimate', frames: 8, desc: 'large blizzard explosion around character' }
    ]
  },
  {
    id: 'flame',
    jsonId: 'flame_berserker',
    desc: 'muscular warrior infused with fire, spiked armor, flaming hair, large flaming axe, embers constantly falling from body',
    palette: 'red, orange, yellow, dark brown armor',
    style: 'aggressive, chaotic, powerful',
    animations: [
      { name: 'idle', frames: 4, desc: 'flames flickering around body' },
      { name: 'run', frames: 6, desc: 'aggressive forward charge with fire trail' },
      { name: 'attack', frames: 6, desc: 'heavy axe swing with fire arc' },
      { name: 'ultimate', frames: 8, desc: 'explosion of flames engulfing character' }
    ]
  },
  {
    id: 'tech',
    jsonId: 'tech_guardian',
    desc: 'bulky sci-fi robot tank, heavy armor plating, glowing teal energy core in chest, large mechanical arms, shield generator on back',
    palette: 'teal, dark gray, metallic tones',
    style: 'futuristic, heavy, defensive',
    animations: [
      { name: 'idle', frames: 3, desc: 'subtle mechanical movement and energy pulsing' },
      { name: 'run', frames: 5, desc: 'slow heavy steps with weight impact' },
      { name: 'attack', frames: 4, desc: 'mechanical punch or energy slam' },
      { name: 'ultimate', frames: 6, desc: 'deploy large energy shield dome' }
    ]
  },
  {
    id: 'storm',
    jsonId: 'storm_archer',
    desc: 'agile archer infused with lightning, light armor, glowing bow made of electricity, hair flowing with electric sparks',
    palette: 'yellow, electric blue, white',
    style: 'fast, energetic, precise',
    animations: [
      { name: 'idle', frames: 4, desc: 'small lightning sparks around body' },
      { name: 'run', frames: 6, desc: 'fast movement with electric trails' },
      { name: 'attack', frames: 5, desc: 'shooting lightning arrows' },
      { name: 'ultimate', frames: 7, desc: 'rain of arrows falling from sky with lightning strikes' }
    ]
  }
];

async function generateImage(prompt, outputPath, aspectRatio = "4:1") {
    console.log(`Generating ${outputPath}...`);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: prompt,
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio,
                    imageSize: "1K"
                }
            }
        });
        
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const buffer = Buffer.from(part.inlineData.data, 'base64');
                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                fs.writeFileSync(outputPath, buffer);
                console.log(`Saved ${outputPath}`);
                return;
            }
        }
    } catch (e) {
        console.error(`Failed to generate ${outputPath}:`, e.message);
    }
}

async function main() {
    for (const char of characters) {
        for (const anim of char.animations) {
            let ratio = "4:1";
            if (anim.frames === 5) ratio = "4:1";
            if (anim.frames === 6) ratio = "8:1";
            if (anim.frames === 7) ratio = "8:1";
            if (anim.frames === 8) ratio = "8:1";
            if (anim.frames === 3) ratio = "4:1";
            
            const spritePrompt = `Pixel art sprite sheet, strict grid, aligned in a single horizontal row, equal spacing, same character scale in all frames, black background. Character: ${char.desc}. Animation: ${anim.desc}. Color palette: ${char.palette}. Style: ${char.style}.`;
            await generateImage(spritePrompt, `./public/sprites/${char.id}_${anim.name}.png`, ratio);
            
            // Add a small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 2000));
        }
        
        const portraitPrompt = `Pixel art portrait, head and shoulders, high quality, black background. Character: ${char.desc}. Color palette: ${char.palette}. Style: ${char.style}.`;
        await generateImage(portraitPrompt, `./public/ui/portraits/${char.jsonId}.png`, "1:1");
        await new Promise(r => setTimeout(r, 2000));
        
        const iconPrompt = `Pixel art icon, close up face, high quality, black background. Character: ${char.desc}. Color palette: ${char.palette}. Style: ${char.style}.`;
        await generateImage(iconPrompt, `./public/ui/icons/${char.jsonId}_icon.png`, "1:1");
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log("Done generating all art.");
}

main();
