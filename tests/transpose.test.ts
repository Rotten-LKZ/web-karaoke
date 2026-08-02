import { describe, it, expect } from "vitest";
import { comparePitch, CLARITY_THRESHOLD } from "../src/data/transpose.ts";
import { freqToMidi, midiToFreq, applySemitones } from "../src/util/music.ts";

describe("freqToMidi / midiToFreq", () => {
  it("A4 (440Hz) → midi 69", () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 5);
  });

  it("midiToFreq 是 freqToMidi 的反函数", () => {
    for (const midi of [48, 60, 69, 72, 81]) {
      expect(freqToMidi(midiToFreq(midi))).toBeCloseTo(midi, 5);
    }
  });
});

describe("applySemitones", () => {
  it("半音偏移直接相加", () => {
    expect(applySemitones(60, 3)).toBe(63);
    expect(applySemitones(60, -2)).toBe(58);
  });
});

describe("comparePitch", () => {
  it("麦克风清晰度不足 → none", () => {
    const r = comparePitch(60, 261.6, CLARITY_THRESHOLD - 0.01, 0);
    expect(r.isActive).toBe(false);
    expect(r.verdict).toBe("none");
  });

  it("目标为休止(null) → none", () => {
    const r = comparePitch(null, 261.6, 0.99, 0);
    expect(r.isActive).toBe(false);
    expect(r.verdict).toBe("none");
  });

  it("麦克风频率<=0 → none", () => {
    const r = comparePitch(60, 0, 0.99, 0);
    expect(r.isActive).toBe(false);
  });

  it("完全唱准目标 → in-tune, cents≈0", () => {
    const target = 60; // C4 = 261.63Hz
    const freq = midiToFreq(target);
    const r = comparePitch(target, freq, 0.99, 0);
    expect(r.isActive).toBe(true);
    expect(r.verdict).toBe("in-tune");
    expect(r.centsOff).toBeCloseTo(0, 1);
    expect(r.targetMidi).toBe(60);
  });

  it("偏高 60 cents → sharp", () => {
    // 目标 C4，唱到 C4 + 0.6 半音
    const freq = midiToFreq(60 + 0.6);
    const r = comparePitch(60, freq, 0.99, 0);
    expect(r.verdict).toBe("sharp");
    expect(r.centsOff).toBeCloseTo(60, 0);
  });

  it("偏低 60 cents → flat", () => {
    const freq = midiToFreq(60 - 0.6);
    const r = comparePitch(60, freq, 0.99, 0);
    expect(r.verdict).toBe("flat");
    expect(r.centsOff).toBeCloseTo(-60, 0);
  });

  it("移调 +3：目标升到 63，唱准新目标才算 in-tune", () => {
    const r = comparePitch(60, midiToFreq(63), 0.99, 3);
    expect(r.isActive).toBe(true);
    expect(r.targetMidi).toBe(63);
    expect(r.verdict).toBe("in-tune");
  });

  it("移调 +3：仍唱原调(60) → flat（差 3 半音=300 cents）", () => {
    const r = comparePitch(60, midiToFreq(60), 0.99, 3);
    expect(r.targetMidi).toBe(63);
    expect(r.verdict).toBe("flat");
    expect(r.centsOff).toBeCloseTo(-300, 0);
  });

  it("容差边界：恰好 +50 cents 仍 in-tune（<=）", () => {
    const freq = midiToFreq(60 + 0.5);
    const r = comparePitch(60, freq, 0.99, 0, 50);
    expect(r.verdict).toBe("in-tune");
  });

  it("容差边界：+51 cents → sharp", () => {
    const freq = midiToFreq(60 + 0.51);
    const r = comparePitch(60, freq, 0.99, 0, 50);
    expect(r.verdict).toBe("sharp");
  });

  describe("八度等价（男声低八度/升 key 降八度）", () => {
    it("低八度唱同一音级 → in-tune", () => {
      // 目标 C4(60)，唱 C3(48)，差 -1200 cents，八度等价后归一为 0
      const r = comparePitch(60, midiToFreq(48), 0.99, 0);
      expect(r.verdict).toBe("in-tune");
      expect(r.centsOff).toBeCloseTo(0, 0);
    });

    it("高八度唱同一音级 → in-tune", () => {
      const r = comparePitch(60, midiToFreq(72), 0.99, 0);
      expect(r.verdict).toBe("in-tune");
    });

    it("低八度但音级也错（唱 C3 对 D4）→ 仍判错", () => {
      // 目标 D4(62)，唱 C3(48)：音级差 C-D = 2 半音，八度等价后差 -200 cents
      const r = comparePitch(62, midiToFreq(48), 0.99, 0);
      expect(r.verdict).toBe("flat");
      expect(r.centsOff).toBeCloseTo(-200, 0);
    });

    it("关闭八度等价时，低八度 → flat", () => {
      const r = comparePitch(60, midiToFreq(48), 0.99, 0, 50, false);
      expect(r.verdict).toBe("flat");
      expect(r.centsOff).toBeCloseTo(-1200, 0);
    });

    it("跨八度的微偏也归一：唱 C3+30¢ 对 C4 → in-tune", () => {
      const r = comparePitch(60, midiToFreq(48 + 0.3), 0.99, 0);
      expect(r.verdict).toBe("in-tune");
      expect(r.centsOff).toBeCloseTo(30, 0);
    });
  });
});
