import { ChannelAudioConfig } from './AudioConfig';

export class StemChannel {
  public config: ChannelAudioConfig;
  private audioCtx: AudioContext;
  private masterGainNode: GainNode;

  public buffer: AudioBuffer | null = null;
  public sourceNode: AudioBufferSourceNode | null = null;

  // 1. Audible path
  private audibleGainNode: GainNode;

  // 2. Volume envelope path (True perceived loudness, musical body intact)
  public volumeHighPass: BiquadFilterNode;
  public volumeAnalyserNode: AnalyserNode;

  // 3. Transient detector path (Specialized spectral filter + high makeup gain)
  public detectionHighPass: BiquadFilterNode;
  public detectionLowPass: BiquadFilterNode;
  public detectionGainNode: GainNode;
  public transientAnalyserNode: AnalyserNode;

  // 4. Bass drum sideband path (Narrow 50Hz bandpass filter -> kickAnalyser)
  public kickBandPass: BiquadFilterNode;
  public kickAnalyserNode: AnalyserNode;

  // Analysis buffers
  private volumeTimeDomainData: Uint8Array<ArrayBuffer>;
  private transientTimeDomainData: Uint8Array<ArrayBuffer>;
  private kickTimeDomainData: Uint8Array<ArrayBuffer>;
  private prevTransientLevel = 0;
  private prevKickLevel = 0;

  // Channel parameters
  public lowCutHz: number;
  public highCutHz: number;
  public threshold: number;
  public detectGain = 1.0; // Makeup gain for detection path only (0.2x .. 10.0x)
  public kickThreshold = 0.25; // Detection threshold on 50Hz kick energy (0..1)
  public volume = 1.0;
  public isMuted = false;
  public isSoloed = false;
  public fileName: string = 'None';

  // Live real-time analysis readouts
  public currentLevel = 0; // 0..1 for live VU meters
  public isPastThreshold = false;
  public isOnset = false;
  public isKickHit = false; // True for 1 frame when 50Hz kick thumps
  public onsetFlashTimerMs = 0; // Visual flash duration remaining (ms)
  public kickFlashTimerMs = 0; // Visual kick indicator remaining (ms)
  public timeSinceOnsetMs = 999999;
  public timeSinceKickMs = 999999;
  public activityScore = 0; // Integrated transient density (leaky bucket)
  public instantScore = 0; // Instantaneous energy: (1 - beta)*Activity + beta*Volume
  public sustainedScore = 0; // Low-pass flywheel energy follower
  public dominanceScore = 0; // Blended (1 - w_sustain)*Instant + w_sustain*Sustained

  // Dynamic decay parameters
  public loudnessDecayMs = 200; // Release time constant for VU level (ms)
  public activityDecayMs = 800; // Leaky bucket transient activity half-life/decay time constant (ms)

  // Transient detection parameters
  public riseSensitivity: number; // Min positive delta (rawLevel - prevLevel) to trigger transient
  public pulseWeight: number; // Multiplier for energy added to leaky bucket

  public get transientDensity(): number {
    return Math.min(1.0, this.activityScore / 4.0);
  }

