import './style.css';
import { BattleStage } from './engine/BattleStage';
import { ControlSidebar } from './ui/ControlSidebar';

async function bootstrap() {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  app.innerHTML = `
    <main class="stage-viewport">
      <div class="canvas-frame">
        <canvas id="battle-canvas"></canvas>
      </div>
      <div class="stage-caption">
        <span>Hold <kbd>A</kbd> for Hero Strum Attack</span>
        <span>Hold <kbd>B</kbd> for Boss Attack</span>
        <span>Drop custom PNGs into <code>public/assets/</code> &amp; click Reload</span>
      </div>
    </main>
    <aside id="sidebar" class="sidebar-panel"></aside>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>('#battle-canvas')!;
  const sidebarEl = document.querySelector<HTMLElement>('#sidebar')!;

  const stage = new BattleStage(canvas);
  await stage.loadAllAssets();

  new ControlSidebar(stage, sidebarEl);
  stage.startLoop();
}

bootstrap();
