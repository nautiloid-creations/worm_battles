import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// ============================================================================
// 1. PURE-NODE PNG ENCODER & DECODER (Supports 8-bit RGBA PNGs + sips fallback)
// ============================================================================

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
    rawData[y * (width * 4 + 1)] = 0; // Filter type 0 (None)
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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes an 8-bit RGB or RGBA PNG directly in Node (preserving full alpha channel).
 * Falls back to macOS `sips` BMP conversion for JPEGs or indexed PNGs.
 */
function loadImageRGBA(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.png') {
    const buf = fs.readFileSync(inputPath);
    if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) {
      let pos = 8;
      let width = 0,
        height = 0,
        bitDepth = 0,
        colorType = 0;
      const idatChunks = [];
      while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
          width = data.readUInt32BE(0);
          height = data.readUInt32BE(4);
          bitDepth = data[8];
          colorType = data[9];
        } else if (type === 'IDAT') {
          idatChunks.push(data);
        } else if (type === 'IEND') {
          break;
        }
        pos += 12 + len;
      }

      if (bitDepth === 8 && (colorType === 6 || colorType === 2)) {
        const bpp = colorType === 6 ? 4 : 3;
        const raw = zlib.inflateSync(Buffer.concat(idatChunks));
        const stride = width * bpp;
        const recon = Buffer.alloc(width * height * bpp);

        for (let y = 0; y < height; y++) {
          const filter = raw[y * (stride + 1)];
          const rowIn = y * (stride + 1) + 1;
          const rowOut = y * stride;
          for (let i = 0; i < stride; i++) {
            const x = raw[rowIn + i];
            const a = i >= bpp ? recon[rowOut + i - bpp] : 0;
            const b = y > 0 ? recon[rowOut - stride + i] : 0;
            const c = y > 0 && i >= bpp ? recon[rowOut - stride + i - bpp] : 0;
            let val = x;
            if (filter === 1) val = (x + a) & 0xff;
            else if (filter === 2) val = (x + b) & 0xff;
            else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
            else if (filter === 4) val = (x + paethPredictor(a, b, c)) & 0xff;
            recon[rowOut + i] = val;
          }
        }

        if (colorType === 6) {
          return { width, height, rgba: recon };
        } else {
          const rgba = Buffer.alloc(width * height * 4);
          for (let i = 0; i < width * height; i++) {
            rgba[i * 4] = recon[i * 3];
            rgba[i * 4 + 1] = recon[i * 3 + 1];
            rgba[i * 4 + 2] = recon[i * 3 + 2];
            rgba[i * 4 + 3] = 255;
          }
          return { width, height, rgba };
        }
      }
    }
  }

  // Fallback for JPEG / other formats via macOS `sips` -> BMP
  const tmpBmp = path.join(
    os.tmpdir(),
    `studio_${Date.now()}_${Math.random().toString(36).slice(2)}.bmp`
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
  const bpp = b.readUInt16LE(28) / 8;
  const rowStride = Math.ceil((w * bpp) / 4) * 4;

  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const srcIdx = offset + sy * rowStride + x * bpp;
      const dstIdx = (y * w + x) * 4;
      rgba[dstIdx] = b[srcIdx + 2];
      rgba[dstIdx + 1] = b[srcIdx + 1];
      rgba[dstIdx + 2] = b[srcIdx];
      rgba[dstIdx + 3] = bpp === 4 ? b[srcIdx + 3] : 255;
    }
  }
  return { width: w, height: h, rgba };
}

function savePNG(filePath, width, height, rgba) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePNG(width, height, rgba));
}

// ============================================================================
// 2. CHROMA-KEY MAGENTA REMOVAL & BOUNDING BOX HELPERS
// ============================================================================

function removeMagentaBackground(width, height, rgba) {
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    if (rgba[idx + 3] === 0) continue;
    const r = rgba[idx],
      g = rgba[idx + 1],
      b = rgba[idx + 2];
    const magentaScore = r + b - 2 * g;
    if (r > 150 && b > 150 && g < 135 && magentaScore > 165) {
      rgba[idx + 3] = 0;
    }
  }

  // De-fringe 2px border around transparent pixels
  const copy = Buffer.from(rgba);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (copy[idx + 3] === 0) continue;
      let nearTransparent = false;
      for (let dy = -2; dy <= 2 && !nearTransparent; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (copy[((y + dy) * width + (x + dx)) * 4 + 3] === 0) {
            nearTransparent = true;
            break;
          }
        }
      }
      if (nearTransparent) {
        const r = copy[idx],
          g = copy[idx + 1],
          b = copy[idx + 2];
        const excess = (r + b) / 2 - g;
        if (r > 110 && b > 110 && g < 100 && excess > 65) {
          rgba[idx + 3] = 0;
        } else if (excess > 28 && r > g && b > g) {
          rgba[idx] = g;
          rgba[idx + 2] = g;
        }
      }
    }
  }
}

/**
 * Automatically detects horizontal row spans and vertical column spans within each row,
 * supporting arbitrary grid layouts (e.g., 4x2, 3x2, 4+3=7 poses, 2x2, 1xN, etc.).
 */
function findActiveSpans1D(hasPixels, length, minGap = 20, minSize = 10) {
  const spans = [];
  let inSpan = false;
  let start = 0;
  for (let i = 0; i < length; i++) {
    if (hasPixels[i] && !inSpan) {
      if (spans.length > 0 && i - spans[spans.length - 1][1] < minGap) {
        inSpan = true;
        start = spans.pop()[0];
      } else {
        inSpan = true;
        start = i;
      }
    } else if (!hasPixels[i] && inSpan) {
      inSpan = false;
      if (i - 1 - start >= minSize) {
        spans.push([start, i - 1]);
      }
    }
  }
  if (inSpan && length - 1 - start >= minSize) {
    spans.push([start, length - 1]);
  }
  return spans;
}