  constructor(
    config: ChannelAudioConfig,
    audioCtx: AudioContext,
    masterGainNode: GainNode
  ) {
    this.config = config;
    this.audioCtx = audioCtx;
    this.masterGainNode = masterGainNode;

    this.lowCutHz = config.defaultLowCutHz;
    this.highCutHz = config.defaultHighCutHz;
    this.threshold = config.defaultThreshold;
    this.detectGain = config.defaultDetectGain ?? 1.0;
    this.riseSensitivity = config.defaultRiseSensitivity ?? 0.07;
    this.pulseWeight = config.defaultPulseWeight ?? 1.0;

    // 1. Audible path
    this.audibleGainNode = this.audioCtx.createGain();
    this.audibleGainNode.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
    this.audibleGainNode.connect(this.masterGainNode);

    // 2. Volume envelope path (Sub-bass rumble cut: 30Hz for bass, 70Hz for others -> volumeAnalyser)
    this.volumeHighPass = this.audioCtx.createBiquadFilter();
    this.volumeHighPass.type = 'highpass';
    const rumbleHz = config.id === 'bass' ? 30 : 70;
    this.volumeHighPass.frequency.setValueAtTime(rumbleHz, this.audioCtx.currentTime);

    this.volumeAnalyserNode = this.audioCtx.createAnalyser();
    this.volumeAnalyserNode.fftSize = 512;
    this.volumeAnalyserNode.smoothingTimeConstant = 0.2;
    this.volumeHighPass.connect(this.volumeAnalyserNode);

    // 3. Transient detection path (User Low Cut -> User High Cut -> Detect Gain -> transientAnalyser)
    this.detectionHighPass = this.audioCtx.createBiquadFilter();
    this.detectionHighPass.type = 'highpass';
    this.detectionHighPass.frequency.setValueAtTime(this.lowCutHz, this.audioCtx.currentTime);
    this.detectionHighPass.Q.setValueAtTime(0.707, this.audioCtx.currentTime);

    this.detectionLowPass = this.audioCtx.createBiquadFilter();
    this.detectionLowPass.type = 'lowpass';
    this.detectionLowPass.frequency.setValueAtTime(this.highCutHz, this.audioCtx.currentTime);
    this.detectionLowPass.Q.setValueAtTime(0.707, this.audioCtx.currentTime);

    this.detectionGainNode = this.audioCtx.createGain();
    this.detectionGainNode.gain.setValueAtTime(this.detectGain, this.audioCtx.currentTime);

    this.transientAnalyserNode = this.audioCtx.createAnalyser();
    this.transientAnalyserNode.fftSize = 512;
    this.transientAnalyserNode.smoothingTimeConstant = 0.1;

    this.detectionHighPass.connect(this.detectionLowPass);
    this.detectionLowPass.connect(this.detectionGainNode);
    this.detectionGainNode.connect(this.transientAnalyserNode);

    // 4. Bass drum sideband (50Hz narrow bandpass filter -> kickAnalyser)
    this.kickBandPass = this.audioCtx.createBiquadFilter();
    this.kickBandPass.type = 'bandpass';
    this.kickBandPass.frequency.setValueAtTime(50, this.audioCtx.currentTime);
    this.kickBandPass.Q.setValueAtTime(4.0, this.audioCtx.currentTime);

    this.kickAnalyserNode = this.audioCtx.createAnalyser();
    this.kickAnalyserNode.fftSize = 256;
    this.kickAnalyserNode.smoothingTimeConstant = 0.05;

    this.kickBandPass.connect(this.kickAnalyserNode);

    this.volumeTimeDomainData = new Uint8Array(new ArrayBuffer(this.volumeAnalyserNode.frequencyBinCount));
    this.transientTimeDomainData = new Uint8Array(new ArrayBuffer(this.transientAnalyserNode.frequencyBinCount));
    this.kickTimeDomainData = new Uint8Array(new ArrayBuffer(this.kickAnalyserNode.frequencyBinCount));
  }

  public setKickThreshold(val: number): void {
    this.kickThreshold = Math.max(0.01, Math.min(1.0, val));
  }

  public setLowCut(freqHz: number): void {
    this.lowCutHz = Math.max(0, Math.min(20000, freqHz));
    // If 0, set filter cutoff to sub-audible 10 Hz (transparent pass)
    const filterFreq = this.lowCutHz <= 0 ? 10 : this.lowCutHz;
    this.detectionHighPass.frequency.setValueAtTime(filterFreq, this.audioCtx.currentTime);
  }

  public setHighCut(freqHz: number): void {
    this.highCutHz = Math.max(500, Math.min(20000, freqHz));
    this.detectionLowPass.frequency.setValueAtTime(this.highCutHz, this.audioCtx.currentTime);
  }

  public setThreshold(val: number): void {
    this.threshold = Math.max(0.01, Math.min(1.0, val));
  }

  public setDetectGain(val: number): void {
    this.detectGain = Math.max(0.1, Math.min(60.0, val));
    this.detectionGainNode.gain.setValueAtTime(this.detectGain, this.audioCtx.currentTime);
  }

  public setRiseSensitivity(val: number): void {
    this.riseSensitivity = Math.max(0.01, Math.min(0.25, val));
  }

  public setPulseWeight(val: number): void {
    this.pulseWeight = Math.max(0.1, Math.min(5.0, val));
  }

  public setVolume(val: number): void {
    this.volume = Math.max(0, Math.min(2.0, val));
    this.updateGain();
  }

