import { describe, it, expect } from "vitest";
import { fftInPlace, hannWindow } from "../src/editor/Fft.ts";

describe("fftInPlace", () => {
  it("DC 信号：只有 bin0 非零", () => {
    const n = 8;
    const re = new Float32Array(n).fill(1);
    const im = new Float32Array(n);
    fftInPlace(re, im);
    expect(re[0]).toBeCloseTo(n, 5);
    expect(im[0]).toBeCloseTo(0, 5);
    for (let k = 1; k < n; k++) {
      expect(Math.abs(re[k])).toBeLessThan(1e-5);
      expect(Math.abs(im[k])).toBeLessThan(1e-5);
    }
  });

  it("已知正弦波：峰值在正确 bin", () => {
    // 采样率构造为 N，频率 = binK * 1Hz，则峰值应在 binK
    const n = 256;
    const binK = 10;
    const sr = n; // 每帧 1 秒，bin 间距 1Hz
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.cos((2 * Math.PI * binK * i) / sr);
    }
    fftInPlace(re, im);
    // 找幅度最大的 bin（取前半）
    let maxBin = 0;
    let maxMag = 0;
    for (let k = 0; k < n / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag > maxMag) {
        maxMag = mag;
        maxBin = k;
      }
    }
    expect(maxBin).toBe(binK);
  });

  it("实数 + 虚部 0：对称性（re 对称、im 反对称）", () => {
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i);
    fftInPlace(re, im);
    // 实信号频谱：re[k] == re[N-k], im[k] == -im[N-k]
    for (let k = 1; k < n / 2; k++) {
      expect(re[k]).toBeCloseTo(re[n - k], 4);
      expect(im[k]).toBeCloseTo(-im[n - k], 4);
    }
  });

  it("可逆性：FFT → IFFT 还原（含 1/N）", () => {
    const n = 32;
    const reOrig = new Float32Array(n);
    for (let i = 0; i < n; i++) reOrig[i] = Math.cos((2 * Math.PI * 3 * i) / n) + 0.5;
    const re = reOrig.slice();
    const im = new Float32Array(n);
    fftInPlace(re, im, false);
    fftInPlace(re, im, true); // 逆变换
    for (let i = 0; i < n; i++) {
      expect(re[i] / n).toBeCloseTo(reOrig[i], 4);
    }
  });
});

describe("hannWindow", () => {
  it("端点为 0，中点附近接近 1", () => {
    const w = hannWindow(16);
    expect(w[0]).toBeCloseTo(0, 5);
    // 最大值在中点附近，接近 1（n 偶数时中点偏半步）
    const max = Math.max(...w);
    expect(max).toBeGreaterThan(0.98);
    expect(max).toBeLessThanOrEqual(1);
  });
  it("对称", () => {
    const w = hannWindow(16);
    for (let i = 0; i < 8; i++) {
      expect(w[i]).toBeCloseTo(w[15 - i], 5);
    }
  });
});