function detectFlexibleSpriteBoxes(width, height, rgba, forcedCols, forcedRows) {
  if (forcedCols && forcedRows) {
    const boxes = [];
    for (let r = 0; r < forcedRows; r++) {
      const y0 = Math.floor((r * height) / forcedRows);
      const y1 = Math.floor(((r + 1) * height) / forcedRows) - 1;
      for (let c = 0; c < forcedCols; c++) {
        const x0 = Math.floor((c * width) / forcedCols);
        const x1 = Math.floor(((c + 1) * width) / forcedCols) - 1;
        const box = getTightBounds(width, rgba, x0, x1, y0, y1);
        if (box.w >= 12 && box.h >= 12) {
          boxes.push(box);
        }
      }
    }
    return boxes;
  }

  // 2D Connected-Component detection (handles diagonal overhangs like guitar necks over next pose's shoes!)
  const labels = new Int32Array(width * height);
  const components = [];
  const queue = new Int32Array(width * height);
  const bridgeRadius = 6; // connects tiny 1-4px shoe sparkles to their shoe without bridging separate sprites

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] !== 0 || rgba[idx * 4 + 3] === 0) continue;

      const compId = components.length + 1;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        count = 0;
      let head = 0,
        tail = 0;
      queue[tail++] = idx;
      labels[idx] = compId;

      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % width;
        const cy = (cur - cx) / width;
        count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const yStart = Math.max(0, cy - bridgeRadius);
        const yEnd = Math.min(height - 1, cy + bridgeRadius);
        const xStart = Math.max(0, cx - bridgeRadius);
        const xEnd = Math.min(width - 1, cx + bridgeRadius);
        for (let ny = yStart; ny <= yEnd; ny++) {
          const rowOff = ny * width;
          for (let nx = xStart; nx <= xEnd; nx++) {
            const nIdx = rowOff + nx;
            if (labels[nIdx] === 0 && rgba[nIdx * 4 + 3] > 0) {
              labels[nIdx] = compId;
              queue[tail++] = nIdx;
            }
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (count >= 150 && w >= 20 && h >= 20) {
        components.push({
          compId,
          minX,
          maxX,
          minY,
          maxY,
          w,
          h,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          labels,
        });
      }
    }
  }

  // Group components into horizontal rows by vertical center `cy`, then sort left-to-right `cx`
  components.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const comp of components) {
    const existingRow = rows.find(
      (r) => Math.abs(comp.cy - r.avgCy) < Math.max(comp.h, r.avgH) * 0.55
    );
    if (existingRow) {
      existingRow.items.push(comp);
      existingRow.avgCy =
        existingRow.items.reduce((s, i) => s + i.cy, 0) /
        existingRow.items.length;
      existingRow.avgH =
        existingRow.items.reduce((s, i) => s + i.h, 0) /
        existingRow.items.length;
    } else {
      rows.push({ avgCy: comp.cy, avgH: comp.h, items: [comp] });
    }
  }

  rows.sort((a, b) => a.avgCy - b.avgCy);
  const sortedBoxes = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.cx - b.cx);
    sortedBoxes.push(...r.items);
  }
  return sortedBoxes;
}

/**
 * Parses pose names from:
 * 1) `--poses "idle_1,idle_2,..."` CLI flag, OR
 * 2) `assets_src/characters/<charId>/refs/*description*.txt` under `poses`, OR
 * 3) Default fallback list matching the number of detected sprites.
 */
function resolvePoseNames(charId, args, detectedCount) {
  const normalizePoseName = (raw) => {
    const clean = raw.trim().toLowerCase().replace(/\s+/g, '_');
    if (clean === 'down') return 'downed';
    if (clean === 'stunned' || clean === 'stun') return 'hit';
    return clean;
  };

  if (args.poses) {
    return String(args.poses)
      .split(',')
      .map(normalizePoseName)
      .filter(Boolean);
  }

  // Check if a description.md or description.txt exists in refs/
  const { refsDir } = getCharacterDirs(charId);
  if (fs.existsSync(refsDir)) {
    const descFile = fs
      .readdirSync(refsDir)
      .find(
        (f) =>
          f.toLowerCase().includes('description') &&
          (f.endsWith('.md') || f.endsWith('.txt'))
      );
    if (descFile) {
      const text = fs.readFileSync(path.join(refsDir, descFile), 'utf8');
      const lines = text.split(/\r?\n/);
      let inPoses = false;
      const parsed = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^(#+\s*)?poses\b/i.test(trimmed)) {
          inPoses = true;
          continue;
        }
        if (inPoses) {
          // Matches both `IDLE_1:` and `- **`IDLE_1`**:`
          const match = trimmed.match(
            /^(?:-\s*)?(?:\*\*`?)?([A-Za-z0-9_]+)(?:`?\*\*)?\s*:/
          );
          if (match) {
            parsed.push(normalizePoseName(match[1]));
          }
        }
      }
      if (parsed.length === detectedCount) {
        return parsed;
      }
    }
  }

  const standard7 = [
    'idle_1',
    'idle_2',
    'attack_1',
    'attack_2',
    'ultimate',
    'hit',
    'downed',
  ];
  const standard6 = [
    'idle_1',
    'idle_2',
    'attack_1',
    'attack_2',
    'hit',
    'downed',
  ];
  if (detectedCount === 6) return standard6;
  if (detectedCount === 7) return standard7;

  const fallback = [];
  for (let i = 0; i < detectedCount; i++) {
    fallback.push(standard7[i] || `pose_${i + 1}`);
  }
  return fallback;
}

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
    w: Math.max(1, maxX - minX + 1),
    h: Math.max(1, maxY - minY + 1),
  };
}

function resizeNearest(srcW, srcH, srcRgba, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4, 0);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) / dstH) * srcH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) / dstW) * srcW));
      const sIdx = (sy * srcW + sx) * 4;
      const dIdx = (y * dstW + x) * 4;
      if (srcRgba[sIdx + 3] > 127) {
        out[dIdx] = srcRgba[sIdx];
        out[dIdx + 1] = srcRgba[sIdx + 1];
        out[dIdx + 2] = srcRgba[sIdx + 2];
        out[dIdx + 3] = 255;
      }
    }
  }
  return out;
}

// ============================================================================
// 3. MEDIAN-CUT COLOR PALETTE QUANTIZER (Enforces Strict Max N Colors)
// ============================================================================

