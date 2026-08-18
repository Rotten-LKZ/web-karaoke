import "./style.css";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { Synth } from "./audio/Synth.ts";
import { MicPitchDetector } from "./audio/PitchDetector.ts";
import { Recorder } from "./audio/Recorder.ts";
import { loadSongData } from "./data/SongLoader.ts";
import { parseAss } from "./data/AssParser.ts";
import { comparePitch, type Verdict } from "./data/transpose.ts";
import { Scoring } from "./data/Scoring.ts";
import { freqToMidi, midiToName } from "./util/music.ts";
import { audioBufferToWav } from "./util/wav.ts";
import songList from "../songs.json";
import { HighwayCanvas, type MicPitch } from "./render/HighwayCanvas.ts";
import { PitchLineCanvas } from "./render/PitchLineCanvas.ts";
import { PianoRoll } from "./render/PianoRoll.ts";
import { KaraokeLyrics } from "./render/KaraokeLyrics.ts";
import type { SongData } from "./types.ts";

const gate = document.getElementById("gate")!;
const stage = document.getElementById("stage")!;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const controls = document.getElementById("controls")!;
const songInfo = document.getElementById("song-info")!;
const canvas = document.getElementById("highway") as HTMLCanvasElement;
const pitchCanvas = document.getElementById("pitchline") as HTMLCanvasElement;
const pianoEl = document.getElementById("piano")!;
const lyricsEl = document.getElementById("lyrics")!;
const micStatusEl = document.getElementById("mic-status")!;
const scoreBadge = document.getElementById("score-badge")!;

const SONGS_BASE = "/songs";
const SIGN_API = import.meta.env.VITE_SIGN_API ?? "https://karaoke-api.rotcool.me";

interface SongEntry {
  slug: string;
  title: string;
  artist: string;
  key?: string;
  /** 原唱音轨（可选）：有该字段的歌曲才能切换原唱。 */
  original?: string;
}

/** 一次录音：Blob 供下载，解码后的 buffer 供同步回放（解码失败时为 null）。 */
interface Recording {
  blob: Blob;
  buffer: AudioBuffer | null;
  /** 录音起点对应的歌曲秒数。 */
  startOffset: number;
  slug: string;
}

// 全局可变状态。
const state = {
  semitones: 0,
  mic: null as MicPitch | null,
  micOn: false,
};

// UI 元素引用。
let playBtn: HTMLButtonElement;
let seekBar: HTMLInputElement;
let timeLbl: HTMLSpanElement;
let songSelect: HTMLSelectElement;
let micBtn: HTMLButtonElement;
let origBtn: HTMLButtonElement;
let recBtn: HTMLButtonElement;
let recPlayBtn: HTMLButtonElement;
let recDlBtn: HTMLButtonElement;
let recOffsetInput: HTMLInputElement;
let recOffsetLbl: HTMLSpanElement;
let seeking = false;

