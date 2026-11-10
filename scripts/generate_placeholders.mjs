import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Minimal pure-Node RGBA PNG encoder (zero external dependencies)
 */
function encodePNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Filter byte 0 at start of each scanline
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0;
    rgbaBuffer.copy(
      rawData,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const compressed = zlib.deflateSync(rawData);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4, 0);
  }

  setPixel(x, y, [r, g, b, a = 255]) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = a;
  }

  fillRect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setPixel(x + dx, y + dy, color);
      }
    }
  }

  drawLine(x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0),
      sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0),
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      this.setPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  save(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, encodePNG(this.width, this.height, this.data));
  }
}

// Color Palette
const C = {
  outline: [18, 16, 32, 255],
  skin: [245, 200, 158, 255],
  skinShade: [204, 150, 110, 255],
  hair: [45, 210, 255, 255],
  hairShade: [22, 130, 185, 255],
  bandana: [235, 55, 90, 255],
  jacket: [50, 62, 115, 255],
  jacketLight: [82, 102, 175, 255],
  shirt: [235, 240, 250, 255],
  pants: [36, 40, 68, 255],
  boots: [25, 22, 38, 255],
  guitarBody: [235, 45, 65, 255],
  guitarHighlight: [255, 130, 145, 255],
  guitarNeck: [210, 170, 115, 255],
  strings: [240, 248, 255, 255],
  sparkYellow: [255, 240, 90, 255],
  sparkCyan: [110, 250, 255, 255],
  hitRed: [255, 90, 90, 255],
};

