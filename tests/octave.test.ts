import { describe, it, expect } from "vitest";
import {
  pitchClass,
  foldToOctaveOf,
  foldToRange,
  centsErrorOctaveInvariant,
  verdictForCents,
} from "../src/util/octave.ts";

describe("pitchClass", () => {
  it("C 在所有八度都是 0", () => {
    expect(pitchClass(0)).toBe(0);
    expect(pitchClass(12)).toBe(0);
    expect(pitchClass(60)).toBe(0); // C4
    expect(pitchClass(-12)).toBe(0);
  });
  it("B 是 11", () => {
    expect(pitchClass(59)).toBe(11); // B3
    expect(pitchClass(71)).toBe(11); // B4
  });
  it("D4 与 D5 同类 = 2", () => {
    expect(pitchClass(62)).toBe(2);
    expect(pitchClass(74)).toBe(2);
  });
});

describe("foldToRange（折叠进显示范围）", () => {
  it("低于范围 → 升八度进入", () => {
    expect(foldToRange(48, 58, 79)).toBe(60); // C3 → C4
  });
  it("高于范围 → 降八度进入", () => {
    expect(foldToRange(84, 58, 79)).toBe(72); // C6 → C5
  });
  it("已在范围内 → 不变", () => {
    expect(foldToRange(65, 58, 79)).toBe(65);
  });
  it("保持 pitch class", () => {
    expect(pitchClass(foldToRange(50, 58, 79))).toBe(pitchClass(50));
  });
});

describe("foldToOctaveOf（演唱 → 标准所在八度）", () => {
  it("低八度唱同一音 → 折叠到 target 八度", () => {
    expect(foldToOctaveOf(48, 60)).toBe(60); // C3 → C4
    expect(foldToOctaveOf(60, 72)).toBe(72); // C4 → C5
  });
  it("高八度唱同一音 → 折叠到 target 八度", () => {
    expect(foldToOctaveOf(72, 60)).toBe(60); // C5 → C4
    expect(foldToOctaveOf(84, 60)).toBe(60); // C6 → C4（跨两个八度）
  });
  it("音类相同但偏离多个八度仍折叠", () => {
    expect(foldToOctaveOf(36, 60)).toBe(60); // C2 → C4
    expect(foldToOctaveOf(96, 60)).toBe(60); // C7 → C4
  });
  it("不同音类折叠后保持自身音类", () => {
    // D3(50) 对 target C4(60)：D 类(2)最近的等八度是 D4(62)
    expect(foldToOctaveOf(50, 60)).toBe(62);
    // B3(59) 对 target C4(60)：B 类(11) → B3(59) 已在 target 同八度附近
    expect(foldToOctaveOf(59, 60)).toBe(59);
  });
  it("foldToOctaveOf 后结果与 target 差 <= 6 半音", () => {
    for (let mic = 30; mic <= 100; mic++) {
      for (const target of [48, 60, 72]) {
        const folded = foldToOctaveOf(mic, target);
        expect(Math.abs(folded - target)).toBeLessThanOrEqual(6);
        // pitch class 保持
        expect(pitchClass(folded)).toBe(pitchClass(mic));
      }
    }
  });
});

describe("centsErrorOctaveInvariant", () => {
  it("完全唱准 → 0 cents", () => {
    expect(centsErrorOctaveInvariant(60, 60)).toBe(0);
    expect(centsErrorOctaveInvariant(48, 60)).toBe(0); // 低八度
    expect(centsErrorOctaveInvariant(72, 60)).toBe(0); // 高八度
  });
  it("归一到 [-600, 600)", () => {
    // D4(62) 对 C4(60)：+200 cents
    expect(centsErrorOctaveInvariant(62, 60)).toBe(200);
    // 低八度的 D3(50) 对 C4(60)：仍 +200（八度等价）
    expect(centsErrorOctaveInvariant(50, 60)).toBe(200);
    // B3(59) 对 C4(60)：-100 cents
    expect(centsErrorOctaveInvariant(59, 60)).toBe(-100);
  });
  it("不在 ±600 边界外", () => {
    for (let mic = 30; mic <= 100; mic++) {
      for (const target of [48, 60, 72]) {
        const c = centsErrorOctaveInvariant(mic, target);
        expect(c).toBeGreaterThanOrEqual(-600);
        expect(c).toBeLessThan(600);
      }
    }
  });
});

describe("verdictForCents", () => {
  it("|cents|<=50 → in-tune", () => {
    expect(verdictForCents(0)).toBe("in-tune");
    expect(verdictForCents(50)).toBe("in-tune");
    expect(verdictForCents(-50)).toBe("in-tune");
  });
  it(">50 → sharp", () => {
    expect(verdictForCents(51)).toBe("sharp");
    expect(verdictForCents(200)).toBe("sharp");
  });
  it("<-50 → flat", () => {
    expect(verdictForCents(-51)).toBe("flat");
    expect(verdictForCents(-200)).toBe("flat");
  });
});
