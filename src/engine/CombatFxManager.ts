export interface ActiveArenaFx {
  fxId: string;
  paletteName: string;
  size: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  speed?: number; // px per ms
  facing: 'right' | 'left';
  flipX?: boolean;
  rotation?: 0 | 90 | 180 | 270;
  lifeMs: number;
  maxLifeMs: number;
}

export interface FxConfig {
  fxId: string;
  paletteName: string;
  size: number;
}

export const FX_PALETTES: Record<string, [number, number, number][]> = {
  'Musical Steel': [
    [16, 20, 28], [54, 64, 78], [98, 114, 130], [168, 192, 212], [245, 252, 255],
  ],
  'Solar Flame': [
    [69, 8, 0], [208, 18, 0], [255, 106, 0], [255, 229, 59], [255, 255, 255],
  ],
  'Dark Flame': [
    [40, 2, 2], [255, 160, 0], [255, 60, 0], [140, 8, 8], [45, 2, 2],
  ],
  'Electric Plasma': [
    [12, 14, 54], [0, 72, 200], [0, 166, 255], [117, 255, 255], [255, 255, 255],
  ],
  'Toxic Acid': [
    [4, 38, 9], [0, 122, 29], [0, 210, 46], [132, 255, 20], [242, 255, 240],
  ],
  'Dark Magic': [
    [22, 0, 38], [78, 0, 120], [148, 20, 214], [232, 92, 255], [255, 255, 255],
  ],
  'Void Magic': [
    [20, 0, 35], [225, 80, 255], [140, 18, 210], [50, 2, 85], [5, 0, 10],
  ],
  'Starlight Chorus': [
    [62, 34, 0], [186, 114, 0], [242, 184, 0], [255, 248, 166], [255, 255, 255],
  ],
  'Chrome & Blood': [
    [26, 0, 5], [123, 8, 26], [216, 26, 50], [203, 226, 244], [255, 255, 255],
  ],
};

export const FX_LIST = [
  // Elemental & Energy
  { id: 'fx_fireball', label: 'Fireball' },
  { id: 'fx_branching_lightning', label: 'Branching Lightning' },
  { id: 'fx_energy_arc', label: 'Energy Arc' },
  { id: 'fx_stormcloud', label: 'Stormcloud' },
  { id: 'fx_orb_crackling', label: 'Crackling Orb' },
  { id: 'fx_orb_lightning', label: 'Lightning Orb' },
  { id: 'fx_orb_fire', label: 'Fire Orb' },
  // Musical Weapons
  { id: 'fx_note_bassclef', label: 'Bass Clef Sword' },
  { id: 'fx_note_trebleclef', label: 'Treble Clef Blade' },
  { id: 'fx_note_quarter', label: 'Quarter Mace' },
  { id: 'fx_note_eighths', label: 'Eighth Axes' },
  { id: 'fx_note_triplets', label: 'Triplet Flanged' },
  { id: 'fx_note_sixteenths', label: 'Sixteenth Sawblades' },
  { id: 'fx_rest_quarter', label: 'Rest Dagger' },
  { id: 'fx_rest_eighth', label: 'Rest Scythe' },
  { id: 'fx_accidental_flat', label: 'Flat Hatchet' },
  { id: 'fx_accidental_sharp', label: 'Sharp Throwing Weapon' },
  { id: 'fx_repeat_sign', label: 'Repeat Sign Blade' },
];

export const FX_SIZES = [
  { value: 18, label: '18% Height (Tiny)' },
  { value: 27, label: '27% Height (Small)' },
  { value: 36, label: '36% Height (Normal)' },
  { value: 53, label: '53% Height (Large)' },
  { value: 71, label: '71% Height (Huge)' },
];

export class CombatFxManager {
  private baseImages: Map<string, HTMLImageElement> = new Map();
  private cache: Map<string, HTMLCanvasElement> = new Map();
  public activeEffects: ActiveArenaFx[] = [];
  public isLoaded = false;

