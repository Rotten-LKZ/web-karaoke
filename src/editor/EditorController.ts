import type { Synth } from "../audio/Synth.ts";
import type { MelodyNote } from "../types.ts";
import { clamp } from "../util/math.ts";
import type { EditorState } from "./EditorState.ts";
import type { PianoRollView, Viewport } from "./PianoRollView.ts";
import type { AudioEngine } from "../audio/AudioEngine.ts";

type Mode = "idle" | "creating" | "moving" | "resizing";

const RESIZE_HANDLE_PX = 8;
const MIN_DUR = 0.05;
const DEFAULT_DUR = 0.3;

interface Drag {
  mode: Mode;
  idx: number;
  startMouseTime: number;
  startMouseMidi: number;
  origNote: MelodyNote;
  moved: boolean;
}

/** 鼠标交互状态机：
 *  - 左键空白：画音符（拖出时长）
 *  - 左键音符：移动 / 拖右边缘改时长 / 单击试听
 *  - 右键空白：seek（移动播放起点）
 *  - 右键音符：删除
 *  - Delete/Backspace：删除选中音符
 *  双击删除（兼容）。 */
export class EditorController {
  private drag: Drag | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private view: PianoRollView,
    private state: EditorState,
    private synth: Synth,
    private engine: AudioEngine,
    private viewportGetter: () => Viewport,
    private totalDurationGetter: () => number,
  ) {
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("dblclick", this.onDblClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private total(): number {
    return this.totalDurationGetter() || 0;
  }

  private hitTest(x: number, y: number): { idx: number; onRightEdge: boolean } | null {
    const vp = this.viewportGetter();
    const notes = this.state.get().notes;
    const rowH = this.view.rowH;
    const barH = Math.max(4, rowH * 0.8);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch === null) continue;
      const x1 = this.view.xForTime(n.start, vp);
      const x2 = this.view.xForTime(n.start + n.dur, vp);
      const cy = this.view.yForMidi(n.pitch);
      if (x >= x1 - 2 && x <= x2 + 2 && y >= cy - barH / 2 - 2 && y <= cy + barH / 2 + 2) {
        return { idx: i, onRightEdge: x >= x2 - RESIZE_HANDLE_PX };
      }
    }
    return null;
  }

  private xyToTimeMidi(e: MouseEvent): { x: number; y: number; time: number; midi: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const vp = this.viewportGetter();
    return {
      x,
      y,
      time: this.view.timeForX(x, vp),
      midi: Math.round(this.view.midiForY(y)),
    };
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const { x, y, time, midi } = this.xyToTimeMidi(e);
    const hit = this.hitTest(x, y);
    if (hit) {
      const n = this.state.get().notes[hit.idx];
      this.state.update({ selectedIdx: hit.idx });
      if (n.pitch !== null) this.synth.playNote(n.pitch);
      this.drag = {
        mode: hit.onRightEdge ? "resizing" : "moving",
        idx: hit.idx,
        startMouseTime: time,
        startMouseMidi: midi,
        origNote: { ...n },
        moved: false,
      };
      return;
    }
    const startT = clamp(time, 0, Math.max(0, this.total()));
    const newNote: MelodyNote = { start: startT, dur: MIN_DUR, pitch: midi };
    const notes = [...this.state.get().notes, newNote];
    const newIdx = notes.length - 1;
    this.state.update({ notes, selectedIdx: newIdx });
    this.drag = {
      mode: "creating",
      idx: newIdx,
      startMouseTime: time,
      startMouseMidi: midi,
      origNote: { ...newNote },
      moved: false,
    };
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.drag) return;
    const { time, midi } = this.xyToTimeMidi(e);
    const total = this.total();
    const n = this.state.get().notes[this.drag.idx];
    if (!n) return;
    this.drag.moved = true;

    if (this.drag.mode === "creating") {
      // 音头出现即固定音高：只改 dur，不改 pitch（pitch 在 mousedown 时确定）
      n.dur = Math.max(MIN_DUR, time - n.start);
    } else if (this.drag.mode === "moving") {
      const dTime = time - this.drag.startMouseTime;
      const dMidi = midi - this.drag.startMouseMidi;
      n.start = clamp(this.drag.origNote.start + dTime, 0, Math.max(0, total - MIN_DUR));
      n.pitch = clamp(
        this.drag.origNote.pitch! + dMidi,
        this.view.midiLo,
        this.view.midiHi - 1,
      );
    } else if (this.drag.mode === "resizing") {
      n.dur = Math.max(MIN_DUR, time - n.start);
    }
    this.state.notifyNotesMutated();
  };

  private onMouseUp = (): void => {
    if (!this.drag) return;
    if (this.drag.mode === "creating" && !this.drag.moved) {
      const n = this.state.get().notes[this.drag.idx];
      if (n) {
        n.dur = DEFAULT_DUR;
        this.state.notifyNotesMutated();
      }
    }
    this.drag = null;
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { x, y, time } = this.xyToTimeMidi(e);
    const hit = this.hitTest(x, y);
    if (hit) {
      const notes = this.state.get().notes.filter((_, i) => i !== hit.idx);
      this.state.update({ notes, selectedIdx: null });
    } else {
      void this.engine.seek(clamp(time, 0, Math.max(0, this.total())));
    }
  };

  private onDblClick = (e: MouseEvent): void => {
    const { x, y } = this.xyToTimeMidi(e);
    const hit = this.hitTest(x, y);
    if (!hit) return;
    const notes = this.state.get().notes.filter((_, i) => i !== hit.idx);
    this.state.update({ notes, selectedIdx: null });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      const s = this.state.get();
      if (s.selectedIdx !== null) {
        const notes = s.notes.filter((_, i) => i !== s.selectedIdx);
        this.state.update({ notes, selectedIdx: null });
        e.preventDefault();
      }
    }
  };
}
