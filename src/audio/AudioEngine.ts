import { STEM_CHANNELS, findChannelIdForFilename } from './AudioConfig';
import { StemChannel } from './StemChannel';

export class AudioEngine {
  public audioCtx: AudioContext;
  public masterGain: GainNode;
  public recordDestination: MediaStreamAudioDestinationNode;
  public channels: Map<string, StemChannel> = new Map();

  public isPlaying = false;
  private playStartTimeCtx = 0;
  private startOffsetSec = 0;
  public loop = true;
  public onStopOrPause?: () => void;

  constructor() {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.setValueAtTime(0.9, this.audioCtx.currentTime);
    this.masterGain.connect(this.audioCtx.destination);

    this.recordDestination = this.audioCtx.createMediaStreamDestination();
    this.masterGain.connect(this.recordDestination);

    for (const conf of STEM_CHANNELS) {
      const ch = new StemChannel(conf, this.audioCtx, this.masterGain);
      this.channels.set(conf.id, ch);
    }
  }

  public async resumeContext(): Promise<void> {
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  public getAudioStreamTrack(): MediaStreamTrack | null {
    const tracks = this.recordDestination.stream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  public getChannel(id: string): StemChannel | undefined {
    return this.channels.get(id);
  }

  public getChannelByHeroId(heroId: string): StemChannel | undefined {
    for (const ch of this.channels.values()) {
      if (ch.config.heroId === heroId) return ch;
    }
    return undefined;
  }

  public getDuration(): number {
    let maxDur = 0;
    for (const ch of this.channels.values()) {
      if (ch.buffer && ch.buffer.duration > maxDur) {
        maxDur = ch.buffer.duration;
      }
    }
    return maxDur;
  }

  public getCurrentTimeSec(): number {
    if (!this.isPlaying) {
      return this.startOffsetSec;
    }
    const elapsed = this.audioCtx.currentTime - this.playStartTimeCtx;
    return Math.max(0, this.startOffsetSec + elapsed);
  }

  public async play(): Promise<void> {
    await this.resumeContext();
    if (this.isPlaying) return;

    const dur = this.getDuration();
    if (dur <= 0) return;

    if (this.startOffsetSec >= dur) {
      this.startOffsetSec = 0;
    }

    const when = this.audioCtx.currentTime + 0.025; // 25ms lookahead for synchronized buffer start
    for (const ch of this.channels.values()) {
      ch.startSource(when, this.startOffsetSec);
    }

    this.playStartTimeCtx = when;
    this.isPlaying = true;
  }

  public pause(): void {
    if (!this.isPlaying) return;
    this.startOffsetSec = this.getCurrentTimeSec();
    for (const ch of this.channels.values()) {
      ch.stopSource();
      ch.resetAnalysis();
    }
    this.isPlaying = false;
    this.onStopOrPause?.();
  }

  public stop(): void {
    const wasPlaying = this.isPlaying;
    this.pause();
    this.startOffsetSec = 0;
    for (const ch of this.channels.values()) {
      ch.resetAnalysis();
    }
    if (!wasPlaying) {
      this.onStopOrPause?.();
    }
  }

  public seek(targetSec: number): void {
    const dur = this.getDuration();
    const clamped = Math.max(0, dur > 0 ? Math.min(targetSec, dur) : targetSec);

    if (this.isPlaying) {
      for (const ch of this.channels.values()) {
        ch.stopSource();
      }
      this.startOffsetSec = clamped;
      const when = this.audioCtx.currentTime + 0.025;
      for (const ch of this.channels.values()) {
        ch.startSource(when, this.startOffsetSec);
      }
      this.playStartTimeCtx = when;
    } else {
      this.startOffsetSec = clamped;
    }
  }

  public syncSoloMutes(): void {
    const anySolo = Array.from(this.channels.values()).some((ch) => ch.isSoloed);
    for (const ch of this.channels.values()) {
      ch.updateGain(anySolo);
    }
  }

  public async loadStemFromFile(channelId: string, file: File): Promise<boolean> {
    await this.resumeContext();
    const ch = this.channels.get(channelId);
    if (!ch) return false;

    try {
      const arrayBuf = await file.arrayBuffer();
      const audioBuf = await this.audioCtx.decodeAudioData(arrayBuf);
      ch.setBuffer(audioBuf, file.name);

      // If already playing, restart this channel at the current offset
      if (this.isPlaying) {
        const when = this.audioCtx.currentTime + 0.02;
        ch.startSource(when, this.getCurrentTimeSec());
      }
      return true;
    } catch (err) {
      console.error(`Failed to decode audio file ${file.name}:`, err);
      return false;
    }
  }

  public async loadMultipleFiles(files: FileList | File[]): Promise<number> {
    await this.resumeContext();
    let count = 0;
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const chId = findChannelIdForFilename(file.name);
      if (chId) {
        const ok = await this.loadStemFromFile(chId, file);
        if (ok) count++;
      }
    }
    return count;
  }

  public async preloadDefaultStems(): Promise<void> {
    let files: string[] = [];

    // 1. Try querying /api/stems endpoint (provided by Vite dev server plugin)
    try {
      const res = await fetch('/api/stems');
      if (res.ok) {
        files = await res.json();
      }
    } catch {
      // Fallback
    }

    // 2. If empty, try reading static manifest.json
    if (!files || files.length === 0) {
      try {
        const res = await fetch('/assets/audio/stems/manifest.json');
        if (res.ok) {
          files = await res.json();
        }
      } catch {
        // No manifest
      }
    }

    // 3. For each file found, check if it matches a channel pattern (e.g. "Quetzalcoatlus (guitar_1).mp3")
    const loadedChannels = new Set<string>();
    if (Array.isArray(files) && files.length > 0) {
      const loadPromises = files.map(async (filename) => {
        const channelId = findChannelIdForFilename(filename);
        if (!channelId || loadedChannels.has(channelId)) return;

        const ch = this.channels.get(channelId);
        if (!ch) return;

        try {
          const filePath = `/assets/audio/stems/${encodeURIComponent(filename)}`;
          const res = await fetch(filePath);
          if (!res.ok) return;
          const arrayBuf = await res.arrayBuffer();
          const audioBuf = await this.audioCtx.decodeAudioData(arrayBuf);
          ch.setBuffer(audioBuf, filename);
          loadedChannels.add(channelId);
        } catch (err) {
          console.warn(`Failed loading stem ${filename}:`, err);
        }
      });

      await Promise.all(loadPromises);
    }

    // 4. For any channel not loaded yet, try its direct defaultPath (e.g. guitar_1.mp3)
    const fallbackPromises = Array.from(this.channels.values())
      .filter((ch) => !loadedChannels.has(ch.config.id))
      .map(async (ch) => {
        try {
          const res = await fetch(ch.config.defaultPath);
          if (!res.ok) return;
          const arrayBuf = await res.arrayBuffer();
          const audioBuf = await this.audioCtx.decodeAudioData(arrayBuf);
          const fileName = ch.config.defaultPath.split('/').pop() || ch.config.id;
          ch.setBuffer(audioBuf, `${fileName} (Default)`);
          loadedChannels.add(ch.config.id);
        } catch {
          // Defaults not present
        }
      });

    await Promise.all(fallbackPromises);
  }

  public update(
    dtMs: number,
    dominantBalance = 0.5,
    sustainWeight = 0.4,
    sustainTimeSec = 2.0
  ): void {
    if (this.isPlaying) {
      const dur = this.getDuration();
      if (dur > 0 && this.getCurrentTimeSec() >= dur) {
        if (this.loop) {
          this.seek(0);
        } else {
          this.stop();
        }
      }
    }

    for (const ch of this.channels.values()) {
      ch.updateAnalysis(dtMs, dominantBalance, sustainWeight, sustainTimeSec);
    }
  }
}
