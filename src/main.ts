import "./style.css";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { Synth } from "./audio/Synth.ts";
import { MicPitchDetector } from "./audio/PitchDetector.ts";
import { loadSongData } from "./data/SongLoader.ts";
import { parseAss } from "./data/AssParser.ts";
import { comparePitch, type Verdict } from "./data/transpose.ts";
import { Scoring } from "./data/Scoring.ts";
import { freqToMidi, midiToName } from "./util/music.ts";
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
}

// 全局可变状态。
const state = {
  semitones: 0,
  mic: null as MicPitch | null,
};

// UI 元素引用。
let playBtn: HTMLButtonElement;
let seekBar: HTMLInputElement;
let timeLbl: HTMLSpanElement;
let songSelect: HTMLSelectElement;
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

  /** 加载并切换一首歌。 */
  async function loadSong(slug: string): Promise<void> {
    engine.pause();
    await engine.seek(0);
    songInfo.textContent = "加载中…";
    const dir = `${SONGS_BASE}/${slug}`;
    const song = await loadSongData(dir);
    const audio = await signedAudioUrl(slug);
    await engine.loadAudio(audio);
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

  buildControls(engine, mic, loadSong, () => {
    pitchLine.clearTrail();
    scoring.reset();
  });

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

/** 向签名 API 请求某首歌的七牛 CDN 私有播放 URL。 */
async function signedAudioUrl(slug: string): Promise<string> {
  const res = await fetch(`${SIGN_API}/sign/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(`签名失败: ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

function buildControls(
  engine: AudioEngine,
  mic: MicPitchDetector,
  loadSong: (slug: string) => Promise<void>,
  clearTrail: () => void,
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

  const micBtn = document.createElement("button");
  micBtn.textContent = "开麦克风";
  let micOn = false;
  micBtn.addEventListener("click", async () => {
    if (micOn) {
      mic.stop();
      micOn = false;
      micBtn.textContent = "开麦克风";
      state.mic = null;
    } else {
      try {
        await mic.start();
        micOn = true;
        micBtn.textContent = "关麦克风";
      } catch (err) {
        alert("无法访问麦克风：" + (err as Error).message);
      }
    }
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