function drawGuitarist(state) {
  const p = new PixelCanvas(48, 48);

  if (state === 'downed') {
    // Lying flat on the ground
    const yBase = 37;
    // Shadow
    p.fillRect(6, 42, 36, 3, [12, 10, 24, 160]);
    // Boots & legs
    p.fillRect(7, yBase, 6, 5, C.boots);
    p.fillRect(13, yBase + 1, 9, 4, C.pants);
    // Torso
    p.fillRect(22, yBase, 10, 5, C.jacket);
    p.fillRect(24, yBase + 1, 6, 3, C.shirt);
    // Head & Hair
    p.fillRect(32, yBase - 1, 7, 6, C.skin);
    p.fillRect(34, yBase - 3, 7, 3, C.hair);
    p.fillRect(32, yBase - 1, 2, 5, C.bandana);
    // X eyes
    p.setPixel(36, yBase + 1, C.outline);
    p.setPixel(37, yBase + 2, C.outline);
    // Dropped guitar beside character
    p.fillRect(16, yBase - 3, 9, 4, C.guitarBody);
    p.fillRect(25, yBase - 2, 8, 2, C.guitarNeck);
    return p;
  }

  const bob = state === 'idle_2' ? 2 : state === 'attack_2' ? 1 : 0;
  const leanX =
    state === 'attack_1' || state === 'attack_2'
      ? 3
      : state === 'hit'
      ? -3
      : 0;

  // Ground shadow
  p.fillRect(12, 43, 24, 3, [12, 10, 24, 160]);

  // Legs & Boots
  const leftLegX = 16 + (state === 'hit' ? -2 : 0);
  const rightLegX = 25 + (state === 'attack_1' || state === 'attack_2' ? 3 : 0);
  p.fillRect(leftLegX, 31 + bob, 4, 9 - bob, C.pants);
  p.fillRect(rightLegX, 31 + bob, 4, 9 - bob, C.pants);
  p.fillRect(leftLegX - 1, 40, 6, 4, C.boots);
  p.fillRect(rightLegX, 40, 6, 4, C.boots);

  // Torso / Jacket
  const tx = 16 + leanX;
  const ty = 19 + bob;
  p.fillRect(tx - 1, ty - 1, 15, 14, C.outline);
  p.fillRect(tx, ty, 13, 12, C.jacket);
  p.fillRect(tx + 4, ty + 1, 5, 10, C.shirt);
  p.fillRect(tx + 1, ty + 1, 2, 10, C.jacketLight);

  // Head
  const hx = 17 + leanX;
  const hy = 8 + bob;
  p.fillRect(hx - 1, hy - 1, 12, 12, C.outline);
  p.fillRect(hx, hy, 10, 10, C.skin);
  p.fillRect(hx, hy + 7, 10, 3, C.skinShade);

  // Eyes / expression
  if (state === 'hit') {
    // Wincing eyes > <
    p.setPixel(hx + 6, hy + 4, C.outline);
    p.setPixel(hx + 5, hy + 5, C.outline);
    p.setPixel(hx + 6, hy + 6, C.outline);
    p.fillRect(hx + 6, hy + 8, 3, 2, C.outline);
  } else {
    p.fillRect(hx + 7, hy + 4, 2, 3, C.outline);
    p.setPixel(hx + 7, hy + 4, C.shirt);
  }

  // Bandana & Spiky Hair
  p.fillRect(hx - 1, hy + 1, 12, 2, C.bandana);
  p.fillRect(hx - 4, hy + 2, 3, 2, C.bandana);
  p.fillRect(hx - 2, hy - 3, 13, 4, C.hair);
  p.fillRect(hx + 1, hy - 5, 9, 2, C.hairShade);
  p.fillRect(hx - 3, hy, 3, 5, C.hairShade);

  // Electric Guitar (V-shaped / Superstrat)
  const gx = tx + 2;
  const gy = ty + 5 + (state === 'idle_2' ? 1 : 0);
  // Guitar body
  p.fillRect(gx - 3, gy - 1, 13, 9, C.outline);
  p.fillRect(gx - 2, gy, 11, 7, C.guitarBody);
  p.fillRect(gx - 1, gy + 1, 5, 2, C.guitarHighlight);
  // Guitar neck pointing right-up
  const neckY = state === 'attack_1' ? gy - 1 : gy + 1;
  p.fillRect(gx + 9, neckY, 12, 3, C.outline);
  p.fillRect(gx + 9, neckY + 1, 11, 2, C.guitarNeck);
  p.fillRect(gx + 19, neckY, 4, 3, C.guitarBody);
  // Strings
  p.fillRect(gx + 1, gy + 3, 16, 1, C.strings);

  // Strum Arm & Visual Effects
  if (state === 'attack_1') {
    // Arm up before/mid down-strum + cyan/yellow chord slash
    p.fillRect(tx + 1, ty + 1, 4, 5, C.skin);
    // Big electric strum arcs
    p.drawLine(gx + 3, gy - 5, gx + 10, gy + 9, C.sparkYellow);
    p.drawLine(gx + 5, gy - 5, gx + 12, gy + 9, C.sparkCyan);
    p.fillRect(gx + 18, neckY - 3, 3, 3, C.sparkYellow);
  } else if (state === 'attack_2') {
    // Arm down after strum + upward energy wave
    p.fillRect(tx + 2, ty + 6, 4, 6, C.skin);
    p.drawLine(gx + 10, gy - 6, gx + 3, gy + 9, C.sparkCyan);
    p.drawLine(gx + 12, gy - 6, gx + 5, gy + 9, C.sparkYellow);
    p.fillRect(gx + 20, neckY + 3, 4, 4, C.sparkCyan);
  } else if (state === 'hit') {
    // Flinching sparks
    p.fillRect(tx - 3, ty + 1, 4, 5, C.skin);
    p.drawLine(hx - 4, hy - 2, hx - 7, hy - 5, C.hitRed);
    p.drawLine(hx + 12, hy - 2, hx + 15, hy - 5, C.sparkYellow);
  } else {
    // Idle hand on strings
    p.fillRect(tx + 2, ty + 4, 4, 5, C.skin);
  }

  return p;
}

