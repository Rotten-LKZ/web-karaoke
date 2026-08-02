/**
 * 量化吸附纯函数。
 * quantize 值 = 一拍内的格数：1=1/4 音符（一拍1格），2=1/8（一拍2格），
 * 4=1/16（一拍4格），0=关闭。
 */

/** 由 bpm + quantize 得到量化格步长（秒）。quantize=0 → 返回 0（不吸附）。 */
export function gridSec(bpm: number, quantize: number): number {
  if (!quantize) return 0;
  const beatSec = 60 / bpm;
  return beatSec / quantize;
}

/** 把任意时间吸附到最近的量化格。grid=0 时不吸附原样返回。 */
export function quantize(timeSec: number, grid: number): number {
  if (grid <= 0) return timeSec;
  return Math.round(timeSec / grid) * grid;
}
