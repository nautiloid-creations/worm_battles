import { SpriteActor } from './SpriteActor';

interface FloatingDamage {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  lifeMs: number;
  maxLifeMs: number;
}

interface SlashSpark {
  x: number;
  y: number;
  color: string;
  lifeMs: number;
  maxLifeMs: number;
  variant: 0 | 1;
}

export class BattleStage {
  public static readonly STAGE_WIDTH = 320;
  public static readonly STAGE_HEIGHT = 180;

  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  public hero: SpriteActor;
  public boss: SpriteActor;
  private bgImage: HTMLImageElement | null = null;

  // Option: automatically trigger opponent's 'hit' state when attacking
  public autoHitOpponent = true;

  private floatingDamages: FloatingDamage[] = [];
  private sparks: SlashSpark[] = [];
  private screenShakeMs = 0;

  private lastTimestamp = 0;
  private onFrameListeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = BattleStage.STAGE_WIDTH;
    this.canvas.height = BattleStage.STAGE_HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    // 1. Hero (Left side, facing Right)
    this.hero = new SpriteActor({
      id: 'hero_guitar_1',
      name: 'GUITAR 1',
      folderPath: '/assets/heroes/guitar_1',
      homeX: 84,
      homeY: 156,
      targetHeight: 92, // Normalized height on the 320x180 stage (includes overhead headroom for Ultimate)
      facing: 'right',
      lungeDistance: 24,
    });

    // 2. Boss (Right side, facing Left)
    this.boss = new SpriteActor({
      id: 'boss_the_worm',
      name: 'THE WORM',
      folderPath: '/assets/bosses/the_worm',
      homeX: 236,
      homeY: 160,
      targetHeight: 100, // Normalized boss height on the 320x180 stage
      facing: 'left',
      lungeDistance: 24,
    });

    // Hook up attack strum ticks to visual impact effects
    this.hero.onAttackFrameToggle = (frame) => {
      if (!this.autoHitOpponent) return;
      if (this.boss.state !== 'downed') {
        this.boss.setState('hit');
        this.spawnHitEffect(
          this.boss.config.homeX - 8 + (frame === 0 ? -6 : 6),
          this.boss.config.homeY - this.boss.config.targetHeight * 0.55,
          '#55ffff',
          frame
        );
      }
    };

