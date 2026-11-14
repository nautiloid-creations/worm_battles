import { BattleStage } from '../engine/BattleStage';
import {
  UltimateSequencer,
  UltimateSequence,
  UltimateKeyframe,
  ULTIMATE_PRESETS,
} from '../engine/UltimateSequencer';
import { FX_LIST, FX_PALETTES, FX_SIZES } from '../engine/CombatFxManager';
import { WarpEffectType } from '../engine/RasterWarpManager';
import { SpriteKey } from '../engine/SpriteActor';

export class UltimateStudio {
  private stage: BattleStage;
  private sequencer: UltimateSequencer;
  private container: HTMLElement;

  private selectedKfIndex = 0;
  private selectedFxSubIndex = 0;
  private isUserScrubbing = false;

  // DOM Elements
  private presetSelect!: HTMLSelectElement;
  private playPauseBtn!: HTMLButtonElement;
  private loopCheckbox!: HTMLInputElement;
  private speedSelect!: HTMLSelectElement;
  private timeDisplay!: HTMLElement;
  private scrubberSlider!: HTMLInputElement;
  private keyframeListEl!: HTMLElement;
  private inspectorEl!: HTMLElement;

  constructor(stage: BattleStage, container: HTMLElement) {
    this.stage = stage;
    this.sequencer = stage.ultimateSequencer;
    this.container = container;

    this.render();
    this.setupListeners();
    this.syncStudioFx(true);

    // Hook frame sync to update timeline scrubber when playing
    this.stage.onTick(() => this.syncPlaybackUi());
  }

  public syncStudioFx(forceSelected = false): void {
    const selectedKf = this.sequencer.sequence.keyframes[this.selectedKfIndex];
    this.stage.syncStudioFx(selectedKf, forceSelected);
  }

  private render(): void {
    const presetsOptions = Object.entries(ULTIMATE_PRESETS)
      .map(([id, seq]) => `<option value="${id}">${seq.name} (${id})</option>`)
      .join('');

    this.container.innerHTML = `
      <div class="ultimate-studio">
        <!-- TOP TOOLBAR & PRESETS -->
        <div class="studio-topbar">
          <div class="studio-header-title">
            <h2>🎬 ULTIMATE ANIMATION DESIGNER</h2>
            <span class="studio-subtext">Timeline Keyframing • Retro Raster Warping • Combat FX</span>
          </div>

          <div class="studio-preset-bar">
            <label for="ultimate-preset-select" class="preset-label">Preset:</label>
            <select id="ultimate-preset-select" class="studio-select">
              ${presetsOptions}
            </select>
            <button id="btn-studio-save-json" class="btn-studio-action primary-btn" title="Save directly to assets_src/characters/<char_id>/ultimate.json">💾 Save to File</button>
            <button id="btn-studio-reload-sprites" class="btn-studio-action" title="Reload character sprites from disk (busts browser cache)">🔄 Reload Sprites</button>
            <button id="btn-studio-export-json" class="btn-studio-action" title="Copy sequence JSON to clipboard">📋 Copy</button>
            <button id="btn-studio-import-json" class="btn-studio-action" title="Import sequence from JSON">📂 Import</button>
            <button id="btn-studio-reset-preset" class="btn-studio-action" title="Reset to default preset">🔄 Reset</button>
          </div>
        </div>

        <!-- TRANSPORT BAR -->
        <div class="studio-transport-card">
          <div class="transport-controls-row">
            <div class="transport-btn-group">
              <button id="btn-studio-rewind" class="studio-btn" title="Rewind to start">⏮ 0.0s</button>
              <button id="btn-studio-play" class="studio-btn primary-btn">▶ Play</button>
            </div>

            <div class="transport-timing-group">
              <span id="studio-time-display" class="studio-time-code">00.00s / 03.80s</span>
              <label class="studio-checkbox-label">
                <input type="checkbox" id="chk-studio-loop" checked />
                <span>🔁 Loop</span>
              </label>
              <label class="studio-speed-label">
                Speed:
                <select id="sel-studio-speed" class="studio-select-small">
                  <option value="0.25">0.25x</option>
                  <option value="0.5">0.5x</option>
                  <option value="1" selected>1.0x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2.0x</option>
                </select>
              </label>
            </div>
          </div>

          <!-- Scrubbing Timeline Slider -->
          <div class="studio-scrubber-row">
            <input
              type="range"
              id="studio-scrubber-slider"
              class="studio-slider"
              min="0"
              max="${this.sequencer.sequence.durationMs}"
              step="10"
              value="0"
            />
          </div>
        </div>

        <!-- SEQUENCE TIMELINE & KEYFRAMES LIST -->
        <div class="studio-section-card">
          <div class="studio-section-header">
            <h3>KEYFRAME TIMELINE (${this.sequencer.sequence.keyframes.length} KEYFRAMES)</h3>
            <div class="studio-kf-actions">
              <button id="btn-studio-add-kf" class="btn-studio-small btn-green">+ Add Keyframe at Cursor</button>
              <button id="btn-studio-del-kf" class="btn-studio-small btn-red">- Delete Selected</button>
            </div>
          </div>

          <div id="studio-keyframe-list" class="studio-kf-list">
            <!-- Dynamically populated keyframe chips -->
          </div>
        </div>

        <!-- KEYFRAME INSPECTOR / PROPERTY EDITOR -->
        <div id="studio-inspector-card" class="studio-section-card inspector-card">
          <!-- Populated by renderInspector() -->
        </div>
      </div>
    `;

    // Cache elements
    this.presetSelect = this.container.querySelector('#ultimate-preset-select')!;
    this.playPauseBtn = this.container.querySelector('#btn-studio-play')!;
    this.loopCheckbox = this.container.querySelector('#chk-studio-loop')!;
    this.speedSelect = this.container.querySelector('#sel-studio-speed')!;
    this.timeDisplay = this.container.querySelector('#studio-time-display')!;
    this.scrubberSlider = this.container.querySelector('#studio-scrubber-slider')!;
    this.keyframeListEl = this.container.querySelector('#studio-keyframe-list')!;
    this.inspectorEl = this.container.querySelector('#studio-inspector-card')!;

    this.renderKeyframeList();
    this.renderInspector();
  }

