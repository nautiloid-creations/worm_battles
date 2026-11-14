import { SpriteActor, ActorState } from './SpriteActor';
import { AudioEngine } from '../audio/AudioEngine';
import { SpotlightArbitrator } from '../audio/SpotlightArbitrator';
import { CombatFxManager, FxConfig, ActiveArenaFx } from './CombatFxManager';
import { RasterWarpManager } from './RasterWarpManager';
import { UltimateSequencer, UltimateKeyframe, UltimateFxDef } from './UltimateSequencer';
import {
  loadSettingsDefaults,
  loadPartyDefaults,
  loadEnemiesDefaults,
  loadAudioDefaults,
} from './StorageDefaults';

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

export interface ArenaDef {
  id: string;
  name: string;
  path: string;
}

export const ARENAS: ArenaDef[] = [
  { id: 'desert', name: '🏜️ Desert Dunes', path: '/assets/backgrounds/desert.png' },
  { id: 'stage_1', name: '🌌 Synthwave Horizon', path: '/assets/backgrounds/stage_1.png' },
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
  public currentArenaId = 'desert';

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
  public attackFxHoldOffMs = 250; // Minimum interval between floating numbers & spark VFX (default 250ms)
  private lastHeroAttackFxTimeMs = 0;
  private lastEnemyAttackFxTimeMs = 0;

  public audioEngine: AudioEngine;
  public arbitrator: SpotlightArbitrator;

  public fxManager: CombatFxManager = new CombatFxManager();
  public heroAttackFxConfig: FxConfig = {
    fxId: 'fx_fireball',
    paletteName: 'Solar Flame',
    size: 64,
  };
  public enemyAttackFxConfig: FxConfig = {
    fxId: 'fx_orb_lightning',
    paletteName: 'Electric Plasma',
    size: 64,
  };

  public warpManager: RasterWarpManager = new RasterWarpManager();
  public ultimateSequencer: UltimateSequencer = new UltimateSequencer();
  public isUltimateStudioMode = false;
  private sceneBufferCanvas: HTMLCanvasElement = document.createElement('canvas');
  private sceneBufferCtx: CanvasRenderingContext2D = this.sceneBufferCanvas.getContext('2d')!;

  private floatingDamages: FloatingDamage[] = [];
  private sparks: SlashSpark[] = [];
  private screenShakeMs = 0;

  private lastTimestamp = 0;
  private onFrameListeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Load saved settings defaults if available
    const savedSettings = loadSettingsDefaults();
    if (savedSettings) {
      if (RESOLUTION_PRESETS[savedSettings.resKey]) {
        this.currentResKey = savedSettings.resKey;
      }
      this.currentArenaId = savedSettings.arenaId || this.currentArenaId;
      if (savedSettings.idleBpm) {
        this.idleIntervalMs = Math.round(60000 / savedSettings.idleBpm);
      }
      if (savedSettings.attackBpm) {
        this.attackIntervalMs = Math.round(60000 / savedSettings.attackBpm);
      }
      if (savedSettings.lungePx !== undefined) {
        this.baseLungeDistance = savedSettings.lungePx;
      }
      if (savedSettings.autoHit !== undefined) {
        this.autoHitOpponent = savedSettings.autoHit;
      }
      if (savedSettings.attackFxHoldOffMs !== undefined) {
        this.attackFxHoldOffMs = savedSettings.attackFxHoldOffMs;
      }
    }

    const initialRes = RESOLUTION_PRESETS[this.currentResKey];
    this.canvas.width = initialRes.width;
    this.canvas.height = initialRes.height;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    // Initialize Web Audio Engine & Spotlight Arbitrator
    this.audioEngine = new AudioEngine();
    this.arbitrator = new SpotlightArbitrator(this, this.audioEngine);
    this.audioEngine.onStopOrPause = () => {
      this.resetActorsAndTimers();
    };

    // Ultimate Sequencer Callbacks
    this.ultimateSequencer.onSpawnFx = (fx) => {
      const scale = this.canvas.height / 180;
      const targetX = fx.targetXFrac !== undefined ? Math.round(this.canvas.width * fx.targetXFrac) : undefined;
      const targetY = fx.targetYFrac !== undefined ? Math.round(this.canvas.height * fx.targetYFrac) : undefined;
      const speed = fx.speed !== undefined ? fx.speed * scale : undefined;

      this.fxManager.spawnArenaEffect(
        fx.fxId,
        fx.paletteName,
        fx.size,
        Math.round(this.canvas.width * fx.xFrac),
        Math.round(this.canvas.height * fx.yFrac),
        fx.facing || 'right',
        fx.durationMs,
        targetX,
        targetY,
        speed
      );
    };
    this.ultimateSequencer.onClearFx = () => {
      this.fxManager.clear();
    };
    this.ultimateSequencer.onScreenShake = (intensity) => {
      this.triggerScreenShake(intensity * 40);
    };

    // Apply saved audio defaults
    const savedAudio = loadAudioDefaults();
    if (savedAudio) {
      this.arbitrator.allowInPlaceAttack = savedAudio.allowInPlaceAttack;
      if (savedAudio.minFrontSec !== undefined) {
        this.arbitrator.minInFrontTimeMs = Math.round(savedAudio.minFrontSec * 1000);
      }
      if (savedAudio.maxStarveSec !== undefined) {
        this.arbitrator.maxNotInFrontTimeMs = Math.round(savedAudio.maxStarveSec * 1000);
      }
      if (savedAudio.silenceFloorPct !== undefined) {
        this.arbitrator.silenceThresholdFraction = savedAudio.silenceFloorPct / 100;
      }
      if (savedAudio.dominantBalance !== undefined) {
        this.arbitrator.dominantBalance = savedAudio.dominantBalance;
      }
      if (savedAudio.sustainWeightPct !== undefined) {
        this.arbitrator.sustainWeight = savedAudio.sustainWeightPct / 100;
      }
      if (savedAudio.sustainTimeSec !== undefined) {
        this.arbitrator.sustainTimeSec = savedAudio.sustainTimeSec;
      }
      if (savedAudio.loudnessDecayMs !== undefined) {
        this.arbitrator.setLoudnessDecay(savedAudio.loudnessDecayMs);
      }
      if (savedAudio.activityDecayMs !== undefined) {
        this.arbitrator.setActivityDecay(savedAudio.activityDecayMs);
      }
      if (savedAudio.minAttackBpm !== undefined) {
        this.arbitrator.minAttackBpm = savedAudio.minAttackBpm;
      } else if (savedAudio.minAttackSpeedMs !== undefined) {
        this.arbitrator.minAttackSpeedMs = savedAudio.minAttackSpeedMs;
      }
      if (savedAudio.maxAttackBpm !== undefined) {
        this.arbitrator.maxAttackBpm = savedAudio.maxAttackBpm;
      } else if (savedAudio.maxAttackSpeedMs !== undefined) {
        this.arbitrator.maxAttackSpeedMs = savedAudio.maxAttackSpeedMs;
      }
      for (const [chId, conf] of Object.entries(savedAudio.channels)) {
        const ch = this.audioEngine.getChannel(chId);
        if (ch) {
          if (conf.lowCutHz) ch.setLowCut(conf.lowCutHz);
          if (conf.highCutHz) ch.setHighCut(conf.highCutHz);
          if (conf.threshold) ch.setThreshold(conf.threshold);
          if (conf.detectGain !== undefined) ch.setDetectGain(conf.detectGain);
          if (conf.volume !== undefined) ch.setVolume(conf.volume);
          if (conf.riseSensitivity !== undefined) ch.setRiseSensitivity(conf.riseSensitivity);
          if (conf.pulseWeight !== undefined) ch.setPulseWeight(conf.pulseWeight);
          if (conf.kickThreshold !== undefined) ch.setKickThreshold(conf.kickThreshold);
        }
      }
    }

    // Initialize the 4 band members
    this.initHeroes();

    // Initialize enemies
    this.initEnemies();
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

    const partyDefaults = loadPartyDefaults();
    if (partyDefaults?.fxConfig) {
      this.heroAttackFxConfig = { ...partyDefaults.fxConfig };
    }

    this.heroes = [];
    this.heroSlots.clear();

    const scale = this.canvas.height / 180;

    for (const def of heroDefs) {
      const norm = BASE_HERO_SLOT_POSITIONS[def.slot];
      const posX = Math.round(norm.xFraction * this.canvas.width);
      const posY = Math.round(norm.yFraction * this.canvas.height);
      const heightFraction = partyDefaults?.heroSizes?.[def.id] ?? def.heightFraction;

      const actor = new SpriteActor({
        id: def.id,
        name: def.name,
        folderPath: `/assets/heroes/${def.folder}`,
        homeX: posX,
        homeY: posY,
        heightFraction,
        facing: 'right',
        lungeDistance: Math.round(this.baseLungeDistance * scale),
      });

      actor.idleIntervalMs = this.idleIntervalMs;
      actor.attackIntervalMs = this.attackIntervalMs;

      // When this hero attacks, trigger hit reaction on active enemy if in front slot
      actor.onAttackFrameToggle = (frame) => {
        if (!this.autoHitOpponent) return;
        const slot = this.heroSlots.get(actor.config.id);
        if (slot && slot !== 'front') return; // In-place attackers rock out without striking boss

        const target = this.getActiveTargetEnemy();
        if (target && target.state !== 'downed') {
          target.isManuallyLatched = false;
          target.setState('hit');

          // Spawn selected attack effect in the middle of the arena
          const midX = Math.round(this.canvas.width * 0.5);
          const midY = Math.round(this.canvas.height * 0.65);
          this.fxManager.spawnArenaEffect(
            this.heroAttackFxConfig.fxId,
            this.heroAttackFxConfig.paletteName,
            this.heroAttackFxConfig.size,
            midX,
            midY,
            'right'
          );

          // Throttle combat VFX and floating damage numbers by attackFxHoldOffMs
          const now = performance.now();
          if (now - this.lastHeroAttackFxTimeMs >= this.attackFxHoldOffMs) {
            this.lastHeroAttackFxTimeMs = now;
            this.spawnHitEffect(
              target.currentX - 6 + (frame === 0 ? -6 : 6),
              target.currentY - (this.canvas.height * target.heightFraction) * 0.55,
              '#55ffff',
              frame
            );
          }
        }
      };

      this.heroes.push(actor);
      this.heroSlots.set(def.id, def.slot);
    }
  }

  private initEnemies(): void {
    const saved = loadEnemiesDefaults();
    if (saved?.fxConfig) {
      this.enemyAttackFxConfig = { ...saved.fxConfig };
    }
    const scale = this.canvas.height / 180;
    this.enemies = [];

    const enemyConfigs =
      saved && saved.enemies && saved.enemies.length > 0
        ? saved.enemies
        : [{ type: 'the_worm' as const, heightFraction: 0.55 }];

    this.nextEnemyCounter = 1;

    enemyConfigs.forEach((conf, idx) => {
      const norm = BASE_ENEMY_SLOT_POSITIONS[idx] || BASE_ENEMY_SLOT_POSITIONS[0];
      const posX = Math.round(norm.xFraction * this.canvas.width);
      const posY = Math.round(norm.yFraction * this.canvas.height);
      const num = this.nextEnemyCounter++;
      const name = conf.type === 'the_worm' ? `THE WORM #${num}` : `AIR SQUID #${num}`;

      const enemy = new SpriteActor({
        id: `enemy_${num}`,
        name,
        folderPath: `/assets/bosses/${conf.type}`,
        homeX: posX,
        homeY: posY,
        heightFraction: conf.heightFraction,
        facing: 'left',
        lungeDistance: Math.round(this.baseLungeDistance * scale),
      });

      enemy.idleIntervalMs = this.idleIntervalMs;
      enemy.attackIntervalMs = this.attackIntervalMs;
      this.hookEnemyAttack(enemy);
      this.enemies.push(enemy);
    });
  }

  private hookEnemyAttack(enemy: SpriteActor): void {
    enemy.onAttackFrameToggle = (frame) => {
      if (!this.autoHitOpponent) return;
      const targetHero = this.getFrontHero() || this.heroes[0];
      if (targetHero && targetHero.state !== 'downed') {
        targetHero.isManuallyLatched = false;
        targetHero.setState('hit');

        // Spawn selected attack effect in the middle of the arena
        const midX = Math.round(this.canvas.width * 0.5);
        const midY = Math.round(this.canvas.height * 0.65);
        this.fxManager.spawnArenaEffect(
          this.enemyAttackFxConfig.fxId,
          this.enemyAttackFxConfig.paletteName,
          this.enemyAttackFxConfig.size,
          midX,
          midY,
          'left'
        );

        const now = performance.now();
        if (now - this.lastEnemyAttackFxTimeMs >= this.attackFxHoldOffMs) {
          this.lastEnemyAttackFxTimeMs = now;
          this.spawnHitEffect(
            targetHero.currentX + 6 + (frame === 0 ? -4 : 4),
            targetHero.currentY - (this.canvas.height * targetHero.heightFraction) * 0.55,
            '#ff5577',
            frame
          );
        }
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

  public bringHeroToFront(heroId: string): void {
    const currentSlot = this.heroSlots.get(heroId);
    if (!currentSlot || currentSlot === 'front') return;

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
        const newX = Math.round(normNew.xFraction * this.canvas.width);
        const newY = Math.round(normNew.yFraction * this.canvas.height);
        displacedHero.setHome(newX, newY);
        displacedHero.currentX = newX;
        displacedHero.currentY = newY;
      }

      const hero = this.heroes.find((h) => h.config.id === heroId);
      if (hero) {
        const normFront = BASE_HERO_SLOT_POSITIONS['front'];
        const frontX = Math.round(normFront.xFraction * this.canvas.width);
        const frontY = Math.round(normFront.yFraction * this.canvas.height);
        hero.setHome(frontX, frontY);
        hero.currentX = frontX;
        hero.currentY = frontY;
      }
    }
  }

  /**
   * Volleyball swap: at the onset of an attack/ultimate,
   * if the character is not in 'front', direct swap with the current 'front' character.
   */
  public triggerHeroState(heroId: string, state: ActorState): void {
    const hero = this.heroes.find((h) => h.config.id === heroId);
    if (!hero) return;

    if (state === 'attack' || state === 'ultimate') {
      this.bringHeroToFront(heroId);
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

  public async setArena(arenaId: string, cacheBust = false): Promise<void> {
    const arena = ARENAS.find((a) => a.id === arenaId) || ARENAS[0];
    this.currentArenaId = arena.id;
    const query = cacheBust ? `?t=${Date.now()}` : '';

    return new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.bgImage = img;
        resolve();
      };
      img.onerror = () => {
        if (arena.id !== 'stage_1') {
          const fallback = new Image();
          fallback.onload = () => {
            this.bgImage = fallback;
            resolve();
          };
          fallback.onerror = () => resolve();
          fallback.src = `/assets/backgrounds/stage_1.png${query}`;
        } else {
          resolve();
        }
      };
      img.src = `${arena.path}${query}`;
    });
  }

  public async loadAllAssets(cacheBust = false): Promise<void> {
    const heroPromises = this.heroes.map((h) => h.loadSprites(cacheBust));
    const enemyPromises = this.enemies.map((e) => e.loadSprites(cacheBust));

    await Promise.all([
      this.setArena(this.currentArenaId, cacheBust),
      this.audioEngine.preloadDefaultStems(),
      this.fxManager.loadAssets(),
      ...heroPromises,
      ...enemyPromises,
    ]);
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

  public setIdleTempo(bpm: number): void {
    this.setIdleInterval(Math.round(60000 / bpm));
  }

  public setAttackInterval(ms: number): void {
    this.attackIntervalMs = ms;
    for (const h of this.heroes) h.attackIntervalMs = ms;
    for (const e of this.enemies) e.attackIntervalMs = ms;
  }

  public setAttackTempo(bpm: number): void {
    this.setAttackInterval(Math.round(60000 / bpm));
  }

  public resetActorsAndTimers(): void {
    // 1. Reset all heroes to idle and home position
    for (const hero of this.heroes) {
      hero.resetCombatState();
    }

    // 2. Reset all enemies to idle and home position
    for (const enemy of this.enemies) {
      enemy.resetCombatState();
    }

    // 3. Clear combat VFX
    this.sparks = [];
    this.floatingDamages = [];
    this.screenShakeMs = 0;

    // 4. Reset arbitration starvation and front timers
    this.arbitrator.resetTimers();
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
  }

  public triggerScreenShake(durationMs = 80): void {
    this.screenShakeMs = durationMs;
  }

  public onTick(cb: () => void): void {
    this.onFrameListeners.push(cb);
  }

  public removeTick(cb: () => void): void {
    this.onFrameListeners = this.onFrameListeners.filter((l) => l !== cb);
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
    // 1. Audio Engine & Spotlight Arbitrator update
    this.audioEngine.update(
      dtMs,
      this.arbitrator.dominantBalance,
      this.arbitrator.sustainWeight,
      this.arbitrator.sustainTimeSec
    );
    this.arbitrator.update(dtMs);

    // Screen shake is strictly driven by 50Hz bass drum hits
    const drumCh = this.audioEngine.getChannel('drums');
    if (drumCh && drumCh.isKickHit) {
      this.triggerScreenShake(75);
    }

    for (const h of this.heroes) h.update(dtMs);
    for (const e of this.enemies) e.update(dtMs);

    // Only update FX timers if NOT in ultimate studio, OR if playback is actively playing!
    if (!this.isUltimateStudioMode || this.ultimateSequencer.isPlaying) {
      this.fxManager.update(dtMs);
    }

    if (this.isUltimateStudioMode) {
      this.ultimateSequencer.update(dtMs);
      const actorId = this.ultimateSequencer.sequence.actorId;
      const scale = this.canvas.height / 180;
      const actor =
        this.heroes.find((h) => h.config.id === actorId) ||
        this.enemies.find((e) => e.config.id === actorId || e.config.id.startsWith('enemy_'));
      if (actor) {
        actor.forcedSpriteKey = this.ultimateSequencer.currentActorPose;
        const dir = actor.config.facing === 'right' ? 1 : -1;
        actor.currentX = actor.config.homeX + dir * this.ultimateSequencer.currentActorXOffset * scale;
        actor.currentY = actor.config.homeY + this.ultimateSequencer.currentActorYOffset * scale;

        if (this.ultimateSequencer.currentActorShake > 0) {
          const shake = this.ultimateSequencer.currentActorShake;
          actor.currentX += (Math.random() - 0.5) * 2 * shake * scale;
          actor.currentY += (Math.random() - 0.5) * 2 * shake * scale;
        }
      }
      const boss = this.getActiveTargetEnemy();
      if (boss && this.ultimateSequencer.currentBossReaction !== 'idle') {
        boss.setState(this.ultimateSequencer.currentBossReaction);
      }
    }

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

  public syncStudioFx(selectedKf?: UltimateKeyframe, forceSelected = false): void {
    if (!this.isUltimateStudioMode || this.ultimateSequencer.isPlaying) return;

    const W = this.canvas.width;
    const H = this.canvas.height;
    const scale = H / 180;
    const t = this.ultimateSequencer.currentTimeMs;

    const effects: ActiveArenaFx[] = [];

    const evaluateFx = (fx: UltimateFxDef, kfTimeMs: number): ActiveArenaFx => {
      const startMs = kfTimeMs;
      const durMs = fx.durationMs || 1500;
      const elapsed = Math.max(0, Math.min(durMs, t - startMs));

      const startX = Math.round(W * fx.xFrac);
      const startY = Math.round(H * fx.yFrac);
      let currentX = startX;
      let currentY = startY;

      if (fx.targetXFrac !== undefined && fx.targetYFrac !== undefined) {
        const targetX = Math.round(W * fx.targetXFrac);
        const targetY = Math.round(H * fx.targetYFrac);
        const dx = targetX - startX;
        const dy = targetY - startY;
        const dist = Math.hypot(dx, dy);
        const speed = (fx.speed !== undefined ? fx.speed : 0.4) * scale;
        const travelDist = speed * elapsed;

        if (dist > 0 && travelDist < dist) {
          const frac = travelDist / dist;
          currentX = Math.round(startX + dx * frac);
          currentY = Math.round(startY + dy * frac);
        } else if (dist > 0 && travelDist >= dist) {
          currentX = targetX;
          currentY = targetY;
        }
      }

      return {
        fxId: fx.fxId,
        paletteName: fx.paletteName,
        size: fx.size,
        x: currentX,
        y: currentY,
        targetX: fx.targetXFrac !== undefined ? Math.round(W * fx.targetXFrac) : undefined,
        targetY: fx.targetYFrac !== undefined ? Math.round(H * fx.targetYFrac) : undefined,
        speed: fx.speed !== undefined ? fx.speed * scale : undefined,
        facing: fx.facing || 'right',
        lifeMs: durMs,
        maxLifeMs: durMs,
      };
    };

    let forcedAdded = false;
    for (const kf of this.ultimateSequencer.sequence.keyframes) {
      if (!kf.spawnFx) continue;
      const fxDefs = Array.isArray(kf.spawnFx) ? kf.spawnFx : [kf.spawnFx];

      for (const fx of fxDefs) {
        const startMs = kf.timeMs;
        const durMs = fx.durationMs || 1500;
        const endMs = startMs + durMs;

        const isTimeActive = t >= startMs && t <= endMs;
        const isSelected = selectedKf === kf;

        if (isTimeActive || (forceSelected && isSelected)) {
          effects.push(evaluateFx(fx, kf.timeMs));
          if (isSelected) forcedAdded = true;
        }
      }
    }

    if (forceSelected && selectedKf?.spawnFx && !forcedAdded) {
      const fxDefs = Array.isArray(selectedKf.spawnFx) ? selectedKf.spawnFx : [selectedKf.spawnFx];
      for (const fx of fxDefs) {
        effects.push(evaluateFx(fx, selectedKf.timeMs));
      }
    }

    this.fxManager.activeEffects = effects;
  }

  private render(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scale = H / 180;

    const isWarpingAll =
      this.isUltimateStudioMode &&
      this.ultimateSequencer.currentWarpConfig.type !== 'none' &&
      this.ultimateSequencer.currentWarpConfig.target === 'all';

    let ctx = this.ctx;
    if (isWarpingAll) {
      if (this.sceneBufferCanvas.width !== W || this.sceneBufferCanvas.height !== H) {
        this.sceneBufferCanvas.width = W;
        this.sceneBufferCanvas.height = H;
      }
      ctx = this.sceneBufferCtx;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, W, H);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (this.screenShakeMs > 0) {
      const sx = Math.round((Math.random() - 0.5) * 3 * scale);
      const sy = Math.round((Math.random() - 0.5) * 2 * scale);
      ctx.translate(sx, sy);
    }

    // 1. Background (with optional raster warp)
    if (this.bgImage && this.bgImage.naturalWidth > 0) {
      if (
        this.isUltimateStudioMode &&
        this.ultimateSequencer.currentWarpConfig.type !== 'none' &&
        this.ultimateSequencer.currentWarpConfig.target === 'background'
      ) {
        this.warpManager.applyWarp(
          ctx,
          this.bgImage,
          W,
          H,
          this.ultimateSequencer.currentTimeMs,
          this.ultimateSequencer.currentWarpConfig
        );
      } else {
        ctx.drawImage(this.bgImage, 0, 0, W, H);
      }
    } else {
      ctx.fillStyle = '#181028';
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Dimming overlay for ultimate dramatic spotlight
    if (this.isUltimateStudioMode && this.ultimateSequencer.currentDimArena > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.9, this.ultimateSequencer.currentDimArena)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 3. Y-sorted Actor Rendering
    const allActors: SpriteActor[] = [...this.heroes, ...this.enemies];
    allActors.sort((a, b) => {
      const aBonus = a.state === 'attack' || a.state === 'ultimate' ? 12 * scale : 0;
      const bBonus = b.state === 'attack' || b.state === 'ultimate' ? 12 * scale : 0;
      return a.currentY + aBonus - (b.currentY + bBonus);
    });

    for (const actor of allActors) {
      actor.draw(ctx, H);
    }

    // 4. Combat FX
    this.fxManager.draw(ctx);

    // Trajectory flight preview in Ultimate Studio mode
    if (this.isUltimateStudioMode && !this.ultimateSequencer.isPlaying) {
      for (const fx of this.fxManager.activeEffects) {
        if (fx.targetX !== undefined && fx.targetY !== undefined) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(255, 230, 0, 0.7)';
          ctx.lineWidth = Math.max(1, Math.round(1.5 * scale));
          ctx.beginPath();
          ctx.moveTo(fx.x, fx.y);
          ctx.lineTo(fx.targetX, fx.targetY);
          ctx.stroke();

          // Target reticle
          const r = Math.round(6 * scale);
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
          ctx.lineWidth = Math.max(1, Math.round(1.5 * scale));
          ctx.beginPath();
          ctx.arc(fx.targetX, fx.targetY, r, 0, Math.PI * 2);
          ctx.moveTo(fx.targetX - r - 2, fx.targetY);
          ctx.lineTo(fx.targetX + r + 2, fx.targetY);
          ctx.moveTo(fx.targetX, fx.targetY - r - 2);
          ctx.lineTo(fx.targetX, fx.targetY + r + 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 5. Pixel Slash / Sparks
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

    // 6. Floating Retro Damage Numbers
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

    // 7. White flash on impact
    if (this.isUltimateStudioMode && this.ultimateSequencer.currentWhiteFlash) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    ctx.restore();

    // If warping whole scene, apply warp from buffer canvas to main canvas
    if (isWarpingAll) {
      this.ctx.clearRect(0, 0, W, H);
      this.warpManager.applyWarp(
        this.ctx,
        this.sceneBufferCanvas,
        W,
        H,
        this.ultimateSequencer.currentTimeMs,
        this.ultimateSequencer.currentWarpConfig
      );
    }
  }
}
