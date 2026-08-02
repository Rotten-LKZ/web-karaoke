import type { MelodyNote } from "../types.ts";
import { midiToName } from "../util/music.ts";

const BLACK_SEMIS = new Set([1, 3, 6, 8, 10]);

export interface Viewport {
  /** 视口起始时间（秒）。 */
  start: number;
  /** 视口可见时长（秒）。 */
  duration: number;
}

/** canvas 纯渲染层：网格 + 琴键列 + 音符 + playhead。
 *  纵轴用「带子」模型：每个 MIDI 音占一条带，音符画在带子中心（对准琴键，
 *  不骑在网格缝上）。横轴由 viewport 控制（支持 Ctrl+滚轮缩放）。 */
export class PianoRollView {
  private ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  readonly keyColW = 56;
  readonly midiLo = 36; // C2
  readonly midiHi = 84; // C6

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
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

  private pxPerSec(vp: Viewport): number {
    const w = this.W - this.keyColW;
    return vp.duration > 0 ? w / vp.duration : 0;
  }

  /** 时间 → x（用 viewport）。 */
  xForTime(t: number, vp: Viewport): number {
    return this.keyColW + (t - vp.start) * this.pxPerSec(vp);
  }

  /** x → 时间（用 viewport）。 */
  timeForX(x: number, vp: Viewport): number {
    const ps = this.pxPerSec(vp);
    return ps > 0 ? vp.start + (x - this.keyColW) / ps : vp.start;
  }

  /** MIDI → 带子中心 y（高音在上）。音符画在此 y，居中于两网格线之间。 */
  yForMidi(midi: number): number {
    const span = this.midiHi - this.midiLo || 1;
    return this.H - ((midi - this.midiLo + 0.5) / span) * this.H;
  }

  /** y → MIDI（浮点，返回带子中心对应的 midi）。 */
  midiForY(y: number): number {
    const span = this.midiHi - this.midiLo || 1;
    return this.midiLo + ((this.H - y) / this.H) * span - 0.5;
  }

  /** 单个半音带子的高度 px。 */
  get rowH(): number {
    return this.H / (this.midiHi - this.midiLo);
  }

  draw(
    t: number,
    vp: Viewport,
    notes: MelodyNote[],
    selectedIdx: number | null,
  ): void {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    this.drawGrid(vp);
    this.drawKeyColumn();
    this.drawNotes(vp, notes, selectedIdx);
    this.drawPlayhead(t, vp);
  }

  private drawGrid(vp: Viewport): void {
    const { ctx, W, H, keyColW, midiLo, midiHi } = this;
    // 半音横线（带子边界）
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let m = midiLo; m <= midiHi; m++) {
      const span = midiHi - midiLo;
      const y = this.H - ((m - midiLo) / span) * this.H; // 带子边界在整数 m
      ctx.beginPath();
      ctx.moveTo(keyColW, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // 秒刻度：根据视口密度自适应步长
    const step = niceStep(vp.duration);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.font = "10px system-ui";
    ctx.fillStyle = "#6b7080";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const first = Math.ceil(vp.start / step) * step;
    for (let tt = first; tt <= vp.start + vp.duration; tt += step) {
      const x = this.xForTime(tt, vp);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillText(`${tt.toFixed(step < 1 ? 1 : 0)}s`, x + 3, 2);
    }
  }

  private drawKeyColumn(): void {
    const { ctx, H, keyColW, midiLo, midiHi, rowH } = this;
    ctx.fillStyle = "#11131a";
    ctx.fillRect(0, 0, keyColW, H);
    const span = midiHi - midiLo;
    for (let m = midiLo; m < midiHi; m++) {
      // 带 m 的顶部 = 边界 m，底部 = 边界 m+1
      const top = this.H - ((m + 1 - midiLo) / span) * this.H;
      const semi = m % 12;
      const isBlack = BLACK_SEMIS.has(semi);
      ctx.fillStyle = isBlack ? "#15171d" : "#e9ecf2";
      ctx.fillRect(0, top, keyColW, rowH);
      if (semi === 0) {
        ctx.fillStyle = isBlack ? "#c7cbd4" : "#333";
        ctx.font = "10px system-ui";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(midiToName(m), 4, top + rowH / 2);
      }
    }
    ctx.fillStyle = "#2a2e3a";
    ctx.fillRect(keyColW - 1, 0, 1, H);
  }

  private drawNotes(
    vp: Viewport,
    notes: MelodyNote[],
    selectedIdx: number | null,
  ): void {
    const { ctx, rowH } = this;
    const barH = Math.max(4, rowH * 0.8);
    notes.forEach((n, i) => {
      if (n.pitch === null) return;
      const x1 = this.xForTime(n.start, vp);
      const x2 = this.xForTime(n.start + n.dur, vp);
      if (x2 < this.keyColW || x1 > this.W) return; // 视口剔除
      const y = this.yForMidi(n.pitch); // 带子中心
      const w = Math.max(3, x2 - x1);
      const sel = i === selectedIdx;
      ctx.fillStyle = sel ? "#9fc0ff" : "#4f9cff";
      ctx.save();
      if (sel) {
        ctx.shadowColor = "#9fc0ff";
        ctx.shadowBlur = 10;
      }
      this.roundRect(x1, y - barH / 2, w, barH, Math.min(4, barH / 2));
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x2 - 2, y - barH / 2, 2, barH);
    });
  }

  private drawPlayhead(t: number, vp: Viewport): void {
    const { ctx, H } = this;
    const x = this.xForTime(t, vp);
    if (x < this.keyColW || x > this.W) return;
    ctx.strokeStyle = "#ffcf5c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.fillStyle = "#ffcf5c";
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 6);
    ctx.fill();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

/** 根据视口时长选一个「好看的」刻度步长（约 8~12 条线）。 */
function niceStep(visible: number): number {
  const target = visible / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const n = target / pow;
  const nice = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return nice * pow;
}
