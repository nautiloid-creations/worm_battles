import { BattleStage } from '../engine/BattleStage';
import { AudioEngine } from './AudioEngine';

export class SpotlightArbitrator {
  private stage: BattleStage;
  private audioEngine: AudioEngine;

  // Arbitration constraints
  public minInFrontTimeMs = 1000; // 1.0 second minimum hold
  public maxNotInFrontTimeMs = 60000; // 60 seconds maximum starvation
  public allowInPlaceAttack = false; // Global toggle: attack in place from non-front position

  // Dominant Energy parameters
  public dominantBalance = 0.5; // 0.0 = Activity, 1.0 = Loudness
  public sustainWeight = 0.40; // 0.0 = 100% Instant, 1.0 = 100% Sustained (default 40% sustain)
  public sustainTimeSec = 2.0; // Flywheel integrator time constant in seconds (default 2.0s)
  public incumbentAdvantageMargin = 1.20; // Challenger must beat incumbent by 20%
  public silenceThresholdFraction = 0.25; // Level <= 25% of detection threshold is considered silence for early dropouts

  // Decay speeds
  public loudnessDecayMs = 200; // VU loudness level release decay time constant (ms)
  public activityDecayMs = 800; // Transient activity leaky bucket decay time constant (ms)

  // Dynamic attack animation speeds (specified in BPM)
  public minAttackBpm = 270; // Slow, deliberate strums (~222ms)
  public maxAttackBpm = 850; // High-speed thrash picking (~70ms)

  public get minAttackSpeedMs(): number {
    return Math.max(20, Math.round(60000 / Math.max(1, this.minAttackBpm)));
  }
  public set minAttackSpeedMs(ms: number) {
    if (ms > 0) this.minAttackBpm = Math.round(60000 / ms);
  }

  public get maxAttackSpeedMs(): number {
    return Math.max(20, Math.round(60000 / Math.max(1, this.maxAttackBpm)));
  }
  public set maxAttackSpeedMs(ms: number) {
    if (ms > 0) this.maxAttackBpm = Math.round(60000 / ms);
  }

  // State tracking
  public currentFrontHeroId = '';
  public frontTimeElapsedMs = 0;
  public notInFrontTimeMs: Map<string, number> = new Map();
  private attackHoldTimerMs: Map<string, number> = new Map();

  constructor(stage: BattleStage, audioEngine: AudioEngine) {
    this.stage = stage;
    this.audioEngine = audioEngine;

    for (const hero of stage.heroes) {
      this.notInFrontTimeMs.set(hero.config.id, 0);
      this.attackHoldTimerMs.set(hero.config.id, 0);
    }

    const frontHero = stage.getFrontHero();
    if (frontHero) {
      this.currentFrontHeroId = frontHero.config.id;
    }
  }

  public resetTimers(): void {
    this.frontTimeElapsedMs = 0;
    for (const hero of this.stage.heroes) {
      this.notInFrontTimeMs.set(hero.config.id, 0);
      this.attackHoldTimerMs.set(hero.config.id, 0);
    }
  }

  public setLoudnessDecay(ms: number): void {
    this.loudnessDecayMs = Math.max(20, ms);
    for (const ch of this.audioEngine.channels.values()) {
      ch.loudnessDecayMs = this.loudnessDecayMs;
    }
  }

  public setActivityDecay(ms: number): void {
    this.activityDecayMs = Math.max(50, ms);
    for (const ch of this.audioEngine.channels.values()) {
      ch.activityDecayMs = this.activityDecayMs;
    }
  }

