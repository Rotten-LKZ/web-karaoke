import { fftInPlace, hannWindow } from "./Fft.ts";
import { midiToFreq } from "../util/music.ts";

const FRAME = 2048; // ~46ms@44100
const HOP = 512; // ~11.6ms
const MIDI_LO = 36; // C2 ~65Hz
const MIDI_HI = 84; // C6 ~1047Hz

/** 离线频谱：分帧 FFT → 每帧取 MIDI 范围内的频谱能量 → 渲染到离屏 canvas。
 *  分块异步（每 BATCH 帧 await setTimeout 0）避免阻塞主线程，onProgress 报进度。
 *  返回离屏 canvas（宽=帧数，高=MIDI 跨度），由调用方 drawImage 贴图。 */
export async function computeSpectrogram(
  buffer: AudioBuffer,
  onProgress?: (ratio: number) => void,
): Promise<HTMLCanvasElement> {
  const sr = buffer.sampleRate;
  // 单声道混合
  const mono = mixToMono(buffer);
  const total = mono.length;
  const frameCount = Math.max(1, Math.floor((total - FRAME) / HOP) + 1);

  // 每个目标 MIDI（MIDI_LO..MIDI_HI）对应的 bin 索引范围用峰值近似：
  // 渲染时按 MIDI 行遍历，取该 MIDI 频率附近 ±半音 bin 的最大能量。
  const midiSpan = MIDI_HI - MIDI_LO + 1;

  // 离屏 canvas：宽=帧数，高=midiSpan
  const off = document.createElement("canvas");
  off.width = frameCount;
  off.height = midiSpan;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(frameCount, midiSpan);

  const win = hannWindow(FRAME);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  // 预计算每个 MIDI 行要查询的 bin 列表（频率 → bin）
  const binLists: number[][] = [];
  for (let m = 0; m < midiSpan; m++) {
    const midi = MIDI_LO + m;
    const fLo = midiToFreq(midi - 0.5);
    const fHi = midiToFreq(midi + 0.5);
    const binLo = Math.max(1, Math.floor(fLo * FRAME / sr));
    const binHi = Math.min(FRAME / 2 - 1, Math.ceil(fHi * FRAME / sr));
    const bins: number[] = [];
    for (let b = binLo; b <= binHi; b++) bins.push(b);
    binLists.push(bins.length ? bins : [Math.floor(midiToFreq(midi) * FRAME / sr)]);
  }

  const BATCH = 256;
  for (let fi = 0; fi < frameCount; fi++) {
    const offset = fi * HOP;
    // 填窗
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[offset + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    // 每个 MIDI 行取该频段最大幅度 → dB
    for (let m = 0; m < midiSpan; m++) {
      const bins = binLists[m];
      let maxMag = 0;
      for (const b of bins) {
        const mag = Math.hypot(re[b], im[b]);
        if (mag > maxMag) maxMag = mag;
      }
      const db = 20 * Math.log10(maxMag + 1e-9);
      // 归一到 0..1（经验范围 -80..-20 dB）
      const norm = clamp01((db + 80) / 60);
      const [r, g, bb] = turbo(norm);
      const px = (m * frameCount + fi) * 4;
      img.data[px] = r;
      img.data[px + 1] = g;
      img.data[px + 2] = bb;
      img.data[px + 3] = Math.floor(norm * 255);
    }

    if (fi % BATCH === 0) {
      onProgress?.(fi / frameCount);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  octx.putImageData(img, 0, 0);
  onProgress?.(1);
  return off;
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  if (ch === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / ch;
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** turbo 风格 colormap 简化：低→深蓝，中→青绿/黄，高→红。 */
function turbo(t: number): [number, number, number] {
  // 简化分段映射，足够辨识
  const r = clamp01(Math.min(1, Math.max(0, t * 2 - 0.5)));
  const g = clamp01(Math.sin(t * Math.PI));
  const b = clamp01(Math.min(1, Math.max(0, 0.5 - t * 1.5) + (t > 0.8 ? (t - 0.8) * 2 : 0)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
