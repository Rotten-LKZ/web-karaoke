import type { MelodyNote } from "../types.ts";
import { applySemitones, freqToMidi } from "../util/music.ts";
import {
  centsErrorOctaveInvariant,
  foldToOctaveOf,
  foldToRange,
  verdictForCents,
  type Verdict,
} from "../util/octave.ts";
import type { MicPitch } from "./HighwayCanvas.ts";

const VERDICT_COLOR: Record<Verdict, string> = {
  "in-tune": "#5fd07a",
  sharp: "#ff6b6b",
  flat: "#ff8a4c",
};

const NEUTRAL_COLOR = "#cfd3dc";

/** 一段连续演唱（长音）：同一音高（容差内）的演唱连成一条。 */
interface SungSegment {
  start: number; // 段开始时间（秒）
  end: number; // 段当前结束时间（秒，随演唱延伸）
  /** 参考音高（折叠后），绘制 Y；用滑动平均平滑。 */
  midi: number;
  verdict: Verdict;
  /** 无旋律目标时为 true，用中性色绘制。 */
  neutral: boolean;
}

/** 视为「同一长音」的音高容差（半音）。长音相对段起始音高在此范围内则延长同一段。
 *  音头固定后，后续帧只与段起始比较，不改音高，故容差可略宽以容忍抖动。 */
const SAME_NOTE_SEMITONE = 0.5;
/** 超过此时长无更新则结束当前段（秒）。 */
const SEGMENT_GAP = 0.15;
/**
 * 音高识别延迟补偿（秒）。检测到的音高其实对应 LATENCY 秒前的声音：
 * 分析窗口(~23ms) + 轮询(25ms) + 平滑(~100ms)。把演唱段标注到 t-LATENCY，
 * 方块视觉对齐到声音实际发生的过去时刻，与标准方块正确比对。
 * 物理上无法消除窗口延迟，只能在显示层补偿。 */
const LATENCY = 0.15;

/**
 * 音轨与实时音准比对视图（Pitch Matching View）：
 * - 判定线固定在左侧（JUDGE_RATIO）。右侧 = 未来，左侧 = 已唱。
 * - 标准音高方块（胶囊 Note Bars）：MIDI 音符 → 横向胶囊，长=时长，Y=标准音高。
 *   随播放从右向左滚动，经过判定线。
 * - 实时演唱方块：麦克风音高按八度容错折叠到当前目标八度，在判定线位置
 *   生成连续方块条，与标准方块纵向对比；重合时标准方块高亮 + 粒子。
 */
export class PitchLineCanvas {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private notes: MelodyNote[] = [];
  private midiLo = 48;
  private midiHi = 79;

  /** 判定线 x 占比（0..1），左侧为已唱区。 */
  private readonly JUDGE_RATIO = 0.22;
  /** 判定线右侧（未来）可见秒数。 */
  private readonly FUTURE_SEC = 6;
  /** 判定线左侧（已唱）可见秒数。 */
  private readonly PAST_SEC = 2;

  private trail: SungSegment[] = [];
  /** 粒子（命中反馈），{x,y,life}。 */
  private particles: { x: number; y: number; life: number }[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    notes: MelodyNote[],
    private semitonesGetter: () => number,
    private micGetter: () => MicPitch | null,
    private playingGetter: () => boolean,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.setSong(notes);
    this.resize();
  }

  setSong(notes: MelodyNote[]): void {
    this.notes = notes;
    this.trail = [];
    this.particles = [];
    const pitches = notes
      .map((n) => n.pitch)
      .filter((p): p is number => p !== null);
    if (pitches.length > 0) {
      this.midiLo = Math.min(...pitches) - 2;
      this.midiHi = Math.max(...pitches) + 2;
    }
  }

