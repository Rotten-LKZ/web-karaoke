import { describe, it, expect } from "vitest";
import { parseAss, parseAssTime } from "../src/data/AssParser.ts";

describe("parseAssTime", () => {
  it("H:MM:SS.CS（厘秒/100）", () => {
    expect(parseAssTime("0:00:05.20")).toBeCloseTo(5.2, 5);
    expect(parseAssTime("0:01:23.45")).toBeCloseTo(83.45, 5);
    expect(parseAssTime("1:02:03.00")).toBeCloseTo(3723, 5);
  });

  it("不是 /1000", () => {
    // .20 是 20 厘秒 = 0.2s，不是 0.02s 也不是 0.2s 之外的值
    expect(parseAssTime("0:00:00.50")).toBeCloseTo(0.5, 5);
  });

  it("非法格式返回 NaN", () => {
    expect(Number.isNaN(parseAssTime("garbage"))).toBe(true);
  });
});

describe("parseAss", () => {
  const SAMPLE = `[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,40

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\k50}Hel{\\k50}lo`;

  it("解析 K 标签累加厘秒得音节开始时间", () => {
    const lines = parseAss(SAMPLE);
    expect(lines).toHaveLength(1);
    const syl = lines[0].syllables;
    expect(syl).toHaveLength(2);
    expect(syl[0].text).toBe("Hel");
    expect(syl[0].start).toBeCloseTo(1.0, 5);
    expect(syl[0].dur).toBeCloseTo(0.5, 5); // 50cs = 0.5s
    expect(syl[1].text).toBe("lo");
    expect(syl[1].start).toBeCloseTo(1.5, 5); // 累加
    expect(syl[1].dur).toBeCloseTo(0.5, 5);
  });

  it("回填行 end 为末音节结束", () => {
    const lines = parseAss(SAMPLE);
    expect(lines[0].end).toBeCloseTo(2.0, 5); // 1.0 + 0.5 + 0.5
  });

  it("识别 kf / ko 类型", () => {
    const text = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\kf30}a{\\ko30}b{\\K40}c`;
    const syl = parseAss(text)[0].syllables;
    expect(syl[0].effect).toBe("kf");
    expect(syl[1].effect).toBe("ko");
    expect(syl[2].effect).toBe("kf"); // \K 等同 \kf
  });

  it("无 K 标签的行当普通字幕（plain）", () => {
    const text = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,纯文本一行`;
    const syl = parseAss(text)[0].syllables;
    expect(syl).toHaveLength(1);
    expect(syl[0].effect).toBe("plain");
    expect(syl[0].text).toBe("纯文本一行");
  });

  it("剥离非 K 的 override 标签", () => {
    const text = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\k50\\b1}bold{\\k50}\\Nnext`;
    const syl = parseAss(text)[0].syllables;
    expect(syl[0].text).toBe("bold");
    expect(syl[1].text).toBe("\\Nnext"); // \\N 是换行符保留（渲染时处理）
  });

  it("Text 内含逗号不被误切", () => {
    const text = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\k50}Hello, world`;
    const syl = parseAss(text)[0].syllables;
    expect(syl[0].text).toBe("Hello, world");
  });

  it("忽略非 Events 段的 Dialogue 样文本", () => {
    const text = `[Script Info]
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,should be ignored
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\k50}real`;
    const lines = parseAss(text);
    expect(lines).toHaveLength(1);
    expect(lines[0].syllables[0].text).toBe("real");
  });
});
