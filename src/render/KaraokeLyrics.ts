import type { AssLine } from "../data/AssParser.ts";

/**
 * K 轴逐字歌词渲染（按行）。
 * - 按 ASS Dialogue 行分行显示：上一行（淡）/ 当前行（大）/ 下一行（淡）。
 * - 当前行内逐音节 K 轴高亮：
 *   {\k} 瞬间变色、{\kf}/{\K} background-clip:text + --progress 擦除填充。
 * - 切行时才重建当前行 DOM，每帧只改当前音节 class/style。
 */
export class KaraokeLyrics {
  private root: HTMLElement;
  private lines: AssLine[] = [];
  private lineDivs: HTMLDivElement[] = [];
  private spans: HTMLSpanElement[][] = [];
  private currentLine = -1;
  private currentSyl = -1;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** 设置歌词行（重建所有行 DOM）。 */
  setLines(lines: AssLine[]): void {
    this.lines = lines;
    this.root.innerHTML = "";
    this.lineDivs = [];
    this.spans = [];
    this.currentLine = -1;
    this.currentSyl = -1;

    const frag = document.createDocumentFragment();
    lines.forEach((ln, li) => {
      const div = document.createElement("div");
      div.className = "lyr-line";
      div.dataset.idx = String(li);
      const sylSpans: HTMLSpanElement[] = [];
      ln.syllables.forEach((s) => {
        const span = document.createElement("span");
        span.className = "syl";
        span.dataset.effect = s.effect;
        span.textContent = s.text || " ";
        div.appendChild(span);
        sylSpans.push(span);
      });
      frag.appendChild(div);
      this.lineDivs.push(div);
      this.spans.push(sylSpans);
    });
    this.root.appendChild(frag);
    this.applyVisibility();
  }

  /** 每帧更新：定位当前行 + 当前进音节。 */
  update(t: number): void {
    if (this.lines.length === 0) return;
    const li = this.findLine(t);
    if (li !== this.currentLine) {
      // 切行：把旧行所有音节清理（active→done），整行标记已唱完
      if (this.currentLine >= 0 && this.spans[this.currentLine]) {
        for (const span of this.spans[this.currentLine]) {
          span.classList.remove("active");
          span.style.removeProperty("--progress");
          span.classList.add("done");
        }
      }
      this.currentLine = li;
      this.currentSyl = -1;
      this.applyVisibility();
    }
    if (li < 0) return;

    // 当前行内逐音节高亮
    const sylIdx = this.findSyllable(li, t);
    if (sylIdx !== this.currentSyl) {
      const spans = this.spans[li];
      // 把上一音节标记 done（保留彩色，稍暗）
      if (this.currentSyl >= 0 && spans[this.currentSyl]) {
        spans[this.currentSyl].classList.remove("active");
        spans[this.currentSyl].classList.add("done");
        spans[this.currentSyl].style.removeProperty("--progress");
      }
      this.currentSyl = sylIdx;
      if (sylIdx >= 0 && spans[sylIdx]) {
        spans[sylIdx].classList.remove("done");
        spans[sylIdx].classList.add("active");
      }
    }

    // kf 平滑进度
    if (sylIdx >= 0) {
      const s = this.lines[li].syllables[sylIdx];
      const span = this.spans[li][sylIdx];
      if (span && s.effect === "kf" && s.dur > 0) {
        const progress = clamp((t - s.start) / s.dur, 0, 1);
        span.style.setProperty("--progress", progress.toFixed(3));
      }
    }
  }

  /** 根据当前行刷新三行（prev/cur/next）的显隐与样式。 */
  private applyVisibility(): void {
    this.lineDivs.forEach((div, i) => {
      const rel = i - this.currentLine;
      div.classList.toggle("cur", rel === 0);
      div.classList.toggle("prev", rel === -1);
      div.classList.toggle("next", rel === 1);
      div.classList.toggle("far", Math.abs(rel) > 1);
    });
    // 当前行滚入视野
    if (this.currentLine >= 0 && this.lineDivs[this.currentLine]) {
      this.lineDivs[this.currentLine].scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }

  private findLine(t: number): number {
    for (let i = 0; i < this.lines.length; i++) {
      const ln = this.lines[i];
      if (t >= ln.start && t < ln.end) return i;
    }
    // 间隙：取最近一个已开始的行
    let last = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].start <= t) last = i;
      else break;
    }
    return last;
  }

  private findSyllable(li: number, t: number): number {
    const syls = this.lines[li].syllables;
    for (let i = 0; i < syls.length; i++) {
      const s = syls[i];
      if (t >= s.start && t < s.start + s.dur) return i;
    }
    let last = -1;
    for (let i = 0; i < syls.length; i++) {
      if (syls[i].start <= t) last = i;
      else break;
    }
    return last;
  }
}

const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v;