  /** 清除演唱轨迹与粒子（评分由调用方同步重置）。 */
  clearTrail(): void {
    this.trail = [];
    this.particles = [];
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

  /** 每帧：t=当前播放时间。 */
  draw(t: number): void {
    const { ctx, W, H } = this;
    const semis = this.semitonesGetter();
    ctx.clearRect(0, 0, W, H);

    this.maybeRecordTrail(t);

    const judgeX = W * this.JUDGE_RATIO;
    // 时间 → x：判定线处 = t，每秒对应 (W-judgeX)/FUTURE_SEC px（右侧）
    const pxPerSec = (W - judgeX) / this.FUTURE_SEC;
    const xForTime = (tt: number) => judgeX + (tt - t) * pxPerSec;

    const span = this.midiHi - this.midiLo || 1;
    const padY = H * 0.08;
    const yForMidi = (m: number) =>
      H - padY - ((m - this.midiLo) / span) * (H - padY * 2);

    // 当前目标（用于八度折叠基准 + 命中粒子）
    const cur = this.currentNote(t);
    const targetMidi =
      cur?.pitch !== null && cur?.pitch !== undefined
        ? applySemitones(cur.pitch, semis)
        : null;

    // 1. 标准音高方块（胶囊）
    const barH = Math.min(14, (H - padY * 2) / (span + 1));
    for (const n of this.notes) {
      if (n.pitch === null) continue;
      const midi = applySemitones(n.pitch, semis);
      const x1 = xForTime(n.start);
      const x2 = xForTime(n.start + n.dur);
      if (x2 < 0 || x1 > W) continue; // 视口剔除
      const isCurrent = cur !== null && n === cur && targetMidi !== null;
      this.drawNoteBar(
        x1,
        x2,
        yForMidi(midi),
        barH,
        isCurrent,
        isCurrent ? targetMidi! : null,
      );
    }

    // 2. 演唱长条（连续段，随时间左移；长音会横向延伸）
    for (const seg of this.trail) {
      const x1 = xForTime(seg.start);
      const x2 = xForTime(seg.end);
      if (x2 < -6 || x1 > W) continue;
      const color = seg.neutral ? NEUTRAL_COLOR : VERDICT_COLOR[seg.verdict];
      const by = yForMidi(seg.midi);
      const x = Math.max(x1, -6);
      const w = Math.max(8, x2 - x);
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      this.roundRect(x, by - barH / 2, w, barH, barH / 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. 粒子
    this.drawParticles();

    // 4. 判定线
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(judgeX, 0);
    ctx.lineTo(judgeX, H);
    ctx.stroke();
  }

  /** 画一个标准音符胶囊；当前命中时发光 + 生成粒子。
   *  currentTargetMidi 非 null 表示此方块是当前目标，参与命中判定。 */
  private drawNoteBar(
    x1: number,
    x2: number,
    y: number,
    h: number,
    isCurrent: boolean,
    currentTargetMidi: number | null,
  ): void {
    const { ctx } = this;
    const x = Math.max(x1, 0);
    const w = Math.max(2, Math.min(x2, this.W) - x);
    // 命中判定：当前麦克风在唱且八度等价准
    const mic = this.micGetter();
    let hit = false;
    if (isCurrent && currentTargetMidi !== null && mic && mic.freq > 0 && mic.clarity >= 0.9) {
      const micMidi = freqToMidi(mic.freq);
      const cents = centsErrorOctaveInvariant(micMidi, currentTargetMidi);
      if (Math.abs(cents) <= 50) hit = true;
    }

    const past = x2 < this.W * this.JUDGE_RATIO;
    ctx.fillStyle = hit
      ? "#5fd07a"
      : isCurrent
        ? "#9fc0ff"
        : past
          ? "rgba(122,168,255,0.45)"
          : "rgba(122,168,255,0.85)";
    if (hit) {
      ctx.save();
      ctx.shadowColor = "#5fd07a";
      ctx.shadowBlur = 16;
    }
    this.roundRect(x, y - h / 2, w, h, h / 2);
    ctx.fill();
    if (hit) ctx.restore();

    // 命中粒子（判定线处迸发）
    if (hit) this.spawnParticles(this.W * this.JUDGE_RATIO, y);
  }

  private spawnParticles(x: number, y: number): void {
    // 限频：每帧最多加 2 个
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x,
        y,
        life: 1,
      });
    }
  }

  private drawParticles(): void {
    const { ctx } = this;
    const next: typeof this.particles = [];
    for (const p of this.particles) {
      p.life -= 0.06;
      if (p.life <= 0) continue;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = "#9be8b0";
      ctx.beginPath();
      ctx.arc(p.x, p.y, (1 - p.life) * 10 + 2, 0, Math.PI * 2);
      ctx.fill();
      next.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = next;
    if (this.particles.length > 120) this.particles.splice(0, this.particles.length - 120);
  }

  /** 记录当前麦克风音高到轨迹。有目标时折叠到目标八度并算 verdict；
   *  无目标（暂停/休止/间隙）也记录，用中性色 + 折叠到显示范围。
   *  检测到的音高对应 LATENCY 秒前的声音，故标注到 ts = t - LATENCY。 */
  private maybeRecordTrail(t: number): void {
    if (!this.playingGetter()) return; // 暂停时不记录/延长演唱长条
    const mic = this.micGetter();
    if (!mic || mic.freq <= 0 || mic.clarity < 0.85) return;
    const micMidi = freqToMidi(mic.freq);

    // 声音实际发生的时刻（补偿识别延迟）：目标判定与段时间戳都用它
    const ts = t - LATENCY;

    const cur = this.currentNote(ts);
    const semis = this.semitonesGetter();

    let folded: number;
    let verdict: Verdict;
    let neutral: boolean;
    if (cur && cur.pitch !== null) {
      const targetMidi = applySemitones(cur.pitch, semis);
      folded = foldToOctaveOf(micMidi, targetMidi);
      verdict = verdictForCents(
        centsErrorOctaveInvariant(micMidi, targetMidi),
      );
      neutral = false;
    } else {
      // 无目标：折叠到显示范围最近的八度，中性色
      folded = foldToRange(micMidi, this.midiLo, this.midiHi);
      verdict = "in-tune";
      neutral = true;
    }

    // 段模型：同性质(neutral) + 音高在容差内 + 时间连续 → 延长最后一段；
    // 否则开新段。延长时用滑动平均微调参考音高，保持长音稳定。
    const last = this.trail[this.trail.length - 1];
    const sameKind = last && last.neutral === neutral;
    const inTune =
      last && Math.abs(folded - last.midi) <= SAME_NOTE_SEMITONE;
    const contiguous = last && ts - last.end <= SEGMENT_GAP;

    if (last && sameKind && inTune && contiguous) {
      // 延长：音头固定——不改 last.midi（段起始音高保持），只延长 end。
      // 长音去匹配段起始音高，匹配不上（超出容差）就开新段。
      last.end = ts;
      last.verdict = verdict; // verdict 跟随最新
    } else {
      this.trail.push({ start: ts, end: ts, midi: folded, verdict, neutral });
    }

    // 清理已划出左侧视野的段
    const cutoff = ts - (this.PAST_SEC + 1);
    while (this.trail.length > 0 && this.trail[0].end < cutoff) {
      this.trail.shift();
    }
  }

  private currentNote(t: number): MelodyNote | null {
    for (const n of this.notes) {
      if (t >= n.start - 0.02 && t <= n.start + n.dur + 0.02) return n;
    }
    return null;
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
}
