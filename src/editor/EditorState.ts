import type { MelodyNote } from "../types.ts";

export interface EditorStateData {
  notes: MelodyNote[];
  bpm: number;
  /** 一拍内的格数：1=1/4, 2=1/8, 4=1/16... 0=关闭吸附。 */
  quantize: 0 | 1 | 2 | 4;
  selectedIdx: number | null;
  title: string;
}

type Listener = () => void;

/** 极简状态容器：notes + 设置 + subscribe。Controller 改 state，View 订阅重绘。 */
export class EditorState {
  private data: EditorStateData;
  private listeners = new Set<Listener>();

  constructor(initial?: Partial<EditorStateData>) {
    this.data = {
      notes: [],
      bpm: 120,
      quantize: 2,
      selectedIdx: null,
      title: "新歌",
      ...initial,
    };
  }

  get(): EditorStateData {
    return this.data;
  }

  /** 浅更新若干字段后通知订阅者。 */
  update(patch: Partial<EditorStateData>): void {
    this.data = { ...this.data, ...patch };
    this.emit();
  }

  /** 直接改动 notes 数组（同一引用）后调用此方法通知。 */
  notifyNotesMutated(): void {
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
