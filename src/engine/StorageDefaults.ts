import type { FxConfig } from './CombatFxManager';

export interface PartyDefaults {
  heroSizes: Record<string, number>; // id -> heightFraction
  fxConfig?: FxConfig;
}

export interface SavedEnemyDef {
  type: 'the_worm' | 'air_squid';
  heightFraction: number;
}

export interface EnemiesDefaults {
  enemies: SavedEnemyDef[];
  fxConfig?: FxConfig;
}

export interface SettingsDefaults {
  arenaId: string;
  resKey: string;
  idleBpm: number;
  attackBpm: number;
  lungePx: number;
  autoHit: boolean;
  attackFxHoldOffMs?: number;
}

export interface AudioDefaults {
  allowInPlaceAttack: boolean;
  minFrontSec?: number;
  maxStarveSec?: number;
  silenceFloorPct?: number;
  dominantBalance?: number; // 0.0 (Activity) to 1.0 (Loudness)
  sustainWeightPct?: number; // 0 to 100%
  sustainTimeSec?: number; // In seconds
  loudnessDecayMs?: number;
  activityDecayMs?: number;
  minAttackBpm?: number;
  maxAttackBpm?: number;
  minAttackSpeedMs?: number;
  maxAttackSpeedMs?: number;
  channels: Record<
    string,
    {
      lowCutHz: number;
      highCutHz: number;
      threshold: number;
      detectGain?: number;
      volume: number;
      riseSensitivity?: number;
      pulseWeight?: number;
      kickThreshold?: number;
    }
  >;
}

const STORAGE_KEYS = {
  PARTY: 'worm_battles_defaults_party',
  ENEMIES: 'worm_battles_defaults_enemies',
  SETTINGS: 'worm_battles_defaults_settings',
  AUDIO: 'worm_battles_defaults_audio',
};

export function savePartyDefaults(data: PartyDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PARTY, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed saving party defaults:', err);
  }
}

export function loadPartyDefaults(): PartyDefaults | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PARTY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveEnemiesDefaults(data: EnemiesDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ENEMIES, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed saving enemies defaults:', err);
  }
}

export function loadEnemiesDefaults(): EnemiesDefaults | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ENEMIES);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSettingsDefaults(data: SettingsDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed saving settings defaults:', err);
  }
}

export function loadSettingsDefaults(): SettingsDefaults | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAudioDefaults(data: AudioDefaults): void {
  try {
    localStorage.setItem(STORAGE_KEYS.AUDIO, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed saving audio defaults:', err);
  }
}

export function loadAudioDefaults(): AudioDefaults | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUDIO);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