  private setupListeners(): void {
    // Preset change
    this.presetSelect.addEventListener('change', () => {
      const preset = ULTIMATE_PRESETS[this.presetSelect.value];
      if (preset) {
        // Deep copy preset
        this.sequencer.setSequence(JSON.parse(JSON.stringify(preset)));
        this.stage.bringHeroToFront(preset.actorId);
        this.selectedKfIndex = 0;
        this.selectedFxSubIndex = 0;
        this.updateSliderMax();
        this.renderKeyframeList();
        this.renderInspector();
        this.syncStudioFx(true);
      }
    });

    // Reset preset
    this.container.querySelector('#btn-studio-reset-preset')?.addEventListener('click', () => {
      const preset = ULTIMATE_PRESETS[this.presetSelect.value];
      if (preset) {
        this.sequencer.setSequence(JSON.parse(JSON.stringify(preset)));
        this.stage.bringHeroToFront(preset.actorId);
        this.selectedKfIndex = 0;
        this.selectedFxSubIndex = 0;
        this.updateSliderMax();
        this.renderKeyframeList();
        this.renderInspector();
        this.syncStudioFx(true);
      }
    });

    // Reload sprites with fresh cache busting
    this.container.querySelector('#btn-studio-reload-sprites')?.addEventListener('click', async () => {
      await Promise.all([
        ...this.stage.heroes.map((h) => h.loadSprites(true)),
        ...this.stage.enemies.map((e) => e.loadSprites(true)),
      ]);
      this.syncStudioFx(true);
      alert('Sprites reloaded with fresh cache-busting!');
    });

    // Transport buttons
    this.container.querySelector('#btn-studio-rewind')?.addEventListener('click', () => {
      this.sequencer.seek(0);
      this.syncPlaybackUi();
      this.syncStudioFx(true);
    });

    this.playPauseBtn.addEventListener('click', () => {
      if (this.sequencer.isPlaying) {
        this.sequencer.pause();
        this.playPauseBtn.textContent = '▶ Play';
        this.syncStudioFx(true);
      } else {
        this.sequencer.play();
        this.playPauseBtn.textContent = '⏸ Pause';
      }
    });

    this.loopCheckbox.addEventListener('change', () => {
      this.sequencer.isLooping = this.loopCheckbox.checked;
    });

    this.speedSelect.addEventListener('change', () => {
      this.sequencer.speed = parseFloat(this.speedSelect.value) || 1.0;
    });

    // Scrubber interaction
    this.scrubberSlider.addEventListener('mousedown', () => {
      this.isUserScrubbing = true;
    });
    this.scrubberSlider.addEventListener('input', () => {
      const timeMs = parseInt(this.scrubberSlider.value, 10);
      this.sequencer.seek(timeMs);
      this.updateTimeDisplay();
      this.syncStudioFx(false);
    });
    this.scrubberSlider.addEventListener('mouseup', () => {
      this.isUserScrubbing = false;
      this.syncStudioFx(false);
    });
    this.scrubberSlider.addEventListener('change', () => {
      this.isUserScrubbing = false;
      this.syncStudioFx(false);
    });

    // Add Keyframe
    this.container.querySelector('#btn-studio-add-kf')?.addEventListener('click', () => {
      this.addKeyframeAtCurrentTime();
    });

    // Delete Keyframe
    this.container.querySelector('#btn-studio-del-kf')?.addEventListener('click', () => {
      this.deleteSelectedKeyframe();
    });

    // Save directly to assets_src/characters/<char_id>/ultimate.json
    this.container.querySelector('#btn-studio-save-json')?.addEventListener('click', async () => {
      const charId = this.getCharIdFromActor(this.sequencer.sequence.actorId);
      const json = JSON.stringify(this.sequencer.sequence, null, 2);
      try {
        const res = await fetch('/api/save-ultimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charId, sequence: this.sequencer.sequence }),
        });
        if (res.ok) {
          alert(`💾 Saved directly to assets_src/characters/${charId}/ultimate.json!`);
        } else {
          throw new Error(await res.text());
        }
      } catch (err: any) {
        navigator.clipboard?.writeText(json);
        alert(`Saved JSON to clipboard (server endpoint note: ${err.message})`);
      }
    });

    // Copy JSON to clipboard
    this.container.querySelector('#btn-studio-export-json')?.addEventListener('click', () => {
      const json = JSON.stringify(this.sequencer.sequence, null, 2);
      navigator.clipboard?.writeText(json);
      alert('Ultimate sequence copied to clipboard as JSON!');
    });

