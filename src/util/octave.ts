/**
 * 八度自动容错（Octave Invariance）工具。
 *
 * 核心思想：用「音类」（pitch class = MIDI mod 12）比较，忽略八度。
 * 这样男生低八度唱女高音、或升 key 降八度，都会被自动映射到
 * 标准音符所在的八度区间进行绘制与判定，视为音准正确。
 */

/** 音类（0=C, 1=C#, ..., 11=B）。 */
export const pitchClass = (midi: number): number =>
  (((Math.round(midi) % 12) + 12) % 12);

/**
 * 把用户演唱的 MIDI 平移到「与 target 同 pitch class、且落在 target 所在
 * 八度」的等价音高——具体为：找离 target 最近（半音距离最小）的等八度音。
 *
 * 例：target=60(C4)，mic=48(C3) → 返回 60(C4)，绘制时贴合标准方块。
 *      target=60(C4)，mic=72(C5) → 返回 60(C4)。
 *      target=62(D4)，mic=50(D3) → 返回 62(D4)。
 *
 * 用于「实时演唱方块」的纵向绘制位置。
 */
export function foldToOctaveOf(micMidi: number, targetMidi: number): number {
  // 找 mic + k*12 中离 target 最近的一个：保持 pitch class，平移八度。
  const k = Math.round((targetMidi - micMidi) / 12);
  return micMidi + k * 12;
}

/**
 * 把 m 平移八度到落在 [lo, hi] 范围内的等价音高（保持 pitch class）。
 * 用于无目标时把演唱音高折叠进显示范围。 */
export function foldToRange(m: number, lo: number, hi: number): number {
  let x = m;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x;
}

/**
 * 八度等价的 cents 误差：归一到 [-600, 600)。
 * 用于判定唱准/偏高/偏低（|cents|<=50 视为准）。
 *
 * 注意：先折叠到 target 八度再算 cents，等价于对 1200 取模。
 */
export function centsErrorOctaveInvariant(
  micMidi: number,
  targetMidi: number,
): number {
  const folded = foldToOctaveOf(micMidi, targetMidi);
  let cents = (folded - targetMidi) * 100;
  // 归一到 [-600, 600)：600 与 -600 等价，统一映射到 -600
  cents = ((cents % 1200) + 1200) % 1200;
  if (cents >= 600) cents -= 1200;
  return cents;
}

/** 判定阈值：|cents| <= 此值视为唱准（半个半音）。 */
export const IN_TUNE_CENTS = 50;

export type Verdict = "in-tune" | "sharp" | "flat";

export function verdictForCents(cents: number): Verdict {
  if (Math.abs(cents) <= IN_TUNE_CENTS) return "in-tune";
  return cents > 0 ? "sharp" : "flat";
}
