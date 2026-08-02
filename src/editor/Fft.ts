/**
 * 基础 radix-2 迭代 Cooley-Tukey FFT（就地，分离 re/im 数组）。
 * 输入长度必须是 2 的幂。实数信号把 im 填 0 即可。
 *
 * 对小规模（帧长 2048~4096）足够快；一首歌几万帧时分块异步计算避免卡 UI。
 */

/** 预计算位反转表（按长度缓存）。 */
const bitReversalCache = new Map<number, Uint32Array>();
function bitReversalTable(n: number): Uint32Array {
  const cached = bitReversalCache.get(n);
  if (cached) return cached;
  const table = new Uint32Array(n);
  let rev = 0;
  for (let i = 0; i < n; i++) {
    table[i] = rev;
    // 计算 i 的下一个位反转
    let bit = n >> 1;
    while (rev & bit) {
      rev ^= bit;
      bit >>= 1;
    }
    rev |= bit;
  }
  bitReversalCache.set(n, table);
  return table;
}

/**
 * 就地 FFT（正变换）。re/im 长度必须为 2 的幂且相等。
 * inverse=false 正变换（不带 1/N 归一化，因为频谱只看相对幅度）。
 */
export function fftInPlace(
  re: Float32Array,
  im: Float32Array,
  inverse = false,
): void {
  const n = re.length;
  if (n <= 1) return;
  // 位反转重排
  const rev = bitReversalTable(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  // 蝶形运算
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half];
        const bIm = im[i + k + half];
        // t = cur * b
        const tRe = curRe * bRe - curIm * bIm;
        const tIm = curRe * bIm + curIm * bRe;
        re[i + k] = aRe + tRe;
        im[i + k] = aIm + tIm;
        re[i + k + half] = aRe - tRe;
        im[i + k + half] = aIm - tIm;
        // cur *= w
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Hann 窗（长度 n）。 */
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}
