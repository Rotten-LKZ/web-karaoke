import { describe, it, expect } from "vitest";
import { convertTrack, offsetTotal } from "../src/midi/convert.ts";

describe("offsetTotal", () => {
  it("秒 + 毫秒 → 秒", () => {
    expect(offsetTotal(1, 500)).toBeCloseTo(1.5, 5);
    expect(offsetTotal(0, 250)).toBeCloseTo(0.25, 5);
  });
  it("负值归零", () => {
    expect(offsetTotal(-1, -100)).toBe(0);
  });
});

describe("convertTrack", () => {
  const raw = [
    { time: 2.0, duration: 0.5, midi: 60 },
    { time: 2.5, duration: 0.5, midi: 62 },
    { time: 3.0, duration: 1.0, midi: 64 },
  ];

  it("无偏移、保留原始 offset → 时间不变", () => {
    const notes = convertTrack(raw, 0, false);
    expect(notes[0].start).toBeCloseTo(2.0, 5);
    expect(notes[2].start).toBeCloseTo(3.0, 5);
  });

  it("忽略原始 offset → 第一个音从 0 开始", () => {
    const notes = convertTrack(raw, 0, true);
    expect(notes[0].start).toBeCloseTo(0, 5);
    expect(notes[1].start).toBeCloseTo(0.5, 5);
    expect(notes[2].start).toBeCloseTo(1.0, 5);
  });

  it("忽略原始 offset + 加偏移 → 从偏移值开始", () => {
    const notes = convertTrack(raw, 1.5, true);
    expect(notes[0].start).toBeCloseTo(1.5, 5);
    expect(notes[2].start).toBeCloseTo(2.5, 5);
  });

  it("保留原始 offset + 加偏移 → 时间 + 偏移", () => {
    const notes = convertTrack(raw, 0.25, false);
    expect(notes[0].start).toBeCloseTo(2.25, 5);
  });

  it("保留 pitch 和 dur", () => {
    const notes = convertTrack(raw, 0, false);
    expect(notes[0].pitch).toBe(60);
    expect(notes[0].dur).toBeCloseTo(0.5, 5);
  });

  it("按 start 排序", () => {
    const shuffled = [raw[2], raw[0], raw[1]];
    const notes = convertTrack(shuffled, 0, false);
    expect(notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
  });

  it("空数组 → 空", () => {
    expect(convertTrack([], 1, true)).toEqual([]);
  });
});
