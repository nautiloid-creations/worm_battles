import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Pure-Node RGBA PNG encoder
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
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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

/**
 * Uses macOS built-in `sips` to convert any JPEG/PNG into a temporary 24-bit BMP
 * and returns an RGBA buffer + dimensions.
 */
function loadImageAsRGBA(inputPath) {
  const tmpBmp = path.join(
    os.tmpdir(),
    `sheet_${Date.now()}_${Math.random().toString(36).slice(2)}.bmp`
  );
  execFileSync('sips', ['-s', 'format', 'bmp', inputPath, '--out', tmpBmp], {
    stdio: 'ignore',
  });

  const b = fs.readFileSync(tmpBmp);
  fs.unlinkSync(tmpBmp);

  const offset = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const rawH = b.readInt32LE(22);
  const h = Math.abs(rawH);
  const topDown = rawH < 0;
  const bpp = b.readUInt16LE(28);
  const bytesPerPixel = bpp / 8;
  const rowStride = Math.ceil((w * bytesPerPixel) / 4) * 4;

  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const srcIdx = offset + sy * rowStride + x * bytesPerPixel;
      const B = b[srcIdx];
      const G = b[srcIdx + 1];
      const R = b[srcIdx + 2];
      const dstIdx = (y * w + x) * 4;
      rgba[dstIdx] = R;
      rgba[dstIdx + 1] = G;
      rgba[dstIdx + 2] = B;
      rgba[dstIdx + 3] = 255;
    }
  }

  return { width: w, height: h, rgba };
}

/**
 * Chroma-keys out the bright magenta (#FF00FF) background and removes JPEG pink edge spill.
 */
function removeMagentaBackground(width, height, rgba) {
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];

    // Primary magenta check (handles JPEG compression variations of #FF00FF)
    const magentaScore = r + b - 2 * g;
    if (r > 150 && b > 150 && g < 135 && magentaScore > 165) {
      rgba[idx + 3] = 0;
    }
  }

  // Second pass: clean 1-2px JPEG magenta fringe around dark outlines bordering transparent pixels
  const copy = Buffer.from(rgba);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (copy[idx + 3] === 0) continue;

      // Check if adjacent to a transparent pixel
      let nearTransparent = false;
      for (let dy = -2; dy <= 2 && !nearTransparent; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nIdx = ((y + dy) * width + (x + dx)) * 4;
          if (copy[nIdx + 3] === 0) {
            nearTransparent = true;
            break;
          }
        }
      }

      if (nearTransparent) {
        const r = copy[idx];
        const g = copy[idx + 1];
        const b = copy[idx + 2];
        const magentaExcess = (r + b) / 2 - g;
        if (r > 110 && b > 110 && g < 100 && magentaExcess > 65) {
          // Strong pink halo pixel -> make transparent
          rgba[idx + 3] = 0;
        } else if (magentaExcess > 28 && r > g && b > g) {
          // Dark outline pixel tainted by JPEG magenta spill -> neutralize toward dark outline
          rgba[idx] = g;
          rgba[idx + 2] = g;
        }
      }
    }
  }
}

/**
 * Finds the 3 horizontal sprite segments in a row by detecting empty vertical gaps.
 */
function findRowColumns(width, rgba, y0, y1) {
  const colHasPixels = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    for (let y = y0; y < y1; y++) {
      if (rgba[(y * width + x) * 4 + 3] > 0) {
        colHasPixels[x] = 1;
        break;
      }
    }
  }

  // Group contiguous active X spans (merging tiny gaps < 15px such as detached sparks)
  const spans = [];
  let inSpan = false;
  let start = 0;
  for (let x = 0; x < width; x++) {
    if (colHasPixels[x] && !inSpan) {
      if (spans.length > 0 && x - spans[spans.length - 1][1] < 25) {
        inSpan = true;
        start = spans.pop()[0];
      } else {
        inSpan = true;
        start = x;
      }
    } else if (!colHasPixels[x] && inSpan) {
      inSpan = false;
      spans.push([start, x - 1]);
    }
  }
  if (inSpan) spans.push([start, width - 1]);

  if (spans.length === 3) {
    return spans;
  }

  // Fallback to thirds if spans != 3
  return [
    [0, Math.floor(width / 3) - 1],
    [Math.floor(width / 3), Math.floor((2 * width) / 3) - 1],
    [Math.floor((2 * width) / 3), width - 1],
  ];
}

/**
 * Finds tight bounding box of non-transparent pixels within [x0..x1, y0..y1]
 */