function drawCyberWorm(state) {
  const p = new PixelCanvas(64, 64);

  const W = {
    outline: [14, 10, 26, 255],
    shellDark: [68, 28, 98, 255],
    shellMid: [115, 48, 155, 255],
    shellLight: [168, 82, 212, 255],
    belly: [45, 195, 165, 255],
    eyeGlow: [255, 55, 95, 255],
    eyeCore: [255, 240, 150, 255],
    mandible: [220, 225, 245, 255],
    plasma: [120, 255, 95, 255],
    plasmaCore: [230, 255, 200, 255],
  };

  if (state === 'downed') {
    // Defeated collapsed worm segments on ground
    p.fillRect(6, 56, 52, 4, [10, 8, 20, 170]);
    const segs = [
      [42, 46, 14, 11],
      [30, 48, 13, 10],
      [18, 47, 13, 11],
      [8, 45, 14, 12],
    ];
    for (const [sx, sy, sw, sh] of segs) {
      p.fillRect(sx - 1, sy - 1, sw + 2, sh + 2, W.outline);
      p.fillRect(sx, sy, sw, sh, W.shellDark);
      p.fillRect(sx + 2, sy + 2, sw - 4, 3, W.shellMid);
    }
    // Dimmed eye
    p.fillRect(11, 49, 4, 2, [90, 40, 60, 255]);
    return p;
  }

  const bob = state === 'idle_2' ? 2 : state === 'attack_2' ? -2 : 0;
  const lunge =
    state === 'attack_1' || state === 'attack_2'
      ? -4
      : state === 'hit'
      ? 4
      : 0;

  // Ground shadow
  p.fillRect(10, 57, 44, 4, [10, 8, 20, 170]);

  // Draw coiled body segments from tail (right-bottom) to head (left-top)
  const segments = [
    { x: 38 + lunge, y: 44, w: 16, h: 13 },
    { x: 32 + lunge, y: 34 + bob, w: 18, h: 14 },
    { x: 25 + lunge, y: 23 + bob, w: 20, h: 15 },
    { x: 16 + lunge, y: 12 + bob, w: 22, h: 17 }, // Head segment
  ];

  segments.forEach((seg, idx) => {
    p.fillRect(seg.x - 1, seg.y - 1, seg.w + 2, seg.h + 2, W.outline);
    p.fillRect(seg.x, seg.y, seg.w, seg.h, W.shellMid);
    p.fillRect(seg.x + 2, seg.y + 2, seg.w - 4, 4, W.shellLight);
    p.fillRect(seg.x, seg.y + seg.h - 4, seg.w, 4, W.shellDark);
    // Cybernetic belly plates on left side (facing Hero on left)
    p.fillRect(seg.x, seg.y + 3, 5, seg.h - 6, W.belly);
    // Glowing nodes on armor
    p.fillRect(
      seg.x + seg.w - 6,
      seg.y + 5,
      3,
      3,
      idx % 2 === 0 ? W.eyeGlow : W.plasma
    );
  });

  // Head details (facing left toward Hero)
  const head = segments[3];
  // Glowing Visor / Eyes
  p.fillRect(head.x + 3, head.y + 5, 7, 5, W.eyeGlow);
  p.fillRect(head.x + 4, head.y + 6, 4, 3, W.eyeCore);

  // Mandibles (open wider during attack or idle_2)
  const jawOpen =
    state === 'attack_1' ? 4 : state === 'attack_2' || state === 'idle_2' ? 2 : 0;
  p.fillRect(head.x - 7, head.y + 3 - jawOpen, 8, 4, W.outline);
  p.fillRect(head.x - 6, head.y + 4 - jawOpen, 7, 2, W.mandible);

  p.fillRect(head.x - 7, head.y + 11 + jawOpen, 8, 4, W.outline);
  p.fillRect(head.x - 6, head.y + 12 + jawOpen, 7, 2, W.mandible);

  // Attack plasma beam / orbs when in attack state
  if (state === 'attack_1') {
    p.fillRect(head.x - 13, head.y + 6, 8, 7, W.plasma);
    p.fillRect(head.x - 11, head.y + 8, 4, 3, W.plasmaCore);
  } else if (state === 'attack_2') {
    p.fillRect(head.x - 15, head.y + 4, 11, 11, W.plasma);
    p.fillRect(head.x - 13, head.y + 6, 7, 7, W.plasmaCore);
  } else if (state === 'hit') {
    // Impact sparks on head/body
    p.drawLine(head.x - 2, head.y, head.x - 7, head.y - 4, W.eyeCore);
    p.drawLine(head.x + 4, head.y + 16, head.x - 2, head.y + 22, W.eyeGlow);
  }

  return p;
}

