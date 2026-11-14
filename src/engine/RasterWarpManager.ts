export type WarpEffectType =
  | 'none'
  | 'scanline_undulation'
  | 'heat_shimmer'
  | 'radial_shockwave'
  | 'void_vortex'
  | 'screen_melt';

export interface WarpConfig {
  type: WarpEffectType;
  target: 'background' | 'all';
  amplitude: number; // Max horizontal pixel displacement
  frequency: number; // Wave density (cycles per pixel)
  speed: number; // Wave travel velocity
  centerX?: number; // 0..1 normalized center X for radial/vortex
  centerY?: number; // 0..1 normalized center Y for radial/vortex
  progress?: number; // 0..1 progress for shockwave / melt
}

export class RasterWarpManager {
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private meltOffsets: number[] = [];

  constructor() {
    this.offscreen = document.createElement('canvas');
    this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: true })!;
  }

  private ensureOffscreenSize(w: number, h: number): void {
    if (this.offscreen.width !== w || this.offscreen.height !== h) {
      this.offscreen.width = w;
      this.offscreen.height = h;
      this.offCtx.imageSmoothingEnabled = false;
      this.initMeltOffsets(w);
    }
  }

  private initMeltOffsets(w: number): void {
    this.meltOffsets = [];
    for (let x = 0; x < w; x++) {
      this.meltOffsets.push(Math.random() * 0.4);
    }
  }

  /**
   * Applies the configured raster distortion onto the destination context.
   */
  public applyWarp(
    dstCtx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    w: number,
    h: number,
    timeMs: number,
    config: WarpConfig
  ): void {
    if (config.type === 'none' || config.amplitude === 0) {
      dstCtx.drawImage(src, 0, 0, w, h);
      return;
    }

    this.ensureOffscreenSize(w, h);
    this.offCtx.clearRect(0, 0, w, h);
    this.offCtx.drawImage(src, 0, 0, w, h);

    switch (config.type) {
      case 'scanline_undulation':
        this.renderScanlineUndulation(dstCtx, w, h, timeMs, config);
        break;
      case 'heat_shimmer':
        this.renderHeatShimmer(dstCtx, w, h, timeMs, config);
        break;
      case 'radial_shockwave':
        this.renderRadialShockwave(dstCtx, w, h, config);
        break;
      case 'void_vortex':
        this.renderVoidVortex(dstCtx, w, h, timeMs, config);
        break;
      case 'screen_melt':
        this.renderScreenMelt(dstCtx, w, h, config);
        break;
      default:
        dstCtx.drawImage(src, 0, 0, w, h);
        break;
    }
  }

  /**
   * Classic SNES HDMA / Genesis H-Blank horizontal sine raster distortion.
   */
  private renderScanlineUndulation(
    dstCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeMs: number,
    config: WarpConfig
  ): void {
    const { amplitude, frequency, speed } = config;
    for (let y = 0; y < h; y++) {
      const xOffset = Math.round(amplitude * Math.sin(y * frequency + timeMs * speed));
      dstCtx.drawImage(this.offscreen, 0, y, w, 1, xOffset, y, w, 1);
    }
  }

  /**
   * Ground-focused desert heat mirage (wobble intensifies closer to arena floor).
   */
  private renderHeatShimmer(
    dstCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeMs: number,
    config: WarpConfig
  ): void {
    const { amplitude, frequency, speed } = config;
    const horizonY = Math.round(h * 0.48);

    // Sky is stable
    if (horizonY > 0) {
      dstCtx.drawImage(this.offscreen, 0, 0, w, horizonY, 0, 0, w, horizonY);
    }

    // Ground shimmers
    for (let y = horizonY; y < h; y++) {
      const depth = (y - horizonY) / (h - horizonY);
      const xOffset = Math.round(amplitude * depth * Math.sin(y * frequency + timeMs * speed));
      dstCtx.drawImage(this.offscreen, 0, y, w, 1, xOffset, y, w, 1);
    }
  }

  /**
   * Radial shockwave ring that refracts pixels as an expanding blast wave.
   */
  private renderRadialShockwave(
    dstCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    config: WarpConfig
  ): void {
    const cy = (config.centerY ?? 0.6) * h;
    const progress = Math.max(0, Math.min(1, config.progress ?? 0.5));
    const maxRadius = Math.sqrt(w * w + h * h) * 0.6;
    const currentRadius = progress * maxRadius;
    const ringThickness = 18;

    // Fast slice approximation: warp horizontal scanlines near the shockwave radius
    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const absDy = Math.abs(dy);
      if (absDy < currentRadius + ringThickness && absDy > currentRadius - ringThickness) {
        const ringDist = Math.abs(absDy - currentRadius);
        const factor = 1 - ringDist / ringThickness;
        const xOffset = Math.round(config.amplitude * factor * (dy > 0 ? 1 : -1));
        dstCtx.drawImage(this.offscreen, 0, y, w, 1, xOffset, y, w, 1);
      } else {
        dstCtx.drawImage(this.offscreen, 0, y, w, 1, 0, y, w, 1);
      }
    }
  }

  /**
   * Gravitational void pull: compresses scanlines inward toward black hole center.
   */
  private renderVoidVortex(
    dstCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeMs: number,
    config: WarpConfig
  ): void {
    const cy = (config.centerY ?? 0.6) * h;
    const { amplitude, speed } = config;

    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dist = Math.abs(dy);
      const pull = Math.max(0, 1 - dist / (h * 0.4));
      const swirl = Math.sin(dist * 0.08 - timeMs * speed);
      const xOffset = Math.round(amplitude * pull * swirl * (dy < 0 ? -1 : 1));
      dstCtx.drawImage(this.offscreen, 0, y, w, 1, xOffset, y, w, 1);
    }
  }

  /**
   * Classic DOOM screen melt: vertical strips drip downward at staggered speeds.
   */
  private renderScreenMelt(
    dstCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    config: WarpConfig
  ): void {
    const progress = config.progress ?? 0.5;
    for (let x = 0; x < w; x++) {
      const offsetFrac = this.meltOffsets[x] ?? 0;
      const columnProgress = Math.max(0, Math.min(1, (progress - offsetFrac) / 0.6));
      const yOffset = Math.round(columnProgress * h);
      dstCtx.drawImage(this.offscreen, x, 0, 1, h, x, yOffset, 1, h);
    }
  }
}
