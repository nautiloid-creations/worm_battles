import { BattleStage } from '../engine/BattleStage';
import {
  UltimateSequencer,
  UltimateSequence,
  ULTIMATE_PRESETS,
  ActionStep,
  ActionActorCard,
  ActionArenaCard,
  ActionSpriteCard,
} from '../engine/UltimateSequencer';
import { FX_LIST, FX_PALETTES } from '../engine/CombatFxManager';
import { WarpEffectType } from '../engine/RasterWarpManager';
import { SpriteKey } from '../engine/SpriteActor';

export class UltimateStudio {
  private stage: BattleStage;
  private sequencer: UltimateSequencer;
  private container: HTMLElement;

  private selectedKfIndex = 0;
  private isUserScrubbing = false;

  // DOM Elements
  private characterSelect!: HTMLSelectElement;
  private animationSelect!: HTMLSelectElement;
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
    this.container.innerHTML = `
      <div class="ultimate-studio action-studio">
        <!-- TOP TOOLBAR -->
        <div class="studio-topbar">
          <div class="studio-header-title">
            <h2>🎬 ACTION STUDIO</h2>
            <span class="studio-subtext">Action &amp; Ultimate Sequencer • Multi-Target Choreography • Retro FX</span>
          </div>

          <div class="studio-selectors-card">
            <!-- Row 1: Character Select & Animation Select -->
            <div class="studio-select-row">
              <div class="studio-select-group">
                <label for="action-character-select" class="preset-label">Character:</label>
                <select id="action-character-select" class="studio-select">
                  <optgroup label="Heroes">
                    <option value="hero_guitar_1">Hero Guitar 1</option>
                    <option value="hero_guitar_2">Hero Guitar 2</option>
                    <option value="hero_bass">Hero Bass</option>
                    <option value="hero_drums">Hero Drums</option>
                  </optgroup>
                  <optgroup label="Enemies">
                    <option value="the_worm">The Worm</option>
                    <option value="enemy_air_squid">Air Squid</option>
                  </optgroup>
                </select>
              </div>

              <div class="studio-select-group">
                <label for="action-animation-select" class="preset-label">Animation:</label>
                <select id="action-animation-select" class="studio-select">
                  <option value="single_attack">Single Attack</option>
                  <option value="group_attack">Group Attack</option>
                  <option value="ultimate" selected>Ultimate</option>
                </select>
              </div>
            </div>

            <!-- Row 2: Action Buttons below Character & Animation Select -->
            <div class="studio-actions-row">
              <button id="btn-studio-save" class="btn-studio-action primary-btn" title="Save sequence for selected character and animation">💾 Save</button>
              <button id="btn-studio-save-as" class="btn-studio-action" title="Save sequence as a different animation or file">📝 Save As...</button>
              <button id="btn-studio-load" class="btn-studio-action" title="Load sequence for selected character and animation">📂 Load</button>
            </div>
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

        <!-- SEQUENCE TIMELINE & STEPS LIST -->
        <div class="studio-section-card">
          <div class="studio-section-header">
            <h3>STEPS TIMELINE (${this.sequencer.sequence.keyframes.length} STEPS)</h3>
            <div class="studio-kf-actions">
              <button id="btn-studio-new-step" class="btn-studio-small btn-green">+ New Step</button>
              <button id="btn-studio-dup-step" class="btn-studio-small btn-studio-action">📋 Duplicate Step</button>
              <button id="btn-studio-del-step" class="btn-studio-small btn-red">🗑️ Delete Step</button>
            </div>
          </div>

          <div id="studio-keyframe-list" class="studio-kf-list">
            <!-- Dynamically populated step chips -->
          </div>
        </div>

        <!-- STEP INSPECTOR / PROPERTY EDITOR -->
        <div id="studio-inspector-card" class="studio-section-card inspector-card">
          <!-- Populated by renderInspector() -->
        </div>
      </div>
    `;

    // Cache elements
    this.characterSelect = this.container.querySelector('#action-character-select')!;
    this.animationSelect = this.container.querySelector('#action-animation-select')!;
    this.playPauseBtn = this.container.querySelector('#btn-studio-play')!;
    this.loopCheckbox = this.container.querySelector('#chk-studio-loop')!;
    this.speedSelect = this.container.querySelector('#sel-studio-speed')!;
    this.timeDisplay = this.container.querySelector('#studio-time-display')!;
    this.scrubberSlider = this.container.querySelector('#studio-scrubber-slider')!;
    this.keyframeListEl = this.container.querySelector('#studio-keyframe-list')!;
    this.inspectorEl = this.container.querySelector('#studio-inspector-card')!;

    // Match select with current sequencer actor
    if (this.sequencer.sequence.actorId) {
      this.characterSelect.value = this.sequencer.sequence.actorId;
    }

