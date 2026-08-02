import type { Viewport } from "./PianoRollView.ts";

const MIDI_LO = 36;
const MIDI_HI = 84;

/** 上方频谱对照条带：画离屏频谱 + 当前播放竖线。
 *  与卷帘窗共享 viewport（横轴）和音高轴（MIDI 36~84）。 */
export class SpecView {
  private ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  readonly keyColW = 56;
  spectrogram: CanvasImageSource | null = null;
  /** 频谱图对应的全曲时长（用于从全曲频谱裁取 viewport 段）。 */
  private fullDuration = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  setSpectrogram(img: CanvasImageSource, fullDuration: number): void {
    this.spectrogram = img;
    this.fullDuration = fullDuration;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.W = rect.width;
    this.H = rect.height;
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(t: number, vp: Viewport): void {
    const { ctx, W, H, keyColW } = this;
    ctx.clearRect(0, 0, W, H);
    // 左侧占位列（与卷帘窗对齐，不标音名）
    ctx.fillStyle = "#11131a";
    ctx.fillRect(0, 0, keyColW, H);
    ctx.fillStyle = "#2a2e3a";
    ctx.fillRect(keyColW - 1, 0, 1, H);

    // 频谱：从全曲频谱图裁取 [vp.start, vp.start+vp.duration] 段
    if (this.spectrogram && this.fullDuration > 0) {
      const sw = (this.spectrogram as HTMLCanvasElement).width;
      const sx = (vp.start / this.fullDuration) * sw;
      const sw2 = (vp.duration / this.fullDuration) * sw;
      ctx.drawImage(this.spectrogram, sx, 0, sw2, MIDI_HI - MIDI_LO, keyColW, 0, W - keyColW, H);
    }

    // 播放竖线
    const x = keyColW + ((t - vp.start) / vp.duration) * (W - keyColW);
    if (x >= keyColW && x <= W) {
      ctx.strokeStyle = "#ffcf5c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }
}
