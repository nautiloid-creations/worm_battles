export interface ChannelAudioConfig {
  id: string;
  name: string;
  heroId: string;
  defaultPath: string;
  namePatterns: RegExp[];
  mixerChannels: number[]; // Stored for future mixer input integration
  defaultLowCutHz: number;
  defaultHighCutHz: number;
  defaultThreshold: number;
  defaultDetectGain?: number;
  defaultRiseSensitivity?: number;
  defaultPulseWeight?: number;
}

export const STEM_CHANNELS: ChannelAudioConfig[] = [
  {
    id: 'guitar_1',
    name: 'Guitar 1',
    heroId: 'hero_guitar_1',
    defaultPath: '/assets/audio/stems/guitar_1.mp3',
    namePatterns: [/guitar[-_ ]?1/i, /gtr[-_ ]?1/i, /lead[-_ ]?guitar/i],
    mixerChannels: [3, 4], // Stereo pair
    defaultLowCutHz: 120,
    defaultHighCutHz: 4500,
    defaultThreshold: 0.18,
    defaultRiseSensitivity: 0.05,
    defaultPulseWeight: 1.0,
  },
  {
    id: 'guitar_2',
    name: 'Guitar 2',
    heroId: 'hero_guitar_2',
    defaultPath: '/assets/audio/stems/guitar_2.mp3',
    namePatterns: [/guitar[-_ ]?2/i, /gtr[-_ ]?2/i, /rhythm[-_ ]?guitar/i],
    mixerChannels: [5, 6], // Stereo pair
    defaultLowCutHz: 120,
    defaultHighCutHz: 4500,
    defaultThreshold: 0.18,
    defaultRiseSensitivity: 0.05,
    defaultPulseWeight: 1.0,
  },
  {
    id: 'bass',
    name: 'Bass',
    heroId: 'hero_bass',
    defaultPath: '/assets/audio/stems/bass.mp3',
    namePatterns: [/bass/i],
    mixerChannels: [7], // Mono
    defaultLowCutHz: 40,
    defaultHighCutHz: 900,
    defaultThreshold: 0.20,
    defaultRiseSensitivity: 0.06,
    defaultPulseWeight: 1.1,
  },
  {
    id: 'drums',
    name: 'Drums',
    heroId: 'hero_drums',
    defaultPath: '/assets/audio/stems/drums.mp3',
    namePatterns: [/drum(s)?/i, /percussion/i],
    mixerChannels: [8], // Mono
    defaultLowCutHz: 60,
    defaultHighCutHz: 6000,
    defaultThreshold: 0.22,
    defaultRiseSensitivity: 0.09,
    defaultPulseWeight: 1.4,
  },
];

export function findChannelIdForFilename(filename: string): string | null {
  for (const conf of STEM_CHANNELS) {
    if (conf.namePatterns.some((pattern) => pattern.test(filename))) {
      return conf.id;
    }
  }
  return null;
}
