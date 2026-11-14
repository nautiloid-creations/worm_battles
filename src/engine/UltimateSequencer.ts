import { WarpEffectType, WarpConfig } from './RasterWarpManager';
import { SpriteKey } from './SpriteActor';

import guitar1Ult from '../../assets_src/characters/guitar_1/ultimate.json';
import guitar2Ult from '../../assets_src/characters/guitar_2/ultimate.json';
import bassUlt from '../../assets_src/characters/bass/ultimate.json';
import drumsUlt from '../../assets_src/characters/drums/ultimate.json';
import theWormUlt from '../../assets_src/characters/the_worm/ultimate.json';
import airSquidUlt from '../../assets_src/characters/air_squid/ultimate.json';

export interface UltimateFxDef {
  fxId: string;
  paletteName: string;
  size: number;
  xFrac: number;
  yFrac: number;
  targetXFrac?: number;
  targetYFrac?: number;
  speed?: number; // px per ms (at 180p scale)
  facing?: 'right' | 'left';
  durationMs: number;
}

export interface UltimateKeyframe {
  timeMs: number;
  actorPose?: SpriteKey;
  actorXOffset?: number; // relative horizontal movement (px)
  actorYOffset?: number; // jump height (negative = up)
  actorShake?: number;   // vibration intensity (0 = none, 1 = subtle, 20+ = extreme)
  warp?: {
    type: WarpEffectType;
    target: 'background' | 'all';
    amplitude: number;
    frequency: number;
    speed: number;
    durationMs: number;
  };
  spawnFx?: UltimateFxDef | UltimateFxDef[];
  screenShake?: {
    intensity: number;
    durationMs: number;
  };
  dimArena?: number; // 0..1 darkness overlay
  flashWhite?: boolean;
  bossReaction?: 'hit' | 'idle' | 'downed';
}

export interface UltimateSequence {
  actorId: string;
  name: string;
  durationMs: number;
  keyframes: UltimateKeyframe[];
}

export class UltimateSequencer {
  public sequence: UltimateSequence;
  public currentTimeMs = 0;
  public isPlaying = false;
  public isLooping = true;
  public speed = 1.0;

  // Active evaluated state at currentTimeMs
  public currentActorPose: SpriteKey = 'ultimate';
  public currentActorXOffset = 0;
  public currentActorYOffset = 0;
  public currentActorShake = 0;
  public currentDimArena = 0;
  public currentWhiteFlash = false;
  public currentBossReaction: 'hit' | 'idle' | 'downed' = 'idle';
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
    this.currentActorPose = 'ultimate';
    this.currentActorXOffset = 0;
    this.currentActorYOffset = 0;
    this.currentActorShake = 0;
    this.currentDimArena = 0;
    this.currentWhiteFlash = false;
    this.currentBossReaction = 'idle';
    this.currentWarpConfig = {
      type: 'none',
      target: 'background',
      amplitude: 0,
      frequency: 0.05,
      speed: 0.005,
    };

    for (const kf of sorted) {
      if (kf.timeMs <= t) {
        if (kf.actorPose) this.currentActorPose = kf.actorPose;
        if (kf.actorXOffset !== undefined) this.currentActorXOffset = kf.actorXOffset;
        if (kf.actorYOffset !== undefined) this.currentActorYOffset = kf.actorYOffset;
        if (kf.actorShake !== undefined) this.currentActorShake = kf.actorShake;
        if (kf.dimArena !== undefined) this.currentDimArena = kf.dimArena;
        if (kf.flashWhite) this.currentWhiteFlash = t - kf.timeMs < 120;
        if (kf.bossReaction) this.currentBossReaction = kf.bossReaction;

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
          if (kf.spawnFx && !this.firedFxKeyframes.has(kf.timeMs)) {
            this.firedFxKeyframes.add(kf.timeMs);
            if (this.onSpawnFx) {
              const fxList = Array.isArray(kf.spawnFx) ? kf.spawnFx : [kf.spawnFx];
              for (const fx of fxList) {
                this.onSpawnFx(fx);
              }
            }
          }
          if (kf.screenShake && !this.firedShakeKeyframes.has(kf.timeMs)) {
            this.firedShakeKeyframes.add(kf.timeMs);
            if (this.onScreenShake) this.onScreenShake(kf.screenShake.intensity);
          }
        }
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
