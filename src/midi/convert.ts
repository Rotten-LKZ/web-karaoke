import type { MelodyNote } from "../types.ts";

/** 原始 MIDI 音符（@tonejs/midi 解析后的形状）。 */
export interface RawNote {
  time: number;
  duration: number;
  midi: number;
}

/** 一个 MIDI 轨道的解析结果（原始音符，未转 MelodyNote）。 */
export interface TrackInfo {
  index: number;
  name: string;
  instrument: string;
  noteCount: number;
  notes: RawNote[];
}

/** 总偏移秒（秒 + 毫秒）。 */
export function offsetTotal(sec: number, ms: number): number {
  return Math.max(0, sec) + Math.max(0, ms) / 1000;
}

/**
 * 把一条轨道的原始音符（{time,duration,midi}，time/duration 单位秒）
 * 转成 MelodyNote，并应用统一偏移。
 *
 * @param raw    原始音符数组（time/duration 秒，midi 整数）。
 * @param offset 统一加上的偏移秒（>=0）。
 * @param ignoreOrigOffset 若 true，先把所有音符时间减去最小起始时间
 *                         （去掉 MIDI 自带的前置空白），再加 offset。
 */
export function convertTrack(
  raw: RawNote[],
  offset: number,
  ignoreOrigOffset: boolean,
): MelodyNote[] {
  if (raw.length === 0) return [];
  const baseT = ignoreOrigOffset ? Math.min(...raw.map((n) => n.time)) : 0;
  return raw
    .map((n) => ({
      start: n.time - baseT + offset,
      dur: n.duration,
      pitch: n.midi,
    }))
    .sort((a, b) => a.start - b.start);
}
