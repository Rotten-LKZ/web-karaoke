/** 歌曲 JSON 数据结构（song.json）。 */
export interface SongData {
  schemaVersion: number;
  meta: {
    title: string;
    artist: string;
    originalKey: string;
    originalBpm: number;
  };
  audio: { file: string; durationSec: number };
  lyrics: { type: "ass"; file: string };
  melody: {
    unit: "midi";
    notes: MelodyNote[];
  };
}

export interface MelodyNote {
  /** 开始时间，秒（与音频时间轴对齐）。 */
  start: number;
  /** 持续时间，秒。 */
  dur: number;
  /** MIDI note number；null 表示休止。 */
  pitch: number | null;
  /** 可选音节文本（用于瀑布条上标字）。 */
  lyric?: string;
}
