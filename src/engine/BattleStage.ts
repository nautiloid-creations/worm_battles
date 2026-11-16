import { SpriteActor, ActorState } from './SpriteActor';
import { AudioEngine } from '../audio/AudioEngine';
import { SpotlightArbitrator } from '../audio/SpotlightArbitrator';
import { CombatFxManager, FxConfig, ActiveArenaFx, FX_PALETTES } from './CombatFxManager';
import { RasterWarpManager } from './RasterWarpManager';
import { UltimateSequencer, UltimateKeyframe, UltimateFxDef, ULTIMATE_PRESETS } from './UltimateSequencer';
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
  public baseLungePct = 7.5; // % of canvas width (7.5% of 320 = 24px)
  public get baseLungeDistance(): number {
    return this.baseLungePct;
  }
  public set baseLungeDistance(val: number) {
    this.baseLungePct = val;
  }
  public idleIntervalMs = 450;
  public attackIntervalMs = 115;
  public attackFxHoldOffMs = 250; // Minimum interval between floating numbers & spark VFX (default 250ms)
  private lastEnemyAttackFxTimeMs = 0;

  public audioEngine: AudioEngine;
  public arbitrator: SpotlightArbitrator;

  public fxManager: CombatFxManager = new CombatFxManager();
  public heroAttackFxConfig: FxConfig = {
    fxId: 'fx_fireball',
    paletteName: 'Solar Flame',
    size: 36, // 36% of canvas height (~64px at 180p)
  };
  public enemyAttackFxConfig: FxConfig = {
    fxId: 'fx_orb_lightning',
    paletteName: 'Electric Plasma',
    size: 36, // 36% of canvas height (~64px at 180p)
  };

  public warpManager: RasterWarpManager = new RasterWarpManager();
  public ultimateSequencer: UltimateSequencer = new UltimateSequencer();
  public isUltimateStudioMode = false;
  private sceneBufferCanvas: HTMLCanvasElement = document.createElement('canvas');
  private sceneBufferCtx: CanvasRenderingContext2D = this.sceneBufferCanvas.getContext('2d')!;

  // Combat & Vitality System
  public isCombatEnabled = true;
  public isEnemyInvincible = false; // Invincible enemies toggle (boss cannot be KO'd, attacks & rage continue)
  public bossMaxHp = 100; // Adjustable boss max HP
  public rageThresholdPct = 10; // Boss gains an attack charge every 10% rage (adjustable)
  public bossChargeCap = 10; // Cap on reserve attack charges (forces attack when reached)
  public partyAttackChance = 0.25; // 25% chance of whole-party attack, 75% single target
  public heroAttackThresholdPct = 10; // Hero attacks every 10% meter while holding front
  public heroGroupAttackChance = 0.25; // 25% chance of group attack on all enemies
  public heroAttackDamage = 1; // Standardized to 1 damage for heroes
  public bossSingleDamage = 10; // Standardized to 10 damage for bosses
  public bossPartyDamage = 10; // Standardized to 10 damage for bosses
  public heroUltPerHitPct = 0.5; // % Ult meter gained per attack strike (default 0.5%)
  public heroPassiveUltPerSec = 0.2; // % Ult meter gained per second passively (default 0.2%/s)
  public bossAttackCooldownMs = 0;
  public isLiveUltimatePlaying = false;
  public liveUltimateHeroId: string | null = null;
  private heroAttackAccumulator = 0;
  public hudCardBounds: Array<{ id: string; type: 'hero' | 'enemy'; x: number; y: number; w: number; h: number }> = [];

  private floatingDamages: FloatingDamage[] = [];
  private sparks: SlashSpark[] = [];
  private screenShakeMs = 0;
  private actorShakeOffsetX = 0;
  private actorShakeOffsetY = 0;
  private actorShakeFrameToggle = false;

  private lastTimestamp = 0;
  private onFrameListeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.addEventListener('pointerdown', (e) => this.handleCanvasPointerDown(e));

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
      if (savedSettings.lungePct !== undefined) {
        this.baseLungePct = savedSettings.lungePct;
      } else if (savedSettings.lungePx !== undefined) {
        this.baseLungePct = Math.round((savedSettings.lungePx / 320) * 1000) / 10;
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
        speed,
        fx.flipX,
        fx.rotation
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

    // Update hero positions
    for (const [id, slot] of this.heroSlots.entries()) {
      const hero = this.heroes.find((h) => h.config.id === id);
      if (hero) {
        const norm = BASE_HERO_SLOT_POSITIONS[slot];
        const xFrac = hero.customXFraction !== undefined ? hero.customXFraction : norm.xFraction;
        const yFrac = hero.customYFraction !== undefined ? hero.customYFraction : norm.yFraction;
        const newX = Math.round(xFrac * preset.width);
        const newY = Math.round(yFrac * preset.height);
        hero.setHome(newX, newY);
        hero.currentX = newX;
        hero.currentY = newY;
      }
    }

    // Update enemy positions
    this.enemies.forEach((enemy, idx) => {
      const norm = BASE_ENEMY_SLOT_POSITIONS[idx] || BASE_ENEMY_SLOT_POSITIONS[0];
      const xFrac = enemy.customXFraction !== undefined ? enemy.customXFraction : norm.xFraction;
      const yFrac = enemy.customYFraction !== undefined ? enemy.customYFraction : norm.yFraction;
      const newX = Math.round(xFrac * preset.width);
      const newY = Math.round(yFrac * preset.height);
      enemy.setHome(newX, newY);
      enemy.currentX = newX;
      enemy.currentY = newY;
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
        lungeDistance: Math.round((this.baseLungePct / 100) * this.canvas.width),
      });

      actor.idleIntervalMs = this.idleIntervalMs;
      actor.attackIntervalMs = this.attackIntervalMs;

      this.heroes.push(actor);
      this.heroSlots.set(def.id, def.slot);
    }
  }

  private initEnemies(): void {
    const saved = loadEnemiesDefaults();
    if (saved?.fxConfig) {
      this.enemyAttackFxConfig = { ...saved.fxConfig };
    }
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
        lungeDistance: Math.round((this.baseLungePct / 100) * this.canvas.width),
      });

      enemy.maxHp = this.bossMaxHp;
      enemy.currentHp = this.bossMaxHp;
      enemy.idleIntervalMs = this.idleIntervalMs;
      enemy.attackIntervalMs = this.attackIntervalMs;
      this.hookEnemyAttack(enemy);
      this.enemies.push(enemy);
    });
  }

  private hookEnemyAttack(enemy: SpriteActor): void {
    enemy.onAttackFrameToggle = (frame) => {
      if (!this.autoHitOpponent || this.isCombatEnabled) return; // In combat mode, executeBossAttack handles strikes
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
        const xFrac = displacedHero.customXFraction !== undefined ? displacedHero.customXFraction : normNew.xFraction;
        const yFrac = displacedHero.customYFraction !== undefined ? displacedHero.customYFraction : normNew.yFraction;
        const newX = Math.round(xFrac * this.canvas.width);
        const newY = Math.round(yFrac * this.canvas.height);
        displacedHero.setHome(newX, newY);
        displacedHero.currentX = newX;
        displacedHero.currentY = newY;
      }

      const hero = this.heroes.find((h) => h.config.id === heroId);
      if (hero) {
        const normFront = BASE_HERO_SLOT_POSITIONS['front'];
        const xFrac = hero.customXFraction !== undefined ? hero.customXFraction : normFront.xFraction;
        const yFrac = hero.customYFraction !== undefined ? hero.customYFraction : normFront.yFraction;
        const frontX = Math.round(xFrac * this.canvas.width);
        const frontY = Math.round(yFrac * this.canvas.height);
        hero.setHome(frontX, frontY);
        hero.currentX = frontX;
        hero.currentY = frontY;
      }

      if (!this.isUltimateStudioMode) {
        this.handleFrontHeroChanged(frontHeroId, heroId);
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
      lungeDistance: Math.round((this.baseLungePct / 100) * this.canvas.width),
    });

    enemy.maxHp = this.bossMaxHp;
    enemy.currentHp = this.bossMaxHp;
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

  public setBaseLungePct(pct: number): void {
    this.baseLungePct = pct;
    const actualPx = Math.round((pct / 100) * this.canvas.width);
    for (const h of this.heroes) {
      h.config.lungeDistance = actualPx;
    }
    for (const e of this.enemies) {
      e.config.lungeDistance = actualPx;
    }
  }

  public setBaseLungeDistance(pxOrPct: number): void {
    this.setBaseLungePct(pxOrPct);
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

    // 3. Clear combat VFX & shake offsets
    this.sparks = [];
    this.floatingDamages = [];
    this.screenShakeMs = 0;
    this.actorShakeOffsetX = 0;
    this.actorShakeOffsetY = 0;
    this.actorShakeFrameToggle = false;

    // 4. Reset arbitration starvation and front timers
    this.arbitrator.resetTimers();
  }

  public spawnHitEffect(
    x: number,
    y: number,
    color: string,
    variant: 0 | 1,
    customText?: string
  ): void {
    const text = customText !== undefined ? customText : `${Math.floor(120 + Math.random() * 880)}`;
    this.floatingDamages.push({
      x: Math.round(x + (Math.random() * 16 - 8)),
      y: Math.round(y - 8),
      vy: -0.032 * (this.canvas.height / 180),
      text,
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

    // Update combat simulation (vitality, rage, lull triggers, musical revival)
    if (this.isCombatEnabled && !this.isUltimateStudioMode) {
      this.updateCombat(dtMs);
    }

    // Only update FX timers if NOT in ultimate studio, OR if playback is actively playing!
    if (!this.isUltimateStudioMode || this.ultimateSequencer.isPlaying) {
      this.fxManager.update(dtMs);
    }

    if (this.isLiveUltimatePlaying) {
      this.ultimateSequencer.update(dtMs);
      const actor = this.heroes.find((h) => h.config.id === this.liveUltimateHeroId);
      if (actor) {
        actor.forcedSpriteKey = this.ultimateSequencer.currentActorPose;
        actor.flipX = this.ultimateSequencer.currentActorFlipX;
        actor.rotation = this.ultimateSequencer.currentActorRotation;
        const dir = actor.config.facing === 'right' ? 1 : -1;
        actor.currentX = actor.config.homeX + dir * (this.ultimateSequencer.currentActorXOffset / 100) * this.canvas.width;
        actor.currentY = actor.config.homeY + (this.ultimateSequencer.currentActorYOffset / 100) * this.canvas.height;

        if (this.ultimateSequencer.currentActorShake > 0) {
          this.actorShakeFrameToggle = !this.actorShakeFrameToggle;
          if (this.actorShakeFrameToggle) {
            const maxDisplacement = this.canvas.height * (this.ultimateSequencer.currentActorShake / 100);
            this.actorShakeOffsetX = (Math.random() - 0.5) * 2 * maxDisplacement;
            this.actorShakeOffsetY = (Math.random() - 0.5) * 2 * maxDisplacement;
          }
          actor.currentX += this.actorShakeOffsetX;
          actor.currentY += this.actorShakeOffsetY;
        } else {
          this.actorShakeOffsetX = 0;
          this.actorShakeOffsetY = 0;
        }
      }

      if (this.ultimateSequencer.currentEnemiesPose || this.ultimateSequencer.currentEnemiesXOffset !== 0 || this.ultimateSequencer.currentEnemiesYOffset !== 0) {
        const isGroup = this.ultimateSequencer.currentStepType === 'group';
        const targets = isGroup ? this.enemies : (this.getActiveTargetEnemy() ? [this.getActiveTargetEnemy()!] : []);
        for (const e of targets) {
          if (this.ultimateSequencer.currentEnemiesPose) {
            e.forcedSpriteKey = this.ultimateSequencer.currentEnemiesPose;
            e.flipX = this.ultimateSequencer.currentEnemiesFlipX;
            e.rotation = this.ultimateSequencer.currentEnemiesRotation;
          }
          e.currentX = e.config.homeX + (this.ultimateSequencer.currentEnemiesXOffset / 100) * this.canvas.width;
          e.currentY = e.config.homeY + (this.ultimateSequencer.currentEnemiesYOffset / 100) * this.canvas.height;
          if (this.ultimateSequencer.currentEnemiesShake > 0) {
            const maxDisplacement = this.canvas.height * (this.ultimateSequencer.currentEnemiesShake / 100);
            e.currentX += (Math.random() - 0.5) * 2 * maxDisplacement;
            e.currentY += (Math.random() - 0.5) * 2 * maxDisplacement;
          }
        }
      }

      const boss = this.getActiveTargetEnemy();
      if (boss && this.ultimateSequencer.currentBossReaction !== 'idle') {
        boss.setState(this.ultimateSequencer.currentBossReaction);
      }
      if (!this.ultimateSequencer.isPlaying) {
        this.finishLiveUltimate();
      }
    } else if (this.isUltimateStudioMode) {
      this.ultimateSequencer.update(dtMs);
      const actorId = this.ultimateSequencer.sequence.actorId;
      const actor =
        this.heroes.find((h) => h.config.id === actorId) ||
        this.enemies.find((e) => e.config.id === actorId || e.config.id.startsWith('enemy_'));
      if (actor) {
        actor.forcedSpriteKey = this.ultimateSequencer.currentActorPose;
        actor.flipX = this.ultimateSequencer.currentActorFlipX;
        actor.rotation = this.ultimateSequencer.currentActorRotation;
        const dir = actor.config.facing === 'right' ? 1 : -1;
        actor.currentX = actor.config.homeX + dir * (this.ultimateSequencer.currentActorXOffset / 100) * this.canvas.width;
        actor.currentY = actor.config.homeY + (this.ultimateSequencer.currentActorYOffset / 100) * this.canvas.height;

        if (this.ultimateSequencer.currentActorShake > 0) {
          this.actorShakeFrameToggle = !this.actorShakeFrameToggle;
          if (this.actorShakeFrameToggle) {
            const maxDisplacement = this.canvas.height * (this.ultimateSequencer.currentActorShake / 100);
            this.actorShakeOffsetX = (Math.random() - 0.5) * 2 * maxDisplacement;
            this.actorShakeOffsetY = (Math.random() - 0.5) * 2 * maxDisplacement;
          }
          actor.currentX += this.actorShakeOffsetX;
          actor.currentY += this.actorShakeOffsetY;
        } else {
          this.actorShakeOffsetX = 0;
          this.actorShakeOffsetY = 0;
        }
      }

      if (this.ultimateSequencer.currentEnemiesPose || this.ultimateSequencer.currentEnemiesXOffset !== 0 || this.ultimateSequencer.currentEnemiesYOffset !== 0) {
        const isGroup = this.ultimateSequencer.currentStepType === 'group';
        const targets = isGroup ? this.enemies : (this.getActiveTargetEnemy() ? [this.getActiveTargetEnemy()!] : []);
        for (const e of targets) {
          if (this.ultimateSequencer.currentEnemiesPose) {
            e.forcedSpriteKey = this.ultimateSequencer.currentEnemiesPose;
            e.flipX = this.ultimateSequencer.currentEnemiesFlipX;
            e.rotation = this.ultimateSequencer.currentEnemiesRotation;
          }
          e.currentX = e.config.homeX + (this.ultimateSequencer.currentEnemiesXOffset / 100) * this.canvas.width;
          e.currentY = e.config.homeY + (this.ultimateSequencer.currentEnemiesYOffset / 100) * this.canvas.height;
          if (this.ultimateSequencer.currentEnemiesShake > 0) {
            const maxDisplacement = this.canvas.height * (this.ultimateSequencer.currentEnemiesShake / 100);
            e.currentX += (Math.random() - 0.5) * 2 * maxDisplacement;
            e.currentY += (Math.random() - 0.5) * 2 * maxDisplacement;
          }
        }
      } else {
        for (const e of this.enemies) {
          e.forcedSpriteKey = null;
          e.flipX = false;
          e.rotation = 0;
          e.currentX = e.config.homeX;
          e.currentY = e.config.homeY;
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
        flipX: fx.flipX,
        rotation: fx.rotation,
        lifeMs: durMs,
        maxLifeMs: durMs,
      };
    };

    let forcedAdded = false;
    for (const kf of this.ultimateSequencer.sequence.keyframes) {
      const fxDefs = kf.sprites || (kf.spawnFx ? (Array.isArray(kf.spawnFx) ? kf.spawnFx : [kf.spawnFx]) : undefined);
      if (!fxDefs || fxDefs.length === 0) continue;

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

    const selSprites = selectedKf?.sprites || (selectedKf?.spawnFx ? (Array.isArray(selectedKf.spawnFx) ? selectedKf.spawnFx : [selectedKf.spawnFx]) : undefined);
    if (forceSelected && selectedKf && selSprites && !forcedAdded) {
      for (const fx of selSprites) {
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
      (this.isUltimateStudioMode || this.isLiveUltimatePlaying) &&
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
        (this.isUltimateStudioMode || this.isLiveUltimatePlaying) &&
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
    if ((this.isUltimateStudioMode || this.isLiveUltimatePlaying) && this.ultimateSequencer.currentDimArena > 0) {
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

    // 7. Screen flash on impact
    if ((this.isUltimateStudioMode || this.isLiveUltimatePlaying) && this.ultimateSequencer.currentWhiteFlash) {
      ctx.save();
      const opacity = (this.ultimateSequencer.currentFlashOpacity || 85) / 100;
      const pal = this.ultimateSequencer.currentFlashPalette;
      let rgb = '255, 255, 255';
      if (pal && pal !== 'White' && FX_PALETTES[pal]) {
        const ramp = FX_PALETTES[pal];
        const dominant = ramp[Math.min(ramp.length - 1, 2)];
        rgb = `${dominant[0]}, ${dominant[1]}, ${dominant[2]}`;
      }
      ctx.fillStyle = `rgba(${rgb}, ${opacity})`;
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

    // 8. Actor Vitality & Combat HUD (Canvas 2D top row, rendered crisp & unwarped)
    this.drawCombatHud(this.ctx, W, H, scale);
  }

  public handleFrontHeroChanged(_prevHeroId: string, newFrontHeroId: string): void {
    // 1. Guaranteed Hero Attack when taking the front spot
    const newFront = this.heroes.find((h) => h.config.id === newFrontHeroId);
    if (newFront && newFront.state !== 'downed') {
      const isGroup = Math.random() < this.heroGroupAttackChance;
      this.executeHeroAttack(newFront, isGroup);
    }

    // 2. Guaranteed Enemy Strike-Back when hero leaves the front spot
    this.executeEnemyStrikeBack();
  }

  public executeHeroAttack(hero: SpriteActor, forcedGroup?: boolean): void {
    if (hero.state === 'downed') return;

    hero.setState('attack');
    setTimeout(() => {
      if (hero.state === 'attack') {
        hero.setState(this.audioEngine.isPlaying ? 'active' : 'idle');
      }
    }, 450);

    const isGroup = forcedGroup !== undefined ? forcedGroup : Math.random() < this.heroGroupAttackChance;

    if (isGroup) {
      // Group Attack: affects ALL living enemies!
      const livingEnemies = this.enemies.filter((e) => this.isEnemyInvincible || e.currentHp > 0);
      for (const enemy of livingEnemies) {
        const dmg = this.heroAttackDamage;
        if (!this.isEnemyInvincible) {
          enemy.takeDamage(dmg);
        }
        enemy.isManuallyLatched = false;
        enemy.setState(enemy.currentHp <= 0 ? 'downed' : 'hit');

        this.spawnHitEffect(
          enemy.currentX,
          enemy.currentY - (this.canvas.height * enemy.heightFraction) * 0.55,
          '#ffee33',
          1,
          enemy.currentHp <= 0 ? 'KO!' : `-${dmg}`
        );

        // Rage gain for enemy
        enemy.rageAccumulator += dmg;
        enemy.currentMeter = (enemy.currentMeter + dmg) % 100;
        while (enemy.rageAccumulator >= this.rageThresholdPct) {
          enemy.rageAccumulator -= this.rageThresholdPct;
          this.executeBossAttack(enemy);
        }
      }

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
      this.triggerScreenShake(120);
    } else {
      // Single Target Strike: affects front enemy!
      const target = this.getActiveTargetEnemy();
      if (target && (this.isEnemyInvincible || target.currentHp > 0)) {
        const dmg = this.heroAttackDamage;
        if (!this.isEnemyInvincible) {
          target.takeDamage(dmg);
        }
        target.isManuallyLatched = false;
        target.setState(target.currentHp <= 0 ? 'downed' : 'hit');

        this.spawnHitEffect(
          target.currentX,
          target.currentY - (this.canvas.height * target.heightFraction) * 0.55,
          '#ffee33',
          0,
          target.currentHp <= 0 ? 'KO!' : `-${dmg}`
        );

        const targetX = target.currentX;
        const targetY = target.currentY - (this.canvas.height * target.heightFraction) * 0.5;
        this.fxManager.spawnArenaEffect(
          this.heroAttackFxConfig.fxId,
          this.heroAttackFxConfig.paletteName,
          this.heroAttackFxConfig.size,
          targetX,
          targetY,
          'right'
        );

        target.rageAccumulator += dmg;
        target.currentMeter = (target.currentMeter + dmg) % 100;
        while (target.rageAccumulator >= this.rageThresholdPct) {
          target.rageAccumulator -= this.rageThresholdPct;
          this.executeBossAttack(target);
        }
      }
    }
  }

  public executeEnemyStrikeBack(): void {
    const activeEnemy = this.getActiveTargetEnemy();
    if (activeEnemy && (this.isEnemyInvincible || activeEnemy.currentHp > 0)) {
      this.executeBossAttack(activeEnemy, Math.random() < this.partyAttackChance);
    }
  }

  public updateCombat(dtMs: number): void {
    // 1. Passive & Active Hero Meter generation
    if (this.audioEngine.isPlaying) {
      for (const hero of this.heroes) {
        if (hero.state !== 'downed') {
          const isFront = hero.config.id === this.arbitrator.currentFrontHeroId;
          const ch = this.audioEngine.getChannelByHeroId(hero.config.id);
          const isPlaying = ch && (ch.isPastThreshold || ch.isOnset);

          // Gain meter while playing
          let gain = 0;
          if (this.heroPassiveUltPerSec > 0) {
            gain += (this.heroPassiveUltPerSec / 1000) * dtMs;
          }
          if (isPlaying && isFront) {
            gain += (this.heroUltPerHitPct * (dtMs / 250));
          }

          if (gain > 0) {
            hero.addMeter(gain);

            // While holding front spot, attack at fixed % threshold (default 10%)
            if (isFront && !this.isLiveUltimatePlaying) {
              this.heroAttackAccumulator += gain;
              while (this.heroAttackAccumulator >= this.heroAttackThresholdPct) {
                this.heroAttackAccumulator -= this.heroAttackThresholdPct;
                const isGroup = Math.random() < this.heroGroupAttackChance;
                this.executeHeroAttack(hero, isGroup);
              }
            }
          }

          // Auto-trigger Ult on spotlight peak if 100% charged and in front slot
          if (
            hero.currentMeter >= 100 &&
            !this.isLiveUltimatePlaying &&
            isFront
          ) {
            if (ch && ch.isPastThreshold && (ch.dominanceScore >= 0.5 || this.arbitrator.frontTimeElapsedMs >= 1500)) {
              this.playHeroUltimate(hero.config.id);
            }
          }
        }
      }
    }

    // 2. Musical Revival for Downed Heroes (minimum 5.0 seconds down time enforced)
    for (const hero of this.heroes) {
      if (hero.state === 'downed') {
        if (hero.downTimerMs >= 5000) {
          const ch = this.audioEngine.getChannelByHeroId(hero.config.id);
          if (ch && ch.isPastThreshold && (ch.dominanceScore >= 0.35 || ch.isOnset)) {
            hero.heal(Math.round(hero.maxHp * 0.5));
            hero.setState('idle');
            const scale = this.canvas.height / 180;
            this.spawnHitEffect(
              hero.currentX,
              hero.currentY - Math.round(30 * scale),
              '#55ff55',
              0,
              'REVIVED!'
            );
          }
        }
      }
    }

    // 3. Enemy Attack Eligibility: fires when rageAccumulator reaches rageThresholdPct
    this.bossAttackCooldownMs = Math.max(0, this.bossAttackCooldownMs - dtMs);

    for (const enemy of this.enemies) {
      if (this.isEnemyInvincible && (enemy.state === 'downed' || enemy.currentHp < enemy.maxHp)) {
        enemy.currentHp = enemy.maxHp;
        if (enemy.state === 'downed') enemy.setState('idle');
      }

      if (enemy.rageAccumulator >= this.rageThresholdPct && (this.isEnemyInvincible || enemy.currentHp > 0)) {
        if (this.bossAttackCooldownMs <= 0 && enemy.state !== 'attack') {
          enemy.rageAccumulator -= this.rageThresholdPct;
          this.bossAttackCooldownMs = 1200;
          this.executeBossAttack(enemy);
          break;
        }
      }
    }
  }

  public executeBossAttack(enemy: SpriteActor, forcedGroup?: boolean): void {
    if (enemy.state === 'downed' && !this.isEnemyInvincible) return;

    enemy.setState('attack');
    setTimeout(() => {
      if (enemy.state === 'attack') {
        enemy.setState('idle');
      }
    }, 450);

    const isParty = forcedGroup !== undefined ? forcedGroup : Math.random() < this.partyAttackChance;

    if (isParty) {
      // Group Attack: affects ALL living heroes!
      const livingHeroes = this.heroes.filter((h) => h.state !== 'downed');
      if (livingHeroes.length > 0) {
        for (const hero of livingHeroes) {
          const dmg = this.bossPartyDamage;
          hero.takeDamage(dmg);
          hero.isManuallyLatched = false;
          hero.setState(hero.currentHp <= 0 ? 'downed' : 'hit');

          this.spawnHitEffect(
            hero.currentX,
            hero.currentY - (this.canvas.height * hero.heightFraction) * 0.55,
            '#ff3355',
            1,
            hero.currentHp <= 0 ? 'KO!' : `-${dmg}`
          );
        }

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
        this.triggerScreenShake(200);
      }
    } else {
      // Single Target Strike: affects front hero!
      let targetHero = this.getFrontHero();
      if (!targetHero || targetHero.state === 'downed') {
        targetHero = this.heroes.find((h) => h.state !== 'downed') || this.heroes[0];
      }

      if (targetHero && targetHero.state !== 'downed') {
        const dmg = this.bossSingleDamage;
        targetHero.takeDamage(dmg);
        targetHero.isManuallyLatched = false;
        targetHero.setState(targetHero.currentHp <= 0 ? 'downed' : 'hit');

        this.spawnHitEffect(
          targetHero.currentX,
          targetHero.currentY - (this.canvas.height * targetHero.heightFraction) * 0.55,
          '#ff3355',
          0,
          targetHero.currentHp <= 0 ? 'KO!' : `-${dmg}`
        );

        const targetX = targetHero.currentX;
        const targetY = targetHero.currentY - (this.canvas.height * targetHero.heightFraction) * 0.5;
        this.fxManager.spawnArenaEffect(
          this.enemyAttackFxConfig.fxId,
          this.enemyAttackFxConfig.paletteName,
          this.enemyAttackFxConfig.size,
          targetX,
          targetY,
          'left'
        );
        this.triggerScreenShake(120);

        if (targetHero.currentHp <= 0) {
          const nextHealthy = this.heroes.find((h) => h.state !== 'downed');
          if (nextHealthy) {
            this.triggerHeroState(nextHealthy.config.id, 'active');
          }
        }
      }
    }
  }

  public playHeroUltimate(heroId: string): void {
    if (this.isLiveUltimatePlaying) return;

    const hero = this.heroes.find((h) => h.config.id === heroId);
    if (!hero || hero.state === 'downed') return;

    const preset = ULTIMATE_PRESETS[heroId] || ULTIMATE_PRESETS['hero_guitar_1'];
    if (!preset) return;

    this.isLiveUltimatePlaying = true;
    this.liveUltimateHeroId = heroId;

    // Swap to front if not already front
    if (this.heroSlots.get(heroId) !== 'front') {
      this.triggerHeroState(heroId, 'attack');
    }

    this.ultimateSequencer.setSequence(preset);
    this.ultimateSequencer.isLooping = false;
    hero.currentMeter = 0;
    hero.setState('ultimate');
    this.ultimateSequencer.play();
  }

  public finishLiveUltimate(): void {
    const target = this.getActiveTargetEnemy();
    if (target && target.currentHp > 0) {
      const dmg = Math.floor(55 + Math.random() * 15);
      target.takeDamage(dmg);
      target.setState(target.currentHp <= 0 ? 'downed' : 'hit');
      this.spawnHitEffect(
        target.currentX,
        target.currentY - (this.canvas.height * target.heightFraction) * 0.6,
        '#ffee33',
        0,
        `-${dmg} CRIT!`
      );
      this.triggerScreenShake(240);
    }

    const hero = this.heroes.find((h) => h.config.id === this.liveUltimateHeroId);
    if (hero) {
      hero.forcedSpriteKey = null;
      if (hero.state === 'ultimate') {
        hero.setState('idle');
      }
      hero.currentX = hero.config.homeX;
      hero.currentY = hero.config.homeY;
    }

    for (const e of this.enemies) {
      e.forcedSpriteKey = null;
      e.flipX = false;
      e.rotation = 0;
      e.currentX = e.config.homeX;
      e.currentY = e.config.homeY;
    }

    this.isLiveUltimatePlaying = false;
    this.liveUltimateHeroId = null;
  }

  public setBossMaxHp(hp: number): void {
    this.bossMaxHp = Math.max(10, hp);
    for (const enemy of this.enemies) {
      const prevRatio = enemy.maxHp > 0 ? enemy.currentHp / enemy.maxHp : 1;
      enemy.maxHp = this.bossMaxHp;
      enemy.currentHp = Math.max(1, Math.round(this.bossMaxHp * prevRatio));
      if (enemy.state === 'downed') {
        enemy.setState('idle');
      }
    }
  }

  public setBossChargeCap(cap: number): void {
    this.bossChargeCap = Math.max(1, cap);
  }

  public resetCombatVitality(): void {
    for (const h of this.heroes) h.resetVitality();
    for (const e of this.enemies) {
      e.maxHp = this.bossMaxHp;
      e.resetVitality();
    }
    this.bossAttackCooldownMs = 0;
    this.isLiveUltimatePlaying = false;
    this.liveUltimateHeroId = null;
  }

  public forceBossAttack(): void {
    const enemy = this.getActiveTargetEnemy() || this.enemies[0];
    if (enemy) {
      this.executeBossAttack(enemy);
    }
  }

  public fillAllHeroUlts(): void {
    for (const h of this.heroes) {
      h.currentMeter = 100;
    }
  }

  private handleCanvasPointerDown(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const canvasY = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    const scale = this.canvas.height / 180;
    const baseX = canvasX / scale;
    const baseY = canvasY / scale;

    for (const card of this.hudCardBounds) {
      if (
        baseX >= card.x &&
        baseX <= card.x + card.w &&
        baseY >= card.y &&
        baseY <= card.y + card.h
      ) {
        if (card.type === 'hero') {
          const hero = this.heroes.find((h) => h.config.id === card.id);
          if (hero) {
            if (hero.currentMeter >= 100 && !this.isLiveUltimatePlaying) {
              this.playHeroUltimate(hero.config.id);
            } else if (hero.state !== 'downed') {
              this.triggerHeroState(hero.config.id, 'attack');
            }
          }
        }
        break;
      }
    }
  }

  public drawCombatHud(ctx: CanvasRenderingContext2D, _W: number, _H: number, scale: number): void {
    this.hudCardBounds = [];

    ctx.save();
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;

    const cardY = 4;
    const cardH = 13;

    // --- 1. HEROES ROW (Top-Left) ---
    const heroAreaStart = 5;
    const heroAreaEnd = 155;
    const heroAreaW = heroAreaEnd - heroAreaStart;
    const nHeroes = Math.max(1, this.heroes.length);
    const heroGap = 3;
    const heroCardW = Math.min(
      56,
      Math.max(26, Math.floor((heroAreaW - (nHeroes - 1) * heroGap) / nHeroes))
    );

    const abbreviations: Record<string, string> = {
      hero_guitar_1: 'G1',
      hero_drums: 'DR',
      hero_guitar_2: 'G2',
      hero_bass: 'BA',
    };

    for (let i = 0; i < this.heroes.length; i++) {
      const hero = this.heroes[i];
      const cardX = heroAreaStart + i * (heroCardW + heroGap);

      // Record bounding box in base coordinates
      this.hudCardBounds.push({
        id: hero.config.id,
        type: 'hero',
        x: cardX,
        y: cardY,
        w: heroCardW,
        h: cardH,
      });

      const isReady = hero.currentMeter >= 100;
      const isDown = hero.state === 'downed';
      const portSize = 13;

      // 1a. Portrait Box (to the left)
      ctx.fillStyle = '#090d14';
      ctx.fillRect(cardX, cardY, portSize, portSize);

      // Portrait border (pulsing gold/cyan if 100% Ult ready)
      if (isReady) {
        const pulse = Math.floor(Date.now() / 150) % 2 === 0;
        ctx.strokeStyle = pulse ? '#ffee33' : '#00ddff';
      } else if (isDown) {
        ctx.strokeStyle = '#551111';
      } else {
        ctx.strokeStyle = '#1e2d42';
      }
      ctx.strokeRect(cardX + 0.5, cardY + 0.5, portSize - 1, portSize - 1);

      // Portrait text / abbreviation
      ctx.font = '5px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (isDown) {
        ctx.fillStyle = '#ff3344';
        const remainingDownSec = Math.max(0, Math.ceil((5000 - hero.downTimerMs) / 1000));
        const text = remainingDownSec > 0 ? `${remainingDownSec}s` : 'KO';
        ctx.fillText(text, cardX + portSize / 2, cardY + portSize / 2 + 1);
      } else if (isReady) {
        ctx.fillStyle = '#ffee33';
        ctx.fillText(abbreviations[hero.config.id] || `H${i + 1}`, cardX + portSize / 2, cardY + portSize / 2 + 1);
      } else {
        ctx.fillStyle = '#78a2cc';
        ctx.fillText(abbreviations[hero.config.id] || `H${i + 1}`, cardX + portSize / 2, cardY + portSize / 2 + 1);
      }

      // If Ult is ready, small star/badge
      if (isReady) {
        ctx.fillStyle = '#ffe033';
        ctx.fillRect(cardX + portSize - 3, cardY, 3, 3);
      }

      // 1b. Stacked Bars (to the right of portrait)
      const barsX = cardX + portSize + 2;
      const barW = Math.max(4, cardX + heroCardW - barsX);

      // HP Bar (Top)
      const hpBarY = cardY + 1;
      const hpBarH = 4;
      ctx.fillStyle = '#16080e';
      ctx.fillRect(barsX, hpBarY, barW, hpBarH);
      ctx.strokeStyle = '#080406';
      ctx.strokeRect(barsX + 0.5, hpBarY + 0.5, barW - 1, hpBarH - 1);

      const hpRatio = Math.max(0, Math.min(1, hero.currentHp / hero.maxHp));
      const hpFillW = Math.round((barW - 2) * hpRatio);
      if (hpFillW > 0) {
        if (hpRatio > 0.5) ctx.fillStyle = '#22dd55';
        else if (hpRatio > 0.2) ctx.fillStyle = '#ffcc00';
        else ctx.fillStyle = '#ff3344';
        ctx.fillRect(barsX + 1, hpBarY + 1, hpFillW, hpBarH - 2);
      }

      // Ult Bar (Bottom)
      const ultBarY = cardY + 7;
      const ultBarH = 4;
      ctx.fillStyle = '#06121c';
      ctx.fillRect(barsX, ultBarY, barW, ultBarH);
      ctx.strokeStyle = '#040a10';
      ctx.strokeRect(barsX + 0.5, ultBarY + 0.5, barW - 1, ultBarH - 1);

      const ultRatio = Math.max(0, Math.min(1, hero.currentMeter / hero.maxMeter));
      const ultFillW = Math.round((barW - 2) * ultRatio);
      if (ultFillW > 0) {
        if (isReady) {
          const shift = Math.floor(Date.now() / 100) % 2 === 0;
          ctx.fillStyle = shift ? '#ffee33' : '#ffffff';
        } else {
          ctx.fillStyle = '#00ddff';
        }
        ctx.fillRect(barsX + 1, ultBarY + 1, ultFillW, ultBarH - 2);
      }
    }

    // --- 2. ENEMIES ROW (Top-Right) ---
    const enemyAreaStartX = 165;
    const enemyAreaEndX = 315;
    const availableEnemyW = enemyAreaEndX - enemyAreaStartX;
    const nEnemies = Math.max(1, this.enemies.length);
    const enemyGap = 3;
    const enemyCardW = Math.min(
      76,
      Math.max(22, Math.floor((availableEnemyW - (nEnemies - 1) * enemyGap) / nEnemies))
    );
    const totalEnemyBlockW = nEnemies * enemyCardW + (nEnemies - 1) * enemyGap;
    const enemyBlockStartX = enemyAreaEndX - totalEnemyBlockW;

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      const cardX = enemyBlockStartX + i * (enemyCardW + enemyGap);

      this.hudCardBounds.push({
        id: enemy.config.id,
        type: 'enemy',
        x: cardX,
        y: cardY,
        w: enemyCardW,
        h: cardH,
      });

      const portSize = 13;
      const isEligible = enemy.attackCharges > 0;
      const isDead = !this.isEnemyInvincible && enemy.currentHp <= 0;

      // 2a. Portrait Box (to the left)
      ctx.fillStyle = '#16080c';
      ctx.fillRect(cardX, cardY, portSize, portSize);

      if (isEligible) {
        const pulse = Math.floor(Date.now() / 150) % 2 === 0;
        ctx.strokeStyle = pulse ? '#ff3344' : '#ff9900';
      } else if (isDead) {
        ctx.strokeStyle = '#331111';
      } else {
        ctx.strokeStyle = '#3b1219';
      }
      ctx.strokeRect(cardX + 0.5, cardY + 0.5, portSize - 1, portSize - 1);

      ctx.font = '5px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let abbr = 'W';
      if (enemy.config.folderPath.includes('air_squid')) abbr = 'SQ';
      else if (this.enemies.length > 1) abbr = `W${i + 1}`;

      if (isDead) {
        ctx.fillStyle = '#ff3344';
        ctx.fillText('KO', cardX + portSize / 2, cardY + portSize / 2 + 1);
      } else {
        ctx.fillStyle = isEligible ? '#ffaa00' : '#cc7888';
        ctx.fillText(abbr, cardX + portSize / 2, cardY + portSize / 2 + 1);
      }

      // If attack charges > 0, draw charge badge
      if (isEligible) {
        ctx.fillStyle = '#ffdd00';
        ctx.fillRect(cardX + portSize - 3, cardY, 3, 3);
      }

      // 2b. Stacked Bars (to the right of portrait)
      const barsX = cardX + portSize + 2;
      const barW = Math.max(4, cardX + enemyCardW - barsX);

      // HP Bar (Top)
      const hpBarY = cardY + 1;
      const hpBarH = 4;
      ctx.fillStyle = '#1c080c';
      ctx.fillRect(barsX, hpBarY, barW, hpBarH);
      ctx.strokeStyle = '#0a0305';
      ctx.strokeRect(barsX + 0.5, hpBarY + 0.5, barW - 1, hpBarH - 1);

      const hpRatio = Math.max(0, Math.min(1, enemy.currentHp / enemy.maxHp));
      const hpFillW = Math.round((barW - 2) * hpRatio);
      if (hpFillW > 0) {
        ctx.fillStyle = hpRatio > 0.25 ? '#ee2244' : '#ff5577';
        ctx.fillRect(barsX + 1, hpBarY + 1, hpFillW, hpBarH - 2);
      }

      // Rage Bar (Bottom)
      const rageBarY = cardY + 7;
      const rageBarH = 4;
      ctx.fillStyle = '#1c1006';
      ctx.fillRect(barsX, rageBarY, barW, rageBarH);
      ctx.strokeStyle = '#0c0702';
      ctx.strokeRect(barsX + 0.5, rageBarY + 0.5, barW - 1, rageBarH - 1);

      const rageRatio = Math.max(0, Math.min(1, enemy.currentMeter / 100));
      const rageFillW = Math.round((barW - 2) * rageRatio);
      if (rageFillW > 0) {
        ctx.fillStyle = '#ff6600';
        ctx.fillRect(barsX + 1, rageBarY + 1, rageFillW, rageBarH - 2);
      }

      // RAGE THRESHOLD NOTCHES: Vertical tick lines at each rageThresholdPct
      if (barW > 8 && this.rageThresholdPct > 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        for (let p = this.rageThresholdPct; p < 100; p += this.rageThresholdPct) {
          const notchX = barsX + Math.round(((barW - 2) * p) / 100);
          ctx.fillRect(notchX, rageBarY + 1, 1, rageBarH - 2);
        }
      }

      // If attack charges > 0 and width allows, display charges badge
      if (enemy.attackCharges > 0 && barW >= 24) {
        ctx.font = '4px "Press Start 2P", monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffdd44';
        ctx.fillText(`x${enemy.attackCharges}`, barsX + barW - 1, rageBarY + rageBarH + 4);
      }
    }

    ctx.restore();
  }
}