  public async loadAssets(): Promise<void> {
    const promises = FX_LIST.map((item) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.baseImages.set(item.id, img);
          resolve();
        };
        img.onerror = () => {
          console.warn(`Failed to load combat FX: /assets/effects/${item.id}.png`);
          resolve();
        };
        img.src = `/assets/effects/${item.id}.png`;
      });
    });

    await Promise.all(promises);
    this.isLoaded = true;
  }

  public getOrCreateRecoloredCanvas(
    fxId: string,
    paletteName: string,
    targetSize: number
  ): HTMLCanvasElement | null {
    const cacheKey = `${fxId}_${paletteName}_${targetSize}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const resolvedFxId = fxId === 'fx_note_eighth_pair' ? 'fx_note_eighths' : fxId === 'fx_note_triplet' ? 'fx_note_triplets' : fxId;
    const baseImg = this.baseImages.get(resolvedFxId) || this.baseImages.get(fxId);
    if (!baseImg || !baseImg.naturalWidth || !baseImg.naturalHeight) return null;

    const ramp = FX_PALETTES[paletteName] || FX_PALETTES['Solar Flame'];

    // 1. Render scaled to offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = targetSize;
    offscreen.height = targetSize;
    const ctx = offscreen.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baseImg, 0, 0, targetSize, targetSize);

    const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
    const data = imgData.data;
    const len = data.length;

    // 2. Remap to chosen palette ramp
    const numStops = ramp.length - 1;
    for (let i = 0; i < len; i += 4) {
      const a = data[i + 3];
      if (a < 30) {
        data[i + 3] = 0;
        continue;
      }

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const t = Math.pow(lum, 0.95);

      const scaledT = Math.min(numStops, Math.max(0, t * numStops));
      const idx = Math.min(numStops - 1, Math.floor(scaledT));
      const frac = scaledT - idx;

      const c1 = ramp[idx];
      const c2 = ramp[idx + 1];

      data[i] = Math.round(c1[0] * (1 - frac) + c2[0] * frac);
      data[i + 1] = Math.round(c1[1] * (1 - frac) + c2[1] * frac);
      data[i + 2] = Math.round(c1[2] * (1 - frac) + c2[2] * frac);
      data[i + 3] = 255;
    }

    // 3. Edge snapping: ensure outer silhouette borders are solid and punchy
    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        const idx = (y * targetSize + x) * 4;
        if (data[idx + 3] < 40) continue;

        let isEdge = false;
        if (
          x === 0 ||
          x === targetSize - 1 ||
          y === 0 ||
          y === targetSize - 1 ||
          data[idx - 4 + 3] < 40 ||
          data[idx + 4 + 3] < 40 ||
          data[idx - targetSize * 4 + 3] < 40 ||
          data[idx + targetSize * 4 + 3] < 40
        ) {
          isEdge = true;
        }

        if (isEdge) {
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (lum < 95) {
            data[idx] = Math.round(data[idx] * 0.2);
            data[idx + 1] = Math.round(data[idx + 1] * 0.2);
            data[idx + 2] = Math.round(data[idx + 2] * 0.2);
          } else {
            data[idx] = Math.round(data[idx] * 0.65);
            data[idx + 1] = Math.round(data[idx + 1] * 0.65);
            data[idx + 2] = Math.round(data[idx + 2] * 0.65);
          }
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.cache.set(cacheKey, offscreen);
    return offscreen;
  }

  public spawnArenaEffect(
    fxId: string,
    paletteName: string,
    size: number,
    x: number,
    y: number,
    facing: 'right' | 'left',
    durationMs = 450,
    targetX?: number,
    targetY?: number,
    speed?: number,
    flipX?: boolean,
    rotation?: 0 | 90 | 180 | 270
  ): void {
    this.activeEffects.push({
      fxId,
      paletteName,
      size,
      x: Math.round(x),
      y: Math.round(y),
      targetX: targetX !== undefined ? Math.round(targetX) : undefined,
      targetY: targetY !== undefined ? Math.round(targetY) : undefined,
      speed,
      facing,
      flipX,
      rotation,
      lifeMs: durationMs,
      maxLifeMs: durationMs,
    });
  }

  public clear(): void {
    this.activeEffects = [];
  }

  public update(dtMs: number): void {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const fx = this.activeEffects[i];
      fx.lifeMs -= dtMs;

      // Projectile trajectory motion
      if (fx.targetX !== undefined && fx.targetY !== undefined) {
        const dx = fx.targetX - fx.x;
        const dy = fx.targetY - fx.y;
        const dist = Math.hypot(dx, dy);
        const speed = fx.speed !== undefined ? fx.speed : 0.32; // px per ms
        const step = speed * dtMs;
        if (dist <= step || dist < 1) {
          fx.x = fx.targetX;
          fx.y = fx.targetY;
        } else {
          fx.x += (dx / dist) * step;
          fx.y += (dy / dist) * step;
        }
      }

      if (fx.lifeMs <= 0) {
        this.activeEffects.splice(i, 1);
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    const canvasH = ctx.canvas.height;

    for (const fx of this.activeEffects) {
      // Calculate pixel size strictly as % of canvas height (e.g. 1% -> 0.01 * canvasH, 10% -> 0.10 * canvasH)
      const fraction = Math.max(0.005, fx.size / 100);
      const pixelSize = Math.max(4, Math.round(canvasH * fraction));

      const canvas = this.getOrCreateRecoloredCanvas(fx.fxId, fx.paletteName, pixelSize);
      if (!canvas) continue;

      const progress = 1 - fx.lifeMs / fx.maxLifeMs;
      const alpha = fx.lifeMs < 100 ? fx.lifeMs / 100 : 1.0;

      // Gentle floating / pulsing scale
      const pulseScale = 1.0 + Math.sin(progress * Math.PI) * 0.12;
      const drawW = Math.round(pixelSize * pulseScale);
      const drawH = Math.round(pixelSize * pulseScale);

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.imageSmoothingEnabled = false;

      ctx.translate(fx.x, fx.y);
      if (fx.rotation) {
        ctx.rotate((fx.rotation * Math.PI) / 180);
      }
      if (fx.flipX || fx.facing === 'left') {
        ctx.scale(-1, 1);
      }

      ctx.drawImage(canvas, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }
}
