import { BattleStage, RESOLUTION_PRESETS } from '../engine/BattleStage';
import { ActorState, SpriteActor } from '../engine/SpriteActor';
import { STEM_CHANNELS } from '../audio/AudioConfig';
import { FX_LIST, FX_PALETTES, FX_SIZES } from '../engine/CombatFxManager';
import { UltimateStudio } from './UltimateStudio';
import {
  savePartyDefaults,
  saveEnemiesDefaults,
  saveSettingsDefaults,
  saveAudioDefaults,
  AudioDefaults,
} from '../engine/StorageDefaults';

const STATES: { key: ActorState; label: string }[] = [
  { key: 'idle', label: 'Idle' },
  { key: 'attack', label: 'Attack' },
  { key: 'ultimate', label: 'Ultimate' },
  { key: 'hit', label: 'Hit' },
  { key: 'downed', label: 'Down' },
];

function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) sec = 0;
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Piecewise non-linear mapping for Transient Low Cut (HP):
// 0 to 100 Hz in increments of 10 (indices 0..10)
// 100 to 5000 Hz in increments of 100 (indices 11..59)
export function lowCutIndexToHz(idx: number): number {
  if (idx <= 10) return idx * 10;
  return 100 + (idx - 10) * 100;
}

export function lowCutHzToIndex(hz: number): number {
  if (hz <= 100) {
    return Math.max(0, Math.min(10, Math.round(hz / 10)));
  }
  return Math.max(10, Math.min(59, 10 + Math.round((hz - 100) / 100)));
}

export class ControlSidebar {
  private stage: BattleStage;
  private container: HTMLElement;

  private heroStateBtns: Map<string, Record<ActorState, HTMLButtonElement>> = new Map();
  private heroActiveLabels: Map<string, HTMLElement> = new Map();
  private heroSlotBadges: Map<string, HTMLElement> = new Map();

  private enemyStateBtns: Map<string, Record<ActorState, HTMLButtonElement>> = new Map();
  private enemyActiveLabels: Map<string, HTMLElement> = new Map();

  // Audio UI elements
  private isUserSeeking = false;
  private playBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private recordBtn!: HTMLButtonElement;
  private recordQualitySelect!: HTMLSelectElement;
  private timeDisplay!: HTMLElement;
  private seekSlider!: HTMLInputElement;

  // Canvas MediaRecorder
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;
  private recordingStartTimestamp = 0;
  private recTickCleanup: (() => void) | null = null;
  private recordedResolution = '';

  private channelDomMap: Map<
    string,
    {
      stripEl: HTMLElement;
      fileNameEl: HTMLElement;
      onsetDotEl: HTMLElement;
      vuFillEl: HTMLElement;
      silenceLineEl: HTMLElement;
      threshLineEl: HTMLElement;
      vuLevelEl: HTMLElement;
      densityFillEl: HTMLElement;
      densityValEl: HTMLElement;
      sustainFillEl: HTMLElement;
      sustainValEl: HTMLElement;
      vuDomEl: HTMLElement;
      vuStatusEl: HTMLElement;
      lowCutValEl: HTMLElement;
      highCutValEl: HTMLElement;
      threshValEl: HTMLElement;
      detectGainValEl: HTMLElement;
      riseValEl: HTMLElement;
      pulseValEl: HTMLElement;
      muteBtn: HTMLButtonElement;
      soloBtn: HTMLButtonElement;
    }
  > = new Map();

  public ultimateStudio?: UltimateStudio;

  constructor(stage: BattleStage, container: HTMLElement) {
    this.stage = stage;
    this.container = container;
    this.renderUI();
    this.stage.onTick(() => this.syncLiveIndicators());
  }

