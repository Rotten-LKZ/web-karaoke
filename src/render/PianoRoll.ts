import { Synth } from "../audio/Synth.ts";
import type { MelodyNote } from "../types.ts";
import { applySemitones, midiToName } from "../util/music.ts";

// 键盘映射（相对当前八度根音 C 的半音偏移）。
// 白键：A S D F G H J K → C D E F G A B C
// 黑键：W E   T Y U   → C# D#   F# G# A#
const WHITE_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k"];
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK_KEYS: Record<string, number> = { w: 1, e: 3, t: 6, y: 8, u: 10 };

// 白键半音偏移（一个八度内 C..B）
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11];
// 黑键半音偏移（一个八度内 C# D# F# G# A#）
const BLACK_SEMIS = new Set([1, 3, 6, 8, 10]);

/** 人声域默认范围：C2(36) ~ C6(96)，约 5 个八度。 */
const DEFAULT_LO = 36;
const DEFAULT_HI = 96;

/**
 * 钢琴卷帘窗：覆盖人声域的多八度琴键，点击或键盘弹奏；
 * 旋律当前应唱音高（含移调）以高亮层叠加，帮助找音。
 * 键盘弹奏绑定到「当前八度」（默认 C4），Z/X 降/升八度。
 */
export class PianoRoll {
  private root: HTMLElement;
  private synth: Synth;
  private keyEls = new Map<number, HTMLElement>(); // midi → 琴键 DOM
  private loMidi = DEFAULT_LO;
  private hiMidi = DEFAULT_HI;
  private currentMidi: number | null = null;
  private singingMidi: number | null = null;
  private kbOctave = 4; // 键盘弹奏的当前八度（C4 区）

  constructor(
    container: HTMLElement,
    synth: Synth,
    private semitonesGetter: () => number,
  ) {
    this.root = container;
    this.synth = synth;
    this.render();
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }

  /** 随旋律范围微调（确保旋律音在可视范围内），默认保持人声域。 */
  setRangeForNotes(notes: MelodyNote[]): void {
    const pitches = notes
      .map((n) => n.pitch)
      .filter((p): p is number => p !== null);
    if (pitches.length === 0) {
      this.render();
      return;
    }
    // 扩展范围以覆盖旋律（含移调余量），但不小于人声域默认。
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches);
    this.loMidi = Math.min(DEFAULT_LO, Math.floor((lo - 6) / 12) * 12);
    this.hiMidi = Math.max(DEFAULT_HI, Math.ceil((hi + 6) / 12) * 12);
    this.render();
  }

  /** 每帧更新：高亮当前应唱音高（melody-hit）。 */
  update(t: number, notes: MelodyNote[]): void {
    const note = this.findCurrent(t, notes);
    const targetMidi =
      note?.pitch !== null && note?.pitch !== undefined
        ? applySemitones(note.pitch, this.semitonesGetter())
        : null;

    if (targetMidi !== this.currentMidi) {
      this.clearClass("melody-hit");
      this.currentMidi = targetMidi;
      if (targetMidi !== null) {
        const el = this.keyEls.get(targetMidi);
        if (el) el.classList.add("melody-hit");
      }
    }
  }

  /** 设置麦克风正在唱的音高（singing 高亮）。null 表示没在唱。 */
  setSinging(midi: number | null): void {
    if (midi === this.singingMidi) return;
    this.clearClass("singing");
    this.singingMidi = midi;
    if (midi !== null) {
      const el = this.keyEls.get(midi);
      if (el) el.classList.add("singing");
    }
  }

  private clearClass(cls: string): void {
    for (const el of this.keyEls.values()) el.classList.remove(cls);
  }

  private findCurrent(t: number, notes: MelodyNote[]): MelodyNote | null {
    for (const n of notes) {
      if (t >= n.start - 0.02 && t <= n.start + n.dur + 0.02) return n;
    }
    return null;
  }

  private render(): void {
    this.root.innerHTML = "";
    this.keyEls.clear();
    const wrap = document.createElement("div");
    wrap.className = "piano";

    // 收集范围内的白键 MIDI
    const whiteMidis: number[] = [];
    for (let m = this.loMidi; m <= this.hiMidi; m++) {
      const semi = m % 12;
      if (WHITE_SEMIS.includes(semi)) whiteMidis.push(m);
    }
    const whiteCount = whiteMidis.length;
    const KEY_W = 34; // 白键宽 px（5 个八度 36 键 → 总宽 ~1224px，可横向滚动）
    const innerW = whiteCount * KEY_W;

    const inner = document.createElement("div");
    inner.className = "piano-inner";
    inner.style.width = `${innerW}px`;

    // 白键直接进 inner（无 gap，黑键定位才准确）
    whiteMidis.forEach((midi) => {
      const el = this.makeKey(midi, "white");
      el.style.width = `${KEY_W}px`;
      inner.appendChild(el);
      this.keyEls.set(midi, el);
    });

    // 黑键：绝对定位居中在「左侧白键的右边缘」
    const whiteIndex = new Map(whiteMidis.map((m, i) => [m, i]));
    const BLACK_W = 22;
    for (let m = this.loMidi; m <= this.hiMidi; m++) {
      const semi = m % 12;
      if (!BLACK_SEMIS.has(semi)) continue;
      const leftWhiteIdx = whiteIndex.get(m - 1);
      if (leftWhiteIdx === undefined) continue;
      const el = this.makeKey(m, "black");
      el.style.width = `${BLACK_W}px`;
      el.style.left = `${(leftWhiteIdx + 1) * KEY_W - BLACK_W / 2}px`;
      inner.appendChild(el);
      this.keyEls.set(m, el);
    }

    wrap.appendChild(inner);
    this.root.appendChild(wrap);
  }

  private makeKey(midi: number, kind: "white" | "black"): HTMLElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `piano-key ${kind}`;
    el.dataset.midi = String(midi);
    el.title = midiToName(midi);
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.synth.playNote(midi);
      el.classList.add("pressed");
    });
    el.addEventListener("pointerup", () => el.classList.remove("pressed"));
    el.addEventListener("pointerleave", () => el.classList.remove("pressed"));

    // 只在 C 音上标注音名（避免过密）
    if (midi % 12 === 0) {
      const nm = document.createElement("span");
      nm.className = "piano-key-name";
      nm.textContent = midiToName(midi);
      el.appendChild(nm);
    }
    return el;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    // Z/X 切换八度
    if (k === "z") {
      this.kbOctave = Math.max(1, this.kbOctave - 1);
      return;
    }
    if (k === "x") {
      this.kbOctave = Math.min(7, this.kbOctave + 1);
      return;
    }
    const base = (this.kbOctave + 1) * 12; // C{octave} 的 MIDI
    let off: number | undefined;
    const wi = WHITE_KEYS.indexOf(k);
    if (wi >= 0) off = WHITE_OFFSETS[wi];
    else if (k in BLACK_KEYS) off = BLACK_KEYS[k];
    if (off === undefined) return;
    const midi = base + off;
    this.synth.playNote(midi);
    const el = this.keyEls.get(midi);
    if (el) {
      el.classList.add("pressed");
      setTimeout(() => el.classList.remove("pressed"), 120);
    }
  };
}
