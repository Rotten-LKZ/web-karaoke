import "./editor.css";
import { AudioEngine } from "../audio/AudioEngine.ts";
import { clamp } from "../util/math.ts";
import { Synth } from "../audio/Synth.ts";
import { EditorState } from "./EditorState.ts";
import { PianoRollView } from "./PianoRollView.ts";
import { EditorController } from "./EditorController.ts";
import { computeSpectrogram } from "./Spectrogram.ts";
import { SpecView } from "./SpecView.ts";
import { exportSongJson } from "./exportJson.ts";
import type { Viewport } from "./PianoRollView.ts";

const gate = document.getElementById("gate")!;
const editor = document.getElementById("editor")!;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const trackInfo = document.getElementById("track-info")!;
const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const progress = document.getElementById("progress")!;
const canvas = document.getElementById("roll") as HTMLCanvasElement;
const specCanvas = document.getElementById("spec") as HTMLCanvasElement;

let engine: AudioEngine;
let synth: Synth;
let state: EditorState;
let view: PianoRollView;
let specView: SpecView;
let currentBlobUrl: string | null = null;
// 视口：当前查看的时间窗口（Ctrl+滚轮缩放、播放头跟随会改它）。
const viewport: Viewport = { start: 0, duration: 8 };

function resetViewport(): void {
  const d = engine?.duration || 8;
  viewport.start = 0;
  viewport.duration = d;
}

async function boot(): Promise<void> {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  engine = new AudioEngine(ctx);
  await engine.init();
  synth = new Synth(ctx);

  state = new EditorState({
    notes: [
      { start: 1.0, dur: 0.5, pitch: 60 },
      { start: 1.5, dur: 0.5, pitch: 62 },
      { start: 2.0, dur: 1.0, pitch: 64 },
    ],
  });
  view = new PianoRollView(canvas);
  specView = new SpecView(specCanvas);
  window.addEventListener("resize", () => {
    view.resize();
    specView.resize();
  });

  wireControls();

  // 鼠标交互（画/拖/删/试听/seek）
  new EditorController(
    canvas,
    view,
    state,
    synth,
    engine,
    () => viewport,
    () => engine.duration,
  );

  gate.hidden = true;
  editor.hidden = false;
  view.resize(); // 取消 hidden 后测量真实尺寸
  specView.resize();

  const tick = () => {
    const s = state.get();
    const t = engine.getCurrentTime();
    // 播放头接近视口右边缘时自动跟进（不强制跟随，便于编辑）
    if (engine.isPlaying && t > viewport.start + viewport.duration - 0.1) {
      viewport.start = Math.max(0, t - viewport.duration * 0.5);
    }
    view.draw(t, viewport, s.notes, s.selectedIdx);
    specView.draw(t, viewport);
    playBtn.textContent = engine.isPlaying ? "暂停" : "播放";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function wireControls(): void {
  exportBtn.addEventListener("click", () => {
    exportSongJson(state.get(), engine.duration || 0);
  });
  // 频谱条带：点/拖动 seek（放大后也能移动播放点）
  let scrubbing = false;
  const seekFromSpec = (e: MouseEvent) => {
    const rect = specCanvas.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, view.keyColW, rect.width);
    const time = view.timeForX(x, viewport);
    void engine.seek(clamp(time, 0, Math.max(0, engine.duration)));
  };
  specCanvas.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    specCanvas.setPointerCapture(e.pointerId);
    seekFromSpec(e);
  });
  specCanvas.addEventListener("pointermove", (e) => {
    if (scrubbing) seekFromSpec(e);
  });
  specCanvas.addEventListener("pointerup", () => (scrubbing = false));
  specCanvas.addEventListener("pointercancel", () => (scrubbing = false));
  // 空格播放/暂停（非输入控件聚焦时）
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (engine.isPlaying) engine.pause();
      else void engine.play();
    }
  });
  // Ctrl+滚轮缩放；普通滚轮横向滚动视口
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const total = engine.duration || 0;
    if (e.ctrlKey || e.metaKey) {
      // 以鼠标处的时间为中心缩放
      const rect = canvas.getBoundingClientRect();
      const mx = clamp(e.clientX - rect.left, view.keyColW, rect.width);
      const timeAtMouse = view.timeForX(mx, viewport);
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      viewport.duration = clamp(viewport.duration * factor, 0.5, Math.max(0.5, total || 60));
      viewport.start = clamp(
        timeAtMouse - ((mx - view.keyColW) / (rect.width - view.keyColW)) * viewport.duration,
        0,
        Math.max(0, total - viewport.duration),
      );
    } else {
      // 横向滚动（按可见时长的比例）
      const step = viewport.duration * 0.1 * (e.deltaY > 0 ? 1 : -1);
      viewport.start = clamp(
        viewport.start + step,
        0,
        Math.max(0, total - viewport.duration),
      );
    }
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  specCanvas.addEventListener("wheel", onWheel, { passive: false });
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file || !engine) return;
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = URL.createObjectURL(file);
  trackInfo.textContent = "解码中…";
  try {
    await engine.loadAudio(currentBlobUrl);
    trackInfo.textContent = `${file.name}（${engine.duration.toFixed(1)}s）`;
    resetViewport();
    progress.textContent = "计算频谱…";
    const buf = engine.getBuffer();
    if (buf && specView) {
      const spec = await computeSpectrogram(buf, (r) => {
        progress.textContent = `计算频谱… ${(r * 100).toFixed(0)}%`;
      });
      specView.setSpectrogram(spec, engine.duration);
      progress.textContent = "";
    }
  } catch (err) {
    trackInfo.textContent = "加载失败";
    progress.textContent = (err as Error).message;
  }
});

playBtn.addEventListener("click", async () => {
  if (!engine) return;
  if (engine.isPlaying) engine.pause();
  else await engine.play();
});

stopBtn.addEventListener("click", async () => {
  if (!engine) return;
  engine.pause();
  await engine.seek(0);
});

startBtn.addEventListener("click", () => {
  startBtn.disabled = true;
  boot().catch((err: Error) => {
    console.error(err);
    startBtn.disabled = false;
    alert("初始化失败：" + err.message);
  });
});