function computeMedianCutPalette(buffers, maxColors) {
  const colorCounts = new Map();
  for (const rgba of buffers) {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      // Pre-snap to 6-bit per channel so bucket sorting is fast and clean
      const r = rgba[i] & 0xfc;
      const g = rgba[i + 1] & 0xfc;
      const b = rgba[i + 2] & 0xfc;
      const key = (r << 16) | (g << 8) | b;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }

  const points = [];
  for (const [key, count] of colorCounts.entries()) {
    points.push({
      r: (key >> 16) & 0xff,
      g: (key >> 8) & 0xff,
      b: key & 0xff,
      count,
    });
  }

  if (points.length <= maxColors) {
    return points.map((p) => [p.r, p.g, p.b]);
  }

  // Separate neutral greys/blacks/whites from chromatic colors in initial seed buckets
  // so black t-shirts / grey hats never average with warm brown wood tones.
  const neutrals = points.filter(
    (p) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) <= 16
  );
  const chromatics = points.filter(
    (p) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) > 16
  );
  const buckets =
    neutrals.length > 0 && chromatics.length > 0
      ? [neutrals, chromatics]
      : [points];
  while (buckets.length < maxColors) {
    // Pick bucket with largest RGB range weighted by pixel count
    let bestIdx = -1;
    let bestScore = -1;
    let bestChannel = 'r';

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length <= 1) continue;
      let minR = 255,
        maxR = 0,
        minG = 255,
        maxG = 0,
        minB = 255,
        maxB = 0;
      for (const p of b) {
        if (p.r < minR) minR = p.r;
        if (p.r > maxR) maxR = p.r;
        if (p.g < minG) minG = p.g;
        if (p.g > maxG) maxG = p.g;
        if (p.b < minB) minB = p.b;
        if (p.b > maxB) maxB = p.b;
      }
      const dr = maxR - minR,
        dg = maxG - minG,
        db = maxB - minB;
      const maxSpan = Math.max(dr, dg, db);
      let countSum = 0;
      for (const p of b) countSum += p.count;
      // Weight by both color span and pixel population so large neutral areas (like black shirts) never merge with brown wood
      const score = maxSpan * Math.pow(countSum, 0.28);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestChannel = dr >= dg && dr >= db ? 'r' : dg >= db ? 'g' : 'b';
      }
    }

    if (bestIdx === -1 || bestScore === 0) break;
    const target = buckets.splice(bestIdx, 1)[0];
    target.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(target.length / 2);
    buckets.push(target.slice(0, mid), target.slice(mid));
  }

  return buckets.map((bucket) => {
    let sumR = 0,
      sumG = 0,
      sumB = 0,
      total = 0;
    for (const p of bucket) {
      sumR += p.r * p.count;
      sumG += p.g * p.count;
      sumB += p.b * p.count;
      total += p.count;
    }
    return [
      Math.round(sumR / total),
      Math.round(sumG / total),
      Math.round(sumB / total),
    ];
  });
}

function applyPalette(rgba, palette) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 128) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    const r = out[i],
      g = out[i + 1],
      b = out[i + 2];
    let bestDist = Infinity;
    let bestColor = palette[0];
    for (const c of palette) {
      const dr = r - c[0],
        dg = g - c[1],
        db = b - c[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestColor = c;
      }
    }
    out[i] = bestColor[0];
    out[i + 1] = bestColor[1];
    out[i + 2] = bestColor[2];
    out[i + 3] = 255;
  }
  return out;
}

function countUniqueColors(rgba) {
  const set = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) {
      set.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    }
  }
  return set.size;
}

// ============================================================================
// 4. CLI SUBCOMMANDS
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function getCharacterDirs(charId) {
  const root = process.cwd();
  const srcCharDir = path.join(root, 'assets_src/characters', charId);
  const mastersDir = path.join(srcCharDir, 'masters');
  const refsDir = path.join(srcCharDir, 'refs');
  const masksDir = path.join(srcCharDir, 'masks');
  return { srcCharDir, mastersDir, refsDir, masksDir };
}

/**
 * Strict Folder Isolation Guard:
 * Ensures no file from `assets_src/characters/<other_char>/` can ever be passed
 * when operating on `<charId>`.
 */
function assertCharacterPathIsolation(charId, filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const charsRoot = path.resolve(process.cwd(), 'assets_src/characters');
  if (resolved.startsWith(charsRoot + path.sep)) {
    const rel = path.relative(charsRoot, resolved);
    const folderOwner = rel.split(path.sep)[0];
    if (folderOwner && folderOwner !== charId) {
      throw new Error(
        `[ISOLATION ERROR] Refusing to use file from character "${folderOwner}" (${filePath}) while processing character "${charId}".`
      );
    }
  }
}

/**
 * Subcommand: slice-to-masters
 * Slices a 3x2 magenta sprite sheet into high-res transparent master PNGs (normalized to 256px height)
 */
function cmdSliceToMasters(args) {
  const charId = args.char;
  const inputPath = path.resolve(args.input);
  assertCharacterPathIsolation(charId, inputPath);
  const anchor = args.anchor || 'bottom';
  const masterHeight = Number(args['master-height'] || 256);

  if (!charId || !inputPath) {
    throw new Error(
      'Usage: slice-to-masters --char <id> --input <sheet> [--anchor bottom|center]'
    );
  }

  const { mastersDir, refsDir } = getCharacterDirs(charId);
  fs.mkdirSync(mastersDir, { recursive: true });
  fs.mkdirSync(refsDir, { recursive: true });

  const { width, height, rgba } = loadImageRGBA(inputPath);
  removeMagentaBackground(width, height, rgba);

  const forcedCols = args.cols ? Number(args.cols) : undefined;
  const forcedRows = args.rows ? Number(args.rows) : undefined;
  const boxes = detectFlexibleSpriteBoxes(
    width,
    height,
    rgba,
    forcedCols,
    forcedRows
  );

  if (boxes.length === 0) {
    throw new Error(`No sprites detected in ${inputPath}`);
  }

  const poseNames = resolvePoseNames(charId, args, boxes.length);
  console.log(
    `  🔍 Auto-detected ${boxes.length} sprites on sheet -> [${poseNames.slice(0, boxes.length).join(', ')}]`
  );

  const maxBoxW = Math.max(...boxes.map((b) => b.w));
  const maxBoxH = Math.max(...boxes.map((b) => b.h));
  const pad = 16;
  const uniformW = maxBoxW + pad * 2;
  const uniformH = maxBoxH + pad * 2;

  const scale = masterHeight / uniformH;
  const outW = Math.round(uniformW * scale);
  const outH = Math.round(uniformH * scale);

  boxes.forEach((box, idx) => {
    const pose = poseNames[idx] || `pose_${idx + 1}`;
    const uniformBuf = Buffer.alloc(uniformW * uniformH * 4, 0);
    const dstStartX = Math.floor((uniformW - box.w) / 2);
    const dstStartY =
      anchor === 'bottom'
        ? uniformH - pad - box.h
        : Math.floor((uniformH - box.h) / 2);

    for (let sy = 0; sy < box.h; sy++) {
      for (let sx = 0; sx < box.w; sx++) {
        const pxIdx = (box.minY + sy) * width + (box.minX + sx);
        if (box.labels && box.labels[pxIdx] !== box.compId) continue;
        const srcIdx = pxIdx * 4;
        const dstIdx = ((dstStartY + sy) * uniformW + (dstStartX + sx)) * 4;
        uniformBuf[dstIdx] = rgba[srcIdx];
        uniformBuf[dstIdx + 1] = rgba[srcIdx + 1];
        uniformBuf[dstIdx + 2] = rgba[srcIdx + 2];
        uniformBuf[dstIdx + 3] = rgba[srcIdx + 3];
      }
    }

    const masterRgba = resizeNearest(
      uniformW,
      uniformH,
      uniformBuf,
      outW,
      outH
    );
    const outFile = path.join(mastersDir, `${pose}.png`);
    savePNG(outFile, outW, outH, masterRgba);
    console.log(
      `  ✓ Saved master: assets_src/characters/${charId}/masters/${pose}.png (${outW}x${outH})`
    );
  });
}

