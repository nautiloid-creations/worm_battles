import { SpriteActor, ActorState } from './SpriteActor';

export type HeroSlotKey = 'front' | 'top' | 'bottom' | 'back';

export const BASE_HERO_SLOT_POSITIONS: Record<HeroSlotKey, { xFraction: number; yFraction: number }> = {
  front: { xFraction: 125 / 320, yFraction: 142 / 180 }, // Rightmost rank, closest to enemies
  top: { xFraction: 74 / 320, yFraction: 112 / 180 },    // Upper background
  bottom: { xFraction: 88 / 320, yFraction: 166 / 180 }, // Lower foreground
  back: { xFraction: 38 / 320, yFraction: 136 / 180 },   // Far-left background
};

export const BASE_ENEMY_SLOT_POSITIONS: Array<{ xFraction: number; yFraction: number }> = [
  { xFraction: 242 / 320, yFraction: 152 / 180 }, // 0: Center front
  { xFraction: 275 / 320, yFraction: 118 / 180 }, // 1: Upper back
  { xFraction: 215 / 320, yFraction: 164 / 180 }, // 2: Lower front
  { xFraction: 218 / 320, yFraction: 114 / 180 }, // 3: Upper front
  { xFraction: 278 / 320, yFraction: 160 / 180 }, // 4: Lower back
  { xFraction: 250 / 320, yFraction: 94 / 180 },  // 5: High center
  { xFraction: 288 / 320, yFraction: 138 / 180 }, // 6: Deep back
  { xFraction: 196 / 320, yFraction: 138 / 180 }, // 7: Front vanguard
];

export interface ResolutionPreset {
  width: number;
  height: number;
  label: string;
}

