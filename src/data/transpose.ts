import { applySemitones, freqToMidi } from "../util/music.ts";

export type Verdict = "sharp" | "flat" | "in-tune" | "none";

export interface PitchComparison {
  /** 是否有有效判定（麦克风清晰且存在目标音）。 */
  isActive: boolean;
  /** 移调后的目标 MIDI（null 表示此刻无目标）。 */
  targetMidi: number | null;
  /** 麦克风测得的 MIDI（null 表示无有效信号）。 */
  actualMidi: number | null;
  /** 偏离 cents（100 = 一个半音）；null 表示无判定。 */
  centsOff: number | null;
  verdict: Verdict;
}

/** 麦克风音高清晰度阈值，低于此值视为「没在唱/噪音」。 */
export const CLARITY_THRESHOLD = 0.9;

/**
 * 把麦克风测得的频率与（移调后的）目标 MIDI 对比。
 *
 * @param targetMidiRaw 旋律原始 MIDI（未移调）；null 表示休止/无目标。
 * @param micFreq        麦克风测得的频率（Hz）；<=0 表示无效。
 * @param micClarity     麦克风清晰度 0..1。
 * @param semitones      当前调式偏移。
 * @param toleranceCents 命中容差（cents），默认 ±50（半个半音）。
 * @param octaveEquivalence 八度等价（默认 true）：男声低八度/升 key 降八度
 *                          唱同一音级也算准。centsOff 归一到离目标最近的
 *                          八度（[-600, +600)）。
 */
export function comparePitch(
  targetMidiRaw: number | null,
  micFreq: number,
  micClarity: number,
  semitones: number,
  toleranceCents = 50,
  octaveEquivalence = true,
): PitchComparison {
  const targetMidi =
    targetMidiRaw !== null ? applySemitones(targetMidiRaw, semitones) : null;

  if (
    micClarity < CLARITY_THRESHOLD ||
    targetMidi === null ||
    micFreq <= 0
  ) {
    return {
      isActive: false,
      targetMidi,
      actualMidi: null,
      centsOff: null,
      verdict: "none",
    };
  }

  const actualMidi = freqToMidi(micFreq);
  let centsOff = (actualMidi - targetMidi) * 100;

  if (octaveEquivalence) {
    // 折叠到离目标最近的八度：把 centsOff 对 1200 取模并归一到 [-600, 600)。
    centsOff = ((centsOff % 1200) + 1800) % 1200 - 600;
  }

  const verdict: Verdict =
    Math.abs(centsOff) <= toleranceCents
      ? "in-tune"
      : centsOff > 0
        ? "sharp"
        : "flat";

  return { isActive: true, targetMidi, actualMidi, centsOff, verdict };
}
