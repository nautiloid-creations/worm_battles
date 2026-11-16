import { WarpConfig } from './RasterWarpManager';
import { SpriteKey } from './SpriteActor';

import guitar1Ult from '../../assets_src/characters/guitar_1/ultimate.json';
import guitar2Ult from '../../assets_src/characters/guitar_2/ultimate.json';
import bassUlt from '../../assets_src/characters/bass/ultimate.json';
import drumsUlt from '../../assets_src/characters/drums/ultimate.json';
import theWormUlt from '../../assets_src/characters/the_worm/ultimate.json';
import airSquidUlt from '../../assets_src/characters/air_squid/ultimate.json';

export type ActionTargetType = 'single' | 'group';

export interface ActionActorCard {
  pose: SpriteKey;
  xOffset: number; // % canvas width
  yOffset: number; // % canvas height
  flipX: boolean;
  rotation: 0 | -90 | 90;
  shake?: number; // % canvas height
}

export interface ActionArenaCard {
  darkness?: number; // 0..1 darkness overlay
  screenShake?: {
    intensity: number;
    durationMs: number;
  };
  flash?: {
    enabled: boolean;
    opacity: number; // 0..100%
    paletteName: string; // Palette name or 'White'
  };
}

export interface ActionSpriteCard extends UltimateFxDef {
  type?: 'static' | 'projectile';
  flipX?: boolean;
  rotation?: 0 | -90 | 90;
}

export interface ActionStep {
  timeMs: number;
  type?: ActionTargetType; // 'single' | 'group'
  actor?: ActionActorCard;
  arena?: ActionArenaCard;
  enemies?: ActionActorCard;
  warp?: WarpConfig & { durationMs: number };
  sprites?: ActionSpriteCard[];

  // Legacy keyframe compatibility
  actorPose?: SpriteKey;
  actorXOffset?: number;
  actorYOffset?: number;
  actorShake?: number;
  actorFlipX?: boolean;
  actorRotation?: 0 | -90 | 90;
  dimArena?: number;
  flashWhite?: boolean;
  bossReaction?: 'hit' | 'idle' | 'downed';
  screenShake?: {
    intensity: number;
    durationMs: number;
  };
  spawnFx?: UltimateFxDef | UltimateFxDef[];
}

export type UltimateKeyframe = ActionStep;

export interface UltimateFxDef {
  fxId: string;
  paletteName: string;
  size: number; // % canvas height
  xFrac: number;
  yFrac: number;
  targetXFrac?: number;
  targetYFrac?: number;
  speed?: number; // px per ms (at 180p scale)
  facing?: 'right' | 'left';
  flipX?: boolean;
  rotation?: 0 | -90 | 90;
  durationMs: number;
}

export interface UltimateSequence {
  actorId: string;
  name: string;
  durationMs: number;
  type?: ActionTargetType;
  keyframes: ActionStep[];
}

export class UltimateSequencer {
  public sequence: UltimateSequence;
  public currentTimeMs = 0;
  public isPlaying = false;
  public isLooping = true;
  public speed = 1.0;

  // Active evaluated state at currentTimeMs
  public currentActorPose: SpriteKey = 'idle_1';
  public currentActorXOffset = 0;
  public currentActorYOffset = 0;
  public currentActorFlipX = false;
  public currentActorRotation: 0 | -90 | 90 = 0;
  public currentActorShake = 0;

  public currentEnemiesPose?: SpriteKey;
  public currentEnemiesXOffset = 0;
  public currentEnemiesYOffset = 0;
  public currentEnemiesFlipX = false;
  public currentEnemiesRotation: 0 | -90 | 90 = 0;
  public currentEnemiesShake = 0;

  public currentDimArena = 0;
  public currentWhiteFlash = false;
  public currentFlashOpacity = 0;
  public currentFlashPalette = 'White';
  public currentBossReaction: 'hit' | 'idle' | 'downed' = 'idle';
  public currentStepType: ActionTargetType = 'single';

  public currentWarpConfig: WarpConfig = {
    type: 'none',
    target: 'background',
    amplitude: 0,
    frequency: 0.05,
    speed: 0.005,
  };

  public onSpawnFx?: (fx: UltimateFxDef) => void;
  public onClearFx?: () => void;
  public onScreenShake?: (intensity: number) => void;

  private firedFxKeyframes: Set<number> = new Set();
  private firedShakeKeyframes: Set<number> = new Set();

  constructor(defaultSeq?: UltimateSequence) {
    this.sequence = defaultSeq || ULTIMATE_PRESETS['hero_guitar_1'];
  }

  public setSequence(seq: UltimateSequence): void {
    this.sequence = seq;
    this.seek(0);
  }

  public play(): void {
    this.isPlaying = true;
  }