async function boot(): Promise<void> {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  const engine = new AudioEngine(ctx);
  await engine.init();

  // 一次性组件
  const synth = new Synth(ctx);
  const piano = new PianoRoll(pianoEl, synth, () => state.semitones);
  const highway = new HighwayCanvas(
    canvas,
    [],
    () => state.semitones,
    () => state.mic,
  );
  const pitchLine = new PitchLineCanvas(
    pitchCanvas,
    [],
    () => state.semitones,
    () => state.mic,
    () => engine.isPlaying,
  );
  const scoring = new Scoring();
  window.addEventListener("resize", () => {
    highway.resize();
    pitchLine.resize();
  });
  const lyrics = new KaraokeLyrics(lyricsEl);
  const mic = new MicPitchDetector(ctx);

  // 当前歌曲数据（tick 闭包引用）
  let currentSong: SongData | null = null;
  let currentSlug = "";

  // ---- 录音状态与操作 ----
  const recorder = new Recorder();
  let recording: Recording | null = null;
  let recEnabled = false;
  let recStartOffset = 0;
  /** 回放偏移补偿（ms）。正值 = 录音延后播放（Windows 麦克风采集有延迟）。 */
  let recOffsetMs = 0;

  function updateRecUI(): void {
    recBtn.textContent = recorder.isRecording ? "停止录音" : "开始录音";
    recBtn.classList.toggle("recording", recorder.isRecording);
    const playable =
      recording !== null &&
      recording.buffer !== null &&
      recording.slug === currentSlug;
    recPlayBtn.disabled = !playable;
    recPlayBtn.textContent = recEnabled ? "录音播放: 开" : "录音播放: 关";
    recOffsetInput.disabled = !playable;
    recDlBtn.disabled = recording === null;
  }

  /** 开/关麦克风（录音按钮与话筒按钮共用）。 */
  async function setMic(on: boolean): Promise<boolean> {
    if (on) {
      try {
        await mic.start();
        state.micOn = true;
        micBtn.textContent = "关麦克风";
        return true;
      } catch (err) {
        alert("无法访问麦克风：" + (err as Error).message);
        return false;
      }
    }
    if (recorder.isRecording) void stopRecording();
    mic.stop();
    state.micOn = false;
    micBtn.textContent = "开麦克风";
    state.mic = null;
    return true;
  }

  /** 开始录音（麦克风未开时自动开启）。 */
  async function startRecording(): Promise<void> {
    if (recorder.isRecording) {
      await stopRecording();
      return;
    }
    if (!state.micOn && !(await setMic(true))) return;
    const stream = mic.stream;
    if (!stream) return;
    recStartOffset = engine.getCurrentTime();
    recorder.start(stream);
    updateRecUI();
  }

  /** 停止录音并解码，默认立刻启用「带录音播放」。 */
  async function stopRecording(opts: { enablePlayback?: boolean } = {}): Promise<void> {
    if (!recorder.isRecording) return;
    const blob = await recorder.stop();
    let buffer: AudioBuffer | null = null;
    try {
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (err) {
      console.warn("录音解码失败（可能为空录音）：", err);
      alert("录音解码失败，无法回放，但仍可下载。");
    }
    // 下载用 WAV（解码成功后转换；失败则退回 MediaRecorder 原始格式）。
    recording = {
      blob: buffer ? audioBufferToWav(buffer) : blob,
      buffer,
      startOffset: recStartOffset,
      slug: currentSlug,
    };
    if (opts.enablePlayback !== false && buffer) {
      recEnabled = true;
      await engine.setOverlay(buffer, recStartOffset - recOffsetMs / 1000);
      await engine.setOverlayEnabled(true);
    }
    updateRecUI();
  }

  /** 切换「带录音播放」。 */
  async function toggleRecPlayback(): Promise<void> {
    if (!recording?.buffer || recording.slug !== currentSlug) return;
    recEnabled = !recEnabled;
    if (recEnabled) {
      await engine.setOverlay(
        recording.buffer,
        recording.startOffset - recOffsetMs / 1000,
      );
      await engine.setOverlayEnabled(true);
    } else {
      await engine.setOverlayEnabled(false);
    }
    updateRecUI();
  }

  /** 调整录音回放偏移（补偿麦克风采集延迟）。 */
  async function setRecOffset(ms: number): Promise<void> {
    recOffsetMs = ms;
    if (recording?.buffer && recording.slug === currentSlug) {
      await engine.setOverlay(
        recording.buffer,
        recording.startOffset - ms / 1000,
      );
    }
  }

  /** 下载保存录音文件（WAV；解码失败时退回原始 webm/mp4）。 */
  function downloadRecording(): void {
    if (!recording) return;
    const ext =
      recording.blob.type === "audio/wav"
        ? "wav"
        : recording.blob.type.includes("mp4")
          ? "mp4"
          : "webm";
    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recording.slug || "karaoke"}-录音.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 加载并切换一首歌。 */
  async function loadSong(slug: string): Promise<void> {
    engine.pause();
    await engine.seek(0);
    currentSlug = slug;

    // 换歌：结束进行中的录音，并停用录音叠加（录音文件仍保留可下载）。
    if (recorder.isRecording) await stopRecording({ enablePlayback: false });
    recEnabled = false;
    await engine.setOverlayEnabled(false);
    await engine.setOverlay(null);
    updateRecUI();

    songInfo.textContent = "加载中…";
    const dir = `${SONGS_BASE}/${slug}`;
    const entry = (songList as SongEntry[]).find((s) => s.slug === slug);
    const song = await loadSongData(dir);
    const audio = await signedAudioUrl(slug);
    await engine.loadAudio(audio);

    // 原唱（可选）：仅配置了 original 且加载成功的歌曲显示切换按钮。
    await engine.setUseOriginal(false);
    try {
      if (entry?.original) {
        await engine.loadOriginalAudio(await signedAudioUrl(slug, "original"));
      } else {
        engine.clearOriginal();
      }
    } catch (err) {
      console.warn("原唱加载失败：", err);
      engine.clearOriginal();
      alert(
        "原唱加载失败，无法切换原唱。请确认 Worker 已重新部署（支持 ?track=original）且七牛上存在对应文件。",
      );
    }
    origBtn.hidden = !engine.hasOriginal;
    origBtn.textContent = "原唱: 关";

    currentSong = song;

    highway.setNotes(song.melody.notes);
    piano.setRangeForNotes(song.melody.notes);
    pitchLine.setSong(song.melody.notes);
    scoring.reset();
    seekBar.max = String(engine.duration);

    try {
      const assRes = await fetch(`${dir}/${song.lyrics.file}`);
      lyrics.setLines(assRes.ok ? parseAss(await assRes.text()) : []);
    } catch {
      lyrics.setLines([]);
    }

    songInfo.textContent = `${song.meta.title} · ${song.meta.artist}（${engine.duration.toFixed(0)}s）`;
  }

  buildControls(engine, loadSong, () => {
    pitchLine.clearTrail();
    scoring.reset();
  }, {
    setMic,
    startRecording,
    toggleRecPlayback,
    setRecOffset,
    downloadRecording,
  });
  updateRecUI();

  // 加载歌曲列表并选中第一首
  const songs = await fetchSongList();
  for (const s of songs) {
    const opt = document.createElement("option");
    opt.value = s.slug;
    opt.textContent = `${s.title} — ${s.artist}`;
    songSelect.appendChild(opt);
  }
  if (songs.length > 0) {
    songSelect.value = songs[0].slug;
    await loadSong(songs[0].slug);
  }

  gate.hidden = true;
  stage.hidden = false;

  // stage 取消 hidden 后才测量到真实尺寸（hidden 时 canvas getBoundingClientRect 为 0）。
  highway.resize();
  pitchLine.resize();

  const tick = () => {
    const t = engine.getCurrentTime();
    state.mic = mic.latest;
    highway.draw(t);
    pitchLine.draw(t);
    if (currentSong) {
      piano.update(t, currentSong.melody.notes);
    }
    piano.setSinging(
      state.mic && state.mic.freq > 0
        ? Math.round(freqToMidi(state.mic.freq))
        : null,
    );
    lyrics.update(t);

    // 统一的音高判定（micStatus 与 scoring 共用）
    const target = highway.currentNote(t)?.pitch ?? null;
    const cmp =
      state.mic && state.mic.freq > 0
        ? comparePitch(
            target,
            state.mic.freq,
            state.mic.clarity,
            state.semitones,
          )
        : null;
    updateMicStatus(cmp);
    // 评分：当前目标音符索引
    const activeIdx = currentSong
      ? currentSong.melody.notes.findIndex(
          (n) => t >= n.start - 0.02 && t <= n.start + n.dur + 0.02,
        )
      : -1;
    const singing = !!state.mic && state.mic.clarity >= 0.9 && state.mic.freq > 0;
    scoring.update(
      t,
      activeIdx,
      !!(cmp?.isActive && cmp.verdict === "in-tune"),
      singing,
    );
    const score = scoring.score();
    if (score === null) {
      scoreBadge.textContent = "评分 —";
      scoreBadge.classList.remove("has-score");
    } else {
      scoreBadge.textContent = `评分 ${score}`;
      scoreBadge.classList.toggle("has-score", score >= 60);
    }

    if (engine.isPlaying && t >= engine.duration - 0.02) {
      engine.pause();
      void engine.seek(0);
      // 歌曲放完时若还在录音则自动停止（下次播放即可听到自己的录音）。
      if (recorder.isRecording) void stopRecording();
    }
    refreshUI(engine);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // 上一次有效识别结果，用于无新结果时保持显示
  let lastMicStatus: { text: string; verdict: Verdict } | null = null;

  function updateMicStatus(cmp: ReturnType<typeof comparePitch> | null): void {
    if (cmp && state.mic && state.mic.freq > 0) {
      // 显示「相对识别到的最近音级」的偏移（调音器式，±50¢），
      // 而非相对目标的八度等价 cents（那个可能 ±600 无意义）。
      const micMidi = freqToMidi(state.mic.freq);
      const heardMidi = Math.round(micMidi);
      const heardName = midiToName(heardMidi);
      const centsOff = Math.round((micMidi - heardMidi) * 100); // -50..+50
      const label = {
        "in-tune": "准 ✓",
        sharp: "偏高 ↑",
        flat: "偏低 ↓",
        none: "—",
      }[cmp.verdict];
      const text = `${heardName} ${centsOff > 0 ? "+" : ""}${centsOff}¢ · ${label}`;
      lastMicStatus = { text, verdict: cmp.verdict };
      micStatusEl.textContent = text;
      micStatusEl.dataset.verdict = cmp.verdict;
      return;
    }
    // 无有效结果：若有过识别则保持上一个，否则才提示麦克风未开
    if (lastMicStatus) {
      micStatusEl.textContent = lastMicStatus.text;
      micStatusEl.dataset.verdict = lastMicStatus.verdict;
    } else {
      micStatusEl.textContent = "麦克风未开";
      micStatusEl.dataset.verdict = "none";
    }
  }

  (window as unknown as { __engine: AudioEngine }).__engine = engine;
}

async function fetchSongList(): Promise<SongEntry[]> {
  return songList as SongEntry[];
}

/** 向签名 API 请求某首歌的七牛 CDN 私有播放 URL；track="original" 取原唱。 */
async function signedAudioUrl(
  slug: string,
  track?: "original",
): Promise<string> {
  const q = track ? `?track=${track}` : "";
  const res = await fetch(`${SIGN_API}/sign/${encodeURIComponent(slug)}${q}`);
  if (!res.ok) throw new Error(`签名失败: ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

function buildControls(
  engine: AudioEngine,
  loadSong: (slug: string) => Promise<void>,
  clearTrail: () => void,
  rec: {
    setMic: (on: boolean) => Promise<boolean>;
    startRecording: () => Promise<void>;
    toggleRecPlayback: () => Promise<void>;
    setRecOffset: (ms: number) => Promise<void>;
    downloadRecording: () => void;
  },
): void {
  // 选歌下拉
  songSelect = document.createElement("select");
  songSelect.addEventListener("change", () => {
    void loadSong(songSelect.value);
  });

  playBtn = document.createElement("button");
  playBtn.textContent = "播放";
  playBtn.addEventListener("click", async () => {
    if (engine.isPlaying) engine.pause();
    else await engine.play();
  });

  // 倍速（保持音高不变，用于慢练/快练）
  const speedLbl = document.createElement("span");
  speedLbl.style.cssText = "color: var(--muted); font-size:.8rem";
  speedLbl.textContent = "倍速";
  const speedSelect = document.createElement("select");
  for (const r of [0.5, 0.75, 0.85, 1, 1.25, 1.5]) {
    const opt = document.createElement("option");
    opt.value = String(r);
    opt.textContent = r === 1 ? "1x" : `${r}x`;
    if (r === 1) opt.selected = true;
    speedSelect.appendChild(opt);
  }
  speedSelect.addEventListener("change", () => {
    void engine.setRate(Number(speedSelect.value));
  });

  timeLbl = document.createElement("span");
  timeLbl.style.cssText =
    "font-variant-numeric: tabular-nums; color: var(--muted); font-size:.8rem";
  seekBar = document.createElement("input");
  seekBar.type = "range";
  seekBar.min = "0";
  seekBar.max = "0";
  seekBar.step = "0.05";
  seekBar.addEventListener("pointerdown", () => (seeking = true));
  seekBar.addEventListener("pointerup", async () => {
    await engine.seek(Number(seekBar.value));
    seeking = false;
  });

  const semiLbl = document.createElement("span");
  semiLbl.style.cssText =
    "color: var(--muted); font-size:.8rem; font-variant-numeric: tabular-nums";
  semiLbl.textContent = "调式: 0";
  const semi = document.createElement("input");
  semi.type = "range";
  semi.min = "-6";
  semi.max = "6";
  semi.step = "1";
  semi.value = "0";
  semi.addEventListener("input", (e) => {
    state.semitones = Number((e.target as HTMLInputElement).value);
    engine.setSemitones(state.semitones);
    semiLbl.textContent = `调式: ${state.semitones > 0 ? "+" : ""}${state.semitones}`;
  });

  const volLbl = document.createElement("span");
  volLbl.style.cssText = "color: var(--muted); font-size:.8rem";
  volLbl.textContent = "音量";
  const vol = document.createElement("input");
  vol.type = "range";
  vol.min = "0";
  vol.max = "1";
  vol.step = "0.01";
  vol.value = "0.8";
  vol.addEventListener("input", (e) =>
    engine.setVolume(Number((e.target as HTMLInputElement).value)),
  );
  engine.setVolume(0.8);

  micBtn = document.createElement("button");
  micBtn.textContent = "开麦克风";
  micBtn.addEventListener("click", () => {
    void rec.setMic(!state.micOn);
  });

  recBtn = document.createElement("button");
  recBtn.textContent = "开始录音";
  recBtn.title = "录下自己的演唱（按歌曲时间轴对齐）";
  recBtn.addEventListener("click", () => {
    void rec.startRecording();
  });

  recPlayBtn = document.createElement("button");
  recPlayBtn.textContent = "录音播放: 关";
  recPlayBtn.title = "播放时同时播放自己的录音";
  recPlayBtn.disabled = true;
  recPlayBtn.addEventListener("click", () => {
    void rec.toggleRecPlayback();
  });

  recOffsetLbl = document.createElement("span");
  recOffsetLbl.style.cssText =
    "color: var(--muted); font-size:.8rem; font-variant-numeric: tabular-nums";
  recOffsetLbl.textContent = "录音偏移: 0ms";
  recOffsetInput = document.createElement("input");
  recOffsetInput.type = "range";
  recOffsetInput.min = "-1000";
  recOffsetInput.max = "1000";
  recOffsetInput.step = "10";
  recOffsetInput.value = "0";
  recOffsetInput.title =
    "补偿麦克风采集延迟：正值 = 录音延后播放（Windows 麦克风通常 +100~+300ms）";
  recOffsetInput.disabled = true;
  recOffsetInput.addEventListener("input", (e) => {
    const ms = Number((e.target as HTMLInputElement).value);
    recOffsetLbl.textContent = `录音偏移: ${ms > 0 ? "+" : ""}${ms}ms`;
    void rec.setRecOffset(ms);
  });

  recDlBtn = document.createElement("button");
  recDlBtn.textContent = "下载录音";
  recDlBtn.title = "把录音保存为音频文件";
  recDlBtn.disabled = true;
  recDlBtn.addEventListener("click", rec.downloadRecording);

  origBtn = document.createElement("button");
  origBtn.textContent = "原唱: 关";
  origBtn.title = "在伴奏与原唱间切换（本曲无原唱时隐藏）";
  origBtn.hidden = true;
  origBtn.addEventListener("click", () => {
    const next = !engine.useOriginal;
    void engine.setUseOriginal(next);
    origBtn.textContent = next ? "原唱: 开" : "原唱: 关";
  });

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "清除轨迹";
  clearBtn.title = "清除演唱轨迹与评分";
  clearBtn.addEventListener("click", clearTrail);

  controls.append(
    songSelect,
    playBtn,
    seekBar,
    timeLbl,
    speedLbl,
    speedSelect,
    semiLbl,
    semi,
    volLbl,
    vol,
    micBtn,
    recBtn,
    recPlayBtn,
    recOffsetLbl,
    recOffsetInput,
    recDlBtn,
    origBtn,
    clearBtn,
  );
}

function refreshUI(engine: AudioEngine): void {
  playBtn.textContent = engine.isPlaying ? "暂停" : "播放";
  const t = engine.getCurrentTime();
  if (!seeking) seekBar.value = String(t);
  timeLbl.textContent = `${t.toFixed(1)} / ${engine.duration.toFixed(1)}s`;
}

startBtn.addEventListener("click", () => {
  startBtn.disabled = true;
  boot().catch((err: Error) => {
    console.error(err);
    startBtn.disabled = false;
    alert("初始化失败：" + err.message);
  });
});
