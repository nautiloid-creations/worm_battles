import { BattleStage, RESOLUTION_PRESETS } from '../engine/BattleStage';
import { ActorState, SpriteActor } from '../engine/SpriteActor';

const STATES: { key: ActorState; label: string }[] = [
  { key: 'idle', label: 'Idle' },
  { key: 'attack', label: 'Attack' },
  { key: 'ultimate', label: 'Ultimate' },
  { key: 'hit', label: 'Hit' },
  { key: 'downed', label: 'Down' },
];

export class ControlSidebar {
  private stage: BattleStage;
  private container: HTMLElement;

  private heroStateBtns: Map<string, Record<ActorState, HTMLButtonElement>> = new Map();
  private heroActiveLabels: Map<string, HTMLElement> = new Map();
  private heroSlotBadges: Map<string, HTMLElement> = new Map();

  private enemyStateBtns: Map<string, Record<ActorState, HTMLButtonElement>> = new Map();
  private enemyActiveLabels: Map<string, HTMLElement> = new Map();

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

      <!-- PARTY CARD -->
      <section class="control-card party-card">
        <div class="card-title-row">
          <h2>🎸 BAND MEMBERS</h2>
          <span class="card-subtitle">Cluster Left • Direct Swap to Front on Attack</span>
        </div>
        <div id="party-columns" class="columns-grid four-cols"></div>
      </section>

      <!-- ENEMIES CARD -->
      <section class="control-card enemies-card">
        <div class="card-title-row">
          <h2>👾 ENEMIES <span id="enemy-count-badge" class="count-badge">(${this.stage.enemies.length}/8)</span></h2>
          <span class="card-subtitle">Cluster Right • Up to 8 Enemies</span>
        </div>
        <div id="enemies-scroll-container" class="enemies-scroll">
          <div id="enemy-columns" class="columns-grid"></div>
        </div>
      </section>

      <!-- TIMING & SPRITE SETTINGS CARD -->
      <section class="control-card settings-card">
        <h2>⚙️ CANVAS &amp; TIMING SETTINGS</h2>

        <div class="settings-grid">
          <!-- Canvas Resolution (Master Quality Control) -->
          <div class="setting-item full-width">
            <div class="setting-label-row">
              <span>Canvas Resolution:</span>
              <span id="res-mode-display" class="tempo-display">${RESOLUTION_PRESETS[this.stage.currentResKey].label}</span>
            </div>
            <select id="select-canvas-resolution" class="resolution-select">
              ${resOptionsHtml}
            </select>
          </div>

          <!-- Idle Tempo -->
          <div class="setting-item">
            <div class="setting-label-row">
              <span>Idle Tempo:</span>
              <span id="idle-tempo-val" class="tempo-display">133 BPM (450ms)</span>
            </div>
            <input type="range" id="slider-idle-bpm" min="40" max="240" value="133" />
          </div>

          <!-- Attack Tempo -->
          <div class="setting-item">
            <div class="setting-label-row">
              <span>Attack Tempo:</span>
              <span id="attack-tempo-val" class="tempo-display">522 BPM (115ms)</span>
            </div>
            <input type="range" id="slider-attack-bpm" min="80" max="600" value="522" />
          </div>

          <!-- Base Lunge Distance -->
          <div class="setting-item full-width">
            <div class="setting-label-row">
              <span>Lunge Reach (180p base):</span>
              <span id="lunge-val">24px</span>
            </div>
            <input type="range" id="slider-lunge" min="0" max="60" value="24" />
          </div>
        </div>

