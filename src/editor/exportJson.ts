import type { SongData } from "../types.ts";
import type { EditorStateData } from "./EditorState.ts";

/** 把编辑器状态组装成练习页可加载的 SongData，并触发下载。 */
export function exportSongJson(state: EditorStateData, durationSec: number): void {
  const notes = state.notes
    .filter((n) => n.pitch !== null)
    .map((n) => ({ start: n.start, dur: n.dur, pitch: n.pitch as number }))
    .sort((a, b) => a.start - b.start);

  const song: SongData = {
    schemaVersion: 1,
    meta: {
      title: state.title || "新歌",
      artist: "",
      originalKey: "C",
      originalBpm: state.bpm,
    },
    audio: { file: "audio.mp3", durationSec },
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
}
