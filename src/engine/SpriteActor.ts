export type ActorState = 'idle' | 'attack' | 'hit' | 'downed' | 'ultimate';

export type SpriteKey =
  | 'idle_1'
  | 'idle_2'
  | 'attack_1'
  | 'attack_2'
  | 'hit'
  | 'downed'
  | 'ultimate'
  | 'ultimate_1'
  | 'ultimate_2'
  | 'ultimate_3';

export const ALL_SPRITE_KEYS: SpriteKey[] = [
  'idle_1',
  'idle_2',
  'attack_1',
  'attack_2',
  'hit',
  'downed',
  'ultimate',
  'ultimate_1',
  'ultimate_2',
  'ultimate_3',
];

export interface SpriteActorConfig {
  id: string;
  name: string;
  folderPath: string; // e.g. '/assets/heroes/guitar_1'
  homeX: number; // Bottom-center X in stage coordinates
  homeY: number; // Bottom-center Y (feet position) in stage coordinates
  heightFraction: number; // Normalized height as a fraction of canvas height (e.g. 0.42 = 42%)
  facing: 'right' | 'left';
  lungeDistance: number; // How far to step forward during attack in stage pixels
  availablePoses?: SpriteKey[]; // Optional custom pose list (defaults to ALL_SPRITE_KEYS)
}

export class SpriteActor {
  public config: SpriteActorConfig;
  public state: ActorState = 'idle';
  public frameIndex: 0 | 1 = 0;

  public heightFraction: number;
  public currentX: number;
  public currentY: number;

  // Timing configuration
  public idleIntervalMs = 450; // ~133 BPM bounce
  public attackIntervalMs = 115; // Fast guitar strum / rapid boss attack

  // Internal timers & visual juice
  private frameTimerMs = 0;
  private hitFlashTimerMs = 0;
  private hitShakeTimerMs = 0;
  private hitAutoRecoveryTimerMs = 0;
  public isManuallyLatched = false;
  public canLunge = true;
  public forcedSpriteKey: SpriteKey | null = null;

  // Loaded HTMLImageElement map + white silhouette canvas cache
  private sprites: Partial<Record<SpriteKey, HTMLImageElement>> = {};
  private whiteSilhouettes: Partial<Record<SpriteKey, HTMLCanvasElement>> = {};
  private scaledCache: Map<string, HTMLCanvasElement> = new Map();
  public isLoaded = false;

  // Optional callback fired each time an attack frame toggles (for triggering opponent hit/sparks)
  public onAttackFrameToggle?: (frame: 0 | 1) => void;

  constructor(config: SpriteActorConfig) {
    this.config = { ...config };
    this.heightFraction = config.heightFraction;
    this.currentX = config.homeX;
    this.currentY = config.homeY;
  }

  public setHome(x: number, y: number): void {
    this.config.homeX = x;
    this.config.homeY = y;
  }