/**
 * Subcommand: import-single-master
 * Imports a single raw sprite image (with #FF00FF magenta background),
 * strips magenta, normalizes it to a 256px master canvas (matching guitar_1's foot padding),
 * and saves it to assets_src/characters/<char>/masters/<pose>.png
 */
function cmdImportSingleMaster(args) {
  const charId = args.char;
  const pose = (args.pose || 'idle_1').replace(/\.png$/, '');
  const inputPath = path.resolve(args.input);
  assertCharacterPathIsolation(charId, inputPath);
  const anchor = args.anchor || 'bottom';
  const masterHeight = Number(args['master-height'] || 256);

  const { mastersDir } = getCharacterDirs(charId);
  fs.mkdirSync(mastersDir, { recursive: true });
  if (args.clean) {
    for (const f of fs.readdirSync(mastersDir)) {
      if (f.endsWith('.png')) fs.unlinkSync(path.join(mastersDir, f));
    }
  }

  const { width, height, rgba } = loadImageRGBA(inputPath);
  removeMagentaBackground(width, height, rgba);

  const box = getTightBounds(width, rgba, 0, width - 1, 0, height - 1);
  const pad = Math.round(Math.max(box.w, box.h) * 0.06);

  // Reserve top headroom when importing a crouched idle_1 if other poses stand more upright
  let uprightHeadroom = 0;
  const { refsDir } = getCharacterDirs(charId);
  if (pose === 'idle_1' && fs.existsSync(refsDir)) {
    const descFile = fs
      .readdirSync(refsDir)
      .find((f) => f.toLowerCase().includes('description'));
    if (descFile) {
      const descText = fs
        .readFileSync(path.join(refsDir, descFile), 'utf8')
        .toLowerCase();
      if (descText.includes('crouch') && descText.includes('upright')) {
        uprightHeadroom = Math.round(box.h * 0.08);
      }
    }
  }

  const uniformW = box.w + pad * 2;
  const uniformH = box.h + uprightHeadroom + pad * 2;

  const uniformBuf = Buffer.alloc(uniformW * uniformH * 4, 0);
  const dstStartX = Math.floor((uniformW - box.w) / 2);
  const dstStartY =
    anchor === 'bottom'
      ? uniformH - pad - box.h
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

  const scale = masterHeight / uniformH;
  const outW = Math.round(uniformW * scale);
  const outH = Math.round(uniformH * scale);

  const masterRgba = resizeNearest(
    uniformW,
    uniformH,
    uniformBuf,
    outW,
    outH
  );
  const outFile = path.join(mastersDir, `${pose}.png`);
  savePNG(outFile, outW, outH, masterRgba);
  console.log(
    `  ✓ Imported single master: assets_src/characters/${charId}/masters/${pose}.png (${outW}x${outH})`
  );
}

/**
 * Subcommand: compile
 * Compiles all masters/*.png for a character into public/assets/ with hard max-height, max-width, and max-colors
 */