  public pause(): void {
    this.isPlaying = false;
  }

  public seek(timeMs: number): void {
    const prevTime = this.currentTimeMs;
    this.currentTimeMs = Math.max(0, Math.min(this.sequence.durationMs, timeMs));
    if (this.currentTimeMs < prevTime || this.currentTimeMs === 0) {
      this.firedFxKeyframes.clear();
      this.firedShakeKeyframes.clear();
      if (this.onClearFx && this.isPlaying) this.onClearFx();
    }
    this.evaluateState();
  }

  public update(dtMs: number): void {
    if (!this.isPlaying) return;

    this.currentTimeMs += dtMs * this.speed;

    if (this.currentTimeMs >= this.sequence.durationMs) {
      if (this.isLooping) {
        this.currentTimeMs = 0;
        this.firedFxKeyframes.clear();
        this.firedShakeKeyframes.clear();
        if (this.onClearFx) this.onClearFx();
      } else {
        this.currentTimeMs = this.sequence.durationMs;
        this.isPlaying = false;
      }
    }

    this.evaluateState();
  }

  private evaluateState(): void {
    const t = this.currentTimeMs;
    const sorted = [...this.sequence.keyframes].sort((a, b) => a.timeMs - b.timeMs);

    // Reset defaults
    this.currentActorPose = 'idle_1';
    this.currentActorXOffset = 0;
    this.currentActorYOffset = 0;
    this.currentActorFlipX = false;
    this.currentActorRotation = 0;
    this.currentActorShake = 0;

    this.currentEnemiesPose = undefined;
    this.currentEnemiesXOffset = 0;
    this.currentEnemiesYOffset = 0;
    this.currentEnemiesFlipX = false;
    this.currentEnemiesRotation = 0;
    this.currentEnemiesShake = 0;

    this.currentDimArena = 0;
    this.currentWhiteFlash = false;
    this.currentFlashOpacity = 0;
    this.currentFlashPalette = 'White';
    this.currentBossReaction = 'idle';
    this.currentStepType = this.sequence.type || 'single';

    this.currentWarpConfig = {
      type: 'none',
      target: 'background',
      amplitude: 0,
      frequency: 0.05,
      speed: 0.005,
    };

    for (const kf of sorted) {
      if (kf.timeMs <= t) {
        if (kf.type) this.currentStepType = kf.type;

        // Actor card / legacy actor (discrete properties: pose, flipX, rotation, shake)
        if (kf.actor) {
          this.currentActorPose = kf.actor.pose;
          this.currentActorFlipX = kf.actor.flipX;
          this.currentActorRotation = kf.actor.rotation;
          this.currentActorShake = kf.actor.shake ?? 0;
        } else {
          if (kf.actorPose) this.currentActorPose = kf.actorPose;
          if (kf.actorShake !== undefined) this.currentActorShake = kf.actorShake;
        }

        // Enemies card / legacy reaction (discrete properties: pose, flipX, rotation, shake)
        if (kf.enemies) {
          this.currentEnemiesPose = kf.enemies.pose;
          this.currentEnemiesFlipX = kf.enemies.flipX;
          this.currentEnemiesRotation = kf.enemies.rotation;
          this.currentEnemiesShake = kf.enemies.shake ?? 0;
        }
        if (kf.bossReaction) this.currentBossReaction = kf.bossReaction;

        // Arena card / legacy arena (discrete flash; darkness is linearly interpolated below)
        if (kf.arena) {
          if (kf.arena.flash?.enabled) {
            const isFlashing = t - kf.timeMs < 140;
            this.currentWhiteFlash = isFlashing;
            this.currentFlashOpacity = isFlashing ? (kf.arena.flash.opacity ?? 85) : 0;
            this.currentFlashPalette = kf.arena.flash.paletteName || 'White';
          }
        } else {
          if (kf.flashWhite) {
            const isFlashing = t - kf.timeMs < 120;
            this.currentWhiteFlash = isFlashing;
            this.currentFlashOpacity = isFlashing ? 85 : 0;
            this.currentFlashPalette = 'White';
          }
        }

        // Warp check
        if (kf.warp) {
          const elapsed = t - kf.timeMs;
          if (elapsed >= 0 && elapsed <= kf.warp.durationMs) {
            const progress = elapsed / kf.warp.durationMs;
            this.currentWarpConfig = {
              type: kf.warp.type,
              target: kf.warp.target,
              amplitude: kf.warp.amplitude,
              frequency: kf.warp.frequency,
              speed: kf.warp.speed,
              progress,
            };
          }
        }

        // Fire one-shot events when playing forward
        if (this.isPlaying) {
          const spritesToFire = kf.sprites || (kf.spawnFx ? (Array.isArray(kf.spawnFx) ? kf.spawnFx : [kf.spawnFx]) : undefined);
          if (spritesToFire && !this.firedFxKeyframes.has(kf.timeMs)) {
            this.firedFxKeyframes.add(kf.timeMs);
            if (this.onSpawnFx) {
              for (const fx of spritesToFire) {
                this.onSpawnFx(fx);
              }
            }
          }

          const shakeToFire = kf.arena?.screenShake || kf.screenShake;
          if (shakeToFire && !this.firedShakeKeyframes.has(kf.timeMs)) {
            this.firedShakeKeyframes.add(kf.timeMs);
            if (this.onScreenShake) this.onScreenShake(shakeToFire.intensity);
          }
        }
      }
    }

    // Smooth linear slide interpolation for positions (actor & enemy) and arena darkness between steps
    if (sorted.length > 0) {
      const resolvedActorPos: Array<{ x: number; y: number }> = [];
      const resolvedEnemiesPos: Array<{ x: number; y: number }> = [];
      const resolvedDarkness: number[] = [];

      let curActorPos = { x: 0, y: 0 };
      let curEnemiesPos = { x: 0, y: 0 };
      let curDarkness = 0;

      for (let i = 0; i < sorted.length; i++) {
        const kf = sorted[i];
        if (kf.actor) {
          curActorPos = { x: kf.actor.xOffset ?? 0, y: kf.actor.yOffset ?? 0 };
        } else if (kf.actorXOffset !== undefined || kf.actorYOffset !== undefined) {
          curActorPos = { x: kf.actorXOffset ?? 0, y: kf.actorYOffset ?? 0 };
        }
        resolvedActorPos.push(curActorPos);

        if (kf.enemies) {
          curEnemiesPos = { x: kf.enemies.xOffset ?? 0, y: kf.enemies.yOffset ?? 0 };
        }
        resolvedEnemiesPos.push(curEnemiesPos);

        if (kf.arena?.darkness !== undefined) {
          curDarkness = kf.arena.darkness;
        } else if (kf.dimArena !== undefined) {
          curDarkness = kf.dimArena;
        }
        resolvedDarkness.push(curDarkness);
      }

      if (t <= sorted[0].timeMs) {
        this.currentActorXOffset = resolvedActorPos[0].x;
        this.currentActorYOffset = resolvedActorPos[0].y;
        this.currentEnemiesXOffset = resolvedEnemiesPos[0].x;
        this.currentEnemiesYOffset = resolvedEnemiesPos[0].y;
        this.currentDimArena = resolvedDarkness[0];
      } else if (t >= sorted[sorted.length - 1].timeMs) {
        const lastIdx = sorted.length - 1;
        this.currentActorXOffset = resolvedActorPos[lastIdx].x;
        this.currentActorYOffset = resolvedActorPos[lastIdx].y;
        this.currentEnemiesXOffset = resolvedEnemiesPos[lastIdx].x;
        this.currentEnemiesYOffset = resolvedEnemiesPos[lastIdx].y;
        this.currentDimArena = resolvedDarkness[lastIdx];
      } else {
        // Find segment [i, i+1] where sorted[i].timeMs <= t < sorted[i+1].timeMs
        let idx = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].timeMs <= t && t < sorted[i + 1].timeMs) {
            idx = i;
            break;
          }
        }
        const kfA = sorted[idx];
        const kfB = sorted[idx + 1];
        const dt = kfB.timeMs - kfA.timeMs;
        const alpha = dt > 0 ? (t - kfA.timeMs) / dt : 0;