  public update(dtMs: number): void {
    if (!this.audioEngine.isPlaying) {
      return;
    }

    const frontHero = this.stage.getFrontHero();
    if (!frontHero) return;

    // Track front hero changes
    if (frontHero.config.id !== this.currentFrontHeroId) {
      this.currentFrontHeroId = frontHero.config.id;
      this.frontTimeElapsedMs = 0;
    }
    this.frontTimeElapsedMs += dtMs;

    // Update starvation timers (time not spent in front)
    for (const hero of this.stage.heroes) {
      if (hero.config.id === this.currentFrontHeroId) {
        this.notInFrontTimeMs.set(hero.config.id, 0);
      } else {
        const prev = this.notInFrontTimeMs.get(hero.config.id) || 0;
        this.notInFrontTimeMs.set(hero.config.id, prev + dtMs);
      }
    }

    // Silence Forfeit Evaluation:
    // Silence is defined strictly by:
    // 1. Level is down at or below the Silence Floor (<= silenceThresholdFraction * detection threshold)
    // 2. Another band member is actively playing past threshold (hasActiveChallenger)
    // No time-since-last-hit or lingering activity delay is used, allowing instant handoff when an instrument drops out cold!
    const frontChannel = this.audioEngine.getChannelByHeroId(this.currentFrontHeroId);
    const frontScore = frontChannel ? frontChannel.dominanceScore : 0;
    const frontIsPlaying = frontChannel ? frontChannel.isPastThreshold : false;

    const silenceFloor = frontChannel
      ? frontChannel.threshold * this.silenceThresholdFraction
      : 0.03;
    const frontIsSilent = frontChannel
      ? frontChannel.currentLevel <= silenceFloor
      : true;

    // Check if any challenger is actively playing past threshold
    const hasActiveChallenger = Array.from(this.stage.heroes).some(
      (h) => h.config.id !== this.currentFrontHeroId && this.audioEngine.getChannelByHeroId(h.config.id)?.isPastThreshold
    );

    // Silence Forfeit: only fires if front is genuinely down in silence AND another member is actively playing
    const isSilenceForfeited = frontIsSilent && hasActiveChallenger;
    const canDisplaceFront = (this.frontTimeElapsedMs >= this.minInFrontTimeMs) || isSilenceForfeited;

    if (canDisplaceFront) {
      // 1. Starvation priority: if any other hero has been out of front for >= maxStarve AND is playing
      let mostStarvedHeroId: string | null = null;
      let maxStarveTime = this.maxNotInFrontTimeMs;

      for (const hero of this.stage.heroes) {
        if (hero.config.id === this.currentFrontHeroId) continue;
        const starveTime = this.notInFrontTimeMs.get(hero.config.id) || 0;
        const ch = this.audioEngine.getChannelByHeroId(hero.config.id);

        if (starveTime >= maxStarveTime && ch && (ch.isPastThreshold || ch.isOnset)) {
          maxStarveTime = starveTime;
          mostStarvedHeroId = hero.config.id;
        }
      }

      if (mostStarvedHeroId) {
        // Swap starved hero to front (starvation override ignores incumbent advantage margin)
        this.stage.triggerHeroState(mostStarvedHeroId, 'attack');
        this.currentFrontHeroId = mostStarvedHeroId;
        this.frontTimeElapsedMs = 0;
        this.notInFrontTimeMs.set(mostStarvedHeroId, 0);
      } else {
        // 2. Dominant Energy Arbitration with Incumbent Advantage
        let bestChallengerId: string | null = null;
        let highestChallengerScore = -1;

        for (const hero of this.stage.heroes) {
          if (hero.config.id === this.currentFrontHeroId) continue;
          const ch = this.audioEngine.getChannelByHeroId(hero.config.id);
          if (!ch || !ch.isPastThreshold) continue;

          if (ch.dominanceScore > highestChallengerScore) {
            highestChallengerScore = ch.dominanceScore;
            bestChallengerId = hero.config.id;
          }
        }

        // Rotate challenger to front if:
        // - Front has stopped playing, OR
        // - Silence was forfeited, OR
        // - Challenger exceeds incumbent by the advantage margin (+20%)
        if (bestChallengerId) {
          const shouldSwap =
            !frontIsPlaying ||
            isSilenceForfeited ||
            highestChallengerScore > frontScore * this.incumbentAdvantageMargin;

          if (shouldSwap) {
            this.stage.triggerHeroState(bestChallengerId, 'attack');
            this.currentFrontHeroId = bestChallengerId;
            this.frontTimeElapsedMs = 0;
            this.notInFrontTimeMs.set(bestChallengerId, 0);
          }
        }
      }
    }

    // Now update attack/idle states and dynamically scale attack animation speeds
    const activeFrontHero = this.stage.getFrontHero();
    if (!activeFrontHero) return;

    for (const hero of this.stage.heroes) {
      const isFront = hero.config.id === activeFrontHero.config.id;
      const ch = this.audioEngine.getChannelByHeroId(hero.config.id);
      let holdTimer = this.attackHoldTimerMs.get(hero.config.id) || 0;

      // Allow lunge only for front slot
      hero.canLunge = isFront;

      // Dynamically modulate attack animation interval based on transient activity density
      if (ch) {
        const normActivity = Math.min(1.0, ch.activityScore / 4.0);
        const dynamicInterval = Math.round(
          this.minAttackSpeedMs - normActivity * (this.minAttackSpeedMs - this.maxAttackSpeedMs)
        );
        hero.attackIntervalMs = Math.max(this.maxAttackSpeedMs, dynamicInterval);
      }

      if (isFront) {
        // Soloist Latch: Check if this front hero is currently the only active musical voice
        let otherTotalDominance = 0;
        for (const h of this.stage.heroes) {
          if (h.config.id === hero.config.id) continue;
          const otherCh = this.audioEngine.getChannelByHeroId(h.config.id);
          if (otherCh && otherCh.isPastThreshold) {
            otherTotalDominance += otherCh.dominanceScore;
          }
        }

        const myScore = ch ? ch.dominanceScore : 0;
        // Soloist condition: front hero has meaningful energy and accounts for >= 70% of active band dominance (or everyone else is silent)
        const isSoloist =
          myScore > 0.08 &&
          (otherTotalDominance <= 0 || myScore / (myScore + otherTotalDominance) >= 0.7);

        // Front hero attacks when past threshold or hold timer active
        if (ch && (ch.isPastThreshold || ch.isOnset)) {
          // Soloists get an extended 950ms phrase hold so clean guitar notes link together seamlessly
          holdTimer = isSoloist ? 950 : 250;
          if (hero.state !== 'attack' && hero.state !== 'ultimate') {
            hero.setState('attack');
          }
        } else {
          holdTimer = Math.max(0, holdTimer - dtMs);
          if (holdTimer <= 0 && hero.state === 'attack') {
            hero.setState('idle');
          }
        }
      } else {
        // Non-front hero
        if (this.allowInPlaceAttack && ch && ch.isPastThreshold) {
          holdTimer = 220;
          if (hero.state !== 'attack' && hero.state !== 'ultimate') {
            hero.setState('attack');
          }
        } else {
          holdTimer = Math.max(0, holdTimer - dtMs);
          if (holdTimer <= 0 && hero.state === 'attack') {
            hero.setState('idle');
          }
        }
      }

      this.attackHoldTimerMs.set(hero.config.id, holdTimer);
    }
  }
}