  public setMute(muted: boolean): void {
    this.isMuted = muted;
    this.updateGain();
  }

  public setSolo(soloed: boolean): void {
    this.isSoloed = soloed;
  }

  public updateGain(anySoloActive = false): void {
    let effectiveGain = this.volume;
    if (this.isMuted) {
      effectiveGain = 0;
    } else if (anySoloActive && !this.isSoloed) {
      effectiveGain = 0;
    }
    this.audibleGainNode.gain.setValueAtTime(effectiveGain, this.audioCtx.currentTime);
  }

  public setBuffer(buffer: AudioBuffer, name: string): void {
    this.buffer = buffer;
    this.fileName = name;
  }

  public startSource(whenCtxTime: number, offsetSec: number): void {
    this.stopSource();
    if (!this.buffer) return;

    const src = this.audioCtx.createBufferSource();
    src.buffer = this.buffer;

    // Connect to audible path
    src.connect(this.audibleGainNode);

    // Connect to volume envelope path (preserves musical body)
    src.connect(this.volumeHighPass);

    // Connect to transient detection path
    src.connect(this.detectionHighPass);

    // Connect to bass drum sideband path
    src.connect(this.kickBandPass);

    const safeOffset = Math.max(0, Math.min(offsetSec, this.buffer.duration));
    src.start(whenCtxTime, safeOffset);
    this.sourceNode = src;
  }