  /**
   * Loads (or hot-reloads) all available PNG files from the actor's folder.
   * Supports characters/bosses with any subset or superset of poses.
   */
  public async loadSprites(cacheBust = false): Promise<void> {
    const query = cacheBust ? `?t=${Date.now()}` : '';
    const keysToTry = this.config.availablePoses || ALL_SPRITE_KEYS;
    this.sprites = {};
    this.whiteSilhouettes = {};
    this.scaledCache.clear();

    const promises = keysToTry.map(
      (key) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            this.sprites[key] = img;
            this.whiteSilhouettes[key] = this.createWhiteSilhouette(img);
            resolve();
          };
          img.onerror = () => {
            // Optional poses (like ultimate on a boss or fewer frames) may not exist
            resolve();
          };
          img.src = `${this.config.folderPath}/${key}.png${query}`;
        })
    );

    await Promise.all(promises);
    this.isLoaded = true;
  }

  public hasSprite(key: SpriteKey): boolean {
    return Boolean(this.sprites[key]);
  }

  public getLoadedSpriteKeys(): SpriteKey[] {
    return ALL_SPRITE_KEYS.filter((k) => Boolean(this.sprites[k]));
  }

  private createWhiteSilhouette(img: HTMLImageElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 48;
    c.height = img.naturalHeight || 48;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  public setState(nextState: ActorState): void {
    if (this.state === nextState) {
      if (nextState === 'hit') {
        // Re-trigger flash, shake, and reset auto-recovery window
        this.hitFlashTimerMs = 110;
        this.hitShakeTimerMs = 220;
        this.hitAutoRecoveryTimerMs = 320;
      }
      return;
    }

    this.state = nextState;
    this.frameIndex = 0;
    this.frameTimerMs = 0;

    if (nextState === 'hit') {
      this.hitFlashTimerMs = 110;
      this.hitShakeTimerMs = 220;
      this.hitAutoRecoveryTimerMs = 320;
    }

    if (nextState === 'attack' && this.onAttackFrameToggle) {
      this.onAttackFrameToggle(0);
    }
  }

  public resetCombatState(): void {
    this.state = 'idle';
    this.forcedSpriteKey = null;
    this.isManuallyLatched = false;
    this.hitFlashTimerMs = 0;
    this.hitShakeTimerMs = 0;
    this.hitAutoRecoveryTimerMs = 0;
    this.currentX = this.config.homeX;
    this.currentY = this.config.homeY;
    this.frameIndex = 0;
    this.frameTimerMs = 0;
  }

  public getActiveSpriteKey(): SpriteKey {
    if (this.forcedSpriteKey && this.sprites[this.forcedSpriteKey]) {
      return this.forcedSpriteKey;
    }
    switch (this.state) {
      case 'idle':
        if (this.frameIndex === 1 && this.sprites.idle_2) return 'idle_2';
        return 'idle_1';
      case 'attack':
        if (this.frameIndex === 1 && this.sprites.attack_2) return 'attack_2';
        return this.sprites.attack_1 ? 'attack_1' : 'idle_1';
      case 'hit':
        return this.sprites.hit ? 'hit' : 'idle_1';
      case 'downed':
        return this.sprites.downed ? 'downed' : 'idle_1';
      case 'ultimate':
        return this.sprites.ultimate
          ? 'ultimate'
          : this.sprites.attack_1
          ? 'attack_1'
          : 'idle_1';
    }
  }

  public getActiveSpriteDimensions(): { width: number; height: number } | null {
    const img = this.sprites[this.getActiveSpriteKey()];
    if (!img || !img.naturalWidth) return null;
    return { width: img.naturalWidth, height: img.naturalHeight };
  }

  public update(dtMs: number): void {
    // 1. Update 2-frame loops for 'idle' and 'attack'
    if (this.state === 'idle' || this.state === 'attack') {
      const interval =
        this.state === 'idle' ? this.idleIntervalMs : this.attackIntervalMs;
      this.frameTimerMs += dtMs;
      if (this.frameTimerMs >= interval) {
        this.frameTimerMs %= interval;
        this.frameIndex = this.frameIndex === 0 ? 1 : 0;
        if (this.state === 'attack' && this.onAttackFrameToggle) {
          this.onAttackFrameToggle(this.frameIndex);
        }
      }
    }

    // 2. Smooth position lerping for slot swaps and attack/ultimate lunges
    const isLunging = (this.state === 'attack' || this.state === 'ultimate') && this.canLunge;
    const dir = this.config.facing === 'right' ? 1 : -1;
    const targetX = this.config.homeX + (isLunging ? dir * this.config.lungeDistance : 0);
    const targetY = this.config.homeY;

    const lerpSpeed = Math.min(1, dtMs * 0.018);
    this.currentX += (targetX - this.currentX) * lerpSpeed;
    this.currentY += (targetY - this.currentY) * lerpSpeed;

    // 3. Decrement hit flash & shake timers, and auto-recover from hit if not manually latched
    if (this.hitFlashTimerMs > 0) {
      this.hitFlashTimerMs = Math.max(0, this.hitFlashTimerMs - dtMs);
    }
    if (this.hitShakeTimerMs > 0) {
      this.hitShakeTimerMs = Math.max(0, this.hitShakeTimerMs - dtMs);
    }
    if (this.state === 'hit' && !this.isManuallyLatched) {
      this.hitAutoRecoveryTimerMs -= dtMs;
      if (this.hitAutoRecoveryTimerMs <= 0) {
        this.setState('idle');
      }
    }
  }

  private getOrCreateScaledCanvas(
    key: SpriteKey,
    img: HTMLImageElement,
    targetW: number,
    targetH: number
  ): HTMLCanvasElement {
    const cacheKey = `${key}_${targetW}x${targetH}`;
    let cached = this.scaledCache.get(cacheKey);
    if (cached) return cached;

    cached = document.createElement('canvas');
    cached.width = targetW;
    cached.height = targetH;
    const cCtx = cached.getContext('2d')!;
    cCtx.imageSmoothingEnabled = true;
    cCtx.imageSmoothingQuality = 'high';
    cCtx.drawImage(img, 0, 0, targetW, targetH);

    // Apply +40% Unsharp Kernel followed by Edge Snapping (Arcade Re-inking)
    const imgData = cCtx.getImageData(0, 0, targetW, targetH);
    const src = imgData.data;
    const len = src.length;

    // Step 1: Unsharp sharpening (+40% strength: center c = 1.40, 4 neighbors w = 0.10)
    const sharp = new Uint8ClampedArray(len);
    const c = 1.40;
    const w = 0.10;

    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const idx = (y * targetW + x) * 4;
        const a = src[idx + 3];
        if (a < 30) {
          sharp[idx + 3] = 0;
          continue;
        }

        let r = src[idx] * c;
        let g = src[idx + 1] * c;
        let b = src[idx + 2] * c;

        if (x > 0 && src[idx - 4 + 3] > 30) {
          r -= src[idx - 4] * w;
          g -= src[idx - 3] * w;
          b -= src[idx - 2] * w;
        }
        if (x < targetW - 1 && src[idx + 4 + 3] > 30) {
          r -= src[idx + 4] * w;
          g -= src[idx + 5] * w;
          b -= src[idx + 6] * w;
        }
        if (y > 0 && src[idx - targetW * 4 + 3] > 30) {
          r -= src[idx - targetW * 4] * w;
          g -= src[idx - targetW * 4 + 1] * w;
          b -= src[idx - targetW * 4 + 2] * w;
        }
        if (y < targetH - 1 && src[idx + targetW * 4 + 3] > 30) {
          r -= src[idx + targetW * 4] * w;
          g -= src[idx + targetW * 4 + 1] * w;
          b -= src[idx + targetW * 4 + 2] * w;
        }

        sharp[idx] = r;
        sharp[idx + 1] = g;
        sharp[idx + 2] = b;
        sharp[idx + 3] = a;
      }
    }

    // Step 2: Edge Snapping & Outline Re-inking
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const idx = (y * targetW + x) * 4;
        const a = sharp[idx + 3];
        if (a < 40) {
          src[idx + 3] = 0;
          continue;
        }

        let isEdge = false;
        if (
          x === 0 ||
          x === targetW - 1 ||
          y === 0 ||
          y === targetH - 1 ||
          sharp[idx - 4 + 3] < 40 ||
          sharp[idx + 4 + 3] < 40 ||
          sharp[idx - targetW * 4 + 3] < 40 ||
          sharp[idx + targetW * 4 + 3] < 40
        ) {
          isEdge = true;
        }

        let r = sharp[idx];
        let g = sharp[idx + 1];
        let b = sharp[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (isEdge) {
          // Perimeter pixel: if dark/outline, clamp to solid black outline; otherwise darken by 35%
          if (lum < 95) {
            r = Math.round(r * 0.2);
            g = Math.round(g * 0.2);
            b = Math.round(b * 0.2);
          } else {
            r = Math.round(r * 0.65);
            g = Math.round(g * 0.65);
            b = Math.round(b * 0.65);
          }
          src[idx + 3] = 255; // solid alpha, eliminating blurry halo
        } else {
          src[idx + 3] = 255;
        }

        src[idx] = r;
        src[idx + 1] = g;
        src[idx + 2] = b;
      }
    }

    cCtx.putImageData(imgData, 0, 0);

    this.scaledCache.set(cacheKey, cached);
    return cached;
  }

  private getOrCreateWhiteMask(
    key: SpriteKey,
    scaledCanvas: HTMLCanvasElement,
    targetW: number,
    targetH: number
  ): HTMLCanvasElement {
    const whiteKey = `white_${key}_${targetW}x${targetH}`;
    let cached = this.scaledCache.get(whiteKey);
    if (cached) return cached;

    cached = document.createElement('canvas');
    cached.width = targetW;
    cached.height = targetH;
    const ctx = cached.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scaledCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    this.scaledCache.set(whiteKey, cached);
    return cached;
  }

  public draw(ctx: CanvasRenderingContext2D, canvasHeight: number): void {
    const key = this.getActiveSpriteKey();
    const img = this.sprites[key];
    if (!img || !img.naturalHeight || !img.naturalWidth) return;

    // 1. Calculate display height as a direct fraction of canvas height
    const displayH = Math.round(canvasHeight * this.heightFraction);
    const displayW = Math.max(1, Math.round(img.naturalWidth * (displayH / img.naturalHeight)));

    let shakeX = 0;
    if (this.hitShakeTimerMs > 0) {
      shakeX = Math.sin(this.hitShakeTimerMs * 0.15) * 3;
    }

    const drawX = Math.round(this.currentX + shakeX - displayW / 2);
    const drawY = Math.round(this.currentY - displayH);

    // Pre-scale using high-quality area downscaling + edge-snapping when rendering below native master height
    let sourceToDraw: CanvasImageSource = img;
    let whiteMask: CanvasImageSource | undefined = this.whiteSilhouettes[key];

    if (displayH < img.naturalHeight) {
      const scaled = this.getOrCreateScaledCanvas(key, img, displayW, displayH);
      sourceToDraw = scaled;
      whiteMask = this.getOrCreateWhiteMask(key, scaled, displayW, displayH);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceToDraw, drawX, drawY, displayW, displayH);

    // If hit flash is active, overlay white silhouette
    if (this.hitFlashTimerMs > 0 && whiteMask) {
      ctx.globalAlpha = 0.78;
      ctx.drawImage(whiteMask, drawX, drawY, displayW, displayH);
    }
    ctx.restore();
  }
}
