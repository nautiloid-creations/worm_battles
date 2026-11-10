import { BattleStage } from '../engine/BattleStage';
import {
  ALL_SPRITE_KEYS,
  ActorState,
  SpriteActor,
} from '../engine/SpriteActor';

export class ControlSidebar {
  private stage: BattleStage;
  private container: HTMLElement;

  private heroFilePills: Record<string, HTMLElement> = {};
  private bossFilePills: Record<string, HTMLElement> = {};
  private heroStateBtns: Partial<Record<ActorState, HTMLButtonElement>> = {};
  private bossStateBtns: Partial<Record<ActorState, HTMLButtonElement>> = {};

  constructor(stage: BattleStage, container: HTMLElement) {
    this.stage = stage;
    this.container = container;
    this.renderUI();
    this.bindKeyboardShortcuts();

    this.stage.onTick(() => this.syncLiveIndicators());
  }

  private renderUI(): void {
    this.container.innerHTML = `
      <div class="sidebar-header">
        <h1>WORM BATTLES</h1>
        <span class="step-badge">STEP 1: FLEXIBLE SPRITE ENGINE</span>
      </div>

      <!-- HERO CARD -->
      <section class="control-card hero-card">
        <div class="card-title-row">
          <h2 id="hero-card-title">🎸 HERO: GUITAR 1</h2>
          <select id="hero-char-select" class="folder-tag" style="cursor:pointer; background:#151824; color:#7ce8ff; border:1px solid #303956; border-radius:4px; padding:2px 6px;">
            <option value="guitar_1">heroes/guitar_1</option>
            <option value="guitar_2">heroes/guitar_2</option>
            <option value="bass">heroes/bass</option>
            <option value="drums">heroes/drums</option>
          </select>
        </div>

        <button id="hero-hold-attack" class="hold-attack-btn hero-accent">
          <span class="btn-main">⚡ HOLD TO ATTACK (STRUM)</span>
          <span class="btn-sub">Hold Mouse or [A] Key • Steps forward &amp; loops attack_1 ↔ attack_2</span>
        </button>

        <div class="state-grid">
          <button data-actor="hero" data-state="idle" class="state-btn">Idle (x2)</button>
          <button data-actor="hero" data-state="attack" class="state-btn">Lock Attack (x2)</button>
          <button data-actor="hero" data-state="hit" class="state-btn">Hit / Stun (x1)</button>
          <button data-actor="hero" data-state="downed" class="state-btn">Downed (x1)</button>
          <button data-actor="hero" data-state="ultimate" class="state-btn" style="grid-column: span 2;">⚡ Ultimate Pose (x1)</button>
        </div>

        <div class="sprite-Monitor">
          <div class="monitor-label">Active Sprite File (<span id="hero-dims">loading...</span>):</div>
          <div id="hero-pills" class="pill-grid"></div>
        </div>
      </section>

      <!-- BOSS CARD -->
      <section class="control-card boss-card">
        <div class="card-title-row">
          <h2 id="boss-card-title">🐛 BOSS: THE WORM</h2>
          <select id="boss-char-select" class="folder-tag" style="cursor:pointer; background:#151824; color:#ff7ce8; border:1px solid #56304a; border-radius:4px; padding:2px 6px;">
            <option value="the_worm" selected>bosses/the_worm</option>
            <option value="cyber_worm">bosses/cyber_worm</option>
          </select>
        </div>

        <button id="boss-hold-attack" class="hold-attack-btn boss-accent">
          <span class="btn-main">🔥 HOLD BOSS ATTACK</span>
          <span class="btn-sub">Hold Mouse or [B] Key • Steps forward &amp; loops attack_1 ↔ attack_2</span>
        </button>

        <div class="state-grid">
          <button data-actor="boss" data-state="idle" class="state-btn">Idle (x2)</button>
          <button data-actor="boss" data-state="attack" class="state-btn">Lock Attack (x2)</button>
          <button data-actor="boss" data-state="hit" class="state-btn">Hit / Stun (x1)</button>
          <button data-actor="boss" data-state="downed" class="state-btn">Downed (x1)</button>
          <button data-actor="boss" data-state="ultimate" class="state-btn" style="grid-column: span 2;">⚡ Ultimate Pose (x1)</button>
        </div>

        <div class="sprite-Monitor">
          <div class="monitor-label">Active Sprite File (<span id="boss-dims">loading...</span>):</div>
          <div id="boss-pills" class="pill-grid"></div>
        </div>
      </section>

      <!-- TIMING & STAGE SETTINGS -->
      <section class="control-card settings-card">
        <h2>⚙️ TIMING &amp; SPRITE NORMALIZATION</h2>

        <label class="checkbox-row">
          <input type="checkbox" id="toggle-auto-hit" checked />
          <span>Attacking automatically triggers opponent's <code>hit.png</code> &amp; damage</span>
        </label>

        <div class="slider-group">
          <div class="slider-header">
            <span>Idle Bounce Tempo</span>
            <strong id="val-idle-bpm">133 BPM (450ms)</strong>
          </div>
          <input type="range" id="slider-idle-bpm" min="60" max="240" value="133" />
        </div>

        <div class="slider-group">
          <div class="slider-header">
            <span>Attack Strum Loop Speed</span>
            <strong id="val-attack-ms">115 ms</strong>
          </div>
          <input type="range" id="slider-attack-ms" min="50" max="300" step="5" value="115" />
        </div>

        <div class="slider-group">
          <div class="slider-header">
            <span>Step-Forward (Lunge) Distance</span>
            <strong id="val-lunge-px">24 px</strong>
          </div>
          <input type="range" id="slider-lunge-px" min="0" max="60" value="24" />
        </div>

        <div class="slider-row-2col">
          <div class="slider-group">
            <div class="slider-header">
              <span>Hero Height</span>
              <strong id="val-hero-h">92 px</strong>
            </div>
            <input type="range" id="slider-hero-h" min="32" max="140" value="92" />
          </div>
          <div class="slider-group">
            <div class="slider-header">
              <span>Boss Height</span>
              <strong id="val-boss-h">100 px</strong>
            </div>
            <input type="range" id="slider-boss-h" min="48" max="165" value="100" />
          </div>
        </div>

        <button id="btn-reload-sprites" class="reload-btn">
          🔄 Reload All PNGs from Disk (public/assets/)
        </button>
      </section>
    `;

    // Populate the 6-sprite file pills for Hero and Boss
    const heroPillContainer = this.container.querySelector('#hero-pills')!;
    const bossPillContainer = this.container.querySelector('#boss-pills')!;

    for (const key of ALL_SPRITE_KEYS) {
      const hp = document.createElement('span');
      hp.className = 'file-pill';
      hp.textContent = `${key}.png`;
      heroPillContainer.appendChild(hp);
      this.heroFilePills[key] = hp;

      const bp = document.createElement('span');
      bp.className = 'file-pill';
      bp.textContent = `${key}.png`;
      bossPillContainer.appendChild(bp);
      this.bossFilePills[key] = bp;
    }

    // Bind Hero character selector
    const heroSelect = this.container.querySelector(
      '#hero-char-select'
    ) as HTMLSelectElement;
    const heroTitle = this.container.querySelector('#hero-card-title')!;
    heroSelect.addEventListener('change', async () => {
      const charId = heroSelect.value;
      heroTitle.textContent = `🎸 HERO: ${charId.toUpperCase().replace('_', ' ')}`;
      this.stage.hero.config.id = `hero_${charId}`;
      this.stage.hero.config.name = charId.toUpperCase().replace('_', ' ');
      this.stage.hero.config.folderPath = `/assets/heroes/${charId}`;
      await this.stage.hero.loadSprites(true);
    });

    // Bind Boss character selector
    const bossSelect = this.container.querySelector(
      '#boss-char-select'
    ) as HTMLSelectElement;
    const bossTitle = this.container.querySelector('#boss-card-title')!;
    bossSelect.addEventListener('change', async () => {
      const charId = bossSelect.value;
      bossTitle.textContent = `🐛 BOSS: ${charId.toUpperCase().replace('_', ' ')}`;
      this.stage.boss.config.id = `boss_${charId}`;
      this.stage.boss.config.name = charId.toUpperCase().replace('_', ' ');
      this.stage.boss.config.folderPath = `/assets/bosses/${charId}`;
      await this.stage.boss.loadSprites(true);
    });

    // Bind Hold-to-Attack buttons (press -> lunge + loop attack_1/2; release -> idle)
    const heroAttackBtn = this.container.querySelector(
      '#hero-hold-attack'
    ) as HTMLButtonElement;
    this.bindHoldButton(
      heroAttackBtn,
      () => this.stage.startHeroAttack(),
      () => this.stage.stopHeroAttack()
    );

    const bossAttackBtn = this.container.querySelector(
      '#boss-hold-attack'
    ) as HTMLButtonElement;
    this.bindHoldButton(
      bossAttackBtn,
      () => this.stage.startBossAttack(),
      () => this.stage.stopBossAttack()
    );

    // Bind direct state buttons
    this.container
      .querySelectorAll<HTMLButtonElement>('.state-btn')
      .forEach((btn) => {
        const actorType = btn.dataset.actor as 'hero' | 'boss';
        const state = btn.dataset.state as ActorState;
        if (actorType === 'hero') {
          this.heroStateBtns[state] = btn;
        } else {
          this.bossStateBtns[state] = btn;
        }

        btn.addEventListener('click', () => {
          const target: SpriteActor =
            actorType === 'hero' ? this.stage.hero : this.stage.boss;
          const other: SpriteActor =
            actorType === 'hero' ? this.stage.boss : this.stage.hero;
          const wasAttacking = target.state === 'attack';
          target.setState(state);

          // If switching out of locked attack, return opponent from hit to idle
          if (
            wasAttacking &&
            state !== 'attack' &&
            this.stage.autoHitOpponent &&
            other.state === 'hit'
          ) {
            other.setState('idle');
          }
        });
      });

    // Bind Settings & Sliders
    const autoHitCheckbox = this.container.querySelector(
      '#toggle-auto-hit'
    ) as HTMLInputElement;
    autoHitCheckbox.addEventListener('change', () => {
      this.stage.autoHitOpponent = autoHitCheckbox.checked;
    });

    const idleBpmSlider = this.container.querySelector(
      '#slider-idle-bpm'
    ) as HTMLInputElement;
    const idleBpmVal = this.container.querySelector('#val-idle-bpm')!;
    idleBpmSlider.addEventListener('input', () => {
      const bpm = Number(idleBpmSlider.value);
      const ms = Math.round(60000 / bpm);
      this.stage.hero.idleIntervalMs = ms;
      this.stage.boss.idleIntervalMs = ms;
      idleBpmVal.textContent = `${bpm} BPM (${ms}ms)`;
    });

    const attackMsSlider = this.container.querySelector(
      '#slider-attack-ms'
    ) as HTMLInputElement;
    const attackMsVal = this.container.querySelector('#val-attack-ms')!;
    attackMsSlider.addEventListener('input', () => {
      const ms = Number(attackMsSlider.value);
      this.stage.hero.attackIntervalMs = ms;
      this.stage.boss.attackIntervalMs = ms;
      attackMsVal.textContent = `${ms} ms`;
    });

    const lungeSlider = this.container.querySelector(
      '#slider-lunge-px'
    ) as HTMLInputElement;
    const lungeVal = this.container.querySelector('#val-lunge-px')!;
    lungeSlider.addEventListener('input', () => {
      const px = Number(lungeSlider.value);
      this.stage.hero.config.lungeDistance = px;
      this.stage.boss.config.lungeDistance = px;
      lungeVal.textContent = `${px} px`;
    });

    const heroHSlider = this.container.querySelector(
      '#slider-hero-h'
    ) as HTMLInputElement;
    const heroHVal = this.container.querySelector('#val-hero-h')!;
    heroHSlider.addEventListener('input', () => {
      const h = Number(heroHSlider.value);
      this.stage.hero.config.targetHeight = h;
      heroHVal.textContent = `${h} px`;
    });

    const bossHSlider = this.container.querySelector(
      '#slider-boss-h'
    ) as HTMLInputElement;
    const bossHVal = this.container.querySelector('#val-boss-h')!;
    bossHSlider.addEventListener('input', () => {
      const h = Number(bossHSlider.value);
      this.stage.boss.config.targetHeight = h;
      bossHVal.textContent = `${h} px`;
    });

    const reloadBtn = this.container.querySelector(
      '#btn-reload-sprites'
    ) as HTMLButtonElement;
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.textContent = '⏳ Reloading PNGs...';
      await this.stage.loadAllAssets(true);
      reloadBtn.textContent = '✅ Reloaded PNGs from Disk!';
      setTimeout(() => {
        reloadBtn.textContent = '🔄 Reload All PNGs from Disk (public/assets/)';
      }, 1200);
    });
  }

  private bindHoldButton(
    btn: HTMLButtonElement,
    onPress: () => void,
    onRelease: () => void
  ): void {
    let holding = false;

    const start = (e: Event) => {
      e.preventDefault();
      if (holding) return;
      holding = true;
      btn.classList.add('is-holding');
      onPress();
    };

    const end = () => {
      if (!holding) return;
      holding = false;
      btn.classList.remove('is-holding');
      onRelease();
    };

    btn.addEventListener('pointerdown', start);
    window.addEventListener('pointerup', end);
    btn.addEventListener('pointerCancel', end);
    btn.addEventListener('pointerleave', end);
  }

  private bindKeyboardShortcuts(): void {
    const heldKeys = new Set<string>();

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (heldKeys.has(key)) return;
      if (key === 'a') {
        heldKeys.add(key);
        this.stage.startHeroAttack();
        this.container
          .querySelector('#hero-hold-attack')
          ?.classList.add('is-holding');
      } else if (key === 'b') {
        heldKeys.add(key);
        this.stage.startBossAttack();
        this.container
          .querySelector('#boss-hold-attack')
          ?.classList.add('is-holding');
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (!heldKeys.has(key)) return;
      heldKeys.delete(key);
      if (key === 'a') {
        this.stage.stopHeroAttack();
        this.container
          .querySelector('#hero-hold-attack')
          ?.classList.remove('is-holding');
      } else if (key === 'b') {
        this.stage.stopBossAttack();
        this.container
          .querySelector('#boss-hold-attack')
          ?.classList.remove('is-holding');
      }
    });
  }

  private syncLiveIndicators(): void {
    const heroActiveFile = this.stage.hero.getActiveSpriteKey();
    const bossActiveFile = this.stage.boss.getActiveSpriteKey();

    const heroDims = this.stage.hero.getActiveSpriteDimensions();
    const bossDims = this.stage.boss.getActiveSpriteDimensions();
    const heroDimsEl = this.container.querySelector('#hero-dims');
    const bossDimsEl = this.container.querySelector('#boss-dims');
    if (heroDimsEl && heroDims) {
      heroDimsEl.textContent = `${heroDims.width}×${heroDims.height} px`;
    }
    if (bossDimsEl && bossDims) {
      bossDimsEl.textContent = `${bossDims.width}×${bossDims.height} px`;
    }

    for (const key of ALL_SPRITE_KEYS) {
      const heroPill = this.heroFilePills[key];
      if (heroPill) {
        heroPill.classList.toggle('active-pill', key === heroActiveFile);
        if (this.stage.hero.isLoaded) {
          heroPill.style.display = this.stage.hero.hasSprite(key)
            ? ''
            : 'none';
        }
      }

      const bossPill = this.bossFilePills[key];
      if (bossPill) {
        bossPill.classList.toggle('active-pill', key === bossActiveFile);
        if (this.stage.boss.isLoaded) {
          bossPill.style.display = this.stage.boss.hasSprite(key)
            ? ''
            : 'none';
        }
      }
    }

    for (const [st, btn] of Object.entries(this.heroStateBtns)) {
      btn?.classList.toggle('active-state', st === this.stage.hero.state);
      if (st === 'ultimate' && btn && this.stage.hero.isLoaded) {
        btn.style.display = this.stage.hero.hasSprite('ultimate')
          ? ''
          : 'none';
      }
    }
    for (const [st, btn] of Object.entries(this.bossStateBtns)) {
      btn?.classList.toggle('active-state', st === this.stage.boss.state);
      if (st === 'ultimate' && btn && this.stage.boss.isLoaded) {
        btn.style.display = this.stage.boss.hasSprite('ultimate')
          ? ''
          : 'none';
      }
    }
  }
}
