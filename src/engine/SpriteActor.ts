export type ActorState = 'idle' | 'attack' | 'hit' | 'downed' | 'ultimate';

export type SpriteKey =
  | 'idle_1'
  | 'idle_2'
  | 'attack_1'
  | 'attack_2'
  | 'hit'
  | 'downed'
  | 'ultimate';

export const ALL_SPRITE_KEYS: SpriteKey[] = [
  'idle_1',
  'idle_2',
  'attack_1',
  'attack_2',
  'hit',
  'downed',
  'ultimate',
];

export interface SpriteActorConfig {
  id: string;
  name: string;
  folderPath: string; // e.g. '/assets/heroes/guitar_1'
  homeX: number; // Bottom-center X in 320x180 stage coordinates
  homeY: number; // Bottom-center Y (feet position) in 320x180 stage coordinates
  targetHeight: number; // Normalized on-screen height in stage pixels
  facing: 'right' | 'left';
  lungeDistance: number; // How far to step forward during attack
  availablePoses?: SpriteKey[]; // Optional custom pose list (defaults to ALL_SPRITE_KEYS)
}

export class SpriteActor {
  public config: SpriteActorConfig;
  public state: ActorState = 'idle';
  public frameIndex: 0 | 1 = 0;

  // Timing configuration
  public idleIntervalMs = 450; // ~133 BPM bounce
  public attackIntervalMs = 115; // Fast guitar strum / rapid boss attack

  // Internal timers & visual juice
  private frameTimerMs = 0;
  private hitFlashTimerMs = 0;
  private hitShakeTimerMs = 0;
  private currentOffsetX = 0;

  // Loaded HTMLImageElement map + white silhouette canvas cache
  private sprites: Partial<Record<SpriteKey, HTMLImageElement>> = {};
  private whiteSilhouettes: Partial<Record<SpriteKey, HTMLCanvasElement>> = {};
  public isLoaded = false;

  // Optional callback fired each time an attack frame toggles (for triggering opponent hit/sparks)
  public onAttackFrameToggle?: (frame: 0 | 1) => void;

  constructor(config: SpriteActorConfig) {
    this.config = { ...config };
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
        // Re-trigger flash and shake if hit again while already in hit state
        this.hitFlashTimerMs = 110;
        this.hitShakeTimerMs = 220;
      }
      return;
    }

    this.state = nextState;
    this.frameIndex = 0;
    this.frameTimerMs = 0;

    if (nextState === 'hit') {
      this.hitFlashTimerMs = 110;
      this.hitShakeTimerMs = 220;
    }

    if (nextState === 'attack' && this.onAttackFrameToggle) {
      this.onAttackFrameToggle(0);
    }
  }

  public getActiveSpriteKey(): SpriteKey {
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

    // 2. Smoothly step forward when attacking, return to 0 otherwise
    const dir = this.config.facing === 'right' ? 1 : -1;
    const targetOffsetX =
      this.state === 'attack' ? dir * this.config.lungeDistance : 0;
    const lerpSpeed = Math.min(1, dtMs * 0.025);
    this.currentOffsetX += (targetOffsetX - this.currentOffsetX) * lerpSpeed;

    // 3. Decrement hit flash & shake timers
    if (this.hitFlashTimerMs > 0) {
      this.hitFlashTimerMs = Math.max(0, this.hitFlashTimerMs - dtMs);
    }
    if (this.hitShakeTimerMs > 0) {
      this.hitShakeTimerMs = Math.max(0, this.hitShakeTimerMs - dtMs);
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    const key = this.getActiveSpriteKey();
    const img = this.sprites[key];
    if (!img || !img.naturalHeight) return;

    // Automatic height normalization preserving aspect ratio
    const scale = this.config.targetHeight / img.naturalHeight;
    const drawW = Math.round(img.naturalWidth * scale);
    const drawH = Math.round(this.config.targetHeight);

    // Compute horizontal shake if in hit recovery
    let shakeX = 0;
    if (this.hitShakeTimerMs > 0) {
      shakeX = Math.sin(this.hitShakeTimerMs * 0.15) * 3;
    }

    const drawX = Math.round(
      this.config.homeX + this.currentOffsetX + shakeX - drawW / 2
    );
    const drawY = Math.round(this.config.homeY - drawH);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    // Draw crisp white hit-flash overlay right when hit lands
    const whiteMask = this.whiteSilhouettes[key];
    if (this.hitFlashTimerMs > 0 && whiteMask) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(whiteMask, drawX, drawY, drawW, drawH);
    }
    ctx.restore();
  }
}