function getTightBounds(width, rgba, x0, x1, y0, y1) {
  let minX = x1,
    maxX = x0,
    minY = y1,
    maxY = y0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

/**
 * Slices a 3x2 sprite sheet, normalizes all 6 frames onto a uniform canvas size
 * so relative pose heights (e.g. crouching/kneeling) are preserved, and downsamples
 * to a target SNES pixel height.
 */
function processSheet({
  inputPath,
  outputDir,
  targetPixelHeight,
  anchor = 'bottom', // 'bottom' for ground characters, 'center' for floating bosses
}) {
  console.log(`Processing ${path.basename(inputPath)} -> ${outputDir} ...`);
  const { width, height, rgba } = loadImageAsRGBA(inputPath);
  removeMagentaBackground(width, height, rgba);

  const spriteNames = [
    'idle_1',
    'idle_2',
    'attack_1',
    'attack_2',
    'hit',
    'downed',
  ];

  const midY = Math.floor(height / 2);
  const rowBounds = [
    [0, midY - 1],
    [midY, height - 1],
  ];

  const boxes = [];
  for (let r = 0; r < 2; r++) {
    const [y0, y1] = rowBounds[r];
    const colSpans = findRowColumns(width, rgba, y0, y1);
    for (let c = 0; c < 3; c++) {
      const [x0, x1] = colSpans[c];
      boxes.push(getTightBounds(width, rgba, x0, x1, y0, y1));
    }
  }

  // Uniform source canvas dimensions across all 6 poses so scale stays 100% consistent
  const maxBoxW = Math.max(...boxes.map((b) => b.w));
  const maxBoxH = Math.max(...boxes.map((b) => b.h));
  const pad = 16;
  const uniformW = maxBoxW + pad * 2;
  const uniformH = maxBoxH + pad * 2;

  // Target downsampled SNES pixel dimensions
  const scale = targetPixelHeight / uniformH;
  const outW = Math.max(16, Math.round(uniformW * scale));
  const outH = Math.max(16, Math.round(uniformH * scale));

  fs.mkdirSync(outputDir, { recursive: true });

  boxes.forEach((box, idx) => {
    const name = spriteNames[idx];
    // 1. Place pose onto uniform high-res canvas
    const uniformBuf = Buffer.alloc(uniformW * uniformH * 4, 0);
    const dstStartX = Math.floor((uniformW - box.w) / 2);
    const dstStartY =
      anchor === 'bottom'
        ? uniformH - pad - box.h // Feet planted on consistent ground line
        : Math.floor((uniformH - box.h) / 2);

    for (let sy = 0; sy < box.h; sy++) {
      for (let sx = 0; sx < box.w; sx++) {
        const srcIdx = ((box.minY + sy) * width + (box.minX + sx)) * 4;
        const dstIdx = ((dstStartY + sy) * uniformW + (dstStartX + sx)) * 4;
        uniformBuf[dstIdx] = rgba[srcIdx];
        uniformBuf[dstIdx + 1] = rgba[srcIdx + 1];
        uniformBuf[dstIdx + 2] = rgba[srcIdx + 2];
        uniformBuf[dstIdx + 3] = rgba[srcIdx + 3];
      }
    }

    // 2. Downsample to SNES pixel grid + subtle 5-bit SNES color quantization
    const outBuf = Buffer.alloc(outW * outH * 4, 0);
    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        // Sample center of corresponding source block
        const ux = Math.min(
          uniformW - 1,
          Math.floor(((ox + 0.5) / outW) * uniformW)
        );
        const uy = Math.min(
          uniformH - 1,
          Math.floor(((oy + 0.5) / outH) * uniformH)
        );
        const uIdx = (uy * uniformW + ux) * 4;
        const a = uniformBuf[uIdx + 3];
        const oIdx = (oy * outW + ox) * 4;
        if (a > 128) {
          // Quantize RGB channels to 16-bit SNES 5-bit-per-channel steps (multiples of 8)
          outBuf[oIdx] = Math.min(255, Math.round(uniformBuf[uIdx] / 8) * 8);
          outBuf[oIdx + 1] = Math.min(
            255,
            Math.round(uniformBuf[uIdx + 1] / 8) * 8
          );
          outBuf[oIdx + 2] = Math.min(
            255,
            Math.round(uniformBuf[uIdx + 2] / 8) * 8
          );
          outBuf[oIdx + 3] = 255;
        }
      }
    }

    const outFile = path.join(outputDir, `${name}.png`);
    fs.writeFileSync(outFile, encodePNG(outW, outH, outBuf));
    console.log(`  ✓ Saved ${name}.png (${outW}x${outH} SNES pixels)`);
  });
}

const rootAssets = path.resolve(process.cwd(), 'public/assets');

processSheet({
  inputPath: path.join(rootAssets, 'heroes/spritesheet_guitar1.jpeg'),
  outputDir: path.join(rootAssets, 'heroes/guitarist'),
  targetPixelHeight: 72, // Chunky 16-bit SNES character resolution
  anchor: 'bottom',
});

processSheet({
  inputPath: path.join(rootAssets, 'bosses/spritesheet_air_squid.jpeg'),
  outputDir: path.join(rootAssets, 'bosses/cyber_worm'),
  targetPixelHeight: 92, // Chunky 16-bit SNES boss resolution
  anchor: 'center',
});

console.log('\n🎉 All 12 sprites sliced, chroma-keyed, and SNES-pixelized!');