    this.renderKeyframeList();
    this.renderInspector();
  }

  private setupListeners(): void {
    // Character change (updates stage positioning and sequence actorId without auto-wiping sequence)
    this.characterSelect.addEventListener('change', () => {
      const charKey = this.characterSelect.value;
      if (charKey.startsWith('hero_')) {
        this.stage.bringHeroToFront(charKey);
      }
      this.sequencer.sequence.actorId = charKey;
    });

    // Save
    this.container.querySelector('#btn-studio-save')?.addEventListener('click', () => {
      this.saveCurrentAnimation();
    });

    // Save As
    this.container.querySelector('#btn-studio-save-as')?.addEventListener('click', () => {
      this.saveAsAnimation();
    });

    // Load (loads corresponding JSON based on character and animation dropdowns)
    this.container.querySelector('#btn-studio-load')?.addEventListener('click', () => {
      this.loadSelectedAnimation();
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

    // Step Management
    this.container.querySelector('#btn-studio-new-step')?.addEventListener('click', () => {
      this.createNewStep();
    });

    this.container.querySelector('#btn-studio-dup-step')?.addEventListener('click', () => {
      this.duplicateCurrentStep();
    });

    this.container.querySelector('#btn-studio-del-step')?.addEventListener('click', () => {
      this.deleteCurrentStep();
    });
  }

  private createNewStep(): void {
    const keyframes = this.sequencer.sequence.keyframes;
    let newTime = 0;

    if (keyframes.length === 0) {
      newTime = 0;
    } else if (this.selectedKfIndex >= keyframes.length - 1) {
      newTime = keyframes[keyframes.length - 1].timeMs + 500;
    } else {
      const curTime = keyframes[this.selectedKfIndex].timeMs;
      const nextTime = keyframes[this.selectedKfIndex + 1].timeMs;
      newTime = Math.round((curTime + nextTime) / 2);
    }

    const newStep: ActionStep = {
      timeMs: newTime,
      type: 'single',
    };

    keyframes.push(newStep);
    keyframes.sort((a, b) => a.timeMs - b.timeMs);

    if (newTime > this.sequencer.sequence.durationMs) {
      this.sequencer.sequence.durationMs = newTime + 500;
      this.updateSliderMax();
    }

    this.selectedKfIndex = keyframes.indexOf(newStep);
    this.renderKeyframeList();
    this.renderInspector();
    this.sequencer.seek(newTime);
    this.syncStudioFx(true);
  }

  private duplicateCurrentStep(): void {
    const keyframes = this.sequencer.sequence.keyframes;
    const curStep = keyframes[this.selectedKfIndex];
    if (!curStep) return;

    let dupTime = curStep.timeMs + 200;
    if (this.selectedKfIndex < keyframes.length - 1) {
      const nextTime = keyframes[this.selectedKfIndex + 1].timeMs;
      dupTime = Math.round((curStep.timeMs + nextTime) / 2);
    }

    const dupStep: ActionStep = JSON.parse(JSON.stringify(curStep));
    dupStep.timeMs = dupTime;

    keyframes.push(dupStep);
    keyframes.sort((a, b) => a.timeMs - b.timeMs);

    if (dupTime > this.sequencer.sequence.durationMs) {
      this.sequencer.sequence.durationMs = dupTime + 500;
      this.updateSliderMax();
    }

    this.selectedKfIndex = keyframes.indexOf(dupStep);
    this.renderKeyframeList();
    this.renderInspector();
    this.sequencer.seek(dupTime);
    this.syncStudioFx(true);
  }

  private deleteCurrentStep(): void {
    const keyframes = this.sequencer.sequence.keyframes;
    if (keyframes.length <= 1) {
      alert('Cannot delete the last step in an action sequence.');
      return;
    }

    keyframes.splice(this.selectedKfIndex, 1);
    this.selectedKfIndex = Math.max(0, this.selectedKfIndex - 1);
    const newStep = keyframes[this.selectedKfIndex];

    this.renderKeyframeList();
    this.renderInspector();
    if (newStep) {
      this.sequencer.seek(newStep.timeMs);
      this.syncStudioFx(true);
    }
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

    keyframes.forEach((step, index) => {
      const chip = document.createElement('div');
      chip.className = `studio-kf-chip ${index === this.selectedKfIndex ? 'selected' : ''}`;

      const timeSec = (step.timeMs / 1000).toFixed(2);
      const isGroup = step.type === 'group';

      // Summarize badges for present cards
      const badges: string[] = [];
      const actorPose = step.actor?.pose || step.actorPose;
      if (actorPose) {
        badges.push(`👤 ${actorPose}`);
      }

      const enemiesPose = step.enemies?.pose || step.bossReaction;
      if (enemiesPose) {
        badges.push(`👾 ${enemiesPose}`);
      }

      if (step.arena || step.dimArena !== undefined || step.screenShake || step.flashWhite) {
        badges.push('🏟️ Arena');
      }

      if (step.warp) {
        badges.push(`🌊 ${step.warp.type}`);
      }

      const sprites = step.sprites || (step.spawnFx ? (Array.isArray(step.spawnFx) ? step.spawnFx : [step.spawnFx]) : []);
      if (sprites.length > 0) {
        badges.push(`⚡ ${sprites.length}x Sprite${sprites.length > 1 ? 's' : ''}`);
      }

      chip.innerHTML = `
        <div class="kf-chip-time">${timeSec}s</div>
        <div class="kf-chip-main">
          <div>
            <strong>Step #${index + 1}</strong>
            <span class="step-type-badge ${isGroup ? 'group' : 'single'}">${isGroup ? 'GROUP' : 'SINGLE'}</span>
          </div>
          <span class="kf-chip-details">${badges.length > 0 ? badges.join(' • ') : 'Empty Step'}</span>
        </div>
      `;

      chip.addEventListener('click', () => {
        this.selectedKfIndex = index;
        this.sequencer.seek(step.timeMs);
        this.renderKeyframeList();
        this.renderInspector();
        this.syncStudioFx(true);
      });

      this.keyframeListEl.appendChild(chip);
    });
  }

  private normalizeStep(step: ActionStep): void {
    // Migrate legacy fields into modular cards if not already set
    if (!step.actor && (step.actorPose || step.actorXOffset !== undefined || step.actorYOffset !== undefined || step.actorShake !== undefined)) {
      step.actor = {
        pose: step.actorPose || 'attack_1',
        xOffset: step.actorXOffset || 0,
        yOffset: step.actorYOffset || 0,
        flipX: step.actorFlipX || false,
        rotation: step.actorRotation || 0,
        shake: step.actorShake || 0,
      };
    }

    if (!step.arena && (step.dimArena !== undefined || step.screenShake || step.flashWhite)) {
      step.arena = {
        darkness: step.dimArena || 0,
        screenShake: step.screenShake || { intensity: 0, durationMs: 0 },
        flash: {
          enabled: !!step.flashWhite,
          opacity: 85,
          paletteName: 'White',
        },
      };
    }

    if (!step.enemies && step.bossReaction) {
      step.enemies = {
        pose: step.bossReaction as SpriteKey,
        xOffset: 0,
        yOffset: 0,
        flipX: false,
        rotation: 0,
        shake: 0,
      };
    }

    if (!step.sprites && step.spawnFx) {
      const defs = Array.isArray(step.spawnFx) ? step.spawnFx : [step.spawnFx];
      step.sprites = defs.map((d) => ({
        ...d,
        type: d.targetXFrac !== undefined ? 'projectile' : 'static',
      }));
    }
  }

  private renderInspector(): void {
    const step = this.sequencer.sequence.keyframes[this.selectedKfIndex];
    if (!step) {
      this.inspectorEl.innerHTML = `<div class="inspector-empty">No step selected.</div>`;
      return;
    }

    this.normalizeStep(step);

    const hasActor = !!step.actor;
    const hasArena = !!step.arena;
    const hasEnemies = !!step.enemies;
    const hasWarp = !!step.warp;
    const spritesList = step.sprites || [];

    // Header with required Time, Type, and + Add Effect... dropdown
    let html = `
      <div class="studio-section-header">
        <h3>STEP #${this.selectedKfIndex + 1} INSPECTOR @ ${(step.timeMs / 1000).toFixed(2)}s</h3>
        <span class="studio-subtext">Edits apply live to sequence</span>
      </div>

      <div class="step-header-row">
        <div class="step-header-left">
          <div class="field-row">
            <label class="field-label" style="min-width:auto; font-weight:bold; color:#c7d2fe;">Time (ms):</label>
            <input type="number" id="insp-step-time" class="studio-num-input" value="${step.timeMs}" step="50" min="0" />
          </div>
          <div class="field-row">
            <label class="field-label" style="min-width:auto; font-weight:bold; color:#c7d2fe;">Type:</label>
            <select id="insp-step-type" class="studio-select-small">
              <option value="single" ${step.type !== 'group' ? 'selected' : ''}>Single Target</option>
              <option value="group" ${step.type === 'group' ? 'selected' : ''}>Group Target</option>
            </select>
          </div>
        </div>

        <div class="step-header-right">
          <select id="insp-add-effect-select" class="studio-select-small" style="background:#1e3b6e; border-color:#3b82f6; color:#fff; font-weight:bold;">
            <option value="" disabled selected>+ Add Effect...</option>
            <option value="actor" ${hasActor ? 'disabled' : ''}>Actor</option>
            <option value="arena" ${hasArena ? 'disabled' : ''}>Arena</option>
            <option value="enemies" ${hasEnemies ? 'disabled' : ''}>Enemies</option>
            <option value="warp" ${hasWarp ? 'disabled' : ''}>Retro Raster</option>
            <option value="sprite">Sprites</option>
          </select>
        </div>
      </div>

      <div class="inspector-grid">
    `;

    // 1. ACTOR CARD
    if (step.actor) {
      html += this.renderActorCard(step.actor);
    }

    // 2. ARENA CARD
    if (step.arena) {
      html += this.renderArenaCard(step.arena);
    }

    // 3. ENEMIES CARD
    if (step.enemies) {
      html += this.renderEnemiesCard(step.enemies);
    }

    // 4. RETRO RASTER CARD
    if (step.warp) {
      html += this.renderRasterCard(step.warp);
    }

    // 5. SPRITES CARDS
    for (let i = 0; i < spritesList.length; i++) {
      html += this.renderSpriteCard(spritesList[i], i);
    }

    if (!hasActor && !hasArena && !hasEnemies && !hasWarp && spritesList.length === 0) {
      html += `
        <div class="inspector-empty" style="grid-column: 1 / -1; padding: 30px; background:#100c22; border-radius:4px; border:1px dashed #342b5c;">
          This step is currently blank. Use <strong>+ Add Effect...</strong> above to compose this step.
        </div>
      `;
    }

    html += `</div>`;
    this.inspectorEl.innerHTML = html;

    this.setupStepInspectorListeners(step);
  }

  private renderActorCard(actor: ActionActorCard): string {
    const poses: SpriteKey[] = [
      'idle_1',
      'idle_2',
      'active_1',
      'active_2',
      'attack_1',
      'attack_2',
      'ultimate_1',
      'ultimate_2',
      'hit',
      'downed',
    ];

    const poseOptions = poses
      .map((p) => `<option value="${p}" ${actor.pose === p ? 'selected' : ''}>${p}</option>`)
      .join('');

    const rot = actor.rotation || 0;

    return `
      <div class="inspector-card-group actor-group">
        <div class="card-header-row">
          <h4>🧍 ACTOR</h4>
          <button type="button" class="btn-card-delete" id="btn-del-actor-card" title="Delete Actor card from this step">🗑️ Delete Card</button>
        </div>

        <div class="field-row">
          <label class="field-label">Pose:</label>
          <select id="insp-actor-pose" class="studio-select">
            ${poseOptions}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">X Offset (% Width):</label>
          <input type="range" id="insp-actor-x" class="studio-slider" min="-100" max="100" step="0.5" value="${actor.xOffset}" title="Double-click to reset to 0%" />
          <span id="insp-actor-x-val" class="field-val">${actor.xOffset.toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Y Offset (% Height):</label>
          <input type="range" id="insp-actor-y" class="studio-slider" min="-100" max="100" step="0.5" value="${actor.yOffset}" title="Double-click to reset to 0%" />
          <span id="insp-actor-y-val" class="field-val">${actor.yOffset.toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Flip Horizontal:</label>
          <label class="studio-checkbox-label">
            <input type="checkbox" id="insp-actor-flip" ${actor.flipX ? 'checked' : ''} />
            <span>Facing Left (Mirrored)</span>
          </label>
        </div>

        <div class="field-row">
          <label class="field-label">Rotation:</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="actor-rotation-radio" value="0" ${rot === 0 ? 'checked' : ''} />
              <span>0°</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="actor-rotation-radio" value="-90" ${rot === -90 ? 'checked' : ''} />
              <span>-90°</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="actor-rotation-radio" value="90" ${rot === 90 ? 'checked' : ''} />
              <span>90°</span>
            </label>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Actor Shake (% Height):</label>
          <input type="range" id="insp-actor-shake" class="studio-slider" min="0" max="20" step="0.5" value="${actor.shake ?? 0}" title="Double-click to reset to 0%" />
          <span id="insp-actor-shake-val" class="field-val">${(actor.shake ?? 0).toFixed(1)}%</span>
        </div>
      </div>
    `;
  }

  private renderArenaCard(arena: ActionArenaCard): string {
    const flash = arena.flash || { enabled: false, opacity: 85, paletteName: 'White' };
    const paletteNames = ['White', ...Object.keys(FX_PALETTES)];
    const colorOptions = paletteNames
      .map((c) => `<option value="${c}" ${flash.paletteName === c ? 'selected' : ''}>${c}</option>`)
      .join('');

    return `
      <div class="inspector-card-group atmo-group">
        <div class="card-header-row">
          <h4>🏟️ ARENA</h4>
          <button type="button" class="btn-card-delete" id="btn-del-arena-card" title="Delete Arena card from this step">🗑️ Delete Card</button>
        </div>

        <div class="field-row">
          <label class="field-label">Darkness (0-1):</label>
          <input type="range" id="insp-arena-darkness" class="studio-slider" min="0" max="1" step="0.05" value="${arena.darkness ?? 0}" />
          <span id="insp-arena-darkness-val" class="field-val">${Math.round((arena.darkness ?? 0) * 100)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Screen Shake:</label>
          <input type="range" id="insp-arena-shake" class="studio-slider" min="0" max="20" step="1" value="${arena.screenShake?.intensity || 0}" />
          <span id="insp-arena-shake-val" class="field-val">${arena.screenShake?.intensity || 0}</span>
        </div>

        <div class="field-row" style="margin-top: 4px; border-top: 1px dashed #241d3f; padding-top: 6px;">
          <label class="field-label">Screen Flash:</label>
          <label class="studio-checkbox-label">
            <input type="checkbox" id="insp-arena-flash-chk" ${flash.enabled ? 'checked' : ''} />
            <span>Enable Screen Flash</span>
          </label>
        </div>

        <div id="arena-flash-sub controls" style="${!flash.enabled ? 'display:none;' : ''}">
          <div class="field-row">
            <label class="field-label">Opacity (0-100%):</label>
            <input type="number" id="insp-arena-flash-opac" class="studio-num-input" min="0" max="100" step="1" value="${flash.opacity ?? 85}" />
          </div>

          <div class="field-row">
            <label class="field-label">Color:</label>
            <select id="insp-arena-flash-color" class="studio-select">
              ${colorOptions}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  private renderEnemiesCard(enemies: ActionActorCard): string {
    const poses: SpriteKey[] = [
      'idle_1',
      'idle_2',
      'active_1',
      'active_2',
      'attack_1',
      'attack_2',
      'ultimate_1',
      'ultimate_2',
      'hit',
      'downed',
    ];

    const poseOptions = poses
      .map((p) => `<option value="${p}" ${enemies.pose === p ? 'selected' : ''}>${p}</option>`)
      .join('');

    const rot = enemies.rotation || 0;

    return `
      <div class="inspector-card-group enemies-group">
        <div class="card-header-row">
          <h4>👾 ENEMIES</h4>
          <button type="button" class="btn-card-delete" id="btn-del-enemies-card" title="Delete Enemies card from this step">🗑️ Delete Card</button>
        </div>

        <div class="field-row">
          <label class="field-label">Pose:</label>
          <select id="insp-enemies-pose" class="studio-select">
            ${poseOptions}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">X Offset (% Width):</label>
          <input type="range" id="insp-enemies-x" class="studio-slider" min="-100" max="100" step="0.5" value="${enemies.xOffset}" title="Double-click to reset to 0%" />
          <span id="insp-enemies-x-val" class="field-val">${enemies.xOffset.toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Y Offset (% Height):</label>
          <input type="range" id="insp-enemies-y" class="studio-slider" min="-100" max="100" step="0.5" value="${enemies.yOffset}" title="Double-click to reset to 0%" />
          <span id="insp-enemies-y-val" class="field-val">${enemies.yOffset.toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Flip Horizontal:</label>
          <label class="studio-checkbox-label">
            <input type="checkbox" id="insp-enemies-flip" ${enemies.flipX ? 'checked' : ''} />
            <span>Facing Right (Mirrored)</span>
          </label>
        </div>

        <div class="field-row">
          <label class="field-label">Rotation:</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="enemies-rotation-radio" value="0" ${rot === 0 ? 'checked' : ''} />
              <span>0°</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="enemies-rotation-radio" value="-90" ${rot === -90 ? 'checked' : ''} />
              <span>-90°</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="enemies-rotation-radio" value="90" ${rot === 90 ? 'checked' : ''} />
              <span>90°</span>
            </label>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Enemy Shake (% Height):</label>
          <input type="range" id="insp-enemies-shake" class="studio-slider" min="0" max="20" step="0.5" value="${enemies.shake ?? 0}" title="Double-click to reset to 0%" />
          <span id="insp-enemies-shake-val" class="field-val">${(enemies.shake ?? 0).toFixed(1)}%</span>
        </div>
      </div>
    `;
  }

  private renderRasterCard(warp: NonNullable<ActionStep['warp']>): string {
    const warpTypes: { id: WarpEffectType; label: string }[] = [
      { id: 'screen_melt', label: '🩸 Retro Screen Melt (DOOM)' },
      { id: 'scanline_undulation', label: '🌊 Scanline Undulation (EarthBound / JRPG)' },
      { id: 'heat_shimmer', label: '🔥 Desert Heat Shimmer (Mirage)' },
      { id: 'radial_shockwave', label: '💥 Radial Shockwave (Blast)' },
      { id: 'void_vortex', label: '🌀 Void Gravitational Vortex' },
      { id: 'none', label: 'None' },
    ];

    const warpOptions = warpTypes
      .map((w) => `<option value="${w.id}" ${warp.type === w.id ? 'selected' : ''}>${w.label}</option>`)
      .join('');

    return `
      <div class="inspector-card-group warp-group">
        <div class="card-header-row">
          <h4>🌀 RETRO RASTER</h4>
          <button type="button" class="btn-card-delete" id="btn-del-warp-card" title="Delete Retro Raster card from this step">🗑️ Delete Card</button>
        </div>

        <div class="field-row">
          <label class="field-label">Effect Mode:</label>
          <select id="insp-warp-type" class="studio-select">
            ${warpOptions}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">Target Layer:</label>
          <select id="insp-warp-target" class="studio-select">
            <option value="background" ${warp.target === 'background' ? 'selected' : ''}>Background Arena Only</option>
            <option value="all" ${warp.target === 'all' ? 'selected' : ''}>Whole Scene (Background + Actors + FX)</option>
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">Amplitude (% Separation):</label>
          <input type="range" id="insp-warp-amp" class="studio-slider" min="0.5" max="100" step="0.5" value="${warp.amplitude ?? 20}" />
          <span id="insp-warp-amp-val" class="field-val">${(warp.amplitude ?? 20).toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Frequency (% Column Width):</label>
          <input type="range" id="insp-warp-freq" class="studio-slider" min="0.5" max="25" step="0.5" value="${(warp.frequency ?? 0.05) > 1 ? (warp.frequency ?? 10) : (warp.frequency ?? 0.05) * 100}" />
          <span id="insp-warp-freq-val" class="field-val">${((warp.frequency ?? 0.05) > 1 ? (warp.frequency ?? 10) : (warp.frequency ?? 0.05) * 100).toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Speed (% Descent Speed):</label>
          <input type="range" id="insp-warp-speed" class="studio-slider" min="1" max="100" step="1" value="${(warp.speed ?? 0.01) > 1 ? (warp.speed ?? 20) : Math.round((warp.speed ?? 0.01) * 1000)}" />
          <span id="insp-warp-speed-val" class="field-val">${(warp.speed ?? 0.01) > 1 ? Math.round(warp.speed ?? 20) : Math.round((warp.speed ?? 0.01) * 1000)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Duration (ms):</label>
          <input type="number" id="insp-warp-dur" class="studio-num-input" min="100" max="5000" step="100" value="${warp.durationMs || 1500}" />
        </div>
      </div>
    `;
  }

  private renderSpriteCard(sprite: ActionSpriteCard, index: number): string {
    const fxOptions = FX_LIST.map(
      (fx) => `<option value="${fx.id}" ${sprite.fxId === fx.id ? 'selected' : ''}>${fx.label}</option>`
    ).join('');

    const paletteNames = ['White', ...Object.keys(FX_PALETTES)];
    const paletteOptions = paletteNames
      .map((p) => `<option value="${p}" ${sprite.paletteName === p ? 'selected' : ''}>${p}</option>`)
      .join('');

    const sizePct = sprite.size > 0 ? sprite.size : 10;
    const isProjectile = sprite.type === 'projectile' || sprite.targetXFrac !== undefined;
    const rot = sprite.rotation || 0;

    return `
      <div class="inspector-card-group fx-group">
        <div class="card-header-row">
          <h4>⚡ SPRITE FX #${index + 1}</h4>
          <button type="button" class="btn-card-delete" data-del-sprite-idx="${index}" title="Delete this Sprite from step">🗑️ Delete Sprite</button>
        </div>

        <div class="field-row">
          <label class="field-label">Sprite:</label>
          <select class="studio-select" data-sprite-field="fxId" data-sprite-idx="${index}">
            ${fxOptions}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">Palette:</label>
          <select class="studio-select" data-sprite-field="paletteName" data-sprite-idx="${index}">
            ${paletteOptions}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">Size (% Height):</label>
          <input type="range" class="studio-slider" data-sprite-field="size" data-sprite-idx="${index}" min="1" max="100" step="0.5" value="${sizePct.toFixed(1)}" title="Double-click to reset to 10.0%" />
          <span class="field-val" id="sprite-size-val-${index}">${sizePct.toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">X Position (% Width):</label>
          <input type="range" class="studio-slider" data-sprite-field="xFrac" data-sprite-idx="${index}" min="-50" max="150" step="0.5" value="${(sprite.xFrac * 100).toFixed(1)}" title="Double-click to reset to 50%" />
          <span class="field-val" id="sprite-x-val-${index}">${(sprite.xFrac * 100).toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Y Position (% Height):</label>
          <input type="range" class="studio-slider" data-sprite-field="yFrac" data-sprite-idx="${index}" min="-50" max="150" step="0.5" value="${(sprite.yFrac * 100).toFixed(1)}" title="Double-click to reset to 50%" />
          <span class="field-val" id="sprite-y-val-${index}">${(sprite.yFrac * 100).toFixed(1)}%</span>
        </div>

        <div class="field-row">
          <label class="field-label">Type:</label>
          <select class="studio-select" data-sprite-field="type" data-sprite-idx="${index}">
            <option value="static" ${!isProjectile ? 'selected' : ''}>Static</option>
            <option value="projectile" ${isProjectile ? 'selected' : ''}>Projectile</option>
          </select>
        </div>

        <div id="sprite-projectile-controls-${index}" style="${!isProjectile ? 'display:none;' : ''}">
          <div class="field-row">
            <label class="field-label">X Target (% Width):</label>
            <input type="range" class="studio-slider" data-sprite-field="targetXFrac" data-sprite-idx="${index}" min="-50" max="150" step="0.5" value="${((sprite.targetXFrac ?? 0.76) * 100).toFixed(1)}" title="Double-click to reset to 76%" />
            <span class="field-val" id="sprite-tx-val-${index}">${((sprite.targetXFrac ?? 0.76) * 100).toFixed(1)}%</span>
          </div>

          <div class="field-row">
            <label class="field-label">Y Target (% Height):</label>
            <input type="range" class="studio-slider" data-sprite-field="targetYFrac" data-sprite-idx="${index}" min="-50" max="150" step="0.5" value="${((sprite.targetYFrac ?? 0.6) * 100).toFixed(1)}" title="Double-click to reset to 60%" />
            <span class="field-val" id="sprite-ty-val-${index}">${((sprite.targetYFrac ?? 0.6) * 100).toFixed(1)}%</span>
          </div>

          <div class="field-row">
            <label class="field-label">Speed:</label>
            <input type="range" class="studio-slider" data-sprite-field="speed" data-sprite-idx="${index}" min="0.1" max="3.0" step="0.05" value="${sprite.speed || 0.4}" />
            <span class="field-val" id="sprite-spd-val-${index}">${(sprite.speed || 0.4).toFixed(2)}</span>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Flip Horizontal:</label>
          <label class="studio-checkbox-label">
            <input type="checkbox" data-sprite-field="flipX" data-sprite-idx="${index}" ${sprite.flipX ? 'checked' : ''} />
            <span>Facing Left (Mirrored)</span>
          </label>
        </div>

        <div class="field-row">
          <label class="field-label">Rotation:</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="sprite-rot-${index}" value="0" ${rot === 0 ? 'checked' : ''} data-sprite-rot-idx="${index}" />
              <span>0°</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="sprite-rot-${index}" value="-90" ${rot === -90 ? 'checked' : ''} data-sprite-rot-idx="${index}" />
              <span>-90°</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="sprite-rot-${index}" value="90" ${rot === 90 ? 'checked' : ''} data-sprite-rot-idx="${index}" />
              <span>90°</span>
            </label>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Duration (ms):</label>
          <input type="number" class="studio-num-input" data-sprite-field="durationMs" data-sprite-idx="${index}" min="100" max="5000" step="50" value="${sprite.durationMs || 1000}" />
        </div>
      </div>
    `;
  }

  private setupStepInspectorListeners(step: ActionStep): void {
    // 1. Time (ms)
    const timeInput = this.inspectorEl.querySelector<HTMLInputElement>('#insp-step-time');
    timeInput?.addEventListener('change', () => {
      step.timeMs = Math.max(0, parseInt(timeInput.value, 10) || 0);
      this.sequencer.sequence.keyframes.sort((a, b) => a.timeMs - b.timeMs);
      this.selectedKfIndex = this.sequencer.sequence.keyframes.indexOf(step);
      this.renderKeyframeList();
      this.sequencer.seek(step.timeMs);
      this.syncStudioFx(true);
    });

    // 2. Type (single / group)
    const typeSelect = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-step-type');
    typeSelect?.addEventListener('change', () => {
      step.type = typeSelect.value as 'single' | 'group';
      this.renderKeyframeList();
      this.sequencer.seek(this.sequencer.currentTimeMs);
    });

    // 3. Add Effect... Dropdown
    const addEffectSelect = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-add-effect-select');
    addEffectSelect?.addEventListener('change', () => {
      const effect = addEffectSelect.value;
      if (effect === 'actor') {
        step.actor = {
          pose: 'attack_1',
          xOffset: 0,
          yOffset: 0,
          flipX: false,
          rotation: 0,
          shake: 0,
        };
      } else if (effect === 'arena') {
        step.arena = {
          darkness: 0,
          screenShake: { intensity: 0, durationMs: 0 },
          flash: { enabled: false, opacity: 85, paletteName: 'White' },
        };
      } else if (effect === 'enemies') {
        step.enemies = {
          pose: 'hit',
          xOffset: 0,
          yOffset: 0,
          flipX: false,
          rotation: 0,
          shake: 0,
        };
      } else if (effect === 'warp') {
        step.warp = {
          type: 'screen_melt',
          target: 'background',
          amplitude: 20,
          frequency: 10,
          speed: 20,
          durationMs: 1200,
        };
      } else if (effect === 'sprite') {
        step.sprites = step.sprites || [];
        step.sprites.push({
          fxId: FX_LIST[0].id,
          paletteName: 'White',
          size: 10,
          xFrac: 0.5,
          yFrac: 0.5,
          type: 'static',
          flipX: false,
          rotation: 0,
          durationMs: 1000,
        });
      }

      this.renderKeyframeList();
      this.renderInspector();
      this.sequencer.seek(this.sequencer.currentTimeMs);
      this.syncStudioFx(true);
    });

    // --- ACTOR CARD LISTENERS ---
    if (step.actor) {
      const actor = step.actor;
      this.inspectorEl.querySelector('#btn-del-actor-card')?.addEventListener('click', () => {
        delete step.actor;
        delete step.actorPose;
        delete step.actorXOffset;
        delete step.actorYOffset;
        delete step.actorShake;
        delete step.actorFlipX;
        delete step.actorRotation;
        this.renderKeyframeList();
        this.renderInspector();
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      const poseSel = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-actor-pose');
      poseSel?.addEventListener('change', () => {
        actor.pose = poseSel.value as SpriteKey;
        this.renderKeyframeList();
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      const xSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-actor-x');
      const xVal = this.inspectorEl.querySelector<HTMLElement>('#insp-actor-x-val');
      xSlider?.addEventListener('input', () => {
        actor.xOffset = Math.round((parseFloat(xSlider.value) || 0) * 2) / 2;
        if (xVal) xVal.textContent = `${actor.xOffset.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });
      xSlider?.addEventListener('dblclick', () => {
        xSlider.value = '0';
        xSlider.dispatchEvent(new Event('input'));
      });

      const ySlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-actor-y');
      const yVal = this.inspectorEl.querySelector<HTMLElement>('#insp-actor-y-val');
      ySlider?.addEventListener('input', () => {
        actor.yOffset = Math.round((parseFloat(ySlider.value) || 0) * 2) / 2;
        if (yVal) yVal.textContent = `${actor.yOffset.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });
      ySlider?.addEventListener('dblclick', () => {
        ySlider.value = '0';
        ySlider.dispatchEvent(new Event('input'));
      });

      const flipChk = this.inspectorEl.querySelector<HTMLInputElement>('#insp-actor-flip');
      flipChk?.addEventListener('change', () => {
        actor.flipX = flipChk.checked;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      this.inspectorEl.querySelectorAll('input[name="actor-rotation-radio"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          actor.rotation = parseInt((e.target as HTMLInputElement).value, 10) as 0 | -90 | 90;
          this.sequencer.seek(this.sequencer.currentTimeMs);
          this.syncStudioFx(true);
        });
      });

      const shakeSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-actor-shake');
      const shakeVal = this.inspectorEl.querySelector<HTMLElement>('#insp-actor-shake-val');
      shakeSlider?.addEventListener('input', () => {
        actor.shake = Math.round((parseFloat(shakeSlider.value) || 0) * 2) / 2;
        if (shakeVal) shakeVal.textContent = `${actor.shake.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });
      shakeSlider?.addEventListener('dblclick', () => {
        shakeSlider.value = '0';
        shakeSlider.dispatchEvent(new Event('input'));
      });
    }

    // --- ARENA CARD LISTENERS ---
    if (step.arena) {
      const arena = step.arena;
      this.inspectorEl.querySelector('#btn-del-arena-card')?.addEventListener('click', () => {
        delete step.arena;
        delete step.dimArena;
        delete step.screenShake;
        delete step.flashWhite;
        this.renderKeyframeList();
        this.renderInspector();
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      const darkSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-arena-darkness');
      const darkVal = this.inspectorEl.querySelector<HTMLElement>('#insp-arena-darkness-val');
      darkSlider?.addEventListener('input', () => {
        arena.darkness = parseFloat(darkSlider.value) || 0;
        if (darkVal) darkVal.textContent = `${Math.round(arena.darkness * 100)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });
      darkSlider?.addEventListener('dblclick', () => {
        darkSlider.value = '0';
        darkSlider.dispatchEvent(new Event('input'));
      });

      const shakeSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-arena-shake');
      const shakeVal = this.inspectorEl.querySelector<HTMLElement>('#insp-arena-shake-val');
      shakeSlider?.addEventListener('input', () => {
        const val = parseInt(shakeSlider.value, 10) || 0;
        arena.screenShake = val > 0 ? { intensity: val, durationMs: 400 } : undefined;
        if (shakeVal) shakeVal.textContent = `${val}`;
        this.renderKeyframeList();
      });
      shakeSlider?.addEventListener('dblclick', () => {
        shakeSlider.value = '0';
        shakeSlider.dispatchEvent(new Event('input'));
      });

      const flashChk = this.inspectorEl.querySelector<HTMLInputElement>('#insp-arena-flash-chk');
      const flashControls = this.inspectorEl.querySelector<HTMLElement>('#arena-flash-sub');
      flashChk?.addEventListener('change', () => {
        arena.flash = arena.flash || { enabled: false, opacity: 85, paletteName: 'White' };
        arena.flash.enabled = flashChk.checked;
        if (flashControls) flashControls.style.display = arena.flash.enabled ? '' : 'none';
        this.renderKeyframeList();
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });

      const flashOpac = this.inspectorEl.querySelector<HTMLInputElement>('#insp-arena-flash-opac');
      flashOpac?.addEventListener('input', () => {
        if (arena.flash) {
          arena.flash.opacity = Math.max(0, Math.min(100, parseInt(flashOpac.value, 10) || 85));
          this.sequencer.seek(this.sequencer.currentTimeMs);
        }
      });

      const flashColor = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-arena-flash-color');
      flashColor?.addEventListener('change', () => {
        if (arena.flash) {
          arena.flash.paletteName = flashColor.value;
          this.sequencer.seek(this.sequencer.currentTimeMs);
        }
      });
    }

    // --- ENEMIES CARD LISTENERS ---
    if (step.enemies) {
      const enemies = step.enemies;
      this.inspectorEl.querySelector('#btn-del-enemies-card')?.addEventListener('click', () => {
        delete step.enemies;
        delete step.bossReaction;
        this.renderKeyframeList();
        this.renderInspector();
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      const poseSel = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-enemies-pose');
      poseSel?.addEventListener('change', () => {
        enemies.pose = poseSel.value as SpriteKey;
        this.renderKeyframeList();
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      const xSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-enemies-x');
      const xVal = this.inspectorEl.querySelector<HTMLElement>('#insp-enemies-x-val');
      xSlider?.addEventListener('input', () => {
        enemies.xOffset = Math.round((parseFloat(xSlider.value) || 0) * 2) / 2;
        if (xVal) xVal.textContent = `${enemies.xOffset.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });
      xSlider?.addEventListener('dblclick', () => {
        xSlider.value = '0';
        xSlider.dispatchEvent(new Event('input'));
      });

      const ySlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-enemies-y');
      const yVal = this.inspectorEl.querySelector<HTMLElement>('#insp-enemies-y-val');
      ySlider?.addEventListener('input', () => {
        enemies.yOffset = Math.round((parseFloat(ySlider.value) || 0) * 2) / 2;
        if (yVal) yVal.textContent = `${enemies.yOffset.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });
      ySlider?.addEventListener('dblclick', () => {
        ySlider.value = '0';
        ySlider.dispatchEvent(new Event('input'));
      });

      const flipChk = this.inspectorEl.querySelector<HTMLInputElement>('#insp-enemies-flip');
      flipChk?.addEventListener('change', () => {
        enemies.flipX = flipChk.checked;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });

      this.inspectorEl.querySelectorAll('input[name="enemies-rotation-radio"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          enemies.rotation = parseInt((e.target as HTMLInputElement).value, 10) as 0 | -90 | 90;
          this.sequencer.seek(this.sequencer.currentTimeMs);
          this.syncStudioFx(true);
        });
      });

      const shakeSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-enemies-shake');
      const shakeVal = this.inspectorEl.querySelector<HTMLElement>('#insp-enemies-shake-val');
      shakeSlider?.addEventListener('input', () => {
        enemies.shake = Math.round((parseFloat(shakeSlider.value) || 0) * 2) / 2;
        if (shakeVal) shakeVal.textContent = `${enemies.shake.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
        this.syncStudioFx(true);
      });
      shakeSlider?.addEventListener('dblclick', () => {
        shakeSlider.value = '0';
        shakeSlider.dispatchEvent(new Event('input'));
      });
    }

    // --- RETRO RASTER CARD LISTENERS ---
    if (step.warp) {
      const warp = step.warp;
      this.inspectorEl.querySelector('#btn-del-warp-card')?.addEventListener('click', () => {
        delete step.warp;
        this.renderKeyframeList();
        this.renderInspector();
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });

      const warpTypeSel = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-warp-type');
      warpTypeSel?.addEventListener('change', () => {
        warp.type = warpTypeSel.value as WarpEffectType;
        this.renderKeyframeList();
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });

      const targetSel = this.inspectorEl.querySelector<HTMLSelectElement>('#insp-warp-target');
      targetSel?.addEventListener('change', () => {
        warp.target = targetSel.value as 'background' | 'all';
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });

      const ampSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-warp-amp');
      const ampVal = this.inspectorEl.querySelector<HTMLElement>('#insp-warp-amp-val');
      ampSlider?.addEventListener('input', () => {
        warp.amplitude = Math.round((parseFloat(ampSlider.value) || 0) * 2) / 2;
        if (ampVal) ampVal.textContent = `${warp.amplitude.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });
      ampSlider?.addEventListener('dblclick', () => {
        ampSlider.value = '20';
        ampSlider.dispatchEvent(new Event('input'));
      });

      const freqSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-warp-freq');
      const freqVal = this.inspectorEl.querySelector<HTMLElement>('#insp-warp-freq-val');
      freqSlider?.addEventListener('input', () => {
        const val = parseFloat(freqSlider.value) || 10;
        warp.frequency = val / 100; // Store as fraction or percentage
        if (freqVal) freqVal.textContent = `${val.toFixed(1)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });
      freqSlider?.addEventListener('dblclick', () => {
        freqSlider.value = '10';
        freqSlider.dispatchEvent(new Event('input'));
      });

      const speedSlider = this.inspectorEl.querySelector<HTMLInputElement>('#insp-warp-speed');
      const speedVal = this.inspectorEl.querySelector<HTMLElement>('#insp-warp-speed-val');
      speedSlider?.addEventListener('input', () => {
        const val = parseFloat(speedSlider.value) || 20;
        warp.speed = val / 1000;
        if (speedVal) speedVal.textContent = `${Math.round(val)}%`;
        this.sequencer.seek(this.sequencer.currentTimeMs);
      });
      speedSlider?.addEventListener('dblclick', () => {
        speedSlider.value = '20';
        speedSlider.dispatchEvent(new Event('input'));
      });

      const durInput = this.inspectorEl.querySelector<HTMLInputElement>('#insp-warp-dur');
      durInput?.addEventListener('change', () => {
        warp.durationMs = Math.max(100, parseInt(durInput.value, 10) || 1500);
      });
    }

    // --- SPRITES CARDS LISTENERS ---
    if (step.sprites) {
      this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-del-sprite-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-del-sprite-idx') || '0', 10);
          step.sprites?.splice(idx, 1);
          if (step.sprites && step.sprites.length === 0) {
            delete step.sprites;
            delete step.spawnFx;
          }
          this.renderKeyframeList();
          this.renderInspector();
          this.syncStudioFx(true);
        });
      });

      this.inspectorEl.querySelectorAll<HTMLElement>('[data-sprite-field]').forEach((inputEl) => {
        const field = inputEl.getAttribute('data-sprite-field') as keyof ActionSpriteCard;
        const idx = parseInt(inputEl.getAttribute('data-sprite-idx') || '0', 10);
        const sprite = step.sprites?.[idx];
        if (!sprite) return;

        const eventName = inputEl.tagName === 'SELECT' || (inputEl as HTMLInputElement).type === 'checkbox' ? 'change' : 'input';

        inputEl.addEventListener(eventName, () => {
          if ((inputEl as HTMLInputElement).type === 'checkbox') {
            (sprite as any)[field] = (inputEl as HTMLInputElement).checked;
          } else if (field === 'size') {
            const val = parseFloat((inputEl as HTMLInputElement).value) || 10;
            sprite.size = Math.round(val * 2) / 2; // Snap to 0.5% increments
            const valEl = this.inspectorEl.querySelector(`#sprite-size-val-${idx}`);
            if (valEl) valEl.textContent = `${sprite.size.toFixed(1)}%`;
          } else if (field === 'xFrac' || field === 'yFrac' || field === 'targetXFrac' || field === 'targetYFrac') {
            const val = parseFloat((inputEl as HTMLInputElement).value) || 0;
            const rounded = Math.round(val * 2) / 2; // Snap to 0.5% increments
            (sprite as any)[field] = rounded / 100; // Store as fraction (e.g. 50% -> 0.5)
            const idMap: Record<string, string> = {
              xFrac: `sprite-x-val-${idx}`,
              yFrac: `sprite-y-val-${idx}`,
              targetXFrac: `sprite-tx-val-${idx}`,
              targetYFrac: `sprite-ty-val-${idx}`,
            };
            const valEl = this.inspectorEl.querySelector(`#${idMap[field]}`);
            if (valEl) valEl.textContent = `${rounded.toFixed(1)}%`;
          } else if (field === 'speed') {
            const val = parseFloat((inputEl as HTMLInputElement).value) || 0.4;
            sprite.speed = val;
            const valEl = this.inspectorEl.querySelector(`#sprite-spd-val-${idx}`);
            if (valEl) valEl.textContent = val.toFixed(2);
          } else if (field === 'type') {
            const typeVal = (inputEl as HTMLSelectElement).value as 'static' | 'projectile';
            sprite.type = typeVal;
            const projControls = this.inspectorEl.querySelector<HTMLElement>(`#sprite-projectile-controls-${idx}`);
            if (projControls) {
              projControls.style.display = typeVal === 'projectile' ? '' : 'none';
            }
            if (typeVal === 'projectile') {
              if (sprite.targetXFrac === undefined) sprite.targetXFrac = 0.76;
              if (sprite.targetYFrac === undefined) sprite.targetYFrac = 0.6;
              if (sprite.speed === undefined) sprite.speed = 0.4;
            } else {
              delete sprite.targetXFrac;
              delete sprite.targetYFrac;
              delete sprite.speed;
            }
          } else if (field === 'durationMs') {
            sprite.durationMs = Math.max(100, parseInt((inputEl as HTMLInputElement).value, 10) || 1000);
          } else {
            (sprite as any)[field] = (inputEl as HTMLInputElement).value;
          }

          this.syncStudioFx(true);
        });

        // Double-click to reset slider to default value
        if ((inputEl as HTMLInputElement).type === 'range') {
          inputEl.addEventListener('dblclick', () => {
            let defVal = '0';
            if (field === 'xFrac' || field === 'yFrac') defVal = '50';
            else if (field === 'targetXFrac') defVal = '76';
            else if (field === 'targetYFrac') defVal = '60';
            else if (field === 'size') defVal = '10';
            else if (field === 'speed') defVal = '0.4';
            (inputEl as HTMLInputElement).value = defVal;
            inputEl.dispatchEvent(new Event('input'));
          });
        }
      });

      this.inspectorEl.querySelectorAll<HTMLInputElement>('[data-sprite-rot-idx]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          const idx = parseInt(radio.getAttribute('data-sprite-rot-idx') || '0', 10);
          const sprite = step.sprites?.[idx];
          if (sprite) {
            sprite.rotation = parseInt((e.target as HTMLInputElement).value, 10) as 0 | -90 | 90;
            this.syncStudioFx(true);
          }
        });
      });
    }
  }

  private getCharIdFromActor(actorId: string): string {
    if (actorId.startsWith('hero_')) return actorId.replace('hero_', '');
    if (actorId.startsWith('enemy_')) return actorId.replace('enemy_', '');
    return actorId;
  }

  private getCharacterName(actorId: string): string {
    return this.characterSelect?.options[this.characterSelect.selectedIndex]?.text || actorId;
  }

  private getAnimationLabel(animKey: string): string {
    const map: Record<string, string> = {
      single_attack: 'single attack',
      group_attack: 'group attack',
      ultimate: 'ultimate',
    };
    return map[animKey] || animKey.replace(/_/g, ' ');
  }

  private createBoilerplateSequence(actorId: string, animKey: string): UltimateSequence {
    const charName = this.getCharacterName(actorId);
    const animLabel = this.getAnimationLabel(animKey);
    const isHero = actorId.startsWith('hero_');
    const isGroup = animKey === 'group_attack' || animKey === 'ultimate';

    if (animKey === 'ultimate') {
      return {
        actorId,
        name: `${charName} Ultimate`,
        durationMs: 3500,
        keyframes: [
          {
            timeMs: 0,
            type: 'group',
            actor: {
              pose: 'ultimate_1',
              xOffset: 0,
              yOffset: 0,
              flipX: false,
              rotation: 0,
              shake: 0,
            },
            arena: {
              darkness: 0.3,
            },
          },
        ],
      };
    }

    return {
      actorId,
      name: `${charName} ${animLabel}`,
      durationMs: isGroup ? 1200 : 1000,
      keyframes: [
        {
          timeMs: 0,
          type: isGroup ? 'group' : 'single',
          actor: {
            pose: 'attack_1',
            xOffset: 0,
            yOffset: 0,
            flipX: false,
            rotation: 0,
            shake: 0,
          },
        },
        {
          timeMs: isGroup ? 600 : 500,
          type: isGroup ? 'group' : 'single',
          actor: {
            pose: 'attack_2',
            xOffset: isHero ? 6 : -6,
            yOffset: 0,
            flipX: false,
            rotation: 0,
            shake: 0,
          },
        },
      ],
    };
  }

  private applyLoadedSequence(sequence: UltimateSequence, actorId: string): void {
    this.sequencer.setSequence(sequence);
    this.sequencer.sequence.actorId = actorId;
    if (actorId.startsWith('hero_')) {
      this.stage.bringHeroToFront(actorId);
    }
    this.selectedKfIndex = 0;
    this.updateSliderMax();
    this.renderKeyframeList();
    this.renderInspector();
    this.syncStudioFx(true);
  }

  private async loadSelectedAnimation(): Promise<void> {
    const actorId = this.characterSelect.value;
    const charId = this.getCharIdFromActor(actorId);
    const animKey = this.animationSelect.value;
    const charName = this.getCharacterName(actorId);
    const animLabel = this.getAnimationLabel(animKey);

    try {
      const res = await fetch(`/api/action-sequence?charId=${encodeURIComponent(charId)}&anim=${encodeURIComponent(animKey)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      if (data.exists && data.sequence) {
        this.applyLoadedSequence(data.sequence, actorId);
        return;
      }

      // If the selected animation doesn't exist for that character, show popup
      const create = confirm(`${animLabel} does not exist for ${charName}, create it now?`);
      if (create) {
        const boilerplate = this.createBoilerplateSequence(actorId, animKey);
        await fetch('/api/action-sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charId, animation: animKey, sequence: boilerplate }),
        });
        this.applyLoadedSequence(boilerplate, actorId);
      }
      // If "Cancel", don't do anything
    } catch (err: any) {
      if (animKey === 'ultimate' && ULTIMATE_PRESETS[actorId]) {
        this.applyLoadedSequence(JSON.parse(JSON.stringify(ULTIMATE_PRESETS[actorId])), actorId);
        return;
      }
      alert(`Error loading ${animLabel}: ${err.message}`);
    }
  }

  private async saveCurrentAnimation(): Promise<void> {
    const actorId = this.characterSelect.value;
    const charId = this.getCharIdFromActor(actorId);
    const animKey = this.animationSelect.value;
    const charName = this.getCharacterName(actorId);
    const animLabel = this.getAnimationLabel(animKey);

    try {
      // Whenever the user clicks "Save" and the file already exists, display confirmation
      const checkRes = await fetch(`/api/action-sequence?charId=${encodeURIComponent(charId)}&anim=${encodeURIComponent(animKey)}`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.exists) {
          const overwrite = confirm(`overwrite existing ${animLabel} for ${charName}?`);
          if (!overwrite) return;
        }
      }

      this.sequencer.sequence.actorId = actorId;
      const saveRes = await fetch('/api/action-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          charId,
          animation: animKey,
          sequence: this.sequencer.sequence,
        }),
      });

      if (saveRes.ok) {
        alert(`💾 Saved ${animLabel} for ${charName}!`);
      } else {
        throw new Error(await saveRes.text());
      }
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    }
  }

  private async saveAsAnimation(): Promise<void> {
    const actorId = this.characterSelect.value;
    const charId = this.getCharIdFromActor(actorId);
    const currentAnimKey = this.animationSelect.value;
    const charName = this.getCharacterName(actorId);

    const input = prompt(
      `Save sequence for ${charName} as:\n(Enter "single attack", "group attack", "ultimate", or a filename.json)`,
      this.getAnimationLabel(currentAnimKey)
    );
    if (!input || !input.trim()) return;

    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();

    let targetAnimKey: string | null = null;
    if (lower.includes('single')) targetAnimKey = 'single_attack';
    else if (lower.includes('group')) targetAnimKey = 'group_attack';
    else if (lower.includes('ultimate')) targetAnimKey = 'ultimate';

    if (targetAnimKey) {
      const targetLabel = this.getAnimationLabel(targetAnimKey);
      try {
        const checkRes = await fetch(`/api/action-sequence?charId=${encodeURIComponent(charId)}&anim=${encodeURIComponent(targetAnimKey)}`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.exists) {
            const overwrite = confirm(`overwrite existing ${targetLabel} for ${charName}?`);
            if (!overwrite) return;
          }
        }

        const clone: UltimateSequence = JSON.parse(JSON.stringify(this.sequencer.sequence));
        clone.actorId = actorId;
        clone.name = `${charName} ${targetLabel}`;

        const saveRes = await fetch('/api/action-sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            charId,
            animation: targetAnimKey,
            sequence: clone,
          }),
        });

        if (saveRes.ok) {
          this.animationSelect.value = targetAnimKey;
          this.applyLoadedSequence(clone, actorId);
          alert(`💾 Saved as ${targetLabel} for ${charName}!`);
        } else {
          throw new Error(await saveRes.text());
        }
      } catch (err: any) {
        alert(`Failed to save as ${targetLabel}: ${err.message}`);
      }
      return;
    }

    // Otherwise download as .json file
    const filename = trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
    const json = JSON.stringify(this.sequencer.sequence, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