        const aPosA = resolvedActorPos[idx];
        const aPosB = resolvedActorPos[idx + 1];
        this.currentActorXOffset = aPosA.x + (aPosB.x - aPosA.x) * alpha;
        this.currentActorYOffset = aPosA.y + (aPosB.y - aPosA.y) * alpha;

        const ePosA = resolvedEnemiesPos[idx];
        const ePosB = resolvedEnemiesPos[idx + 1];
        this.currentEnemiesXOffset = ePosA.x + (ePosB.x - ePosA.x) * alpha;
        this.currentEnemiesYOffset = ePosA.y + (ePosB.y - ePosA.y) * alpha;

        const darkA = resolvedDarkness[idx];
        const darkB = resolvedDarkness[idx + 1];
        this.currentDimArena = darkA + (darkB - darkA) * alpha;
      }
    }
  }
}

export const ULTIMATE_PRESETS: Record<string, UltimateSequence> = {
  hero_guitar_1: guitar1Ult as UltimateSequence,
  hero_guitar_2: guitar2Ult as UltimateSequence,
  hero_bass: bassUlt as UltimateSequence,
  hero_drums: drumsUlt as UltimateSequence,
  the_worm: theWormUlt as UltimateSequence,
  enemy_air_squid: airSquidUlt as UltimateSequence,
};
