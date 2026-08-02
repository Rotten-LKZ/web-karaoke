import { describe, it, expect } from "vitest";
import { gridSec, quantize } from "../src/editor/Quantize.ts";

describe("gridSec", () => {
  it("bpm=120 一拍=0.5s，quantize=格数", () => {
    expect(gridSec(120, 4)).toBeCloseTo(0.125, 5); // 1/16（一拍4格）
    expect(gridSec(120, 2)).toBeCloseTo(0.25, 5); // 1/8（一拍2格）
    expect(gridSec(120, 1)).toBeCloseTo(0.5, 5); // 1/4（一拍1格）
  });
  it("quantize=0 → 不吸附（0）", () => {
    expect(gridSec(120, 0)).toBe(0);
  });
  it("bpm=60 一拍=1s", () => {
    expect(gridSec(60, 2)).toBeCloseTo(0.5, 5); // 1/8
  });
});

describe("quantize", () => {
  it("吸附到最近格（1/8 @120bpm，格 0.25s）", () => {
    expect(quantize(0.1, 0.25)).toBeCloseTo(0, 5);
    expect(quantize(0.2, 0.25)).toBeCloseTo(0.25, 5);
    expect(quantize(0.3, 0.25)).toBeCloseTo(0.25, 5);
    expect(quantize(0.5, 0.25)).toBeCloseTo(0.5, 5);
  });
  it("已在格上不变", () => {
    expect(quantize(0.5, 0.25)).toBeCloseTo(0.5, 5);
  });
  it("grid=0 → 原样返回", () => {
    expect(quantize(0.123, 0)).toBeCloseTo(0.123, 5);
  });
});
