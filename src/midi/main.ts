import "./midi.css";
import { Midi } from "@tonejs/midi";
import type { SongData } from "../types.ts";
import { convertTrack, offsetTotal, type TrackInfo } from "./convert.ts";

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileInfo = document.getElementById("file-info")!;
const tracksWrap = document.getElementById("tracks-wrap")!;
const trackSelect = document.getElementById("track-select") as HTMLSelectElement;
const trackInfo = document.getElementById("track-info")!;
const offsetWrap = document.getElementById("offset-wrap")!;
const offsetSec = document.getElementById("offset-sec") as HTMLInputElement;
const offsetMs = document.getElementById("offset-ms") as HTMLInputElement;
const offsetTotalEl = document.getElementById("offset-total")!;
const ignoreOrig = document.getElementById("ignore-orig-offset") as HTMLInputElement;
const previewWrap = document.getElementById("preview-wrap")!;
const preview = document.getElementById("preview")!;
const noteCount = document.getElementById("note-count")!;
const titleInput = document.getElementById("title-input") as HTMLInputElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;

let tracks: TrackInfo[] = [];
let midiDuration = 0;

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileInfo.textContent = "解析中…";
  try {
    const buf = await file.arrayBuffer();
    const midi = new Midi(buf);
    midiDuration = midi.duration;
    tracks = midi.tracks.map((t, i) => ({
      index: i,
      name: t.name || `轨道 ${i}`,
      instrument: t.instrument?.name || "未知",
      noteCount: t.notes.length,
      notes: t.notes.map((n) => ({ time: n.time, duration: n.duration, midi: n.midi })),
    }));
    // 轨道下拉：只列有音符的，按音符数排序（主旋律通常音符最多之一）
    const withNotes = tracks.filter((t) => t.noteCount > 0);
    trackSelect.innerHTML = "";
    if (withNotes.length === 0) {
      fileInfo.textContent = "MIDI 里没有音符";
      tracksWrap.hidden = true;
      offsetWrap.hidden = true;
      previewWrap.hidden = true;
      exportBtn.disabled = true;
      return;
    }
    for (const t of withNotes) {
      const opt = document.createElement("option");
      opt.value = String(t.index);
      opt.textContent = `${t.index}: ${t.name} (${t.instrument}, ${t.noteCount}音)`;
      trackSelect.appendChild(opt);
    }
    // 默认选音符最多的轨道
    const best = [...withNotes].sort((a, b) => b.noteCount - a.noteCount)[0];
    trackSelect.value = String(best.index);

    fileInfo.textContent = `${file.name}（${withNotes.length} 条有音符轨道，时长 ${midiDuration.toFixed(1)}s）`;
    tracksWrap.hidden = false;
    offsetWrap.hidden = false;
    refresh();
  } catch (err) {
    fileInfo.textContent = "解析失败：" + (err as Error).message;
  }
});

function refresh(): void {
  updateOffsetLabel();
  const idx = Number(trackSelect.value);
  const track = tracks.find((t) => t.index === idx);
  if (!track) {
    exportBtn.disabled = true;
    return;
  }
  const off = offsetTotal(Number(offsetSec.value), Number(offsetMs.value));
  const notes = convertTrack(track.notes, off, ignoreOrig.checked);
  trackInfo.textContent = `${track.noteCount} 个音符 → 加偏移后 ${notes.length} 个`;
  preview.textContent = JSON.stringify(notes.slice(0, 20), null, 2);
  noteCount.textContent = String(notes.length);
  previewWrap.hidden = false;
  exportBtn.disabled = notes.length === 0;
}

function updateOffsetLabel(): void {
  const off = offsetTotal(Number(offsetSec.value), Number(offsetMs.value));
  offsetTotalEl.textContent = off.toFixed(3);
}

trackSelect.addEventListener("change", refresh);
offsetSec.addEventListener("input", refresh);
offsetMs.addEventListener("input", refresh);
ignoreOrig.addEventListener("change", refresh);

exportBtn.addEventListener("click", () => {
  const idx = Number(trackSelect.value);
  const track = tracks.find((t) => t.index === idx);
  if (!track) return;
  const off = offsetTotal(Number(offsetSec.value), Number(offsetMs.value));
  const notes = convertTrack(track.notes, off, ignoreOrig.checked);

  const song: SongData = {
    schemaVersion: 1,
    meta: {
      title: titleInput.value || "新歌",
      artist: "",
      originalKey: "C",
      originalBpm: 120,
    },
    audio: { file: "audio.mp3", durationSec: midiDuration },
    lyrics: { type: "ass", file: "lyrics.ass" },
    melody: { unit: "midi", notes },
  };

  const blob = new Blob([JSON.stringify(song, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "song.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
