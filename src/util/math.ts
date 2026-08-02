/** 把 v 限制在 [min, max]。 */
export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/** 取长度为奇数的数组中位数；空数组返回 0。 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}