  private renderUI(): void {
    const resOptionsHtml = Object.entries(RESOLUTION_PRESETS)
      .map(
        ([key, p]) =>
          `<option value="${key}" ${key === this.stage.currentResKey ? 'selected' : ''}>${p.label}</option>`
      )
      .join('');

    this.container.innerHTML = `
      <div class="sidebar-header">
        <h1>WORM BATTLES</h1>
        <span class="step-badge">ARENA BATTLE UI</span>
      </div>

      <!-- MAIN MODE TABS -->
      <div class="main-mode-tabs">
        <button id="btn-mode-battle" class="mode-tab-btn active">⚔️ BATTLE STAGE</button>
        <button id="btn-mode-ultimate" class="mode-tab-btn">🎬 ULTIMATE STUDIO</button>
      </div>

      <div id="battle-stage-tab-content" class="main-tab-content">
        <!-- AUDIO & VISUALIZER CARD -->
        <section class="control-card audio-card">
        <div class="card-title-row">
          <h2>🎵 MUSIC VISUALIZER &amp; STEMS</h2>
          <div class="card-title-actions">
            <input type="file" id="batch-stem-input" multiple accept="audio/*" style="display:none;" />
            <button id="btn-batch-stems" class="btn-load-stem" title="Select multiple audio stems to auto-match by name">📂 Load Stems</button>
          </div>
        </div>
        <div class="section-actions-row">
          <button id="btn-save-audio-defaults" class="btn-save-defaults" title="Save audio cutoffs, thresholds, and options as default">💾 Save Defaults</button>
        </div>

        <!-- Master Transport Bar -->
        <div class="transport-bar">
          <div class="transport-left">
            <button id="btn-transport-play" class="transport-btn play-btn">▶ Play</button>
            <button id="btn-transport-stop" class="transport-btn stop-btn">⏹ Stop</button>
            <button id="btn-transport-record" class="transport-btn record-btn" title="Record canvas video with master audio">⏺ Record</button>
            <select id="record-quality-select" class="record-quality-select" title="Recording Quality & File Size">
              <option value="balanced" selected>Balanced (~25MB, 30fps)</option>
              <option value="compact">Compact (~15MB, Native)</option>
              <option value="hifi">Hi-Fi (~75MB, 60fps)</option>
            </select>
            <span id="audio-time-display" class="time-display">00:00 / 00:00</span>
          </div>
          <div class="transport-seek-container">
            <input type="range" id="audio-seek-slider" min="0" max="1000" value="0" />
          </div>
        </div>

        <!-- Global In-Place Attack Toggle & Arbitration Controls -->
        <div class="audio-global-options">
          <label class="checkbox-row">
            <input type="checkbox" id="toggle-inplace-attack" />
            <span>Allow In-Place Strumming (non-front actors attack in home slot)</span>
          </label>

          <div class="arbitration-controls-grid three-cols">
            <div class="setting-item">
              <label for="input-min-front" class="input-entry-label">Min Front Hold (sec):</label>
              <input type="number" id="input-min-front" class="num-entry-input" min="0.1" max="60" step="0.1" value="${(this.stage.arbitrator.minInFrontTimeMs / 1000).toFixed(1)}" />
            </div>

            <div class="setting-item">
              <label for="input-max-starve" class="input-entry-label">Max Starve (sec):</label>
              <input type="number" id="input-max-starve" class="num-entry-input" min="1" max="600" step="1" value="${Math.round(this.stage.arbitrator.maxNotInFrontTimeMs / 1000)}" />
            </div>

            <div class="setting-item">
              <label for="input-silence-floor" class="input-entry-label">Silence Floor (%):</label>
              <input type="number" id="input-silence-floor" class="num-entry-input" min="5" max="50" step="1" value="${Math.round(this.stage.arbitrator.silenceThresholdFraction * 100)}" title="Level below this % of threshold is silence for instant dropouts" />
            </div>
          </div>

          <!-- Dominant Energy Balance (Activity vs Loudness) -->
          <div class="setting-item full-width dominant-balance-item">
            <div class="setting-label-row">
              <span>Dominant Energy Balance:</span>
              <span id="dominant-balance-val" class="tempo-display">${Math.round((1 - this.stage.arbitrator.dominantBalance) * 100)}% Act / ${Math.round(this.stage.arbitrator.dominantBalance * 100)}% Loud</span>
            </div>
            <div class="balance-slider-container">
              <span class="balance-edge-label">⚡ Activity</span>
              <input type="range" id="slider-dominant-balance" min="0" max="100" value="${Math.round(this.stage.arbitrator.dominantBalance * 100)}" />
              <span class="balance-edge-label">🔊 Loudness</span>
            </div>
          </div>

          <!-- Sustained Energy Follower (Flywheel Anchor) -->
          <div class="arbitration-controls-grid">
            <div class="setting-item">
              <label for="input-sustain-weight" class="input-entry-label">Sustain Weight (%):</label>
              <input type="number" id="input-sustain-weight" class="num-entry-input" min="0" max="100" step="5" value="${Math.round(this.stage.arbitrator.sustainWeight * 100)}" title="How much phrase sustain anchors front dominance vs instant hits" />
            </div>

            <div class="setting-item">
              <label for="input-sustain-time" class="input-entry-label">Sustain Time (sec):</label>
              <input type="number" id="input-sustain-time" class="num-entry-input" min="0.2" max="10.0" step="0.1" value="${this.stage.arbitrator.sustainTimeSec.toFixed(1)}" title="Time constant for slow energy flywheel (phrase memory)" />
            </div>
          </div>

          <!-- Decay Speeds (Loudness Release & Activity Decay) -->
          <div class="arbitration-controls-grid">
            <div class="setting-item">
              <label for="input-loudness-decay" class="input-entry-label">Loudness Decay (ms):</label>
              <input type="number" id="input-loudness-decay" class="num-entry-input" min="20" max="2000" step="10" value="${this.stage.arbitrator.loudnessDecayMs}" title="Release decay speed for volume VU meter in milliseconds" />
            </div>

            <div class="setting-item">
              <label for="input-activity-decay" class="input-entry-label">Activity Decay (ms):</label>
              <input type="number" id="input-activity-decay" class="num-entry-input" min="50" max="5000" step="25" value="${this.stage.arbitrator.activityDecayMs}" title="Transient density leaky bucket memory in milliseconds" />
            </div>
          </div>

          <!-- Dynamic Attack Speed Range (BPM) -->
          <div class="arbitration-controls-grid">
            <div class="setting-item">
              <label for="input-min-atk-bpm" class="input-entry-label">Min Attack Speed (BPM):</label>
              <input type="number" id="input-min-atk-bpm" class="num-entry-input" min="60" max="1500" step="5" value="${this.stage.arbitrator.minAttackBpm}" title="Slowest strumming frame rate in BPM" />
            </div>

            <div class="setting-item">
              <label for="input-max-atk-bpm" class="input-entry-label">Max Attack Speed (BPM):</label>
              <input type="number" id="input-max-atk-bpm" class="num-entry-input" min="60" max="2000" step="5" value="${this.stage.arbitrator.maxAttackBpm}" title="Fastest shredding frame rate in BPM" />
            </div>
          </div>
        </div>

        <!-- Meter Legend -->
        <div class="meter-legend-row">
          <span class="legend-label">Meters:</span>
          <span class="legend-item" title="Volume Envelope (Loudness)">🔊 Vol</span>
          <span class="legend-item" title="Filtered &amp; Gained Transient Activity">⚡ Act</span>
          <span class="legend-item" title="Slow Flywheel Sustained Energy">⚓ Sus</span>
          <span class="legend-item"><span class="legend-pill legend-silence"></span> Silence Floor</span>
          <span class="legend-item"><span class="legend-pill legend-thresh"></span> Attack Thresh</span>
        </div>

        <!-- 4 Channel Strips Grid -->
        <div id="channel-strips-grid" class="channel-strips-grid"></div>
      </section>

      <!-- PARTY CARD -->
      <section class="control-card party-card">
        <div class="card-title-row">
          <h2>🎸 BAND MEMBERS</h2>
          <span class="card-subtitle">Cluster Left • Direct Swap to Front on Attack</span>
        </div>
        <div class="section-actions-row">
          <button id="btn-save-party-defaults" class="btn-save-defaults" title="Save band member sizes as default">💾 Save Defaults</button>
        </div>
        <div class="section-fx-row">
          <span class="section-fx-label">⚡ Attack FX:</span>
          <select id="hero-fx-select" class="fx-select" title="Choose Attack Effect"></select>
          <select id="hero-fx-palette" class="fx-select" title="Choose Effect Palette"></select>
          <select id="hero-fx-size" class="fx-select" title="Choose Effect Size"></select>
        </div>
        <div id="party-columns" class="columns-grid four-cols"></div>
      </section>

      <!-- ENEMIES CARD -->
      <section class="control-card enemies-card">
        <div class="card-title-row">
          <h2>👾 ENEMIES <span id="enemy-count-badge" class="count-badge">(${this.stage.enemies.length}/8)</span></h2>
          <span class="card-subtitle">Cluster Right • Up to 8 Enemies</span>
        </div>
        <div class="section-actions-row">
          <button id="btn-save-enemies-defaults" class="btn-save-defaults" title="Save enemy roster and sizes as default">💾 Save Defaults</button>
        </div>
        <div class="section-fx-row">
          <span class="section-fx-label">⚡ Attack FX:</span>
          <select id="enemy-fx-select" class="fx-select" title="Choose Attack Effect"></select>
          <select id="enemy-fx-palette" class="fx-select" title="Choose Effect Palette"></select>
          <select id="enemy-fx-size" class="fx-select" title="Choose Effect Size"></select>
        </div>
        <div id="enemies-scroll-container" class="enemies-scroll">
          <div id="enemy-columns" class="columns-grid"></div>
        </div>
      </section>

      <!-- TIMING & SPRITE SETTINGS CARD -->
      <section class="control-card settings-card">
        <div class="card-title-row">
          <h2>⚙️ CANVAS &amp; TIMING SETTINGS</h2>
        </div>
        <div class="section-actions-row">
          <button id="btn-save-settings-defaults" class="btn-save-defaults" title="Save arena, resolution, and tempo settings as default">💾 Save Defaults</button>
        </div>

        <div class="settings-grid">
          <!-- Arena Selection -->
          <div class="setting-item full-width">
            <div class="setting-label-row">
              <span>Battle Arena:</span>
              <span id="arena-name-display" class="tempo-display">${this.stage.currentArenaId === 'stage_1' ? '🌌 Synthwave Horizon' : '🏜️ Desert Dunes'}</span>
            </div>
            <select id="select-arena" class="resolution-select">
              <option value="desert" ${this.stage.currentArenaId === 'desert' ? 'selected' : ''}>🏜️ Desert Dunes</option>
              <option value="stage_1" ${this.stage.currentArenaId === 'stage_1' ? 'selected' : ''}>🌌 Synthwave Horizon</option>
            </select>
          </div>

          <!-- Canvas Resolution (Master Quality Control) -->
          <div class="setting-item full-width">
            <div class="setting-label-row">
              <span>Canvas Resolution:</span>
              <span id="res-mode-display" class="tempo-display">${RESOLUTION_PRESETS[this.stage.currentResKey]?.label || RESOLUTION_PRESETS['320x180'].label}</span>
            </div>
            <select id="select-canvas-resolution" class="resolution-select">
              ${resOptionsHtml}
            </select>
          </div>

          <!-- Idle Tempo -->
          <div class="setting-item">
            <div class="setting-label-row">
              <span>Idle Tempo:</span>
              <span id="idle-tempo-val" class="tempo-display">${Math.round(60000 / this.stage.idleIntervalMs)} BPM (${this.stage.idleIntervalMs}ms)</span>
            </div>
            <input type="range" id="slider-idle-bpm" min="40" max="240" value="${Math.round(60000 / this.stage.idleIntervalMs)}" />
          </div>

          <!-- Attack Tempo -->
          <div class="setting-item">
            <div class="setting-label-row">
              <span>Attack Tempo:</span>
              <span id="attack-tempo-val" class="tempo-display">${Math.round(60000 / this.stage.attackIntervalMs)} BPM (${this.stage.attackIntervalMs}ms)</span>
            </div>
            <input type="range" id="slider-attack-bpm" min="80" max="600" value="${Math.round(60000 / this.stage.attackIntervalMs)}" />
          </div>

          <!-- Base Lunge Distance -->
          <div class="setting-item full-width">
            <div class="setting-label-row">
              <span>Lunge Reach (180p base):</span>
              <span id="lunge-val">${this.stage.baseLungeDistance}px</span>
            </div>
            <input type="range" id="slider-lunge" min="0" max="60" value="${this.stage.baseLungeDistance}" />
          </div>

          <!-- Attack FX Hold-Off -->
          <div class="setting-item full-width">
            <div class="setting-label-row">
              <span>Attack FX Hold-Off:</span>
              <span id="fx-holdoff-val" class="tempo-display">${this.stage.attackFxHoldOffMs}ms</span>
            </div>
            <input type="range" id="slider-fx-holdoff" min="50" max="1000" step="25" value="${this.stage.attackFxHoldOffMs}" title="Minimum cooldown between damage numbers and spark effects" />
          </div>
        </div>

        <label class="checkbox-row">
          <input type="checkbox" id="toggle-auto-hit" ${this.stage.autoHitOpponent ? 'checked' : ''} />
          <span>Attacks automatically trigger target's <code>hit.png</code> &amp; sparks</span>
        </label>
      </section>
      </div><!-- /#battle-stage-tab-content -->

      <div id="ultimate-studio-tab-content" class="main-tab-content" style="display:none;"></div>
    `;

    this.renderAudioCard();
    this.renderPartyColumns();
    this.renderEnemyColumns();
    this.bindSettingsControls();

    // Initialize Ultimate Studio Designer
    const studioContainer = this.container.querySelector<HTMLElement>('#ultimate-studio-tab-content');
    if (studioContainer) {
      this.ultimateStudio = new UltimateStudio(this.stage, studioContainer);
    }

    const btnBattle = this.container.querySelector<HTMLButtonElement>('#btn-mode-battle');
    const btnUltimate = this.container.querySelector<HTMLButtonElement>('#btn-mode-ultimate');
    const battleContent = this.container.querySelector<HTMLElement>('#battle-stage-tab-content');
    const ultimateContent = this.container.querySelector<HTMLElement>('#ultimate-studio-tab-content');

    btnBattle?.addEventListener('click', () => {
      btnBattle.classList.add('active');
      btnUltimate?.classList.remove('active');
      if (battleContent) battleContent.style.display = '';
      if (ultimateContent) ultimateContent.style.display = 'none';
      this.stage.isUltimateStudioMode = false;
      this.stage.resetActorsAndTimers();
    });

    btnUltimate?.addEventListener('click', () => {
      btnUltimate.classList.add('active');
      btnBattle?.classList.remove('active');
      if (battleContent) battleContent.style.display = 'none';
      if (ultimateContent) ultimateContent.style.display = '';
      this.stage.isUltimateStudioMode = true;
      if (this.stage.audioEngine.isPlaying) {
        this.stage.audioEngine.pause();
      }
      this.stage.ultimateSequencer.seek(this.stage.ultimateSequencer.currentTimeMs);
      this.stage.syncStudioFx();
      // Reload sprites with fresh cache-busting
      Promise.all([
        ...this.stage.heroes.map((h) => h.loadSprites(true)),
        ...this.stage.enemies.map((e) => e.loadSprites(true)),
      ]).then(() => {
        this.stage.syncStudioFx();
      });
    });
  }

