import { midiToFreq } from "../util/music.ts";

/**
 * 极简钢琴音色合成：triangle 波（含一定谐波，比 sine 更接近钢琴/木琴）
 * + ADSR 包络。每个音创建独立的 osc+gain，结束自动清理。
 */
export class Synth {
  constructor(private ctx: AudioContext) {}

  playNote(midi: number, durationSec = 0.8): void {
    const t0 = this.ctx.currentTime;
    const freq = midiToFreq(midi);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const gain = this.ctx.createGain();
    const peak = 0.25;
    const attack = 0.005;
    const decay = 0.15;
    const sustain = peak * 0.5;
    const release = 0.2;

    // ADSR
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.linearRampToValueAtTime(sustain, t0 + attack + decay);
    const end = t0 + durationSec;
    gain.gain.setValueAtTime(sustain, end);
    gain.gain.linearRampToValueAtTime(0, end + release);

    osc.connect(gain);
    // 输出到引擎的主 gain 之外、独立的 destination，避免与伴奏音量耦合。
    // 这里复用 ctx.destination，简化。
    gain.connect(this.ctx.destination);

    osc.start(t0);
    osc.stop(end + release + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}