        <label class="checkbox-row">
          <input type="checkbox" id="toggle-auto-hit" checked />
          <span>Attacks automatically trigger target's <code>hit.png</code> &amp; sparks</span>
        </label>
      </section>
    `;

    this.renderPartyColumns();
    this.renderEnemyColumns();
    this.bindSettingsControls();
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

  private handleHeroLatch(hero: SpriteActor, clickedState: ActorState): void {
    if (clickedState === 'idle') {
      hero.isManuallyLatched = false;
      this.stage.triggerHeroState(hero.config.id, 'idle');
      return;
    }

    // Latch behavior: if already latched on this pose, unlatch back to idle
    if (hero.state === clickedState) {
      hero.isManuallyLatched = false;
      this.stage.triggerHeroState(hero.config.id, 'idle');
    } else {
      hero.isManuallyLatched = clickedState === 'hit';
      this.stage.triggerHeroState(hero.config.id, clickedState);
    }
  }

  private renderEnemyColumns(): void {
    const enemyContainer = this.container.querySelector<HTMLElement>('#enemy-columns')!;
    const countBadge = this.container.querySelector<HTMLElement>('#enemy-count-badge')!;
    countBadge.textContent = `(${this.stage.enemies.length}/8)`;

    enemyContainer.innerHTML = '';
    this.enemyStateBtns.clear();
    this.enemyActiveLabels.clear();

    // 1. Existing Enemy Columns
    for (const enemy of this.stage.enemies) {
      const col = document.createElement('div');
      col.className = 'actor-column enemy-col';

      const canRemove = this.stage.enemies.length > 1;
      const removeBtnHtml = canRemove
        ? `<button class="remove-enemy-btn" title="Remove enemy" data-remove-id="${enemy.config.id}">✕</button>`
        : '';
      const sizePct = Math.round(enemy.heightFraction * 100);

      col.innerHTML = `
        <div class="col-header enemy-header">
          <span class="actor-name">${enemy.config.name}</span>
          ${removeBtnHtml}
        </div>
        <div class="state-buttons-col" data-enemy-id="${enemy.config.id}"></div>
        <div class="active-sprite-indicator">
          <span class="label">Sprite:</span>
          <code class="active-sprite-name" data-active-enemy="${enemy.config.id}">idle_1.png</code>
        </div>
        <div class="actor-size-control">
          <div class="size-label-row">
            <span>Size:</span>
            <span class="actor-size-val" data-enemy-size-val="${enemy.config.id}">${sizePct}%</span>
          </div>
          <input type="range" class="actor-size-slider" data-enemy-size-input="${enemy.config.id}" min="15" max="90" value="${sizePct}" />
        </div>
      `;

      if (canRemove) {
        col.querySelector<HTMLButtonElement>('.remove-enemy-btn')?.addEventListener('click', () => {
          this.stage.removeEnemy(enemy.config.id);
          this.renderEnemyColumns();
        });
      }

      // State Buttons
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

      // Size Slider
      const sizeSlider = col.querySelector<HTMLInputElement>(`[data-enemy-size-input="${enemy.config.id}"]`)!;
      const sizeValDisplay = col.querySelector<HTMLElement>(`[data-enemy-size-val="${enemy.config.id}"]`)!;
      sizeSlider.addEventListener('input', () => {
        const pct = Number(sizeSlider.value);
        enemy.heightFraction = pct / 100;
        sizeValDisplay.textContent = `${pct}%`;
      });

      this.enemyStateBtns.set(enemy.config.id, btnMap);
      this.enemyActiveLabels.set(
        enemy.config.id,
        col.querySelector<HTMLElement>(`[data-active-enemy="${enemy.config.id}"]`)!
      );

      enemyContainer.appendChild(col);
    }

    // 2. "+ Add Enemy" Column (Last column)
    const addCol = document.createElement('div');
    addCol.className = 'actor-column add-enemy-col';

    const isFull = this.stage.enemies.length >= 8;
    addCol.innerHTML = `
      <div class="col-header">
        <span class="actor-name">➕ ADD ENEMY</span>
      </div>
      <div class="add-enemy-body">
        <select id="add-enemy-select" class="add-enemy-select" ${isFull ? 'disabled' : ''}>
          <option value="">${isFull ? 'MAX (8) REACHED' : '+ Choose Enemy...'}</option>
          <option value="the_worm">The Worm</option>
          <option value="air_squid">Air Squid</option>
        </select>
        <span class="add-tip">${isFull ? 'Cannot add more' : 'Select to spawn'}</span>
      </div>
    `;

    const selectEl = addCol.querySelector<HTMLSelectElement>('#add-enemy-select');
    selectEl?.addEventListener('change', async (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val === 'the_worm' || val === 'air_squid') {
        await this.stage.addEnemy(val);
        this.renderEnemyColumns();
      }
    });

    enemyContainer.appendChild(addCol);
  }

  private handleEnemyLatch(enemy: SpriteActor, clickedState: ActorState): void {
    if (clickedState === 'idle') {
      enemy.isManuallyLatched = false;
      enemy.setState('idle');
      return;
    }

    if (enemy.state === clickedState) {
      enemy.isManuallyLatched = false;
      enemy.setState('idle');
    } else {
      enemy.isManuallyLatched = clickedState === 'hit';
      enemy.setState(clickedState);
    }
  }

  private bindSettingsControls(): void {
    // Canvas Resolution
    const resSelect = this.container.querySelector<HTMLSelectElement>('#select-canvas-resolution')!;
    const resModeDisplay = this.container.querySelector<HTMLElement>('#res-mode-display')!;
    resSelect.addEventListener('change', () => {
      const key = resSelect.value;
      this.stage.setCanvasResolution(key);
      const preset = RESOLUTION_PRESETS[key];
      if (preset) {
        resModeDisplay.textContent = preset.label;
      }
    });

    // Idle BPM
    const idleBpmSlider = this.container.querySelector<HTMLInputElement>('#slider-idle-bpm')!;
    const idleTempoVal = this.container.querySelector<HTMLElement>('#idle-tempo-val')!;
    idleBpmSlider.addEventListener('input', () => {
      const bpm = Number(idleBpmSlider.value);
      const ms = Math.round(60000 / bpm);
      idleTempoVal.textContent = `${bpm} BPM (${ms}ms)`;
      this.stage.setIdleInterval(ms);
    });

    // Attack BPM
    const attackBpmSlider = this.container.querySelector<HTMLInputElement>('#slider-attack-bpm')!;
    const attackTempoVal = this.container.querySelector<HTMLElement>('#attack-tempo-val')!;
    attackBpmSlider.addEventListener('input', () => {
      const bpm = Number(attackBpmSlider.value);
      const ms = Math.round(60000 / bpm);
      attackTempoVal.textContent = `${bpm} BPM (${ms}ms)`;
      this.stage.setAttackInterval(ms);
    });

    // Lunge Distance
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
  }

  private syncLiveIndicators(): void {
    // 1. Sync Heroes
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

    // 2. Sync Enemies
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