export const RESOLUTION_PRESETS: Record<string, ResolutionPreset> = {
  '320x180': { width: 320, height: 180, label: '320 × 180 (Lo-Fi 180p)' },
  '480x270': { width: 480, height: 270, label: '480 × 270 (Classic 270p)' },
  '640x360': { width: 640, height: 360, label: '640 × 360 (Mid-Fi 360p)' },
  '960x540': { width: 960, height: 540, label: '960 × 540 (Hi-Fi 540p)' },
  '1280x720': { width: 1280, height: 720, label: '1280 × 720 (HD 720p)' },
  '1920x1080': { width: 1920, height: 1080, label: '1920 × 1080 (FHD 1080p)' },
};

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
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  public currentResKey = '320x180';

  public heroes: SpriteActor[] = [];
  public heroSlots: Map<string, HeroSlotKey> = new Map();

  public enemies: SpriteActor[] = [];
  private nextEnemyCounter = 1;

  private bgImage: HTMLImageElement | null = null;
  public autoHitOpponent = true;

  // Global settings
  public baseLungeDistance = 24; // in 180p units
  public idleIntervalMs = 450;
  public attackIntervalMs = 115;

  private floatingDamages: FloatingDamage[] = [];
  private sparks: SlashSpark[] = [];
  private screenShakeMs = 0;

  private lastTimestamp = 0;
  private onFrameListeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const initialRes = RESOLUTION_PRESETS[this.currentResKey];
    this.canvas.width = initialRes.width;
    this.canvas.height = initialRes.height;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    // Initialize the 4 band members
    this.initHeroes();

    // Initialize first boss (The Worm)
    this.initDefaultBoss();
  }

  public setCanvasResolution(resKey: string): void {
    const preset = RESOLUTION_PRESETS[resKey];
    if (!preset) return;

    this.currentResKey = resKey;
    this.canvas.width = preset.width;
    this.canvas.height = preset.height;
    this.ctx.imageSmoothingEnabled = false;

    const scale = preset.height / 180;

    // Update hero positions
    for (const [id, slot] of this.heroSlots.entries()) {
      const hero = this.heroes.find((h) => h.config.id === id);
      if (hero) {
        const norm = BASE_HERO_SLOT_POSITIONS[slot];
        const newX = Math.round(norm.xFraction * preset.width);
        const newY = Math.round(norm.yFraction * preset.height);
        hero.setHome(newX, newY);
        hero.currentX = newX;
        hero.currentY = newY;
        hero.config.lungeDistance = Math.round(this.baseLungeDistance * scale);
      }
    }

    // Update enemy positions
    this.enemies.forEach((enemy, idx) => {
      const norm = BASE_ENEMY_SLOT_POSITIONS[idx] || BASE_ENEMY_SLOT_POSITIONS[0];
      const newX = Math.round(norm.xFraction * preset.width);
      const newY = Math.round(norm.yFraction * preset.height);
      enemy.setHome(newX, newY);
      enemy.currentX = newX;
      enemy.currentY = newY;
      enemy.config.lungeDistance = Math.round(this.baseLungeDistance * scale);
    });
  }

  private initHeroes(): void {
    const heroDefs = [
      { id: 'hero_guitar_1', name: 'GUITAR 1', folder: 'guitar_1', slot: 'front' as HeroSlotKey, heightFraction: 0.42 },
      { id: 'hero_drums', name: 'DRUMS', folder: 'drums', slot: 'top' as HeroSlotKey, heightFraction: 0.44 },
      { id: 'hero_guitar_2', name: 'GUITAR 2', folder: 'guitar_2', slot: 'bottom' as HeroSlotKey, heightFraction: 0.42 },
      { id: 'hero_bass', name: 'BASS', folder: 'bass', slot: 'back' as HeroSlotKey, heightFraction: 0.43 },
    ];

    this.heroes = [];
    this.heroSlots.clear();

    const scale = this.canvas.height / 180;

    for (const def of heroDefs) {
      const norm = BASE_HERO_SLOT_POSITIONS[def.slot];
      const posX = Math.round(norm.xFraction * this.canvas.width);
      const posY = Math.round(norm.yFraction * this.canvas.height);

      const actor = new SpriteActor({
        id: def.id,
        name: def.name,
        folderPath: `/assets/heroes/${def.folder}`,
        homeX: posX,
        homeY: posY,
        heightFraction: def.heightFraction,
        facing: 'right',
        lungeDistance: Math.round(this.baseLungeDistance * scale),
      });

      actor.idleIntervalMs = this.idleIntervalMs;
      actor.attackIntervalMs = this.attackIntervalMs;

      // When this hero attacks, trigger hit reaction on active enemy
      actor.onAttackFrameToggle = (frame) => {
        if (!this.autoHitOpponent) return;
        const target = this.getActiveTargetEnemy();
        if (target && target.state !== 'downed') {
          target.isManuallyLatched = false;
          target.setState('hit');
          this.spawnHitEffect(
            target.currentX - 6 + (frame === 0 ? -6 : 6),
            target.currentY - (this.canvas.height * target.heightFraction) * 0.55,
            '#55ffff',
            frame
          );
        }
      };

      this.heroes.push(actor);
      this.heroSlots.set(def.id, def.slot);
    }
  }

  private initDefaultBoss(): void {
    const norm = BASE_ENEMY_SLOT_POSITIONS[0];
    const posX = Math.round(norm.xFraction * this.canvas.width);
    const posY = Math.round(norm.yFraction * this.canvas.height);
    const scale = this.canvas.height / 180;

    const boss = new SpriteActor({
      id: 'enemy_1',
      name: 'THE WORM #1',
      folderPath: '/assets/bosses/the_worm',
      homeX: posX,
      homeY: posY,
      heightFraction: 0.55,
      facing: 'left',
      lungeDistance: Math.round(this.baseLungeDistance * scale),
    });

    boss.idleIntervalMs = this.idleIntervalMs;
    boss.attackIntervalMs = this.attackIntervalMs;

    this.hookEnemyAttack(boss);
    this.enemies = [boss];
    this.nextEnemyCounter = 2;
  }

  private hookEnemyAttack(enemy: SpriteActor): void {
    enemy.onAttackFrameToggle = (frame) => {
      if (!this.autoHitOpponent) return;
      const targetHero = this.getFrontHero() || this.heroes[0];
      if (targetHero && targetHero.state !== 'downed') {
        targetHero.isManuallyLatched = false;
        targetHero.setState('hit');
        this.spawnHitEffect(
          targetHero.currentX + 6 + (frame === 0 ? -4 : 4),
          targetHero.currentY - (this.canvas.height * targetHero.heightFraction) * 0.55,
          '#ff5577',
          frame
        );
      }
    };
  }

  public getFrontHero(): SpriteActor | undefined {
    for (const [id, slot] of this.heroSlots.entries()) {
      if (slot === 'front') {
        return this.heroes.find((h) => h.config.id === id);
      }
    }
    return this.heroes[0];
  }

  public getActiveTargetEnemy(): SpriteActor | undefined {
    return this.enemies.find((e) => e.state !== 'downed') || this.enemies[0];
  }

  /**
   * Volleyball swap: at the onset of an attack/ultimate,
   * if the character is not in 'front', direct swap with the current 'front' character.
   */
  public triggerHeroState(heroId: string, state: ActorState): void {
    const hero = this.heroes.find((h) => h.config.id === heroId);
    if (!hero) return;

    if (state === 'attack' || state === 'ultimate') {
      const currentSlot = this.heroSlots.get(heroId);
      if (currentSlot && currentSlot !== 'front') {
        let frontHeroId = '';
        for (const [id, slot] of this.heroSlots.entries()) {
          if (slot === 'front') {
            frontHeroId = id;
            break;
          }
        }

        if (frontHeroId) {
          this.heroSlots.set(frontHeroId, currentSlot);
          this.heroSlots.set(heroId, 'front');

          const displacedHero = this.heroes.find((h) => h.config.id === frontHeroId);
          if (displacedHero) {
            const normNew = BASE_HERO_SLOT_POSITIONS[currentSlot];
            displacedHero.setHome(
              Math.round(normNew.xFraction * this.canvas.width),
              Math.round(normNew.yFraction * this.canvas.height)
            );
          }

          const normFront = BASE_HERO_SLOT_POSITIONS['front'];
          hero.setHome(
            Math.round(normFront.xFraction * this.canvas.width),
            Math.round(normFront.yFraction * this.canvas.height)
          );
        }
      }
    }

    hero.setState(state);

    // If stopping attack/ultimate, check if opponent was in auto-hit reaction and return them to idle
    if (state === 'idle') {
      const anyOtherHeroAttacking = this.heroes.some(
        (h) => h.config.id !== heroId && (h.state === 'attack' || h.state === 'ultimate')
      );
      if (!anyOtherHeroAttacking) {
        for (const e of this.enemies) {
          if (e.state === 'hit' && !e.isManuallyLatched) {
            e.setState('idle');
          }
        }
      }
    }
  }

  public async addEnemy(type: 'the_worm' | 'air_squid'): Promise<SpriteActor | null> {
    if (this.enemies.length >= 8) return null;

    const index = this.enemies.length;
    const norm = BASE_ENEMY_SLOT_POSITIONS[index] || BASE_ENEMY_SLOT_POSITIONS[0];
    const posX = Math.round(norm.xFraction * this.canvas.width);
    const posY = Math.round(norm.yFraction * this.canvas.height);
    const scale = this.canvas.height / 180;

    const num = this.nextEnemyCounter++;
    const name = type === 'the_worm' ? `THE WORM #${num}` : `AIR SQUID #${num}`;

    const enemy = new SpriteActor({
      id: `enemy_${num}`,
      name,
      folderPath: `/assets/bosses/${type}`,
      homeX: posX,
      homeY: posY,
      heightFraction: 0.55,
      facing: 'left',
      lungeDistance: Math.round(this.baseLungeDistance * scale),
    });

    enemy.idleIntervalMs = this.idleIntervalMs;
    enemy.attackIntervalMs = this.attackIntervalMs;
    this.hookEnemyAttack(enemy);

    await enemy.loadSprites();
    this.enemies.push(enemy);
    return enemy;
  }

  public removeEnemy(enemyId: string): void {
    if (this.enemies.length <= 1) return; // Keep at least one enemy
    this.enemies = this.enemies.filter((e) => e.config.id !== enemyId);

    // Re-assign remaining enemies to slots
    this.enemies.forEach((enemy, idx) => {
      const norm = BASE_ENEMY_SLOT_POSITIONS[idx] || BASE_ENEMY_SLOT_POSITIONS[0];
      enemy.setHome(
        Math.round(norm.xFraction * this.canvas.width),
        Math.round(norm.yFraction * this.canvas.height)
      );
    });
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

    const heroPromises = this.heroes.map((h) => h.loadSprites(cacheBust));
    const enemyPromises = this.enemies.map((e) => e.loadSprites(cacheBust));

    await Promise.all([bgPromise, ...heroPromises, ...enemyPromises]);
  }

  public setBaseLungeDistance(px: number): void {
    this.baseLungeDistance = px;
    const scale = this.canvas.height / 180;
    const actualPx = Math.round(px * scale);
    for (const h of this.heroes) {
      h.config.lungeDistance = actualPx;
    }
    for (const e of this.enemies) {
      e.config.lungeDistance = actualPx;
    }
  }

  public setIdleInterval(ms: number): void {
    this.idleIntervalMs = ms;
    for (const h of this.heroes) h.idleIntervalMs = ms;
    for (const e of this.enemies) e.idleIntervalMs = ms;
  }

  public setAttackInterval(ms: number): void {
    this.attackIntervalMs = ms;
    for (const h of this.heroes) h.attackIntervalMs = ms;
    for (const e of this.enemies) e.attackIntervalMs = ms;
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
      vy: -0.032 * (this.canvas.height / 180),
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
    for (const h of this.heroes) h.update(dtMs);
    for (const e of this.enemies) e.update(dtMs);

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
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scale = H / 180;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (this.screenShakeMs > 0) {
      const sx = Math.round((Math.random() - 0.5) * 3 * scale);
      const sy = Math.round((Math.random() - 0.5) * 2 * scale);
      ctx.translate(sx, sy);
    }

    // 1. Background
    if (this.bgImage && this.bgImage.naturalWidth > 0) {
      ctx.drawImage(this.bgImage, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#181028';
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Y-sorted Actor Rendering
    const allActors: SpriteActor[] = [...this.heroes, ...this.enemies];
    allActors.sort((a, b) => {
      const aBonus = a.state === 'attack' || a.state === 'ultimate' ? 12 * scale : 0;
      const bBonus = b.state === 'attack' || b.state === 'ultimate' ? 12 * scale : 0;
      return a.currentY + aBonus - (b.currentY + bBonus);
    });

    for (const actor of allActors) {
      actor.draw(ctx, H);
    }

    // 3. Pixel Slash / Sparks
    const sparkSize = Math.max(6, Math.round(10 * scale));
    for (const sp of this.sparks) {
      ctx.save();
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = Math.max(1, Math.round(2 * scale));
      ctx.beginPath();
      if (sp.variant === 0) {
        ctx.moveTo(sp.x - sparkSize, sp.y - sparkSize);
        ctx.lineTo(sp.x + sparkSize, sp.y + sparkSize);
      } else {
        ctx.moveTo(sp.x - sparkSize, sp.y + sparkSize);
        ctx.lineTo(sp.x + sparkSize, sp.y - sparkSize);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Floating Retro Damage Numbers
    const fontSize = Math.max(7, Math.round(8 * scale));
    ctx.font = `bold ${fontSize}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    for (const fd of this.floatingDamages) {
      const x = Math.round(fd.x);
      const y = Math.round(fd.y);
      ctx.fillStyle = '#120d1f';
      ctx.fillText(fd.text, x + 1, y + 1);
      ctx.fillStyle = fd.color;
      ctx.fillText(fd.text, x, y);
    }

    ctx.restore();
  }
}
