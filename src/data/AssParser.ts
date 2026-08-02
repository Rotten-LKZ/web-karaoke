/** ASS K 轴单个音节。 */
export interface AssSyllable {
  /** 音节开始时间（秒）。 */
  start: number;
  /** 持续时间（秒）。 */
  dur: number;
  /** 音节文本（已剥离所有 override 标签）。 */
  text: string;
  /** K 标签类型：k=瞬间高亮，kf=平滑填充，ko=轮廓延迟。无 K 标签的行用 "plain"。 */
  effect: "k" | "kf" | "ko" | "plain";
}

/** 解析后的一行 Dialogue。 */
export interface AssLine {
  syllables: AssSyllable[];
  start: number;
  end: number;
}

const TIME_RE = /^(\d+):(\d{1,2}):(\d{1,2})\.(\d+)$/;
// 单个 override 块（{...} 内可含多个标签，如 {\k50\b1}）。
const BLOCK_RE = /\{([^}]*)\}/g;
// 在一个 override 块内部找 K 标签：\k \kf \ko \K，后跟厘秒整数。
// \K（大写）等同 \kf；\kk 等同 \k。大小写不敏感。带 g 用于 exec 迭代。
const K_INNER_RE = /\\(K+O?F?)(\d+)/gi;
// 检测用（无 g，避免污染 lastIndex）。
const K_INNER_TEST = /\\K+O?F?\d+/i;

/** 解析 ASS 时间 "H:MM:SS.CS" → 秒。最后一段是厘秒（/100，非 /1000）。 */
export function parseAssTime(s: string): number {
  const m = s.trim().match(TIME_RE);
  if (!m) return NaN;
  const [, h, mm, ss, cs] = m;
  return (
    Number(h) * 3600 +
    Number(mm) * 60 +
    Number(ss) +
    Number(cs) / 100
  );
}

/** 解析整段 ASS 文本，提取 K 轴音节。 */
export function parseAss(text: string): AssLine[] {
  const lines = text.split(/\r?\n/);

  // 先找 Format 行确定 Text 字段索引（默认 9，标准 ASS）。
  let textIndex = 9;
  let inEvents = false;

  const out: AssLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Events\]/i.test(trimmed)) {
      inEvents = true;
      continue;
    }
    if (/^\[/.test(trimmed)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;

    if (/^Format:/i.test(trimmed)) {
      const fields = trimmed
        .slice("Format:".length)
        .split(",")
        .map((f) => f.trim().toLowerCase());
      const idx = fields.indexOf("text");
      if (idx >= 0) textIndex = idx;
      continue;
    }

    if (/^Dialogue:/i.test(trimmed)) {
      const rest = trimmed.slice("Dialogue:".length);
      // 按逗号切到 textIndex+1 段：前 textIndex 个字段严格切，剩余全归 Text
      // （Text 内可能含逗号）。
      const parts: string[] = [];
      let cur = "";
      let field = 0;
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "," && field < textIndex) {
          parts.push(cur);
          cur = "";
          field++;
        } else {
          cur += ch;
        }
      }
      parts.push(cur);
      const startStr = parts[1] ?? "";
      const textPart = parts[textIndex] ?? "";

      const start = parseAssTime(startStr);
      if (Number.isNaN(start)) continue;

      out.push({
        start,
        end: start, // 末尾音节结束会补上
        syllables: parseSyllables(textPart, start),
      });
    }
  }

  // 用音节时长回填每行 end。
  for (const ln of out) {
    const last = ln.syllables[ln.syllables.length - 1];
    if (last) ln.end = last.start + last.dur;
  }
  return out;
}

/** 解析单行 Text 的 K 标签 → 音节数组。 */
function parseSyllables(text: string, lineStart: number): AssSyllable[] {
  // 把文本切成 {块} 与纯文本段的 token 流。
  const tokens: { block: string | null; text: string }[] = [];
  let last = 0;
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ block: null, text: text.slice(last, m.index) });
    }
    tokens.push({ block: m[1], text: "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    tokens.push({ block: null, text: text.slice(last) });
  }

  // 是否存在任何 K 标签；没有则整行当 plain。
  const hasK = tokens.some(
    (t) => t.block !== null && K_INNER_TEST.test(t.block!),
  );
  if (!hasK) {
    return [
      {
        start: lineStart,
        dur: 0,
        text: text.replace(/\{[^}]*\}/g, ""),
        effect: "plain",
      },
    ];
  }

  const syllables: AssSyllable[] = [];
  let cursor = lineStart; // 秒累加游标
  let pendingText = ""; // 积攒的纯文本，结算给上一个 K 音节

  for (const tok of tokens) {
    if (tok.block === null) {
      pendingText += tok.text;
      continue;
    }
    // override 块：找其中的 K 标签（块内可能含其它非 K 标签，忽略）。
    K_INNER_RE.lastIndex = 0;
    let km: RegExpExecArray | null;
    while ((km = K_INNER_RE.exec(tok.block)) !== null) {
      const kind = normalizeKind(km[1]);
      const cs = Number(km[2]);
      const dur = cs / 100;
      // K 标签作用于其后的文本：先把 pendingText 结算给上一个音节，
      // 再开启新音节等待后续文本。
      if (syllables.length > 0) {
        syllables[syllables.length - 1].text = pendingText;
      }
      pendingText = "";
      syllables.push({ start: cursor, dur, text: "", effect: kind });
      cursor += dur;
    }
  }
  // 末尾剩余文本归属最后一个音节。
  if (syllables.length > 0) {
    syllables[syllables.length - 1].text = pendingText;
  }

  return syllables;
}

/** 规整 K 标签前缀为 effect 类型。
 *  \k（小写）→ k，\kf → kf，\ko → ko，\K（单个大写）→ kf，多 k（\kk）→ k。 */
function normalizeKind(raw: string): AssSyllable["effect"] {
  const lower = raw.toLowerCase();
  if (lower.startsWith("ko")) return "ko";
  if (lower === "kf") return "kf";
  // 单个大写 K（\K）= 平滑填充；其它（\k、\kk 等）= 普通 k
  if (raw === "K") return "kf";
  return "k";
}