    // Import JSON
    this.container.querySelector('#btn-studio-import-json')?.addEventListener('click', () => {
      const input = prompt('Paste Ultimate Sequence JSON here:');
      if (input) {
        try {
          const parsed = JSON.parse(input) as UltimateSequence;
          if (parsed.keyframes && Array.isArray(parsed.keyframes)) {
            this.sequencer.setSequence(parsed);
            this.selectedKfIndex = 0;
            this.updateSliderMax();
            this.renderKeyframeList();
            this.renderInspector();
          } else {
            alert('Invalid JSON structure: missing keyframes array.');
          }
        } catch (e) {
          alert('Could not parse JSON: ' + (e as Error).message);
        }
      }
    });
  }

  private updateSliderMax(): void {
    this.scrubberSlider.max = `${this.sequencer.sequence.durationMs}`;
  }

  private updateTimeDisplay(): void {
    const curSec = (this.sequencer.currentTimeMs / 1000).toFixed(2);
    const totalSec = (this.sequencer.sequence.durationMs / 1000).toFixed(2);
    this.timeDisplay.textContent = `${curSec}s / ${totalSec}s`;
  }

  private syncPlaybackUi(): void {
    if (!this.stage.isUltimateStudioMode) return;

    if (!this.isUserScrubbing) {
      this.scrubberSlider.value = `${Math.round(this.sequencer.currentTimeMs)}`;
      this.updateTimeDisplay();
    }

    if (this.sequencer.isPlaying && this.playPauseBtn.textContent !== '⏸ Pause') {
      this.playPauseBtn.textContent = '⏸ Pause';
    } else if (!this.sequencer.isPlaying && this.playPauseBtn.textContent !== '▶ Play') {
      this.playPauseBtn.textContent = '▶ Play';
    }
  }

  private renderKeyframeList(): void {
    const keyframes = this.sequencer.sequence.keyframes;
    this.keyframeListEl.innerHTML = '';

    keyframes.forEach((kf, index) => {
      const chip = document.createElement('div');
      chip.className = `studio-kf-chip ${index === this.selectedKfIndex ? 'selected' : ''}`;
      
      const timeSec = (kf.timeMs / 1000).toFixed(2);
      const poseText = kf.actorPose || 'pose';
      const warpText = kf.warp ? `🌊 ${kf.warp.type}` : '';
      let fxText = '';
      if (kf.spawnFx) {
        if (Array.isArray(kf.spawnFx)) {
          fxText = `⚡ ${kf.spawnFx.length}x ${kf.spawnFx[0].fxId}`;
        } else {
          fxText = `⚡ ${kf.spawnFx.fxId}${kf.spawnFx.targetXFrac !== undefined ? ' ➔ 🎯' : ''}`;
        }
      }
      const flashText = kf.flashWhite ? '⚡ Flash' : '';
      const shakeText = kf.screenShake ? `💥 ${kf.screenShake.intensity}x` : '';
      const actorShakeText = kf.actorShake ? `📳 ${kf.actorShake}` : '';

      chip.innerHTML = `
        <div class="kf-chip-time">${timeSec}s</div>
        <div class="kf-chip-main">
          <strong>${poseText}</strong>
          <span class="kf-chip-details">${[warpText, fxText, flashText, shakeText, actorShakeText].filter(Boolean).join(' • ')}</span>
        </div>
      `;

      chip.addEventListener('click', () => {
        this.selectedKfIndex = index;
        this.selectedFxSubIndex = 0;
        this.sequencer.seek(kf.timeMs);
        this.renderKeyframeList();
        this.renderInspector();
        this.syncStudioFx(true);
      });

      this.keyframeListEl.appendChild(chip);
    });
  }

  private renderInspector(): void {
    const kf = this.sequencer.sequence.keyframes[this.selectedKfIndex];
    if (!kf) {
      this.inspectorEl.innerHTML = `<div class="inspector-empty">No keyframe selected.</div>`;
      return;
    }

    const poses: SpriteKey[] = [
      'idle_1',
      'idle_2',
      'attack_1',
      'attack_2',
      'ultimate',
      'ultimate_1',
      'ultimate_2',
      'ultimate_3',
      'hit',
      'downed',
    ];

    const poseOptions = poses
      .map(
        (p) =>
          `<option value="${p}" ${kf.actorPose === p ? 'selected' : ''}>${p}</option>`
      )
      .join('');

    const warpTypes: { id: WarpEffectType; label: string }[] = [
      { id: 'none', label: 'None' },
      { id: 'scanline_undulation', label: '🌊 Scanline Undulation (EarthBound / JRPG)' },
      { id: 'heat_shimmer', label: '🔥 Desert Heat Shimmer (Mirage)' },
      { id: 'radial_shockwave', label: '💥 Radial Shockwave (Blast)' },
      { id: 'void_vortex', label: '🌀 Void Gravitational Vortex' },
      { id: 'screen_melt', label: '🩸 Retro Screen Melt (DOOM)' },
    ];

    const currentWarpType = kf.warp ? kf.warp.type : 'none';
    const warpOptions = warpTypes
      .map(
        (w) =>
          `<option value="${w.id}" ${currentWarpType === w.id ? 'selected' : ''}>${w.label}</option>`
      )
      .join('');

    const getPrimaryFx = () => {
      if (!kf.spawnFx) return null;
      if (Array.isArray(kf.spawnFx)) {
        return kf.spawnFx[this.selectedFxSubIndex] || kf.spawnFx[0];
      }
      return kf.spawnFx;
    };
    const fxItem = getPrimaryFx();

    let fxSubSwitcherHtml = '';
    if (Array.isArray(kf.spawnFx) && kf.spawnFx.length > 1) {
      const pills = kf.spawnFx
        .map(
          (item, idx) => `
            <button type="button" class="btn-studio-small ${idx === this.selectedFxSubIndex ? 'primary-btn' : ''}" data-fx-sub-idx="${idx}">
              FX #${idx + 1} (${item.fxId.replace('fx_', '')})
            </button>
          `
        )
        .join('');
      fxSubSwitcherHtml = `
        <div class="field-row" style="margin-bottom: 8px;">
          <label class="field-label">Active FX Slot:</label>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">${pills}</div>
        </div>
      `;
    }

    const fxOptions = [
      `<option value="none" ${!fxItem ? 'selected' : ''}>(None)</option>`,
      ...FX_LIST.map(
        (fx) =>
          `<option value="${fx.id}" ${fxItem?.fxId === fx.id ? 'selected' : ''}>${fx.label}</option>`
      ),
    ].join('');

    const paletteOptions = Object.keys(FX_PALETTES)
      .map(
        (p) =>
          `<option value="${p}" ${fxItem?.paletteName === p ? 'selected' : ''}>${p}</option>`
      )
      .join('');

    const sizeOptions = FX_SIZES.map(
      (s) =>
        `<option value="${s.value}" ${fxItem?.size === s.value ? 'selected' : ''}>${s.label}</option>`
    ).join('');

    this.inspectorEl.innerHTML = `
      <div class="studio-section-header">
        <h3>KEYFRAME #${this.selectedKfIndex + 1} INSPECTOR @ ${(kf.timeMs / 1000).toFixed(2)}s</h3>
        <span class="studio-subtext">Edits apply live to sequence</span>
      </div>

      <div class="inspector-grid">
        <!-- GROUP 1: TIMING & ACTOR POSE -->
        <div class="inspector-card-group">
          <h4>🧍 ACTOR &amp; TIMING</h4>
          <div class="field-row">
            <label class="field-label">Time (ms):</label>
            <input type="number" id="insp-time-ms" class="studio-num-input" value="${kf.timeMs}" step="50" min="0" max="${this.sequencer.sequence.durationMs}" />
          </div>
          <div class="field-row">
            <label class="field-label">Actor Pose:</label>
            <select id="insp-actor-pose" class="studio-select">
              ${poseOptions}
            </select>
          </div>
          <div class="field-row">
            <label class="field-label">X Offset (px):</label>
            <input type="range" id="insp-x-slider" class="studio-slider" min="-50" max="80" value="${kf.actorXOffset || 0}" />
            <span id="insp-x-val" class="field-val">${kf.actorXOffset || 0}px</span>
          </div>
          <div class="field-row">
            <label class="field-label">Jump Y Offset (px):</label>
            <input type="range" id="insp-y-slider" class="studio-slider" min="-60" max="30" value="${kf.actorYOffset || 0}" />
            <span id="insp-y-val" class="field-val">${kf.actorYOffset || 0}px</span>
          </div>
          <div class="field-row">
            <label class="field-label">Actor Shake:</label>
            <input type="range" id="insp-actor-shake-slider" class="studio-slider" min="0" max="25" step="1" value="${kf.actorShake || 0}" />
            <span id="insp-actor-shake-val" class="field-val">${kf.actorShake || 0}</span>
          </div>
        </div>

        <!-- GROUP 2: RETRO RASTER WARPING -->
        <div class="inspector-card-group warp-group">
          <h4>🌀 RETRO RASTER WARPING</h4>
          <div class="field-row">
            <label class="field-label">Warp Mode:</label>
            <select id="insp-warp-type" class="studio-select">
              ${warpOptions}
            </select>
          </div>
          <div id="warp-params-container" style="${currentWarpType === 'none' ? 'display:none;' : ''}">
            <div class="field-row">
              <label class="field-label">Target Layer:</label>
              <select id="insp-warp-target" class="studio-select">
                <option value="background" ${kf.warp?.target === 'background' ? 'selected' : ''}>Background Arena Only</option>
                <option value="all" ${kf.warp?.target === 'all' ? 'selected' : ''}>Whole Scene (Background + Actors + FX)</option>
              </select>
            </div>
            <div class="field-row">
              <label class="field-label">Amplitude (px):</label>
              <input type="range" id="insp-warp-amp" class="studio-slider" min="1" max="45" value="${kf.warp?.amplitude || 15}" />
              <span id="insp-warp-amp-val" class="field-val">${kf.warp?.amplitude || 15}px</span>
            </div>
            <div class="field-row">
              <label class="field-label">Frequency:</label>
              <input type="range" id="insp-warp-freq" class="studio-slider" min="0.01" max="0.18" step="0.005" value="${kf.warp?.frequency || 0.05}" />
              <span id="insp-warp-freq-val" class="field-val">${(kf.warp?.frequency || 0.05).toFixed(3)}</span>
            </div>
            <div class="field-row">
              <label class="field-label">Speed:</label>
              <input type="range" id="insp-warp-speed" class="studio-slider" min="0.001" max="0.03" step="0.001" value="${kf.warp?.speed || 0.01}" />
              <span id="insp-warp-speed-val" class="field-val">${(kf.warp?.speed || 0.01).toFixed(3)}</span>
            </div>
            <div class="field-row">
              <label class="field-label">Duration (ms):</label>
              <input type="number" id="insp-warp-dur" class="studio-num-input" min="100" max="5000" step="100" value="${kf.warp?.durationMs || 2500}" />
            </div>
          </div>
        </div>

        <!-- GROUP 3: COMBAT VISUAL EFFECT (FX) -->
        <div class="inspector-card-group fx-group">
          <h4>⚡ COMBAT VISUAL EFFECT (FX)</h4>
          <div class="field-row">
            <label class="field-label">Visual FX:</label>
            <select id="insp-fx-select" class="studio-select">
              ${fxOptions}
            </select>
          </div>
          <div id="fx-params-container" style="${!fxItem ? 'display:none;' : ''}">
            ${fxSubSwitcherHtml}
            <div class="field-row">
              <label class="field-label">Color Palette:</label>
              <select id="insp-fx-palette" class="studio-select">
                ${paletteOptions}
              </select>
            </div>
            <div class="field-row">
              <label class="field-label">Sprite Size:</label>
              <select id="insp-fx-size" class="studio-select">
                ${sizeOptions}
              </select>
            </div>
            <div class="field-row">
              <label class="field-label">Spawn Position X (%):</label>
              <input type="range" id="insp-fx-x" class="studio-slider" min="0" max="100" value="${Math.round((fxItem?.xFrac || 0.5) * 100)}" />
              <span id="insp-fx-x-val" class="field-val">${Math.round((fxItem?.xFrac || 0.5) * 100)}%</span>
            </div>
            <div class="field-row">
              <label class="field-label">Spawn Position Y (%):</label>
              <input type="range" id="insp-fx-y" class="studio-slider" min="0" max="100" value="${Math.round((fxItem?.yFrac || 0.6) * 100)}" />
              <span id="insp-fx-y-val" class="field-val">${Math.round((fxItem?.yFrac || 0.6) * 100)}%</span>
            </div>
            <div class="field-row">
              <label class="field-label">Trajectory Flight:</label>
              <select id="insp-fx-flight-mode" class="studio-select">
                <option value="hover" ${fxItem?.targetXFrac === undefined ? 'selected' : ''}>Static / Hover on Cast Point</option>
                <option value="boss" ${fxItem?.targetXFrac !== undefined ? 'selected' : ''}>Fly Toward Boss (Projectile Flight)</option>
              </select>
            </div>
            <div id="fx-flight-params" style="${fxItem?.targetXFrac === undefined ? 'display:none;' : ''}">
              <div class="field-row">
                <label class="field-label">Target Boss X (%):</label>
                <input type="range" id="insp-fx-tx" class="studio-slider" min="0" max="100" value="${Math.round((fxItem?.targetXFrac ?? 0.76) * 100)}" />
                <span id="insp-fx-tx-val" class="field-val">${Math.round((fxItem?.targetXFrac ?? 0.76) * 100)}%</span>
              </div>
              <div class="field-row">
                <label class="field-label">Target Boss Y (%):</label>
                <input type="range" id="insp-fx-ty" class="studio-slider" min="0" max="100" value="${Math.round((fxItem?.targetYFrac ?? 0.6) * 100)}" />
                <span id="insp-fx-ty-val" class="field-val">${Math.round((fxItem?.targetYFrac ?? 0.6) * 100)}%</span>
              </div>
              <div class="field-row">
                <label class="field-label">Flight Speed:</label>
                <input type="range" id="insp-fx-spd" class="studio-slider" min="0.1" max="1.0" step="0.05" value="${fxItem?.speed || 0.4}" />
                <span id="insp-fx-spd-val" class="field-val">${(fxItem?.speed || 0.4).toFixed(2)}</span>
              </div>
            </div>
            <div class="field-row">
              <label class="field-label">Trajectory Direction:</label>
              <select id="insp-fx-facing" class="studio-select">
                <option value="right" ${fxItem?.facing !== 'left' ? 'selected' : ''}>Right ➡️ (Facing Boss)</option>
                <option value="left" ${fxItem?.facing === 'left' ? 'selected' : ''}>Left ⬅️ (Facing Party)</option>
              </select>
            </div>
            <div class="field-row">
              <label class="field-label">FX Duration (ms):</label>
              <input type="number" id="insp-fx-dur" class="studio-num-input" min="200" max="4000" step="100" value="${fxItem?.durationMs || 1500}" />
            </div>
          </div>
        </div>

        <!-- GROUP 4: ATMOSPHERE & BOSS REACTION -->
        <div class="inspector-card-group atmo-group">
          <h4>💥 ATMOSPHERE &amp; BOSS REACTION</h4>
          <div class="field-row">
            <label class="field-label">Arena Darkness Overlay:</label>
            <input type="range" id="insp-atmo-dim" class="studio-slider" min="0" max="0.9" step="0.05" value="${kf.dimArena || 0}" />
            <span id="insp-atmo-dim-val" class="field-val">${Math.round((kf.dimArena || 0) * 100)}%</span>
          </div>
          <div class="field-row">
            <label class="field-label">Screen Shake Intensity:</label>
            <input type="range" id="insp-atmo-shake" class="studio-slider" min="0" max="20" step="1" value="${kf.screenShake?.intensity || 0}" />
            <span id="insp-atmo-shake-val" class="field-val">${kf.screenShake?.intensity || 0}</span>
          </div>
          <div class="field-row">
            <label class="checkbox-row">
              <input type="checkbox" id="insp-atmo-flash" ${kf.flashWhite ? 'checked' : ''} />
              <span>⚡ Impact White Flash Overlay</span>
            </label>
          </div>
          <div class="field-row">
            <label class="field-label">Boss Reaction:</label>
            <select id="insp-boss-reaction" class="studio-select">
              <option value="idle" ${kf.bossReaction !== 'hit' && kf.bossReaction !== 'downed' ? 'selected' : ''}>Normal / Idle</option>
              <option value="hit" ${kf.bossReaction === 'hit' ? 'selected' : ''}>Ouch / Hit Flinch</option>
              <option value="downed" ${kf.bossReaction === 'downed' ? 'selected' : ''}>Knocked Down</option>
            </select>
          </div>
        </div>
      </div>
    `;

    this.setupInspectorListeners(kf);
  }

  private setupInspectorListeners(kf: UltimateKeyframe): void {
    // Timing & Pose
    const timeInput = this.inspectorEl.querySelector('#insp-time-ms') as HTMLInputElement;
    timeInput?.addEventListener('change', () => {
      kf.timeMs = Math.max(0, parseInt(timeInput.value, 10) || 0);
      this.sequencer.sequence.keyframes.sort((a, b) => a.timeMs - b.timeMs);
      this.selectedKfIndex = this.sequencer.sequence.keyframes.indexOf(kf);
      this.renderKeyframeList();
      this.sequencer.seek(kf.timeMs);
    });

    const poseSelect = this.inspectorEl.querySelector('#insp-actor-pose') as HTMLSelectElement;
    poseSelect?.addEventListener('change', () => {
      kf.actorPose = poseSelect.value as SpriteKey;
      this.sequencer.seek(this.sequencer.currentTimeMs);
      this.renderKeyframeList();
      this.syncStudioFx(true);
    });

    const xSlider = this.inspectorEl.querySelector('#insp-x-slider') as HTMLInputElement;
    const xVal = this.inspectorEl.querySelector('#insp-x-val') as HTMLElement;
    xSlider?.addEventListener('input', () => {
      kf.actorXOffset = parseInt(xSlider.value, 10);
      xVal.textContent = `${kf.actorXOffset}px`;
      this.sequencer.seek(this.sequencer.currentTimeMs);
      this.syncStudioFx(true);
    });

    const ySlider = this.inspectorEl.querySelector('#insp-y-slider') as HTMLInputElement;
    const yVal = this.inspectorEl.querySelector('#insp-y-val') as HTMLElement;
    ySlider?.addEventListener('input', () => {
      kf.actorYOffset = parseInt(ySlider.value, 10);
      yVal.textContent = `${kf.actorYOffset}px`;
      this.sequencer.seek(this.sequencer.currentTimeMs);
      this.syncStudioFx(true);
    });

    const actorShakeSlider = this.inspectorEl.querySelector('#insp-actor-shake-slider') as HTMLInputElement;
    const actorShakeVal = this.inspectorEl.querySelector('#insp-actor-shake-val') as HTMLElement;
    actorShakeSlider?.addEventListener('input', () => {
      const val = parseInt(actorShakeSlider.value, 10) || 0;
      if (val === 0) {
        delete kf.actorShake;
      } else {
        kf.actorShake = val;
      }
      actorShakeVal.textContent = `${val}`;
      this.sequencer.seek(this.sequencer.currentTimeMs);
      this.renderKeyframeList();
      this.syncStudioFx(true);
    });

    // Raster Warping
    const warpSelect = this.inspectorEl.querySelector('#insp-warp-type') as HTMLSelectElement;
    const warpParams = this.inspectorEl.querySelector('#warp-params-container') as HTMLElement;
    warpSelect?.addEventListener('change', () => {
      const type = warpSelect.value as WarpEffectType;
      if (type === 'none') {
        delete kf.warp;
        warpParams.style.display = 'none';
      } else {
        kf.warp = kf.warp || {
          type,
          target: 'background',
          amplitude: 15,
          frequency: 0.05,
          speed: 0.01,
          durationMs: 2500,
        };
        kf.warp.type = type;
        warpParams.style.display = '';
      }
      this.sequencer.seek(this.sequencer.currentTimeMs);
      this.renderKeyframeList();
    });

    const warpTarget = this.inspectorEl.querySelector('#insp-warp-target') as HTMLSelectElement;
    warpTarget?.addEventListener('change', () => {
      if (kf.warp) {
        kf.warp.target = warpTarget.value as 'background' | 'all';
        this.sequencer.seek(this.sequencer.currentTimeMs);
      }
    });

    const warpAmp = this.inspectorEl.querySelector('#insp-warp-amp') as HTMLInputElement;
    const warpAmpVal = this.inspectorEl.querySelector('#insp-warp-amp-val') as HTMLElement;
    warpAmp?.addEventListener('input', () => {
      if (kf.warp) {
        kf.warp.amplitude = parseInt(warpAmp.value, 10);
        warpAmpVal.textContent = `${kf.warp.amplitude}px`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
      }
    });

    const warpFreq = this.inspectorEl.querySelector('#insp-warp-freq') as HTMLInputElement;
    const warpFreqVal = this.inspectorEl.querySelector('#insp-warp-freq-val') as HTMLElement;
    warpFreq?.addEventListener('input', () => {
      if (kf.warp) {
        kf.warp.frequency = parseFloat(warpFreq.value);
        warpFreqVal.textContent = kf.warp.frequency.toFixed(3);
        this.sequencer.seek(this.sequencer.currentTimeMs);
      }
    });

    const warpSpeed = this.inspectorEl.querySelector('#insp-warp-speed') as HTMLInputElement;
    const warpSpeedVal = this.inspectorEl.querySelector('#insp-warp-speed-val') as HTMLElement;
    warpSpeed?.addEventListener('input', () => {
      if (kf.warp) {
        kf.warp.speed = parseFloat(warpSpeed.value);
        warpSpeedVal.textContent = kf.warp.speed.toFixed(3);
        this.sequencer.seek(this.sequencer.currentTimeMs);
      }
    });

    const warpDur = this.inspectorEl.querySelector('#insp-warp-dur') as HTMLInputElement;
    warpDur?.addEventListener('change', () => {
      if (kf.warp) {
        kf.warp.durationMs = parseInt(warpDur.value, 10) || 2000;
      }
    });

    // Spawning FX
    const fxSelect = this.inspectorEl.querySelector('#insp-fx-select') as HTMLSelectElement;
    const fxParams = this.inspectorEl.querySelector('#fx-params-container') as HTMLElement;
    const flightParams = this.inspectorEl.querySelector('#fx-flight-params') as HTMLElement;

    const getPrimaryFx = () => {
      if (!kf.spawnFx) return null;
      if (Array.isArray(kf.spawnFx)) {
        return kf.spawnFx[this.selectedFxSubIndex] || kf.spawnFx[0];
      }
      return kf.spawnFx;
    };

    // Sub-index buttons for multi-FX keyframes
    this.inspectorEl.querySelectorAll('[data-fx-sub-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-fx-sub-idx') || '0', 10);
        this.selectedFxSubIndex = idx;
        this.renderInspector();
        this.syncStudioFx(true);
      });
    });

    fxSelect?.addEventListener('change', () => {
      const fxId = fxSelect.value;
      if (fxId === 'none') {
        if (Array.isArray(kf.spawnFx) && kf.spawnFx.length > 1) {
          kf.spawnFx.splice(this.selectedFxSubIndex, 1);
          this.selectedFxSubIndex = Math.max(0, this.selectedFxSubIndex - 1);
          if (kf.spawnFx.length === 1) kf.spawnFx = kf.spawnFx[0];
        } else {
          delete kf.spawnFx;
        }
        fxParams.style.display = 'none';
      } else {
        if (!kf.spawnFx) {
          kf.spawnFx = {
            fxId,
            paletteName: 'Solar Flame',
            size: 64,
            xFrac: 0.5,
            yFrac: 0.6,
            facing: 'right',
            durationMs: 1500,
          };
        } else {
          const fx = getPrimaryFx();
          if (fx) fx.fxId = fxId;
        }
        fxParams.style.display = '';
      }
      this.renderKeyframeList();
      this.syncStudioFx(true);
    });

    const fxPalette = this.inspectorEl.querySelector('#insp-fx-palette') as HTMLSelectElement;
    fxPalette?.addEventListener('change', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.paletteName = fxPalette.value;
        this.syncStudioFx(true);
      }
    });

    const fxSize = this.inspectorEl.querySelector('#insp-fx-size') as HTMLSelectElement;
    fxSize?.addEventListener('change', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.size = parseInt(fxSize.value, 10) || 64;
        this.syncStudioFx(true);
      }
    });

    const fxX = this.inspectorEl.querySelector('#insp-fx-x') as HTMLInputElement;
    const fxXVal = this.inspectorEl.querySelector('#insp-fx-x-val') as HTMLElement;
    fxX?.addEventListener('input', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.xFrac = parseInt(fxX.value, 10) / 100;
        fxXVal.textContent = `${parseInt(fxX.value, 10)}%`;
        this.syncStudioFx(true);
      }
    });

    const fxY = this.inspectorEl.querySelector('#insp-fx-y') as HTMLInputElement;
    const fxYVal = this.inspectorEl.querySelector('#insp-fx-y-val') as HTMLElement;
    fxY?.addEventListener('input', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.yFrac = parseInt(fxY.value, 10) / 100;
        fxYVal.textContent = `${parseInt(fxY.value, 10)}%`;
        this.syncStudioFx(true);
      }
    });

    const flightMode = this.inspectorEl.querySelector('#insp-fx-flight-mode') as HTMLSelectElement;
    flightMode?.addEventListener('change', () => {
      const fx = getPrimaryFx();
      if (fx) {
        if (flightMode.value === 'boss') {
          fx.targetXFrac = 0.76;
          fx.targetYFrac = 0.6;
          fx.speed = 0.42;
          flightParams.style.display = '';
        } else {
          delete fx.targetXFrac;
          delete fx.targetYFrac;
          delete fx.speed;
          flightParams.style.display = 'none';
        }
        this.renderKeyframeList();
        this.syncStudioFx(true);
      }
    });

    const fxTx = this.inspectorEl.querySelector('#insp-fx-tx') as HTMLInputElement;
    const fxTxVal = this.inspectorEl.querySelector('#insp-fx-tx-val') as HTMLElement;
    fxTx?.addEventListener('input', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.targetXFrac = parseInt(fxTx.value, 10) / 100;
        fxTxVal.textContent = `${parseInt(fxTx.value, 10)}%`;
        this.syncStudioFx(true);
      }
    });

    const fxTy = this.inspectorEl.querySelector('#insp-fx-ty') as HTMLInputElement;
    const fxTyVal = this.inspectorEl.querySelector('#insp-fx-ty-val') as HTMLElement;
    fxTy?.addEventListener('input', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.targetYFrac = parseInt(fxTy.value, 10) / 100;
        fxTyVal.textContent = `${parseInt(fxTy.value, 10)}%`;
        this.syncStudioFx(true);
      }
    });

    const fxSpd = this.inspectorEl.querySelector('#insp-fx-spd') as HTMLInputElement;
    const fxSpdVal = this.inspectorEl.querySelector('#insp-fx-spd-val') as HTMLElement;
    fxSpd?.addEventListener('input', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.speed = parseFloat(fxSpd.value);
        fxSpdVal.textContent = fx.speed.toFixed(2);
        this.syncStudioFx(true);
      }
    });

    const fxFacing = this.inspectorEl.querySelector('#insp-fx-facing') as HTMLSelectElement;
    fxFacing?.addEventListener('change', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.facing = fxFacing.value as 'right' | 'left';
        this.syncStudioFx(true);
      }
    });

    const fxDur = this.inspectorEl.querySelector('#insp-fx-dur') as HTMLInputElement;
    fxDur?.addEventListener('change', () => {
      const fx = getPrimaryFx();
      if (fx) {
        fx.durationMs = parseInt(fxDur.value, 10) || 1500;
        this.syncStudioFx(true);
      }
    });

    // Atmosphere
    const atmoDim = this.inspectorEl.querySelector('#insp-atmo-dim') as HTMLInputElement;
    const atmoDimVal = this.inspectorEl.querySelector('#insp-atmo-dim-val') as HTMLElement;
    atmoDim?.addEventListener('input', () => {
      kf.dimArena = parseFloat(atmoDim.value);
      atmoDimVal.textContent = `${Math.round(kf.dimArena * 100)}%`;
      this.sequencer.seek(this.sequencer.currentTimeMs);
    });

    const atmoShake = this.inspectorEl.querySelector('#insp-atmo-shake') as HTMLInputElement;
    const atmoShakeVal = this.inspectorEl.querySelector('#insp-atmo-shake-val') as HTMLElement;
    atmoShake?.addEventListener('input', () => {
      const val = parseInt(atmoShake.value, 10);
      if (val === 0) {
        delete kf.screenShake;
      } else {
        kf.screenShake = { intensity: val, durationMs: 400 };
      }
      atmoShakeVal.textContent = `${val}`;
      this.renderKeyframeList();
    });

    const atmoFlash = this.inspectorEl.querySelector('#insp-atmo-flash') as HTMLInputElement;
    atmoFlash?.addEventListener('change', () => {
      kf.flashWhite = atmoFlash.checked;
      this.renderKeyframeList();
    });

    const bossReaction = this.inspectorEl.querySelector('#insp-boss-reaction') as HTMLSelectElement;
    bossReaction?.addEventListener('change', () => {
      kf.bossReaction = bossReaction.value as 'idle' | 'hit' | 'downed';
      this.sequencer.seek(this.sequencer.currentTimeMs);
    });
  }

  private addKeyframeAtCurrentTime(): void {
    const timeMs = Math.round(this.sequencer.currentTimeMs);
    const existing = this.sequencer.sequence.keyframes.find((k) => k.timeMs === timeMs);
    if (existing) {
      alert(`A keyframe already exists at ${timeMs}ms.`);
      return;
    }

    const newKf: UltimateKeyframe = {
      timeMs,
      actorPose: this.sequencer.currentActorPose || 'attack_1',
      actorXOffset: this.sequencer.currentActorXOffset,
      actorYOffset: this.sequencer.currentActorYOffset,
      dimArena: this.sequencer.currentDimArena,
    };
    if (this.sequencer.currentActorShake > 0) {
      newKf.actorShake = this.sequencer.currentActorShake;
    }

    this.sequencer.sequence.keyframes.push(newKf);
    this.sequencer.sequence.keyframes.sort((a, b) => a.timeMs - b.timeMs);
    this.selectedKfIndex = this.sequencer.sequence.keyframes.indexOf(newKf);
    this.renderKeyframeList();
    this.renderInspector();
  }

  private deleteSelectedKeyframe(): void {
    if (this.sequencer.sequence.keyframes.length <= 1) {
      alert('Cannot delete the last keyframe of an ultimate sequence.');
      return;
    }

    this.sequencer.sequence.keyframes.splice(this.selectedKfIndex, 1);
    this.selectedKfIndex = Math.max(0, this.selectedKfIndex - 1);
    this.renderKeyframeList();
    this.renderInspector();
  }

  private getCharIdFromActor(actorId: string): string {
    if (actorId.startsWith('hero_')) return actorId.replace('hero_', '');
    if (actorId.startsWith('enemy_')) return actorId.replace('enemy_', '');
    return actorId;
  }
}