  private renderAudioCard(): void {
    this.playBtn = this.container.querySelector<HTMLButtonElement>('#btn-transport-play')!;
    this.stopBtn = this.container.querySelector<HTMLButtonElement>('#btn-transport-stop')!;
    this.recordBtn = this.container.querySelector<HTMLButtonElement>('#btn-transport-record')!;
    this.recordQualitySelect = this.container.querySelector<HTMLSelectElement>('#record-quality-select')!;
    const savedQuality = localStorage.getItem('wb_record_quality') || 'balanced';
    if (this.recordQualitySelect) {
      this.recordQualitySelect.value = savedQuality;
      this.recordQualitySelect.addEventListener('change', () => {
        localStorage.setItem('wb_record_quality', this.recordQualitySelect.value);
      });
    }
    this.timeDisplay = this.container.querySelector<HTMLElement>('#audio-time-display')!;
    this.seekSlider = this.container.querySelector<HTMLInputElement>('#audio-seek-slider')!;

    // Batch stem loader & Drag-and-drop
    const batchInput = this.container.querySelector<HTMLInputElement>('#batch-stem-input')!;
    const batchBtn = this.container.querySelector<HTMLButtonElement>('#btn-batch-stems')!;
    batchBtn.addEventListener('click', () => batchInput.click());
    batchInput.addEventListener('change', async () => {
      if (batchInput.files && batchInput.files.length > 0) {
        await this.stage.audioEngine.loadMultipleFiles(batchInput.files);
      }
    });

    const audioCard = this.container.querySelector<HTMLElement>('.audio-card')!;
    audioCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      audioCard.classList.add('drag-over');
    });
    audioCard.addEventListener('dragleave', () => {
      audioCard.classList.remove('drag-over');
    });
    audioCard.addEventListener('drop', async (e) => {
      e.preventDefault();
      audioCard.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        await this.stage.audioEngine.loadMultipleFiles(e.dataTransfer.files);
      }
    });

    const inplaceToggle = this.container.querySelector<HTMLInputElement>('#toggle-inplace-attack')!;
    inplaceToggle.checked = this.stage.arbitrator.allowInPlaceAttack;
    inplaceToggle.addEventListener('change', () => {
      this.stage.arbitrator.allowInPlaceAttack = inplaceToggle.checked;
    });

    // Min Front & Max Starve Text Inputs
    const minFrontInput = this.container.querySelector<HTMLInputElement>('#input-min-front');
    if (minFrontInput) {
      minFrontInput.addEventListener('input', () => {
        const sec = parseFloat(minFrontInput.value);
        if (!isNaN(sec) && sec >= 0.1) {
          this.stage.arbitrator.minInFrontTimeMs = Math.round(sec * 1000);
        }
      });
    }

    const maxStarveInput = this.container.querySelector<HTMLInputElement>('#input-max-starve');
    if (maxStarveInput) {
      maxStarveInput.addEventListener('input', () => {
        const sec = parseFloat(maxStarveInput.value);
        if (!isNaN(sec) && sec >= 1) {
          this.stage.arbitrator.maxNotInFrontTimeMs = Math.round(sec * 1000);
        }
      });
    }

    const silenceFloorInput = this.container.querySelector<HTMLInputElement>('#input-silence-floor');
    if (silenceFloorInput) {
      silenceFloorInput.addEventListener('input', () => {
        const pct = parseInt(silenceFloorInput.value, 10);
        if (!isNaN(pct) && pct >= 1 && pct <= 100) {
          this.stage.arbitrator.silenceThresholdFraction = pct / 100;
          for (const conf of STEM_CHANNELS) {
            const ch = this.stage.audioEngine.getChannel(conf.id);
            const dom = this.channelDomMap.get(conf.id);
            if (ch && dom) {
              const sPct = ch.threshold * this.stage.arbitrator.silenceThresholdFraction * 100;
              dom.silenceLineEl.style.left = `${sPct.toFixed(1)}%`;
            }
          }
        }
      });
    }

    // Dominant Energy Balance Slider
    const balanceSlider = this.container.querySelector<HTMLInputElement>('#slider-dominant-balance');
    const balanceVal = this.container.querySelector<HTMLElement>('#dominant-balance-val');
    if (balanceSlider && balanceVal) {
      balanceSlider.addEventListener('input', () => {
        const pct = Number(balanceSlider.value);
        this.stage.arbitrator.dominantBalance = pct / 100;
        balanceVal.textContent = `${100 - pct}% Act / ${pct}% Loud`;
      });
    }

    // Sustain Weight & Sustain Time Inputs
    const sustainWeightInput = this.container.querySelector<HTMLInputElement>('#input-sustain-weight');
    if (sustainWeightInput) {
      sustainWeightInput.addEventListener('input', () => {
        const pct = parseInt(sustainWeightInput.value, 10);
        if (!isNaN(pct) && pct >= 0 && pct <= 100) {
          this.stage.arbitrator.sustainWeight = pct / 100;
        }
      });
    }

    const sustainTimeInput = this.container.querySelector<HTMLInputElement>('#input-sustain-time');
    if (sustainTimeInput) {
      sustainTimeInput.addEventListener('input', () => {
        const sec = parseFloat(sustainTimeInput.value);
        if (!isNaN(sec) && sec >= 0.1 && sec <= 30) {
          this.stage.arbitrator.sustainTimeSec = sec;
        }
      });
    }

    // Decay Speeds (Loudness & Activity)
    const loudnessDecayInput = this.container.querySelector<HTMLInputElement>('#input-loudness-decay');
    if (loudnessDecayInput) {
      loudnessDecayInput.addEventListener('input', () => {
        const ms = parseInt(loudnessDecayInput.value, 10);
        if (!isNaN(ms) && ms >= 20) {
          this.stage.arbitrator.setLoudnessDecay(ms);
        }
      });
    }

    const activityDecayInput = this.container.querySelector<HTMLInputElement>('#input-activity-decay');
    if (activityDecayInput) {
      activityDecayInput.addEventListener('input', () => {
        const ms = parseInt(activityDecayInput.value, 10);
        if (!isNaN(ms) && ms >= 50) {
          this.stage.arbitrator.setActivityDecay(ms);
        }
      });
    }

    // Dynamic Attack Speed Range (BPM Text Inputs)
    const minAtkBpmInput = this.container.querySelector<HTMLInputElement>('#input-min-atk-bpm');
    if (minAtkBpmInput) {
      minAtkBpmInput.addEventListener('input', () => {
        const bpm = parseInt(minAtkBpmInput.value, 10);
        if (!isNaN(bpm) && bpm >= 20) {
          this.stage.arbitrator.minAttackBpm = bpm;
        }
      });
    }

    const maxAtkBpmInput = this.container.querySelector<HTMLInputElement>('#input-max-atk-bpm');
    if (maxAtkBpmInput) {
      maxAtkBpmInput.addEventListener('input', () => {
        const bpm = parseInt(maxAtkBpmInput.value, 10);
        if (!isNaN(bpm) && bpm >= 20) {
          this.stage.arbitrator.maxAttackBpm = bpm;
        }
      });
    }

    // Save Audio Defaults
    const saveAudioBtn = this.container.querySelector<HTMLButtonElement>('#btn-save-audio-defaults');
    if (saveAudioBtn) {
      saveAudioBtn.addEventListener('click', () => {
        const channels: AudioDefaults['channels'] = {};
        for (const [id, ch] of this.stage.audioEngine.channels.entries()) {
          channels[id] = {
            lowCutHz: ch.lowCutHz,
            highCutHz: ch.highCutHz,
            threshold: ch.threshold,
            detectGain: ch.detectGain,
            volume: ch.volume,
            riseSensitivity: ch.riseSensitivity,
            pulseWeight: ch.pulseWeight,
            kickThreshold: ch.kickThreshold,
          };
        }
        saveAudioDefaults({
          allowInPlaceAttack: this.stage.arbitrator.allowInPlaceAttack,
          minFrontSec: this.stage.arbitrator.minInFrontTimeMs / 1000,
          maxStarveSec: this.stage.arbitrator.maxNotInFrontTimeMs / 1000,
          silenceFloorPct: Math.round(this.stage.arbitrator.silenceThresholdFraction * 100),
          dominantBalance: this.stage.arbitrator.dominantBalance,
          sustainWeightPct: Math.round(this.stage.arbitrator.sustainWeight * 100),
          sustainTimeSec: this.stage.arbitrator.sustainTimeSec,
          loudnessDecayMs: this.stage.arbitrator.loudnessDecayMs,
          activityDecayMs: this.stage.arbitrator.activityDecayMs,
          minAttackBpm: this.stage.arbitrator.minAttackBpm,
          maxAttackBpm: this.stage.arbitrator.maxAttackBpm,
          channels,
        });
        this.flashSavedBtn(saveAudioBtn);
      });
    }

    this.playBtn.addEventListener('click', async () => {
      if (this.stage.audioEngine.isPlaying) {
        this.stage.audioEngine.pause();
        this.stage.resetActorsAndTimers();
      } else {
        await this.stage.audioEngine.play();
      }
    });

    this.stopBtn.addEventListener('click', () => {
      this.stage.audioEngine.stop();
      this.stage.resetActorsAndTimers();
    });

    this.recordBtn.addEventListener('click', async () => {
      if (this.isRecording) {
        this.stopRecording();
      } else {
        await this.startRecording();
      }
    });

    this.seekSlider.addEventListener('mousedown', () => {
      this.isUserSeeking = true;
    });

    this.seekSlider.addEventListener('input', () => {
      const dur = this.stage.audioEngine.getDuration();
      const targetSec = (Number(this.seekSlider.value) / 1000) * dur;
      this.timeDisplay.textContent = `${formatTime(targetSec)} / ${formatTime(dur)}`;
    });

    this.seekSlider.addEventListener('change', () => {
      const dur = this.stage.audioEngine.getDuration();
      const targetSec = (Number(this.seekSlider.value) / 1000) * dur;
      this.stage.audioEngine.seek(targetSec);
      this.isUserSeeking = false;
    });

    // Render the 4 channel strips
    const gridEl = this.container.querySelector<HTMLElement>('#channel-strips-grid')!;
    gridEl.innerHTML = '';
    this.channelDomMap.clear();

    for (const conf of STEM_CHANNELS) {
      const ch = this.stage.audioEngine.getChannel(conf.id);
      if (!ch) continue;

      const strip = document.createElement('div');
      strip.className = 'channel-strip';
      strip.setAttribute('data-channel-id', conf.id);

      strip.innerHTML = `
        <div class="strip-header">
          <div class="strip-title-col">
            <div class="channel-name-row">
              <span class="channel-name">${conf.name.toUpperCase()}</span>
              <span class="channel-onset-badge" data-onset-badge="${conf.id}" title="Transient Hit Detected">⚡</span>
              ${conf.id === 'drums' ? '<span class="channel-kick-badge" data-kick-badge="drums" title="50Hz Bass Drum Hit Detected (Screen Shake)">🥁</span>' : ''}
            </div>
            <span class="channel-filename" data-stem-name="${conf.id}">${ch.fileName}</span>
          </div>
          <input type="file" accept="audio/*" class="stem-file-input" data-file-input="${conf.id}" style="display:none;" />
          <button class="btn-load-stem" data-load-btn="${conf.id}" title="Load audio stem file">📁 Load</button>
        </div>

        <!-- Real-Time Loudness & Transient Density Meters -->
        <div class="vu-meter-wrap">
          <!-- Loudness Meter -->
          <div class="meter-row" title="Loudness (Volume RMS)">
            <span class="meter-icon">🔊</span>
            <div class="vu-meter-track" data-vu-track="${conf.id}">
              <div class="vu-meter-fill" data-vu-fill="${conf.id}"></div>
              <div class="vu-silence-line" data-silence-line="${conf.id}" style="left: ${(ch.threshold * this.stage.arbitrator.silenceThresholdFraction * 100).toFixed(1)}%;" title="Silence Floor"></div>
              <div class="vu-threshold-line" data-thresh-line="${conf.id}" style="left: ${Math.round(ch.threshold * 100)}%;" title="Attack Threshold"></div>
            </div>
            <span class="vu-level-val meter-val-text" data-vu-val="${conf.id}">0%</span>
          </div>

          <!-- Transient Density (Activity) Meter -->
          <div class="meter-row" title="Transient Density (Pick/Strike Activity after Filter &amp; Detect Gain)">
            <span class="meter-icon" title="Transient Activity">⚡</span>
            <div class="vu-meter-track density-track" data-density-track="${conf.id}">
              <div class="vu-density-fill" data-density-fill="${conf.id}"></div>
            </div>
            <span class="density-val meter-val-text" data-density-val="${conf.id}">0%</span>
          </div>

          <!-- Sustained Energy Meter -->
          <div class="meter-row" title="Sustained Energy (Slow Flywheel Phrase Anchor)">
            <span class="meter-icon" title="Sustained Energy">⚓</span>
            <div class="vu-meter-track sustain-track" data-sustain-track="${conf.id}">
              <div class="vu-sustain-fill" data-sustain-fill="${conf.id}"></div>
            </div>
            <span class="sustain-val meter-val-text" data-sustain-val="${conf.id}">0%</span>
          </div>

          <div class="vu-readout">
            <span class="vu-dom-badge" data-vu-dom="${conf.id}" title="Dominance Score">DOM: 0%</span>
            <span class="vu-status-badge" data-vu-status="${conf.id}">IDLE</span>
          </div>
        </div>

        <!-- Filter & Transient Controls -->
        <div class="filter-controls-group">
          <div class="param-row">
            <div class="param-label-row">
              <span title="Cuts frequencies below this point for transient detector">Transient Low Cut (HP):</span>
              <span class="param-val" data-lowcut-val="${conf.id}">${ch.lowCutHz} Hz</span>
            </div>
            <input type="range" class="param-slider" data-lowcut-input="${conf.id}" min="0" max="59" step="1" value="${lowCutHzToIndex(ch.lowCutHz)}" title="0 to 100 Hz in steps of 10, then 100 to 5000 Hz in steps of 100" />
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span title="Cuts frequencies above this point for transient detector">Transient High Cut (LP):</span>
              <span class="param-val" data-highcut-val="${conf.id}">${ch.highCutHz} Hz</span>
            </div>
            <input type="range" class="param-slider" data-highcut-input="${conf.id}" min="1000" max="10000" step="100" value="${ch.highCutHz}" title="1,000 to 10,000 Hz in steps of 100" />
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span title="Preamp boost strictly for transient strike detector (does not color audible sound)">Detect Gain:</span>
              <span class="param-val" data-detectgain-val="${conf.id}">${ch.detectGain.toFixed(1)}x</span>
            </div>
            <input type="range" class="param-slider" data-detectgain-input="${conf.id}" min="0.5" max="50.0" step="0.5" value="${ch.detectGain}" title="Boost filtered pick spikes (up to 50x) for reliable detection" />
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span title="Positive level jump (Δ) needed to trigger transient hit">Rise Sens (Δ):</span>
              <span class="param-val" data-rise-val="${conf.id}">${ch.riseSensitivity.toFixed(2)}</span>
            </div>
            <input type="range" class="param-slider" data-rise-input="${conf.id}" min="0.01" max="0.25" step="0.01" value="${ch.riseSensitivity}" title="Lower = sensitive for distorted guitar, Higher = stiff for punchy drums" />
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span title="Energy multiplier added to activity bucket per strike">Pulse Weight:</span>
              <span class="param-val" data-pulse-val="${conf.id}">${ch.pulseWeight.toFixed(1)}x</span>
            </div>
            <input type="range" class="param-slider" data-pulse-input="${conf.id}" min="0.2" max="3.0" step="0.1" value="${ch.pulseWeight}" title="How much activity each hit adds into the bucket" />
          </div>

          <div class="param-row">
            <div class="param-label-row">
              <span title="Volume gate threshold on the Loudness bar (determines when instrument is active)">Volume Threshold:</span>
              <span class="param-val" data-thresh-val="${conf.id}">${Math.round(ch.threshold * 100)}%</span>
            </div>
            <input type="range" class="param-slider" data-thresh-input="${conf.id}" min="1" max="100" value="${Math.round(ch.threshold * 100)}" />
          </div>

          ${conf.id === 'drums' ? `
            <div class="param-row bass-drum-param-row">
              <div class="param-label-row">
                <span title="Threshold on 50Hz narrow bandpass filter for triggering screen shake strictly on bass drum hits">Bass Drum Thresh (50Hz):</span>
                <span class="param-val" data-kickthresh-val="${conf.id}">${Math.round(ch.kickThreshold * 100)}%</span>
              </div>
              <input type="range" class="param-slider kick-thresh-slider" data-kickthresh-input="${conf.id}" min="5" max="100" value="${Math.round(ch.kickThreshold * 100)}" title="Triggers screen shake on 50Hz kick hits" />
            </div>
          ` : ''}
        </div>

        <!-- Strip Footer: Mute, Solo, Volume -->
        <div class="strip-footer">
          <button class="strip-btn btn-mute" data-mute-btn="${conf.id}" title="Mute channel">M</button>
          <button class="strip-btn btn-solo" data-solo-btn="${conf.id}" title="Solo channel">S</button>
          <div class="strip-vol-wrap">
            <input type="range" class="strip-vol-slider" data-vol-input="${conf.id}" min="0" max="150" value="100" title="Audible volume" />
          </div>
        </div>
      `;

      gridEl.appendChild(strip);

      // DOM refs
      const stripEl = strip;
      const onsetDotEl = strip.querySelector<HTMLElement>(`[data-onset-badge="${conf.id}"]`)!;
      const fileNameEl = strip.querySelector<HTMLElement>(`[data-stem-name="${conf.id}"]`)!;
      const fileInput = strip.querySelector<HTMLInputElement>(`[data-file-input="${conf.id}"]`)!;
      const loadBtn = strip.querySelector<HTMLButtonElement>(`[data-load-btn="${conf.id}"]`)!;
      const vuFillEl = strip.querySelector<HTMLElement>(`[data-vu-fill="${conf.id}"]`)!;
      const silenceLineEl = strip.querySelector<HTMLElement>(`[data-silence-line="${conf.id}"]`)!;
      const threshLineEl = strip.querySelector<HTMLElement>(`[data-thresh-line="${conf.id}"]`)!;
      const vuLevelEl = strip.querySelector<HTMLElement>(`[data-vu-val="${conf.id}"]`)!;
      const densityFillEl = strip.querySelector<HTMLElement>(`[data-density-fill="${conf.id}"]`)!;
      const densityValEl = strip.querySelector<HTMLElement>(`[data-density-val="${conf.id}"]`)!;
      const sustainFillEl = strip.querySelector<HTMLElement>(`[data-sustain-fill="${conf.id}"]`)!;
      const sustainValEl = strip.querySelector<HTMLElement>(`[data-sustain-val="${conf.id}"]`)!;
      const vuDomEl = strip.querySelector<HTMLElement>(`[data-vu-dom="${conf.id}"]`)!;
      const vuStatusEl = strip.querySelector<HTMLElement>(`[data-vu-status="${conf.id}"]`)!;
      const lowCutValEl = strip.querySelector<HTMLElement>(`[data-lowcut-val="${conf.id}"]`)!;
      const lowCutSlider = strip.querySelector<HTMLInputElement>(`[data-lowcut-input="${conf.id}"]`)!;
      const highCutValEl = strip.querySelector<HTMLElement>(`[data-highcut-val="${conf.id}"]`)!;
      const highCutSlider = strip.querySelector<HTMLInputElement>(`[data-highcut-input="${conf.id}"]`)!;
      const threshValEl = strip.querySelector<HTMLElement>(`[data-thresh-val="${conf.id}"]`)!;
      const threshSlider = strip.querySelector<HTMLInputElement>(`[data-thresh-input="${conf.id}"]`)!;
      const detectGainValEl = strip.querySelector<HTMLElement>(`[data-detectgain-val="${conf.id}"]`)!;
      const detectGainSlider = strip.querySelector<HTMLInputElement>(`[data-detectgain-input="${conf.id}"]`)!;
      const riseValEl = strip.querySelector<HTMLElement>(`[data-rise-val="${conf.id}"]`)!;
      const riseSlider = strip.querySelector<HTMLInputElement>(`[data-rise-input="${conf.id}"]`)!;
      const pulseValEl = strip.querySelector<HTMLElement>(`[data-pulse-val="${conf.id}"]`)!;
      const pulseSlider = strip.querySelector<HTMLInputElement>(`[data-pulse-input="${conf.id}"]`)!;
      const muteBtn = strip.querySelector<HTMLButtonElement>(`[data-mute-btn="${conf.id}"]`)!;
      const soloBtn = strip.querySelector<HTMLButtonElement>(`[data-solo-btn="${conf.id}"]`)!;
      const volSlider = strip.querySelector<HTMLInputElement>(`[data-vol-input="${conf.id}"]`)!;

      // Bind events
      loadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          fileNameEl.textContent = 'Decoding...';
          const ok = await this.stage.audioEngine.loadStemFromFile(conf.id, file);
          fileNameEl.textContent = ok ? file.name : 'Error loading';
        }
      });

      lowCutSlider.addEventListener('input', () => {
        const idx = Number(lowCutSlider.value);
        const hz = lowCutIndexToHz(idx);
        ch.setLowCut(hz);
        lowCutValEl.textContent = `${hz} Hz`;
      });

      highCutSlider.addEventListener('input', () => {
        const val = Number(highCutSlider.value);
        ch.setHighCut(val);
        highCutValEl.textContent = `${val} Hz`;
      });

      threshSlider.addEventListener('input', () => {
        const pct = Number(threshSlider.value);
        ch.setThreshold(pct / 100);
        threshValEl.textContent = `${pct}%`;
        threshLineEl.style.left = `${pct}%`;
        const silencePct = pct * this.stage.arbitrator.silenceThresholdFraction;
        silenceLineEl.style.left = `${silencePct.toFixed(1)}%`;
      });

      detectGainSlider.addEventListener('input', () => {
        const val = parseFloat(detectGainSlider.value);
        ch.setDetectGain(val);
        detectGainValEl.textContent = `${val.toFixed(1)}x`;
      });

      riseSlider.addEventListener('input', () => {
        const val = parseFloat(riseSlider.value);
        ch.setRiseSensitivity(val);
        riseValEl.textContent = val.toFixed(2);
      });

      pulseSlider.addEventListener('input', () => {
        const val = parseFloat(pulseSlider.value);
        ch.setPulseWeight(val);
        pulseValEl.textContent = `${val.toFixed(1)}x`;
      });

      if (conf.id === 'drums') {
        const kickSlider = strip.querySelector<HTMLInputElement>(`[data-kickthresh-input="${conf.id}"]`);
        const kickValEl = strip.querySelector<HTMLElement>(`[data-kickthresh-val="${conf.id}"]`);
        if (kickSlider && kickValEl) {
          kickSlider.addEventListener('input', () => {
            const pct = Number(kickSlider.value);
            ch.setKickThreshold(pct / 100);
            kickValEl.textContent = `${pct}%`;
          });
        }
      }

      muteBtn.addEventListener('click', () => {
        ch.setMute(!ch.isMuted);
        muteBtn.classList.toggle('active', ch.isMuted);
      });

      soloBtn.addEventListener('click', () => {
        ch.setSolo(!ch.isSoloed);
        soloBtn.classList.toggle('active', ch.isSoloed);
        this.stage.audioEngine.syncSoloMutes();
      });

      volSlider.addEventListener('input', () => {
        ch.setVolume(Number(volSlider.value) / 100);
      });

      this.channelDomMap.set(conf.id, {
        stripEl,
        fileNameEl,
        onsetDotEl,
        vuFillEl,
        silenceLineEl,
        threshLineEl,
        vuLevelEl,
        densityFillEl,
        densityValEl,
        sustainFillEl,
        sustainValEl,
        vuDomEl,
        vuStatusEl,
        lowCutValEl,
        highCutValEl,
        threshValEl,
        detectGainValEl,
        riseValEl,
        pulseValEl,
        muteBtn,
        soloBtn,
      });
    }
  }

  private renderPartyColumns(): void {
    const partyContainer = this.container.querySelector<HTMLElement>('#party-columns')!;
    partyContainer.innerHTML = '';
    this.heroStateBtns.clear();
    this.heroActiveLabels.clear();
    this.heroSlotBadges.clear();

    for (const hero of this.stage.heroes) {
      const col = document.createElement('div');
      col.className = 'actor-column hero-col';

      const slot = this.stage.heroSlots.get(hero.config.id) || 'front';
      const slotClass = `slot-${slot}`;
      const sizePct = Math.round(hero.heightFraction * 100);

      col.innerHTML = `
        <div class="col-header">
          <span class="actor-name">${hero.config.name}</span>
          <span class="slot-badge ${slotClass}" data-slot-for="${hero.config.id}">[${slot.toUpperCase()}]</span>
        </div>
        <div class="state-buttons-col" data-actor-id="${hero.config.id}"></div>
        <div class="active-sprite-indicator">
          <span class="label">Sprite:</span>
          <code class="active-sprite-name" data-active-for="${hero.config.id}">idle_1.png</code>
        </div>
        <div class="actor-size-control">
          <div class="size-label-row">
            <span>Size:</span>
            <span class="actor-size-val" data-size-val="${hero.config.id}">${sizePct}%</span>
          </div>
          <input type="range" class="actor-size-slider" data-size-input="${hero.config.id}" min="15" max="85" value="${sizePct}" />
        </div>
      `;

      // 1. State Buttons
      const btnContainer = col.querySelector<HTMLElement>('.state-buttons-col')!;
      const btnMap: Record<ActorState, HTMLButtonElement> = {} as any;

      for (const st of STATES) {
        const btn = document.createElement('button');
        btn.className = `latch-btn state-${st.key}`;
        btn.textContent = st.label;
        btn.title = `Latch ${st.label}`;

        btn.addEventListener('click', () => {
          this.handleHeroLatch(hero, st.key);
        });

        btnContainer.appendChild(btn);
        btnMap[st.key] = btn;
      }

      // 2. Size Slider
      const sizeSlider = col.querySelector<HTMLInputElement>(`[data-size-input="${hero.config.id}"]`)!;
      const sizeValDisplay = col.querySelector<HTMLElement>(`[data-size-val="${hero.config.id}"]`)!;
      sizeSlider.addEventListener('input', () => {
        const pct = Number(sizeSlider.value);
        hero.heightFraction = pct / 100;
        sizeValDisplay.textContent = `${pct}%`;
      });

      this.heroStateBtns.set(hero.config.id, btnMap);
      this.heroActiveLabels.set(
        hero.config.id,
        col.querySelector<HTMLElement>(`[data-active-for="${hero.config.id}"]`)!
      );
      this.heroSlotBadges.set(
        hero.config.id,
        col.querySelector<HTMLElement>(`[data-slot-for="${hero.config.id}"]`)!
      );

      partyContainer.appendChild(col);
    }
  }

  private renderEnemyColumns(): void {
    const enemyContainer = this.container.querySelector<HTMLElement>('#enemy-columns')!;
    enemyContainer.innerHTML = '';
    this.enemyStateBtns.clear();
    this.enemyActiveLabels.clear();

    const badge = this.container.querySelector<HTMLElement>('#enemy-count-badge');
    if (badge) {
      badge.textContent = `(${this.stage.enemies.length}/8)`;
    }

    this.stage.enemies.forEach((enemy, idx) => {
      const col = document.createElement('div');
      col.className = 'actor-column enemy-col';
      const sizePct = Math.round(enemy.heightFraction * 100);

      col.innerHTML = `
        <div class="col-header enemy-header">
          <span class="actor-name">${enemy.config.name}</span>
          ${
            this.stage.enemies.length > 1
              ? `<button class="btn-remove-enemy" data-remove-id="${enemy.config.id}" title="Remove enemy">✕</button>`
              : `<span class="slot-badge slot-front">[SLOT ${idx + 1}]</span>`
          }
        </div>
        <div class="state-buttons-col" data-actor-id="${enemy.config.id}"></div>
        <div class="active-sprite-indicator">
          <span class="label">Sprite:</span>
          <code class="active-sprite-name" data-active-for="${enemy.config.id}">idle_1.png</code>
        </div>
        <div class="actor-size-control">
          <div class="size-label-row">
            <span>Size:</span>
            <span class="actor-size-val" data-size-val="${enemy.config.id}">${sizePct}%</span>
          </div>
          <input type="range" class="actor-size-slider" data-size-input="${enemy.config.id}" min="15" max="85" value="${sizePct}" />
        </div>
      `;

      // 1. State Buttons
      const btnContainer = col.querySelector<HTMLElement>('.state-buttons-col')!;
      const btnMap: Record<ActorState, HTMLButtonElement> = {} as any;

      for (const st of STATES) {
        const btn = document.createElement('button');
        btn.className = `latch-btn state-${st.key}`;
        btn.textContent = st.label;
        btn.title = `Latch ${st.label}`;

        btn.addEventListener('click', () => {
          this.handleEnemyLatch(enemy, st.key);
        });

        btnContainer.appendChild(btn);
        btnMap[st.key] = btn;
      }

      // 2. Remove Button
      const removeBtn = col.querySelector<HTMLButtonElement>(`[data-remove-id="${enemy.config.id}"]`);
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          this.stage.removeEnemy(enemy.config.id);
          this.renderEnemyColumns();
        });
      }

      // 3. Size Slider
      const sizeSlider = col.querySelector<HTMLInputElement>(`[data-size-input="${enemy.config.id}"]`)!;
      const sizeValDisplay = col.querySelector<HTMLElement>(`[data-size-val="${enemy.config.id}"]`)!;
      sizeSlider.addEventListener('input', () => {
        const pct = Number(sizeSlider.value);
        enemy.heightFraction = pct / 100;
        sizeValDisplay.textContent = `${pct}%`;
      });

      this.enemyStateBtns.set(enemy.config.id, btnMap);
      this.enemyActiveLabels.set(
        enemy.config.id,
        col.querySelector<HTMLElement>(`[data-active-for="${enemy.config.id}"]`)!
      );

      enemyContainer.appendChild(col);
    });

    // Add Enemy Column Button if < 8 enemies
    if (this.stage.enemies.length < 8) {
      const addCol = document.createElement('div');
      addCol.className = 'actor-column add-enemy-column';
      addCol.innerHTML = `
        <button class="btn-add-enemy-card" title="Add another enemy to the battle">
          <span class="plus-icon">+</span>
          <span class="plus-label">ADD ENEMY</span>
        </button>
      `;

      addCol.querySelector('.btn-add-enemy-card')?.addEventListener('click', async () => {
        await this.stage.addEnemy('the_worm');
        this.renderEnemyColumns();
      });

      enemyContainer.appendChild(addCol);
    }
  }

  private handleHeroLatch(hero: SpriteActor, targetState: ActorState): void {
    if (hero.state === targetState && hero.isManuallyLatched) {
      hero.isManuallyLatched = false;
      this.stage.triggerHeroState(hero.config.id, 'idle');
    } else {
      hero.isManuallyLatched = targetState !== 'idle';
      this.stage.triggerHeroState(hero.config.id, targetState);
    }
  }

  private handleEnemyLatch(enemy: SpriteActor, targetState: ActorState): void {
    if (enemy.state === targetState && enemy.isManuallyLatched) {
      enemy.isManuallyLatched = false;
      enemy.setState('idle');
    } else {
      enemy.isManuallyLatched = targetState !== 'idle';
      enemy.setState(targetState);
    }
  }

  private flashSavedBtn(btn: HTMLButtonElement): void {
    const originalText = btn.innerHTML;
    btn.innerHTML = '✓ Defaults Saved!';
    btn.classList.add('is-saved');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('is-saved');
    }, 1500);
  }

  private async startRecording(): Promise<void> {
    try {
      await this.stage.audioEngine.resumeContext();

      const canvas = this.stage.canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream };
      if (!canvas.captureStream) {
        alert('Canvas captureStream is not supported by your browser.');
        return;
      }

      const quality = (this.recordQualitySelect?.value || 'balanced') as 'compact' | 'balanced' | 'hifi';
      if (this.recordQualitySelect) {
        this.recordQualitySelect.disabled = true;
      }

      // 1. Determine recording canvas & preserve crispy retro pixels:
      let streamCanvas: HTMLCanvasElement = this.stage.canvas;
      const curW = this.stage.canvas.width;
      const curH = this.stage.canvas.height;

      // In balanced and hifi modes, integer-upscale using nearest-neighbor to 720p/1080p
      // so players like QuickTime, Discord, and YouTube won't apply bilinear blur to pixel art!
      // In compact mode, capture directly at native resolution for minimal file size.
      const shouldUpscale = quality !== 'compact';
      if (shouldUpscale && curH < 720) {
        // Multipliers: 180p -> 4x (720p), 360p -> 2x (720p), 540p -> 2x (1080p)
        const scaleMult = curH <= 180 ? 4 : (curH <= 360 ? 2 : 2);
        const upCanvas = document.createElement('canvas');
        upCanvas.width = curW * scaleMult;
        upCanvas.height = curH * scaleMult;
        const upCtx = upCanvas.getContext('2d')!;
        upCtx.imageSmoothingEnabled = false;

        const updateUpstream = () => {
          upCtx.imageSmoothingEnabled = false;
          upCtx.drawImage(this.stage.canvas, 0, 0, upCanvas.width, upCanvas.height);
        };
        updateUpstream();
        this.stage.onTick(updateUpstream);
        this.recTickCleanup = () => this.stage.removeTick(updateUpstream);
        streamCanvas = upCanvas;
      }

      const targetFps = quality === 'hifi' ? 60 : 30;
      this.recordedResolution = `${streamCanvas.width}x${streamCanvas.height}_${targetFps}fps`;

      // 2. Capture clean canvas stream
      const canvasStream: MediaStream = (streamCanvas as any).captureStream(targetFps);

      // 3. Capture pure master audio track
      const audioTrack = this.stage.audioEngine.getAudioStreamTrack();

      const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      if (audioTrack) {
        tracks.push(audioTrack);
      }

      const combinedStream = new MediaStream(tracks);

      // 4. Select optimal container format
      const mimeCandidates = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      let selectedMime = '';
      for (const mime of mimeCandidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          break;
        }
      }

      // 5. Smart Bitrate Optimization:
      // - Compact: ~800 kbps (Native Res, 30fps) -> ~12-15 MB for 2.5 min
      // - Balanced: ~1.6 Mbps (Crisp 720p, 30fps) -> ~25-30 MB for 2.5 min
      // - Hi-Fi: ~3.2-4.0 Mbps (Crisp 720p/1080p, 60fps) -> ~70-80 MB for 2.5 min
      let videoBps = 1600000;
      let audioBps = 160000;
      if (quality === 'compact') {
        videoBps = 800000;
        audioBps = 128000;
      } else if (quality === 'hifi') {
        videoBps = streamCanvas.height >= 1080 ? 4000000 : 3200000;
        audioBps = 192000;
      }

      const options: MediaRecorderOptions = selectedMime
        ? { mimeType: selectedMime, videoBitsPerSecond: videoBps, audioBitsPerSecond: audioBps }
        : {};

      this.mediaRecorder = new MediaRecorder(combinedStream, options);
      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.saveRecordingFile(selectedMime);
      };

      this.mediaRecorder.start(250);
      this.isRecording = true;
      this.recordingStartTimestamp = performance.now();

      this.recordBtn.classList.add('is-recording');
      this.recordBtn.innerHTML = '⏹ Stop (00:00)';

      // Auto-start playback if currently paused
      if (!this.stage.audioEngine.isPlaying) {
        await this.stage.audioEngine.play();
      }
    } catch (err) {
      console.error('Failed to start canvas recording:', err);
      alert('Could not start recording. See console for details.');
      if (this.recTickCleanup) {
        this.recTickCleanup();
        this.recTickCleanup = null;
      }
      this.isRecording = false;
      this.recordBtn.classList.remove('is-recording');
      this.recordBtn.innerHTML = '⏺ Record';
      if (this.recordQualitySelect) {
        this.recordQualitySelect.disabled = false;
      }
    }
  }

  private stopRecording(): void {
    if (this.recTickCleanup) {
      this.recTickCleanup();
      this.recTickCleanup = null;
    }
    if (this.recordQualitySelect) {
      this.recordQualitySelect.disabled = false;
    }
    if (!this.mediaRecorder || !this.isRecording) return;
    try {
      this.mediaRecorder.stop();
    } catch (err) {
      console.warn('Error stopping media recorder:', err);
    }
    this.isRecording = false;
    this.recordBtn.classList.remove('is-recording');
    this.recordBtn.innerHTML = '⏺ Record';
  }

  private saveRecordingFile(mimeType: string): void {
    if (this.recordedChunks.length === 0) return;
    const isMp4 = mimeType.toLowerCase().includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const blob = new Blob(this.recordedChunks, { type: mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const arena = this.stage.currentArenaId;
    const res = this.recordedResolution || this.stage.currentResKey;
    a.download = `worm_battles_${arena}_${res}_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  private bindSettingsControls(): void {
    // Save Defaults: Band Members
    const savePartyBtn = this.container.querySelector<HTMLButtonElement>('#btn-save-party-defaults');
    if (savePartyBtn) {
      savePartyBtn.addEventListener('click', () => {
        const heroSizes: Record<string, number> = {};
        for (const h of this.stage.heroes) {
          heroSizes[h.config.id] = h.heightFraction;
        }
        savePartyDefaults({ heroSizes, fxConfig: { ...this.stage.heroAttackFxConfig } });
        this.flashSavedBtn(savePartyBtn);
      });
    }

    // Save Defaults: Enemies
    const saveEnemiesBtn = this.container.querySelector<HTMLButtonElement>('#btn-save-enemies-defaults');
    if (saveEnemiesBtn) {
      saveEnemiesBtn.addEventListener('click', () => {
        const enemies = this.stage.enemies.map((e) => ({
          type: (e.config.folderPath.includes('air_squid') ? 'air_squid' : 'the_worm') as
            | 'the_worm'
            | 'air_squid',
          heightFraction: e.heightFraction,
        }));
        saveEnemiesDefaults({ enemies, fxConfig: { ...this.stage.enemyAttackFxConfig } });
        this.flashSavedBtn(saveEnemiesBtn);
      });
    }

    // Setup FX Selects for Heroes & Enemies
    const setupFxSelects = (
      fxSelectId: string,
      palSelectId: string,
      sizeSelectId: string,
      config: { fxId: string; paletteName: string; size: number }
    ) => {
      const fxEl = this.container.querySelector<HTMLSelectElement>(`#${fxSelectId}`);
      const palEl = this.container.querySelector<HTMLSelectElement>(`#${palSelectId}`);
      const sizeEl = this.container.querySelector<HTMLSelectElement>(`#${sizeSelectId}`);
      if (!fxEl || !palEl || !sizeEl) return;

      fxEl.innerHTML = FX_LIST.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
      palEl.innerHTML = Object.keys(FX_PALETTES).map((p) => `<option value="${p}">${p}</option>`).join('');
      sizeEl.innerHTML = FX_SIZES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');

      fxEl.value = config.fxId;
      palEl.value = config.paletteName;
      sizeEl.value = String(config.size);

      fxEl.addEventListener('change', () => {
        config.fxId = fxEl.value;
      });
      palEl.addEventListener('change', () => {
        config.paletteName = palEl.value;
      });
      sizeEl.addEventListener('change', () => {
        config.size = Number(sizeEl.value);
      });
    };

    setupFxSelects('hero-fx-select', 'hero-fx-palette', 'hero-fx-size', this.stage.heroAttackFxConfig);
    setupFxSelects('enemy-fx-select', 'enemy-fx-palette', 'enemy-fx-size', this.stage.enemyAttackFxConfig);

    // Save Defaults: Settings
    const saveSettingsBtn = this.container.querySelector<HTMLButtonElement>('#btn-save-settings-defaults');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        saveSettingsDefaults({
          arenaId: arenaSelect.value,
          resKey: resSelect.value,
          idleBpm: Number(idleSlider.value),
          attackBpm: Number(attackSlider.value),
          lungePx: Number(lungeSlider.value),
          autoHit: autoHitCheckbox.checked,
          attackFxHoldOffMs: Number(fxHoldOffSlider.value),
        });
        this.flashSavedBtn(saveSettingsBtn);
      });
    }

    // Arena Selector
    const arenaSelect = this.container.querySelector<HTMLSelectElement>('#select-arena')!;
    const arenaNameDisplay = this.container.querySelector<HTMLElement>('#arena-name-display')!;
    arenaSelect.addEventListener('change', async () => {
      const selectedId = arenaSelect.value;
      await this.stage.setArena(selectedId);
      arenaNameDisplay.textContent = arenaSelect.options[arenaSelect.selectedIndex].text;
    });

    // Canvas Resolution (Master Quality Control)
    const resSelect = this.container.querySelector<HTMLSelectElement>('#select-canvas-resolution')!;
    const resModeDisplay = this.container.querySelector<HTMLElement>('#res-mode-display')!;
    resSelect.addEventListener('change', () => {
      const resKey = resSelect.value;
      this.stage.setCanvasResolution(resKey);
      resModeDisplay.textContent = RESOLUTION_PRESETS[resKey].label;
    });

    // Idle Tempo Slider
    const idleSlider = this.container.querySelector<HTMLInputElement>('#slider-idle-bpm')!;
    const idleVal = this.container.querySelector<HTMLElement>('#idle-tempo-val')!;
    idleSlider.addEventListener('input', () => {
      const bpm = Number(idleSlider.value);
      const ms = Math.round(60000 / bpm);
      idleVal.textContent = `${bpm} BPM (${ms}ms)`;
      this.stage.setIdleTempo(bpm);
    });

    // Attack Tempo Slider
    const attackSlider = this.container.querySelector<HTMLInputElement>('#slider-attack-bpm')!;
    const attackVal = this.container.querySelector<HTMLElement>('#attack-tempo-val')!;
    attackSlider.addEventListener('input', () => {
      const bpm = Number(attackSlider.value);
      const ms = Math.round(60000 / bpm);
      attackVal.textContent = `${bpm} BPM (${ms}ms)`;
      this.stage.setAttackTempo(bpm);
    });

    // Lunge Distance Slider
    const lungeSlider = this.container.querySelector<HTMLInputElement>('#slider-lunge')!;
    const lungeVal = this.container.querySelector<HTMLElement>('#lunge-val')!;
    lungeSlider.addEventListener('input', () => {
      const px = Number(lungeSlider.value);
      lungeVal.textContent = `${px}px`;
      this.stage.setBaseLungeDistance(px);
    });

    // Auto-hit checkbox
    const autoHitCheckbox = this.container.querySelector<HTMLInputElement>('#toggle-auto-hit')!;
    autoHitCheckbox.addEventListener('change', () => {
      this.stage.autoHitOpponent = autoHitCheckbox.checked;
    });

    // Attack FX Hold-Off Slider
    const fxHoldOffSlider = this.container.querySelector<HTMLInputElement>('#slider-fx-holdoff')!;
    const fxHoldOffVal = this.container.querySelector<HTMLElement>('#fx-holdoff-val')!;
    fxHoldOffSlider.addEventListener('input', () => {
      const ms = Number(fxHoldOffSlider.value);
      fxHoldOffVal.textContent = `${ms}ms`;
      this.stage.attackFxHoldOffMs = ms;
    });
  }

  private syncLiveIndicators(): void {
    // 1. Sync Audio Transport & Channels
    const isPlaying = this.stage.audioEngine.isPlaying;
    if (this.playBtn) {
      this.playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
      this.playBtn.classList.toggle('active', isPlaying);
    }

    if (this.isRecording && this.recordBtn) {
      const elapsedSec = Math.floor((performance.now() - this.recordingStartTimestamp) / 1000);
      this.recordBtn.innerHTML = `⏹ Stop (${formatTime(elapsedSec)})`;
    }

    const curTime = this.stage.audioEngine.getCurrentTimeSec();
    const dur = this.stage.audioEngine.getDuration();

    if (!this.isUserSeeking && this.seekSlider) {
      this.timeDisplay.textContent = `${formatTime(curTime)} / ${formatTime(dur)}`;
      const frac = dur > 0 ? Math.min(1000, Math.round((curTime / dur) * 1000)) : 0;
      this.seekSlider.value = frac.toString();
    }

    // Sync Channel VU Meters & Dominance
    let maxDominance = 0;
    let dominantChId = '';
    for (const conf of STEM_CHANNELS) {
      const ch = this.stage.audioEngine.getChannel(conf.id);
      if (ch && ch.dominanceScore > maxDominance) {
        maxDominance = ch.dominanceScore;
        dominantChId = conf.id;
      }
    }

    for (const conf of STEM_CHANNELS) {
      const dom = this.channelDomMap.get(conf.id);
      const ch = this.stage.audioEngine.getChannel(conf.id);
      if (!dom || !ch) continue;

      if (dom.fileNameEl.textContent !== ch.fileName) {
        dom.fileNameEl.textContent = ch.fileName;
      }

      const pct = Math.round(ch.currentLevel * 100);
      dom.vuFillEl.style.width = `${pct}%`;
      dom.vuLevelEl.textContent = `${pct}%`;

      const densityPct = Math.round(ch.transientDensity * 100);
      dom.densityFillEl.style.width = `${densityPct}%`;
      dom.densityValEl.textContent = `${densityPct}%`;

      const sustainPct = Math.round(ch.sustainedScore * 100);
      dom.sustainFillEl.style.width = `${sustainPct}%`;
      dom.sustainValEl.textContent = `${sustainPct}%`;

      const silencePct = ch.threshold * this.stage.arbitrator.silenceThresholdFraction * 100;
      dom.silenceLineEl.style.left = `${silencePct.toFixed(1)}%`;
      dom.silenceLineEl.title = `Silence Floor: ${silencePct.toFixed(1)}%`;
      dom.threshLineEl.style.left = `${Math.round(ch.threshold * 100)}%`;
      dom.threshLineEl.title = `Attack Threshold: ${Math.round(ch.threshold * 100)}%`;

      const domScorePct = Math.round(ch.dominanceScore * 100);
      dom.vuDomEl.textContent = `D: ${domScorePct}%`;
      dom.vuDomEl.title = `Dominance: ${domScorePct}% (Loudness: ${pct}%, Activity: ${densityPct}%, Sustain: ${sustainPct}%)`;
      const isLead = conf.id === dominantChId && maxDominance > 0.05;
      dom.vuDomEl.classList.toggle('is-dominant-lead', isLead);

      const isFlashing = ch.onsetFlashTimerMs > 0 || ch.isOnset;
      if (isFlashing) {
        dom.stripEl.classList.add('onset-flash');
        dom.onsetDotEl.classList.add('is-active');
        dom.vuFillEl.classList.add('onset-flash');
        dom.densityFillEl.classList.add('onset-flash');
        dom.sustainFillEl.classList.add('onset-flash');
      } else {
        dom.stripEl.classList.remove('onset-flash');
        dom.onsetDotEl.classList.remove('is-active');
        dom.vuFillEl.classList.remove('onset-flash');
        dom.densityFillEl.classList.remove('onset-flash');
        dom.sustainFillEl.classList.remove('onset-flash');
      }

      if (conf.id === 'drums') {
        const kickBadge = dom.stripEl.querySelector<HTMLElement>('[data-kick-badge="drums"]');
        if (kickBadge) {
          const isKickActive = ch.kickFlashTimerMs > 0 || ch.isKickHit;
          kickBadge.classList.toggle('is-kick-active', isKickActive);
        }
      }

      const hero = this.stage.heroes.find((h) => h.config.id === conf.heroId);
      if (hero) {
        const slot = this.stage.heroSlots.get(hero.config.id) || 'front';
        const isAttacking = hero.state === 'attack' || hero.state === 'ultimate';
        if (slot === 'front' && isAttacking) {
          dom.vuStatusEl.textContent = `FRONT (${hero.attackIntervalMs}ms)`;
          dom.vuStatusEl.className = 'vu-status-badge status-front-attack';
        } else if (isAttacking) {
          dom.vuStatusEl.textContent = `STRUM (${hero.attackIntervalMs}ms)`;
          dom.vuStatusEl.className = 'vu-status-badge status-strum';
        } else {
          dom.vuStatusEl.textContent = 'IDLE';
          dom.vuStatusEl.className = 'vu-status-badge status-idle';
        }
      }
    }

    // 2. Sync Heroes
    for (const hero of this.stage.heroes) {
      const btns = this.heroStateBtns.get(hero.config.id);
      if (btns) {
        for (const st of STATES) {
          const btn = btns[st.key];
          if (!btn) continue;
          if (hero.state === st.key) {
            btn.classList.add('is-latched');
          } else {
            btn.classList.remove('is-latched');
          }
        }
      }

      const activeLabel = this.heroActiveLabels.get(hero.config.id);
      if (activeLabel) {
        activeLabel.textContent = `${hero.getActiveSpriteKey()}.png`;
      }

      const slotBadge = this.heroSlotBadges.get(hero.config.id);
      if (slotBadge) {
        const slot = this.stage.heroSlots.get(hero.config.id) || 'front';
        slotBadge.textContent = `[${slot.toUpperCase()}]`;
        slotBadge.className = `slot-badge slot-${slot}`;
      }
    }

    // 3. Sync Enemies
    for (const enemy of this.stage.enemies) {
      const btns = this.enemyStateBtns.get(enemy.config.id);
      if (btns) {
        for (const st of STATES) {
          const btn = btns[st.key];
          if (!btn) continue;
          if (enemy.state === st.key) {
            btn.classList.add('is-latched');
          } else {
            btn.classList.remove('is-latched');
          }
        }
      }

      const activeLabel = this.enemyActiveLabels.get(enemy.config.id);
      if (activeLabel) {
        activeLabel.textContent = `${enemy.getActiveSpriteKey()}.png`;
      }
    }
  }
}