    this.boss.onAttackFrameToggle = (frame) => {
      if (!this.autoHitOpponent) return;
      if (this.hero.state !== 'downed') {
        this.hero.setState('hit');
        this.spawnHitEffect(
          this.hero.config.homeX + 6 + (frame === 0 ? -4 : 4),
          this.hero.config.homeY - this.hero.config.targetHeight * 0.55,
          '#78ff5f',
          frame
        );
      }
    };
  }

  public async loadAllAssets(cacheBust = false): Promise<void> {
    const query = cacheBust ? `?t=${Date.now()}` : '';
    const bgPromise = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.bgImage = img;
        resolve();
      };
      img.onerror = () => {
        console.warn('Missing background /assets/backgrounds/stage_1.png');
        resolve();
      };
      img.src = `/assets/backgrounds/stage_1.png${query}`;
    });

    await Promise.all([
      bgPromise,
      this.hero.loadSprites(cacheBust),
      this.boss.loadSprites(cacheBust),
    ]);
  }

  public startHeroAttack(): void {
    this.hero.setState('attack');
  }

  public stopHeroAttack(): void {
    if (this.hero.state === 'attack') {
      this.hero.setState('idle');
      if (this.autoHitOpponent && this.boss.state === 'hit') {
        this.boss.setState('idle');
      }
    }
  }

  public startBossAttack(): void {
    this.boss.setState('attack');
  }

  public stopBossAttack(): void {
    if (this.boss.state === 'attack') {
      this.boss.setState('idle');
      if (this.autoHitOpponent && this.hero.state === 'hit') {
        this.hero.setState('idle');
      }
    }
  }

  private spawnHitEffect(
    x: number,
    y: number,
    color: string,
    variant: 0 | 1
  ): void {
    const dmg = Math.floor(120 + Math.random() * 880);
    this.floatingDamages.push({
      x: Math.round(x + (Math.random() * 16 - 8)),
      y: Math.round(y - 8),
      vy: -0.032,
      text: `${dmg}`,
      color: variant === 0 ? '#fff36b' : '#ffffff',
      lifeMs: 520,
      maxLifeMs: 520,
    });

    this.sparks.push({
      x: Math.round(x),
      y: Math.round(y),
      color,
      lifeMs: 120,
      maxLifeMs: 120,
      variant,
    });

    this.screenShakeMs = 90;
  }

  public onTick(cb: () => void): void {
    this.onFrameListeners.push(cb);
  }

  public startLoop(): void {
    this.lastTimestamp = performance.now();
    const step = (now: number) => {
      const dtMs = Math.min(100, now - this.lastTimestamp);
      this.lastTimestamp = now;
      this.update(dtMs);
      this.render();
      for (const cb of this.onFrameListeners) cb();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private update(dtMs: number): void {
    this.hero.update(dtMs);
    this.boss.update(dtMs);

    if (this.screenShakeMs > 0) {
      this.screenShakeMs = Math.max(0, this.screenShakeMs - dtMs);
    }

    for (let i = this.floatingDamages.length - 1; i >= 0; i--) {
      const fd = this.floatingDamages[i];
      fd.y += fd.vy * dtMs;
      fd.lifeMs -= dtMs;
      if (fd.lifeMs <= 0) {
        this.floatingDamages.splice(i, 1);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.lifeMs -= dtMs;
      if (sp.lifeMs <= 0) {
        this.sparks.splice(i, 1);
      }
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const W = BattleStage.STAGE_WIDTH;
    const H = BattleStage.STAGE_HEIGHT;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (this.screenShakeMs > 0) {
      const sx = Math.round((Math.random() - 0.5) * 3);
      const sy = Math.round((Math.random() - 0.5) * 2);
      ctx.translate(sx, sy);
    }

    // 1. Background
    if (this.bgImage && this.bgImage.naturalWidth > 0) {
      ctx.drawImage(this.bgImage, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#181028';
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Actors (Draw defended/idle behind attacking actor so lunge overlaps in front)
    if (this.boss.state === 'attack' && this.hero.state !== 'attack') {
      this.hero.draw(ctx);
      this.boss.draw(ctx);
    } else {
      this.boss.draw(ctx);
      this.hero.draw(ctx);
    }

    // 3. Pixel Slash / Chord Sparks
    for (const sp of this.sparks) {
      ctx.save();
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (sp.variant === 0) {
        ctx.moveTo(sp.x - 10, sp.y - 10);
        ctx.lineTo(sp.x + 10, sp.y + 10);
      } else {
        ctx.moveTo(sp.x - 10, sp.y + 10);
        ctx.lineTo(sp.x + 10, sp.y - 10);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Floating Retro Damage Numbers
    ctx.font = 'bold 8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const fd of this.floatingDamages) {
      const x = Math.round(fd.x);
      const y = Math.round(fd.y);
      ctx.fillStyle = '#120d1f';
      ctx.fillText(fd.text, x + 1, y + 1);
      ctx.fillStyle = fd.color;
      ctx.fillText(fd.text, x, y);
    }

    // 5. Classic Top Retro Battle Banner
    this.drawRetroBanner(ctx);

    ctx.restore();
  }

  private drawRetroBanner(ctx: CanvasRenderingContext2D): void {
    // Classic SNES-style top status bar
    ctx.fillStyle = 'rgba(16, 18, 48, 0.85)';
    ctx.fillRect(8, 6, 304, 18);
    ctx.strokeStyle = '#d8e2ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(8.5, 6.5, 303, 17);

    ctx.font = '6px "Press Start 2P", monospace';
    ctx.textBaseline = 'middle';

    // Left: Hero status
    ctx.textAlign = 'left';
    ctx.fillStyle = '#63e6ff';
    ctx.fillText(
      `${this.hero.config.name}: ${this.hero.getActiveSpriteKey().toUpperCase()}`,
      15,
      15
    );

    // Right: Boss status
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff6b97';
    ctx.fillText(
      `${this.boss.config.name}: ${this.boss.getActiveSpriteKey().toUpperCase()}`,
      305,
      15
    );
  }
}