function cmdCompile(args) {
  const charId = args.char;
  const maxHeight = Number(args['max-height'] || 256);
  const maxWidth = args['max-width'] ? Number(args['max-width']) : Infinity;
  const maxColors = Number(args['max-colors'] || 32);

  const defaultOutMap = {
    guitar_1: 'public/assets/heroes/guitar_1',
    guitar_2: 'public/assets/heroes/guitar_2',
    bass: 'public/assets/heroes/bass',
    drums: 'public/assets/heroes/drums',
    air_squid: 'public/assets/bosses/air_squid',
    cyber_worm: 'public/assets/bosses/air_squid',
    the_worm: 'public/assets/bosses/the_worm',
  };
  const outDir = path.resolve(
    args.out || defaultOutMap[charId] || `public/assets/heroes/${charId}`
  );
  assertCharacterPathIsolation(charId, outDir);

  const { mastersDir } = getCharacterDirs(charId);
  const files = fs
    .readdirSync(mastersDir)
    .filter((f) => f.endsWith('.png') && !f.includes('_mask') && !f.includes('_guide'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No master PNGs found in ${mastersDir}`);
  }

  const loaded = files.map((file) => {
    const img = loadImageRGBA(path.join(mastersDir, file));
    return { file, ...img };
  });

  // Downsample all poses strictly <= maxHeight and <= maxWidth preserving each pose's aspect ratio
  const downsampled = loaded.map((item) => {
    const scale = Math.min(1, Math.min(maxHeight / item.height, maxWidth / item.width));
    const targetW = Math.max(8, Math.floor(item.width * scale));
    const targetH = Math.max(8, Math.floor(item.height * scale));
    return {
      file: item.file,
      width: targetW,
      height: targetH,
      rgba: resizeNearest(
        item.width,
        item.height,
        item.rgba,
        targetW,
        targetH
      ),
    };
  });

  // Compute shared Median-Cut palette of <= maxColors across all poses of this character
  const sharedPalette = computeMedianCutPalette(
    downsampled.map((d) => d.rgba),
    maxColors
  );

  fs.mkdirSync(outDir, { recursive: true });
  if (args.clean) {
    for (const f of fs.readdirSync(outDir)) {
      if (f.endsWith('.png')) fs.unlinkSync(path.join(outDir, f));
    }
  }
  console.log(
    `\n🎨 Compiling [${charId}] -> ${path.relative(process.cwd(), outDir)} (Max ${maxHeight}px H, Max ${maxColors} colors, Shared Palette = ${sharedPalette.length} colors):`
  );

  for (const item of downsampled) {
    const quantized = applyPalette(item.rgba, sharedPalette);
    const uniqueColors = countUniqueColors(quantized);
    const outPath = path.join(outDir, item.file);
    savePNG(outPath, item.width, item.height, quantized);
    console.log(
      `  ✓ ${item.file.padEnd(12)} | Size: ${item.width}x${item.height} px | Colors: ${uniqueColors}/${maxColors}`
    );
  }
}

/**
 * Subcommand: transform
 * Deterministically flips (--flip-x) or recolors (--recolor "oldHex:newHex:tol") one or all master poses
 */
function cmdTransform(args) {
  const charId = args.char;
  const poseArg = args.pose || 'all';

  const { mastersDir } = getCharacterDirs(charId);

  const files =
    poseArg === 'all'
      ? fs.readdirSync(mastersDir).filter((f) => f.endsWith('.png'))
      : [`${poseArg.replace(/\.png$/, '')}.png`];

  for (const file of files) {
    const filePath = path.join(mastersDir, file);
    const { width, height, rgba } = loadImageRGBA(filePath);
    let out = Buffer.from(rgba);

    if (args['flip-x']) {
      const flipped = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIdx = (y * width + x) * 4;
          const dstIdx = (y * width + (width - 1 - x)) * 4;
          flipped[dstIdx] = out[srcIdx];
          flipped[dstIdx + 1] = out[srcIdx + 1];
          flipped[dstIdx + 2] = out[srcIdx + 2];
          flipped[dstIdx + 3] = out[srcIdx + 3];
        }
      }
      out = flipped;
      console.log(`  ↔ Flipped horizontally: ${file}`);
    }

    if (args.recolor) {
      // Format: "#5a3a22:#e2b887:45"
      const [fromHex, toHex, tolStr] = String(args.recolor).split(':');
      const tol = Number(tolStr || 45);
      const parseHex = (h) => {
        const clean = h.replace('#', '');
        return [
          parseInt(clean.slice(0, 2), 16),
          parseInt(clean.slice(2, 4), 16),
          parseInt(clean.slice(4, 6), 16),
        ];
      };
      const [fr, fg, fb] = parseHex(fromHex);
      const [tr, tg, tb] = parseHex(toHex);
      let count = 0;
      for (let i = 0; i < out.length; i += 4) {
        if (out[i + 3] === 0) continue;
        const dr = out[i] - fr,
          dg = out[i + 1] - fg,
          db = out[i + 2] - fb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist <= tol) {
          // Preserve relative shading luminance
          const lumRatio =
            (out[i] + out[i + 1] + out[i + 2]) /
            Math.max(1, fr + fg + fb);
          out[i] = Math.min(255, Math.round(tr * lumRatio));
          out[i + 1] = Math.min(255, Math.round(tg * lumRatio));
          out[i + 2] = Math.min(255, Math.round(tb * lumRatio));
          count++;
        }
      }
      console.log(`  🎨 Recolored ${count} pixels in ${file}`);
    }

    savePNG(filePath, width, height, out);
  }
}

/**
 * Subcommand: splice-mask
 * Mathematical pixel compositor: detects cyan (#00FFFF) scribble pixels in --mask
 * and copies ONLY those pixels from --edited onto the character's master pose!
 */
function cmdSpliceMask(args) {
  const charId = args.char;
  const pose = args.pose.replace(/\.png$/, '');
  const maskPath = path.resolve(args.mask);
  const editedPath = path.resolve(args.edited);

  assertCharacterPathIsolation(charId, maskPath);
  assertCharacterPathIsolation(charId, editedPath);

  const { mastersDir } = getCharacterDirs(charId);
  const origPath = path.join(mastersDir, `${pose}.png`);

  const orig = loadImageRGBA(origPath);
  const maskImg = loadImageRGBA(maskPath);
  const editImg = loadImageRGBA(editedPath);
  removeMagentaBackground(editImg.width, editImg.height, editImg.rgba);

  const maskResized = resizeNearest(
    maskImg.width,
    maskImg.height,
    maskImg.rgba,
    orig.width,
    orig.height
  );
  const editResized = resizeNearest(
    editImg.width,
    editImg.height,
    editImg.rgba,
    orig.width,
    orig.height
  );

  const out = Buffer.from(orig.rgba);
  let splicedCount = 0;

  for (let i = 0; i < orig.width * orig.height; i++) {
    const idx = i * 4;
    const mr = maskResized[idx];
    const mg = maskResized[idx + 1];
    const mb = maskResized[idx + 2];
    const ma = maskResized[idx + 3];

    // Check if pixel was painted with Pinta bright cyan (#00FFFF) scribble
    const isCyanMask = ma > 128 && mg > 175 && mb > 175 && mr < 95;
    if (isCyanMask) {
      out[idx] = editResized[idx];
      out[idx + 1] = editResized[idx + 1];
      out[idx + 2] = editResized[idx + 2];
      out[idx + 3] = editResized[idx + 3];
      splicedCount++;
    }
  }

  savePNG(origPath, orig.width, orig.height, out);
  console.log(
    `  ✂️ Spliced ${splicedCount} cyan-masked pixels into ${pose}.png (100% of unmasked pixels locked!)`
  );
}

/**
 * Subcommand: make-pose-guide
 * Creates a side-by-side 2-panel image ([Master idle_1 on Magenta | Stick-Figure Sketch])
 * so AI generation keeps character self-attention consistency when creating a new pose like ultimate.png!
 */
function cmdMakePoseGuide(args) {
  const charId = args.char;
  const refPose = (args['ref-pose'] || 'idle_1').replace(/\.png$/, '');
  const sketchPath = path.resolve(args.sketch);
  const outPath = path.resolve(args.out);

  assertCharacterPathIsolation(charId, sketchPath);
  assertCharacterPathIsolation(charId, outPath);

  const { mastersDir } = getCharacterDirs(charId);
  const refImg = loadImageRGBA(path.join(mastersDir, `${refPose}.png`));
  const sketchImg = loadImageRGBA(sketchPath);

  const panelW = refImg.width;
  const panelH = refImg.height;
  const sketchResized = resizeNearest(
    sketchImg.width,
    sketchImg.height,
    sketchImg.rgba,
    panelW,
    panelH
  );

  const totalW = panelW * 2 + 8;
  const out = Buffer.alloc(totalW * panelH * 4);

  // Fill background with magenta (#FF00FF) and a 8px divider bar in the center
  for (let y = 0; y < panelH; y++) {
    for (let x = 0; x < totalW; x++) {
      const idx = (y * totalW + x) * 4;
      if (x >= panelW && x < panelW + 8) {
        out[idx] = 20;
        out[idx + 1] = 20;
        out[idx + 2] = 30;
        out[idx + 3] = 255;
      } else {
        out[idx] = 255;
        out[idx + 1] = 0;
        out[idx + 2] = 255;
        out[idx + 3] = 255;
      }
    }
  }

  // Draw Left Panel: Reference Master Pose
  for (let y = 0; y < panelH; y++) {
    for (let x = 0; x < panelW; x++) {
      const sIdx = (y * panelW + x) * 4;
      if (refImg.rgba[sIdx + 3] > 128) {
        const dIdx = (y * totalW + x) * 4;
        out[dIdx] = refImg.rgba[sIdx];
        out[dIdx + 1] = refImg.rgba[sIdx + 1];
        out[dIdx + 2] = refImg.rgba[sIdx + 2];
        out[dIdx + 3] = 255;
      }
    }
  }

  // Draw Right Panel: Stick-Figure Sketch
  for (let y = 0; y < panelH; y++) {
    for (let x = 0; x < panelW; x++) {
      const sIdx = (y * panelW + x) * 4;
      if (sketchResized[sIdx + 3] > 128) {
        const dIdx = (y * totalW + (panelW + 8 + x)) * 4;
        out[dIdx] = sketchResized[sIdx];
        out[dIdx + 1] = sketchResized[sIdx + 1];
        out[dIdx + 2] = sketchResized[sIdx + 2];
        out[dIdx + 3] = 255;
      }
    }
  }

  savePNG(outPath, totalW, panelH, out);
  console.log(`  🖼️ Created 2-panel pose guide: ${outPath} (${totalW}x${panelH})`);
}

/**
 * Subcommand: extract-right-panel
 * Takes the 2-panel AI output image from `make-pose-guide` + AI generation,
 * crops out ONLY the right panel, strips the magenta background, aligns it
 * to the character's master dimensions, and saves it as `masters/<pose>.png`!
 */
function cmdExtractRightPanel(args) {
  const charId = args.char;
  const pose = args.pose.replace(/\.png$/, '');
  const inputPath = path.resolve(args.input);
  const anchor = args.anchor || 'bottom';

  assertCharacterPathIsolation(charId, inputPath);

  const { mastersDir } = getCharacterDirs(charId);
  const refPose = (args['ref-pose'] || 'idle_1').replace(/\.png$/, '');
  const refMaster = loadImageRGBA(path.join(mastersDir, `${refPose}.png`));
  const targetW = refMaster.width;
  const targetH = refMaster.height;

  const { width, height, rgba } = loadImageRGBA(inputPath);
  removeMagentaBackground(width, height, rgba);

  // Extract right half (skipping center divider)
  const rightStartX = Math.floor(width * 0.51);
  const bounds = getTightBounds(
    width,
    rgba,
    rightStartX,
    width - 1,
    0,
    height - 1
  );

  // Scale extracted pose proportionally relative to the left panel's reference height
  const leftBounds = getTightBounds(
    width,
    rgba,
    0,
    Math.floor(width * 0.49),
    0,
    height - 1
  );
  const refBounds = getTightBounds(
    refMaster.width,
    refMaster.rgba,
    0,
    refMaster.width - 1,
    0,
    refMaster.height - 1
  );

  const scaleFactor =
    leftBounds.h > 10 ? refBounds.h / leftBounds.h : targetH / height;
  const scaledW = Math.max(1, Math.round(bounds.w * scaleFactor));
  const scaledH = Math.max(1, Math.round(bounds.h * scaleFactor));

  const cropped = Buffer.alloc(bounds.w * bounds.h * 4);
  for (let y = 0; y < bounds.h; y++) {
    for (let x = 0; x < bounds.w; x++) {
      const sIdx = ((bounds.minY + y) * width + (bounds.minX + x)) * 4;
      const dIdx = (y * bounds.w + x) * 4;
      cropped[dIdx] = rgba[sIdx];
      cropped[dIdx + 1] = rgba[sIdx + 1];
      cropped[dIdx + 2] = rgba[sIdx + 2];
      cropped[dIdx + 3] = rgba[sIdx + 3];
    }
  }

  const resizedPose = resizeNearest(
    bounds.w,
    bounds.h,
    cropped,
    scaledW,
    scaledH
  );

  const outMaster = Buffer.alloc(targetW * targetH * 4, 0);
  const padBottom = targetH - 1 - refBounds.maxY;
  const dstX = Math.floor((targetW - scaledW) / 2);
  const dstY =
    anchor === 'bottom'
      ? Math.max(0, targetH - padBottom - scaledH)
      : Math.floor((targetH - scaledH) / 2);

  for (let y = 0; y < scaledH; y++) {
    if (dstY + y < 0 || dstY + y >= targetH) continue;
    for (let x = 0; x < scaledW; x++) {
      if (dstX + x < 0 || dstX + x >= targetW) continue;
      const sIdx = (y * scaledW + x) * 4;
      const dIdx = ((dstY + y) * targetW + (dstX + x)) * 4;
      outMaster[dIdx] = resizedPose[sIdx];
      outMaster[dIdx + 1] = resizedPose[sIdx + 1];
      outMaster[dIdx + 2] = resizedPose[sIdx + 2];
      outMaster[dIdx + 3] = resizedPose[sIdx + 3];
    }
  }

  const outPath = path.join(mastersDir, `${pose}.png`);
  savePNG(outPath, targetW, targetH, outMaster);
  console.log(
    `  ✨ Extracted right panel -> assets_src/characters/${charId}/masters/${pose}.png (${targetW}x${targetH})`
  );
}

/**
 * Subcommand: pack-sheet
 * Packs all (or specified) master poses in assets_src/characters/<char>/masters/
 * into a clean #FF00FF magenta sprite sheet with flexible columns (default: 4 cols for >6 sprites, 3 cols for <=6).
 */
function cmdPackSheet(args) {
  const charId = args.char;
  if (!charId) {
    throw new Error('Usage: pack-sheet --char <id> [--cols <n>] [--out <path>]');
  }
  const { mastersDir, refsDir } = getCharacterDirs(charId);
  const existingFiles = fs
    .readdirSync(mastersDir)
    .filter((f) => f.endsWith('.png') && !f.includes('_mask') && !f.includes('_guide'));

  if (existingFiles.length === 0) {
    throw new Error(`No master PNGs found in ${mastersDir}`);
  }

  // Order poses logically (matching description.txt order or standard order, followed by any custom boss poses)
  const preferredOrder = resolvePoseNames(charId, args, existingFiles.length);
  const orderedNames = [];
  for (const p of preferredOrder) {
    if (existingFiles.includes(`${p}.png`) && !orderedNames.includes(p)) {
      orderedNames.push(p);
    }
  }
  for (const f of existingFiles.sort()) {
    const p = f.replace(/\.png$/, '');
    if (!orderedNames.includes(p)) {
      orderedNames.push(p);
    }
  }

  const loaded = orderedNames.map((pose) => {
    const img = loadImageRGBA(path.join(mastersDir, `${pose}.png`));
    return { pose, ...img };
  });

  const count = loaded.length;
  const cols = Number(args.cols || (count > 6 ? 4 : count <= 4 ? 2 : 3));
  const rows = Math.ceil(count / cols);
  const cellW = Math.max(...loaded.map((l) => l.width));
  const cellH = Math.max(...loaded.map((l) => l.height));
  const gap = 24;

  const sheetW = cols * cellW + (cols + 1) * gap;
  const sheetH = rows * cellH + (rows + 1) * gap;
  const sheetRgba = Buffer.alloc(sheetW * sheetH * 4);

  // Fill with pure #FF00FF magenta
  for (let i = 0; i < sheetW * sheetH; i++) {
    sheetRgba[i * 4] = 255;
    sheetRgba[i * 4 + 1] = 0;
    sheetRgba[i * 4 + 2] = 255;
    sheetRgba[i * 4 + 3] = 255;
  }

  loaded.forEach((item, idx) => {
    const c = idx % cols;
    const r = Math.floor(idx / cols);
    const cellX = gap + c * (cellW + gap);
    const cellY = gap + r * (cellH + gap);
    const dstStartX = cellX + Math.floor((cellW - item.width) / 2);
    const dstStartY = cellY + (cellH - item.height);

    for (let y = 0; y < item.height; y++) {
      for (let x = 0; x < item.width; x++) {
        const sIdx = (y * item.width + x) * 4;
        if (item.rgba[sIdx + 3] > 128) {
          const dIdx = ((dstStartY + y) * sheetW + (dstStartX + x)) * 4;
          sheetRgba[dIdx] = item.rgba[sIdx];
          sheetRgba[dIdx + 1] = item.rgba[sIdx + 1];
          sheetRgba[dIdx + 2] = item.rgba[sIdx + 2];
          sheetRgba[dIdx + 3] = 255;
        }
      }
    }
  });

  const outPath = path.resolve(
    args.out || path.join(refsDir, 'packed_sheet.png')
  );
  assertCharacterPathIsolation(charId, outPath);
  savePNG(outPath, sheetW, sheetH, sheetRgba);
  console.log(
    `  🧩 Packed ${count} poses [${orderedNames.join(', ')}] into ${cols}x${rows} sheet: ${path.relative(process.cwd(), outPath)} (${sheetW}x${sheetH})`
  );
}

// ============================================================================
// 5. QUOTA TRACKING & DIRECT GEMINI / VERTEX EXPRESS IMAGE GENERATION
// ============================================================================

function getQuotaFilePath() {
  return path.resolve(process.cwd(), '.gemini_image_quota.json');
}

function getQuotaStatus() {
  const file = getQuotaFilePath();
  if (!fs.existsSync(file)) {
    return { freeQuotaAvailable: true, quotaResetTimeStamp: null, remainingMs: 0 };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const resetMs = data.quotaResetTimeStamp ? Date.parse(data.quotaResetTimeStamp) : 0;
    const nowMs = Date.now();
    const remainingMs = Math.max(0, resetMs - nowMs);
    return {
      freeQuotaAvailable: remainingMs === 0,
      quotaResetTimeStamp: data.quotaResetTimeStamp || null,
      remainingMs,
    };
  } catch {
    return { freeQuotaAvailable: true, quotaResetTimeStamp: null, remainingMs: 0 };
  }
}

function cmdQuotaStatus(args) {
  if (args['set-reset']) {
    const ts = String(args['set-reset']);
    fs.writeFileSync(
      getQuotaFilePath(),
      JSON.stringify({ quotaResetTimeStamp: ts, lastUpdated: new Date().toISOString() }, null, 2) + '\n'
    );
    console.log(`  ⏱ Recorded Pro quota reset timestamp: ${ts}`);
  }
  const st = getQuotaStatus();
  if (st.freeQuotaAvailable) {
    console.log('  ✅ FREE PRO QUOTA AVAILABLE: Try Antigravity image-generator subagent first!');
  } else {
    const mins = Math.ceil(st.remainingMs / 60000);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    console.log(
      `  ⏳ PRO QUOTA ON COOLDOWN until ${st.quotaResetTimeStamp} (${hrs}h ${remMins}m remaining) -> Use "node scripts/sprite_studio.mjs generate-image" with GEMINI_API_KEY.`
    );
  }
}

function loadGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('GEMINI_API_KEY not found in .env or environment.');
}

async function cmdGenerateImage(args) {
  const charId = args.char;
  if (!charId && !args.out) {
    throw new Error('Usage: generate-image [--char <id>] --out <file> [--refs <p1,p2>] [--aspect 1:1|16:9] [--prompt <text>|--prompt-file <file>]');
  }
  const outPath = path.resolve(args.out || `assets_src/characters/${charId}/generated_raw.jpg`);
  if (charId) {
    assertCharacterPathIsolation(charId, outPath);
  }

  const refPaths = args.refs
    ? String(args.refs)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (charId) {
    for (const rp of refPaths) {
      assertCharacterPathIsolation(charId, rp);
    }
  }

  let promptText = args.prompt ? String(args.prompt) : '';
  if (args['prompt-file']) {
    promptText = fs.readFileSync(path.resolve(args['prompt-file']), 'utf8');
  }
  if (!promptText) {
    throw new Error('Must provide --prompt or --prompt-file');
  }

  const apiKey = loadGeminiApiKey();
  const aspectRatio = args.aspect || '1:1';
  const imageSize = args.size || '1K';

  const parts = [];
  for (const rp of refPaths) {
    const abs = path.resolve(rp);
    const bytes = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    parts.push({
      inlineData: {
        mimeType,
        data: bytes.toString('base64'),
      },
    });
  }
  parts.push({ text: promptText });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };

  const candidateEndpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
  ];

  let lastError = null;
  for (const url of candidateEndpoints) {
    const modelLabel = url.split('/models/')[1]?.split(':')[0] || url;
    const hostLabel = new URL(url).hostname;
    console.log(`  🚀 Calling ${hostLabel} [${modelLabel}] (aspect=${aspectRatio}, refs=${refPaths.length})...`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      lastError = `${res.status} ${res.statusText}: ${errText.slice(0, 400)}`;
      if (res.status === 404 || res.status === 400 || res.status === 403) {
        continue;
      }
      throw new Error(`API Error (${hostLabel} / ${modelLabel}): ${lastError}`);
    }

    const json = await res.json();
    const candParts = json.candidates?.[0]?.content?.parts || [];
    const imgPart = candParts.find((p) => p.inlineData && p.inlineData.data);
    if (!imgPart) {
      lastError = `No inlineData image returned from ${modelLabel}: ${JSON.stringify(json).slice(0, 300)}`;
      continue;
    }

    const buf = Buffer.from(imgPart.inlineData.data, 'base64');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log(`  ✅ Saved generated image (${buf.length} bytes) -> ${path.relative(process.cwd(), outPath)}`);
    return outPath;
  }

  throw new Error(`All image generation endpoints failed. Last error: ${lastError}`);
}

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

const args = parseArgs(process.argv);
const cmd = args._[0];

switch (cmd) {
  case 'quota-status':
    cmdQuotaStatus(args);
    break;
  case 'generate-image':
    await cmdGenerateImage(args);
    break;
  case 'slice-to-masters':
    cmdSliceToMasters(args);
    break;
  case 'import-single-master':
    cmdImportSingleMaster(args);
    break;
  case 'build-pose':
    cmdImportSingleMaster(args);
    cmdCompile(args);
    break;
  case 'build-sheet': {
    cmdSliceToMasters(args);
    const packArgs = { ...args };
    delete packArgs.poses; // Pack all masters according to canonical description.md order
    cmdPackSheet(packArgs);
    cmdCompile(args);
    break;
  }
  case 'pack-sheet':
    cmdPackSheet(args);
    break;
  case 'run-scratch': {
    const mod = await import(path.resolve(args.script));
    if (typeof mod.default === 'function') {
      await mod.default({
        loadImageRGBA,
        savePNG,
        removeMagentaBackground,
        getTightBounds,
        resizeNearest,
        cmdCompile,
      });
    }
    break;
  }
  case 'compile':
    cmdCompile(args);
    break;
  case 'transform':
    cmdTransform(args);
    break;
  case 'splice-mask':
    cmdSpliceMask(args);
    break;
  case 'make-pose-guide':
    cmdMakePoseGuide(args);
    break;
  case 'extract-right-panel':
    cmdExtractRightPanel(args);
    break;
  case 'verify-isolation': {
    const charsDir = path.resolve(process.cwd(), 'assets_src/characters');
    const chars = fs
      .readdirSync(charsDir)
      .filter((d) => fs.statSync(path.join(charsDir, d)).isDirectory());
    console.log('🔒 Character Folder Isolation Audit:');
    for (const c of chars) {
      const { refsDir } = getCharacterDirs(c);
      const refs = fs.existsSync(refsDir)
        ? fs.readdirSync(refsDir).filter((f) => !f.startsWith('.'))
        : [];
      console.log(`  • [${c}] allowed refs ONLY: ${refs.join(', ')}`);
    }
    let blocked = false;
    try {
      assertCharacterPathIsolation(
        'guitar_1',
        'assets_src/characters/guitar_2/refs/peter.png'
      );
    } catch {
      blocked = true;
    }
    if (!blocked) {
      throw new Error('Isolation guard failed to block cross-character access!');
    }
    console.log(
      '✅ Verified: Cross-character file access is strictly blocked by assertCharacterPathIsolation().'
    );
    break;
  }
  default:
    console.log(`
Usage: node scripts/sprite_studio.mjs <command> [options]

Commands:
  slice-to-masters     --char <id> --input <sheet> [--anchor bottom|center]
  compile              --char <id> [--max-height 48] [--max-colors 16] [--out <dir>]
  transform            --char <id> [--pose all|<pose>] [--flip-x] [--recolor "#old:#new:tol"]
  splice-mask          --char <id> --pose <pose> --mask <cyan_mask.png> --edited <ai.png>
  make-pose-guide      --char <id> --ref-pose idle_1 --sketch <stick.png> --out <guide.png>
  extract-right-panel  --char <id> --pose <new_pose> --input <ai_2panel.png> [--anchor bottom|center]
`);
    break;
}

export {
  loadImageRGBA,
  savePNG,
  removeMagentaBackground,
  getTightBounds,
  resizeNearest,
};