  public stopSource(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Ignored if already stopped
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  public updateAnalysis(
    dtMs: number,
    dominantBalance = 0.5,
    sustainWeight = 0.4,
    sustainTimeSec = 2.0
  ): void {
    this.timeSinceOnsetMs += dtMs;
    this.timeSinceKickMs += dtMs;
    this.isOnset = false;
    this.isKickHit = false;
    if (this.onsetFlashTimerMs > 0) {
      this.onsetFlashTimerMs = Math.max(0, this.onsetFlashTimerMs - dtMs);
    }
    if (this.kickFlashTimerMs > 0) {
      this.kickFlashTimerMs = Math.max(0, this.kickFlashTimerMs - dtMs);
    }

    // Adaptive leak on activity bucket:
    // When audio level is at the silence floor (<= 25% of threshold), decay fast so one-shot hits don't linger
    // When playing or sustaining, decay with configured activityDecayMs time constant
    const silenceFloor = this.threshold * 0.25;
    const tauMs = this.currentLevel <= silenceFloor
      ? Math.min(120, this.activityDecayMs * 0.2)
      : this.activityDecayMs;
    this.activityScore *= Math.exp(-dtMs / Math.max(20, tauMs));

    if (!this.sourceNode || !this.buffer) {
      this.currentLevel = Math.max(0, this.currentLevel - dtMs * 0.005);
      this.isPastThreshold = false;
      this.instantScore = 0;
      this.sustainedScore = 0;
      this.dominanceScore = 0;
      this.prevTransientLevel = 0;
      this.prevKickLevel = 0;
      this.isKickHit = false;
      return;
    }

    // 1. Analyze Volume Envelope (Full musical body, unpegged by detectGain)
    this.volumeAnalyserNode.getByteTimeDomainData(this.volumeTimeDomainData);
    let volSum = 0;
    const volLen = this.volumeTimeDomainData.length;
    for (let i = 0; i < volLen; i++) {
      const norm = (this.volumeTimeDomainData[i] - 128) / 128;
      volSum += norm * norm;
    }
    const volRms = Math.sqrt(volSum / volLen);
    const rawVolLevel = Math.min(1.0, volRms * 3.8);

    // Asymmetric envelope follower: snappy attack, smooth configurable exponential release
    if (rawVolLevel > this.currentLevel) {
      const attackFactor = 0.55;
      this.currentLevel = this.currentLevel * (1 - attackFactor) + rawVolLevel * attackFactor;
    } else {
      const decayCoeff = Math.exp(-dtMs / Math.max(20, this.loudnessDecayMs));
      this.currentLevel = this.currentLevel * decayCoeff + rawVolLevel * (1 - decayCoeff);
    }
    this.isPastThreshold = this.currentLevel >= this.threshold;

    // 2. Analyze Transient Detection (Filtered spectrum + high Detect Gain boost)
    this.transientAnalyserNode.getByteTimeDomainData(this.transientTimeDomainData);
    let transSum = 0;
    const transLen = this.transientTimeDomainData.length;
    for (let i = 0; i < transLen; i++) {
      const norm = (this.transientTimeDomainData[i] - 128) / 128;
      transSum += norm * norm;
    }
    const transRms = Math.sqrt(transSum / transLen);
    const rawTransientLevel = transRms * 3.8;

    // Transient detection: positive delta crossing + 50ms retrigger lockout
    // Audibility gate ensures isolated pick attacks (with high low-cut & detect gain) are caught
    // even when the main volume body hasn't crossed the main volume threshold yet
    const delta = rawTransientLevel - this.prevTransientLevel;
    const isAudible = this.currentLevel >= silenceFloor || rawTransientLevel >= 0.04;
    if (
      delta >= this.riseSensitivity &&
      isAudible &&
      this.timeSinceOnsetMs >= 50
    ) {
      this.isOnset = true;
      this.timeSinceOnsetMs = 0;
      this.onsetFlashTimerMs = 110; // Prominent ~110ms flash

      // Dynamics-aware pulse scaled by pulseWeight and strike delta
      const velocityBonus = Math.min(1.5, Math.max(0, delta / 0.4));
      this.activityScore += (0.8 + velocityBonus) * this.pulseWeight;
    }
    this.prevTransientLevel = rawTransientLevel;

    // 3. Analyze Bass Drum Sideband (50Hz narrow bandpass filter)
    this.kickAnalyserNode.getByteTimeDomainData(this.kickTimeDomainData);
    let kickSum = 0;
    const kickLen = this.kickTimeDomainData.length;
    for (let i = 0; i < kickLen; i++) {
      const norm = (this.kickTimeDomainData[i] - 128) / 128;
      kickSum += norm * norm;
    }
    const kickRms = Math.sqrt(kickSum / kickLen);
    const rawKickLevel = kickRms * 3.8;

    // Retrigger hold-off: 45ms allows fast double bass fills (up to ~260+ BPM 16th notes)
    // while preventing multiple triggers within the same 50Hz sub-oscillation cycle
    const kickDelta = rawKickLevel - this.prevKickLevel;
    if (
      rawKickLevel >= this.kickThreshold &&
      kickDelta >= 0.03 &&
      this.timeSinceKickMs >= 45
    ) {
      this.isKickHit = true;
      this.timeSinceKickMs = 0;
      this.kickFlashTimerMs = 90;
    }
    this.prevKickLevel = rawKickLevel;

    // 3. Instant Energy:
    // Balance slider: 0.0 = 100% Activity (transient density), 1.0 = 100% Loudness (volume)
    const normActivity = Math.min(1.0, this.activityScore / 4.0);
    const normVolume = this.currentLevel;

    if (this.isPastThreshold || normActivity > 0.15) {
      this.instantScore =
        (1 - dominantBalance) * normActivity + dominantBalance * normVolume;
    } else {
      this.instantScore = 0;
    }

    // 4. Sustained Energy (Flywheel / Anchor):
    // Slow energy envelope follower that integrates instant energy over sustainTimeSec
    const sustainTauMs = Math.max(100, sustainTimeSec * 1000);
    const sustainCoeff = 1 - Math.exp(-dtMs / sustainTauMs);
    this.sustainedScore += (this.instantScore - this.sustainedScore) * sustainCoeff;

    // 5. Final Dominance Score:
    // Blends instantaneous response with slow sustained phrase anchor
    const clampedSustainWeight = Math.max(0, Math.min(1.0, sustainWeight));
    this.dominanceScore =
      (1 - clampedSustainWeight) * this.instantScore +
      clampedSustainWeight * this.sustainedScore;
  }

  public resetAnalysis(): void {
    this.currentLevel = 0;
    this.prevTransientLevel = 0;
    this.prevKickLevel = 0;
    this.isPastThreshold = false;
    this.isOnset = false;
    this.isKickHit = false;
    this.onsetFlashTimerMs = 0;
    this.kickFlashTimerMs = 0;
    this.timeSinceOnsetMs = 999999;
    this.timeSinceKickMs = 999999;
    this.activityScore = 0;
    this.instantScore = 0;
    this.sustainedScore = 0;
    this.dominanceScore = 0;
  }
}
