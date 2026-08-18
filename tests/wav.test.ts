import { describe, expect, it } from "vitest";
import { pcmToWav } from "../src/util/wav.ts";

function asView(blob: Blob): Promise<DataView> {
  return blob.arrayBuffer().then((buf) => new DataView(buf));
}

function strAt(dv: DataView, off: number, len: number): string {
  return String.fromCharCode(...new Uint8Array(dv.buffer, off, len));
}

describe("pcmToWav", () => {
  it("写入 RIFF/WAVE 头部与正确尺寸", async () => {
    const buf = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = pcmToWav(buf, 44100);
    expect(blob.type).toBe("audio/wav");

    const dv = await asView(blob);
    expect(dv.byteLength).toBe(44 + 5 * 2);
    expect(strAt(dv, 0, 4)).toBe("RIFF");
    expect(strAt(dv, 8, 4)).toBe("WAVE");
    expect(strAt(dv, 12, 4)).toBe("fmt ");
    expect(strAt(dv, 36, 4)).toBe("data");
    expect(dv.getUint32(4, true)).toBe(36 + 10); // RIFF 块大小
    expect(dv.getUint32(16, true)).toBe(16); // fmt 块大小
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(1); // 单声道
    expect(dv.getUint32(24, true)).toBe(44100);
    expect(dv.getUint32(28, true)).toBe(88200); // 字节率
    expect(dv.getUint16(32, true)).toBe(2); // 块对齐
    expect(dv.getUint16(34, true)).toBe(16); // 位深
    expect(dv.getUint32(40, true)).toBe(10); // data 大小
  });

  it("浮点采样转 16-bit PCM 并截断越界值", async () => {
    const buf = new Float32Array([1, -1, 2, -2, 0.5]);
    const dv = await asView(pcmToWav(buf, 44100));
    expect(dv.getInt16(44, true)).toBe(32767);
    expect(dv.getInt16(46, true)).toBe(-32768);
    expect(dv.getInt16(48, true)).toBe(32767); // 2 被截断到 1
    expect(dv.getInt16(50, true)).toBe(-32768); // -2 被截断到 -1
    expect(dv.getInt16(52, true)).toBe(Math.round(0.5 * 32767));
  });

  it("空输入生成仅含头部的 WAV", async () => {
    const dv = await asView(pcmToWav(new Float32Array(0), 8000));
    expect(dv.byteLength).toBe(44);
    expect(dv.getUint32(24, true)).toBe(8000);
    expect(dv.getUint32(40, true)).toBe(0);
  });
});
