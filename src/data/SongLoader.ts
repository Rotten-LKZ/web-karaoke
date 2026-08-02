import type { SongData } from "../types.ts";

/**
 * 加载一首歌的 song.json（旋律 + 元信息）。
 * baseDir 形如 "/songs/twinkle"。audio/lyrics 文件由调用方按需另行加载。
 */
export async function loadSongData(baseDir: string): Promise<SongData> {
  const res = await fetch(`${baseDir}/song.json`);
  if (!res.ok) throw new Error(`song.json 加载失败: ${res.status}`);
  return (await res.json()) as SongData;
}

/** 给定 baseDir 与 song.audio.file，返回音频 URL。 */
export const audioUrl = (song: SongData, baseDir: string): string =>
  `${baseDir}/${song.audio.file}`;
