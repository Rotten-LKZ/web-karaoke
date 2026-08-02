import type { MelodyNote } from "../types.ts";
import { applySemitones, freqToMidi, midiToName } from "../util/music.ts";
import { foldToOctaveOf } from "../util/octave.ts";

/** 麦克风实时音高（M3 注入；M2 阶段传 null）。 */
export interface MicPitch {
  freq: number; // Hz，<=0 表示无效
  clarity: number; // 0..1
}

/**
 * 下落式音高瀑布（类 Synthesia / 吉他英雄）：
 * 顶部 = 未来，底部判定线 = 现在。音高映射到横轴。
 * 当前应唱的音符条会高亮，麦克风实时音高以发光点叠加（M3）。
 */
export class HighwayCanvas {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;

  /** 可见的时间窗口（秒）：从判定线往前能看到多远。 */
  lookAhead = 4;
  /** 判定线距底部高度（px）。 */
  private hitLineH = 48;
  /** 旋律音高显示范围（MIDI），运行时按数据自适应并留白。 */
  private midiLo = 48;
  private midiHi = 79;
  private notes: MelodyNote[];

  constructor(
    private canvas: HTMLCanvasElement,
    notes: MelodyNote[],
    private semitonesGetter: () => number,
    private micGetter: () => MicPitch | null,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.notes = notes;
    this.fitRange();
    this.resize();
  }

  /** 切换歌曲时更换旋律数据并重新适配范围。 */
  setNotes(notes: MelodyNote[]): void {
    this.notes = notes;
    this.fitRange();
  }

  /** 按 midi 适配纵轴范围（留 2 个半音的边距）。 */
  private fitRange(): void {
    const pitches = this.notes
      .map((n) => n.pitch)
      .filter((p): p is number => p !== null);
    if (pitches.length === 0) return;
    this.midiLo = Math.min(...pitches) - 2;
    this.midiHi = Math.max(...pitches) + 2;
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

  /** t = 当前播放时间（秒）。 */
  draw(t: number): void {
    const { ctx, W, H } = this;
    const semis = this.semitonesGetter();
    ctx.clearRect(0, 0, W, H);

    this.drawBgGrid();
    this.drawHitLine();

    // 把时间 → y：判定线在 H-hitLineH，lookAhead 秒对应整条可用高度。
    const topY = 0;
    const hitY = H - this.hitLineH;
    const pxPerSec = (hitY - topY) / this.lookAhead;
    const yForTime = (noteT: number) => hitY - (noteT - t) * pxPerSec;

    const midiSpan = this.midiHi - this.midiLo || 1;
    const xForMidi = (midi: number) =>
      ((midi - this.midiLo) / midiSpan) * (W - 40) + 20;

    // 音符条
    for (const n of this.notes) {
      if (n.pitch === null) continue;
      const yStart = yForTime(n.start + n.dur); // 条顶端 = 音符结束时间
      const yEnd = yForTime(n.start); // 条底端 = 音符开始时间
      if (yEnd < topY || yStart > hitY + this.hitLineH) continue; // 视口剔除

      const effMidi = applySemitones(n.pitch, semis);
      const x = xForMidi(effMidi);
      const w = Math.max(28, W / (midiSpan + 1) * 0.7);
      const isCurrent = t >= n.start - 0.02 && t <= n.start + n.dur + 0.02;

      ctx.fillStyle = isCurrent ? "#5fd07a" : "#3a6fd8";
      this.roundRect(x - w / 2, yStart, w, Math.max(6, yEnd - yStart), 6);
      ctx.fill();

      // 音名标签
      if (n.lyric && yEnd > topY && yStart < hitY) {
        ctx.fillStyle = "#fff";
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.lyric, x, (yStart + yEnd) / 2);
      }
    }

    // 麦克风实时音高点 + 与当前目标的对比着色（八度等价判定）
    const mic = this.micGetter();
    if (mic && mic.freq > 0) {
      const micMidi = freqToMidi(mic.freq);
      const cur = this.currentNote(t);
      let color = "#ffcf5c"; // 默认黄（无目标）
      let drawMidi = micMidi;
      if (cur?.pitch !== null && cur?.pitch !== undefined) {
        const targetMidi = applySemitones(cur.pitch, semis);
        // 八度吸附：把演唱音高平移到目标所在八度，圆点贴合标准方块
        drawMidi = foldToOctaveOf(micMidi, targetMidi);
        // 八度等价：折叠到离目标最近的八度
        let cents = (micMidi - targetMidi) * 100;
        cents = ((cents % 1200) + 1800) % 1200 - 600;
        if (Math.abs(cents) <= 50) color = "#5fd07a"; // in-tune 绿
        else if (cents > 0) color = "#ff6b6b"; // sharp 红
        else color = "#4f9cff"; // flat 蓝
      }
      // 超出可视范围时钳制到边缘（低/高八度唱也能看到点）
      const clampedMidi = Math.max(this.midiLo, Math.min(this.midiHi, drawMidi));
      const x = xForMidi(clampedMidi);
      // 发光点
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(x, hitY, 11, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(x, hitY, 11, 0, Math.PI * 2);
      ctx.stroke();
      // 音名标签（点上方）
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(midiToName(Math.round(clampedMidi)), x, hitY - 16);
    }
  }

  private drawBgGrid(): void {
    const { ctx, W, H } = this;
    // 半音横线（每个整数 MIDI 一条淡线）
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    const midiSpan = this.midiHi - this.midiLo || 1;
    for (let m = Math.ceil(this.midiLo); m <= Math.floor(this.midiHi); m++) {
      const x = ((m - this.midiLo) / midiSpan) * (W - 40) + 20;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }

  private drawHitLine(): void {
    const { ctx, W, H } = this;
    const y = H - this.hitLineH;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
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

  /** 工具：给定 t 找当前应唱的音符（用于钢琴高亮 / 对比）。 */
  currentNote(t: number): MelodyNote | null {
    for (const n of this.notes) {
      if (t >= n.start - 0.02 && t <= n.start + n.dur + 0.02) return n;
    }
    return null;
  }

  /** 当前可见的音高范围（含移调后），供钢琴卷帘对齐。 */
  visibleRange(): { lo: number; hi: number } {
    return {
      lo: this.midiLo + this.semitonesGetter(),
      hi: this.midiHi + this.semitonesGetter(),
    };
  }
}