function drawStageBackground() {
  const width = 320;
  const height = 180;
  const p = new PixelCanvas(width, height);

  // Night synthwave / dungeon sky gradient
  for (let y = 0; y < 118; y++) {
    const t = y / 118;
    const r = Math.floor(14 + t * 38);
    const g = Math.floor(10 + t * 18);
    const b = Math.floor(34 + t * 55);
    p.fillRect(0, y, width, 1, [r, g, b, 255]);
  }

  // Retro pixelated moon/synth sun in upper center
  const cx = 160,
    cy = 48,
    rad = 26;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy <= rad * rad) {
        // Horizontal synth scan cutouts near bottom of sun
        if (dy > 6 && dy % 4 === 0) continue;
        const sy = (dy + rad) / (2 * rad);
        p.setPixel(cx + dx, cy + dy, [
          255,
          Math.floor(210 - sy * 130),
          Math.floor(80 + sy * 90),
          255,
        ]);
      }
    }
  }

  // Distant pixel mountains / stage towers
  for (let x = 0; x < width; x++) {
    const h1 =
      18 +
      Math.floor(Math.sin(x * 0.04) * 10 + Math.cos(x * 0.09) * 6);
    p.fillRect(x, 118 - h1, 1, h1, [26, 18, 52, 255]);
  }

  // Concert Amp Stacks / Pillars in background
  for (const px of [24, 62, 232, 270]) {
    p.fillRect(px, 78, 26, 40, [20, 20, 36, 255]);
    p.fillRect(px + 2, 80, 22, 16, [34, 34, 58, 255]);
    p.fillRect(px + 2, 99, 22, 16, [34, 34, 58, 255]);
  }

  // Perspective grid floor (y = 118..180)
  for (let y = 118; y < height; y++) {
    const t = (y - 118) / (height - 118);
    const r = Math.floor(24 + t * 20);
    const g = Math.floor(14 + t * 12);
    const b = Math.floor(46 + t * 34);
    p.fillRect(0, y, width, 1, [r, g, b, 255]);

    // Horizontal grid lines
    if (y === 118 || y === 124 || y === 133 || y === 145 || y === 160 || y === 177) {
      p.fillRect(0, y, width, 1, [120, 55, 165, 255]);
    }
  }

  // Perspective radial lines from horizon center
  for (let i = -8; i <= 8; i++) {
    const xTop = 160 + i * 16;
    const xBot = 160 + i * 48;
    p.drawLine(xTop, 118, xBot, height - 1, [95, 45, 138, 255]);
  }

  return p;
}

const rootDir = path.resolve(process.cwd(), 'public/assets');

const states = ['idle_1', 'idle_2', 'attack_1', 'attack_2', 'hit', 'downed'];

for (const st of states) {
  drawGuitarist(st).save(path.join(rootDir, 'heroes/guitarist', `${st}.png`));
  drawCyberWorm(st).save(path.join(rootDir, 'bosses/cyber_worm', `${st}.png`));
}

drawStageBackground().save(path.join(rootDir, 'backgrounds/stage_1.png'));

console.log('✅ Generated 13 pixel-art PNG assets in public/assets/');
