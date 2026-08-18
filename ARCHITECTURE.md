# Architecture

网页卡拉 OK 练习应用的整体架构说明。涵盖前端三页面、音频/话筒管线、数据模型、制谱工具与签名后端 Worker。

> 部署与命令见 [README.md](./README.md)；本文聚焦结构与数据流。

## 总览

```
┌────────────────────────── 浏览器（前端，Cloudflare Pages） ──────────────────────────┐
│                                                                                       │
│   index.html ─ 练习页（src/main.ts）                                                  │
│      ├─ 音频回放管线：AudioEngine（SoundTouch 变调/变速）                              │
│      ├─ 话筒检测管线：MicPitchDetector（pitchy + 中值滤波）                            │
│      ├─ 评分引擎：Scoring                                                             │
│      └─ 4 个渲染视图：HighwayCanvas / PitchLineCanvas / PianoRoll / KaraokeLyrics      │
│                                                                                       │
│   editor.html ─ 手工制谱（src/editor/main.ts，钢琴卷帘 + 频谱）                        │
│   midi.html   ─ MIDI 转 song.json（src/midi/main.ts，@tonejs/midi）                    │
│                                                                                       │
└───────────────┬───────────────────────────────────────┬───────────────────────────────┘
                │ fetch /songs/<slug>/song.json          │ fetch /sign/<slug>
                │ fetch /songs/<slug>/lyrics.ass         │
                ▼                                        ▼
   Cloudflare Pages（静态）                   Cloudflare Worker（karaoke-api，Hono）
   karaoke.rotcool.me                         karaoke-api.rotcool.me
                                                  │ HMAC-SHA1 签名（Web Crypto）
                                                  ▼
                                          七牛云私有 CDN（QINIU_AK/SK + CDN_DOMAIN）
```

两个独立部署单元：

- **前端**：Vite 多页应用（MPA），三个 HTML 入口，无客户端路由，页面间用普通 `<a href>` 跳转。部署到 Cloudflare Pages，自定义域 `karaoke.rotcool.me`。
- **后端**：Cloudflare Worker（`karaoke-api/`，Hono 框架），自定义域 `karaoke-api.rotcool.me`，仅负责为七牛私有 CDN 签发带过期的访问 URL。

## 入口与页面

| HTML | 标题 | TS 入口 | 职责 |
|---|---|---|---|
| `index.html` | 网页卡拉OK | `src/main.ts` | 练习/播放页，应用核心 |
| `editor.html` | 制谱编辑器 | `src/editor/main.ts` | 手工制谱：在频谱上画音符，导出 `song.json` |
| `midi.html` | MIDI 转 song.json | `src/midi/main.ts` | 上传 `.mid`，选旋律轨，导出 `song.json` |

三个页面共享同一种启动模式：一个 `#gate` 遮罩 + `#start-btn`，用户点击后才创建 `AudioContext`（满足浏览器自动播放策略）。`#stage`/`#editor` 在启动完成前为 `hidden`。

`vite.config.ts` 把三个 HTML 都声明为 Rollup 入口（`main` / `editor` / `midi`）。

签名 API 基址按环境可配：`src/main.ts:30` 读取 `import.meta.env.VITE_SIGN_API ?? "https://karaoke-api.rotcool.me"`；本地开发用 `.env.local` 指向 `http://localhost:8787`。

## 前端 `src/` 结构

```
src/
├── main.ts              练习页编排器（应用心脏）
├── style.css            练习页样式
├── types.ts             共享类型：SongData / MelodyNote
├── audio/
│   ├── AudioEngine.ts   加载/解码/播放、原唱切换、录音叠加回放、SoundTouch 变调变速、时间基准
│   ├── PitchDetector.ts 话筒音高检测（pitchy + 中值滤波）；暴露 stream 供录音复用
│   ├── Recorder.ts      MediaRecorder 麦克风录音，产出可下载/可回放 Blob
│   └── Synth.ts         三角波合成器（ADSR），用于钢琴预览/试听
├── data/
│   ├── SongLoader.ts    拉取 /<dir>/song.json → SongData
│   ├── AssParser.ts     ASS 字幕解析（K 轴逐音节）
│   ├── Scoring.ts       实时命中率评分引擎
│   └── transpose.ts     音高比对（话筒 vs 目标，含八度等价）
├── editor/              制谱页（见“制谱编辑器”一节）
├── midi/
│   ├── main.ts          MIDI 转换页编排器
│   └── convert.ts       轨道 → MelodyNote[]（含偏移/忽略原点）
├── render/
│   ├── HighwayCanvas.ts 下落式音符轨道（Synthesia 风格）+ 话筒圆点
│   ├── PitchLineCanvas.ts 水平音高匹配视图 + 已唱轨迹
│   ├── PianoRoll.ts     多八度钢琴键盘（DOM）
│   └── KaraokeLyrics.ts K 轴逐音节歌词高亮
└── util/
    ├── math.ts          clamp、median
    ├── music.ts         freqToMidi / midiToFreq / midiToName / applySemitones
    ├── octave.ts        八度等价工具（折叠、音分误差、判定）
    └── wav.ts           AudioBuffer → 16-bit PCM 单声道 WAV（录音下载）
```

> `src/app/`、`src/state/`、`src/ui/` 目前为空目录，是为未来重构（如把 `main.ts` 内联的状态/UI 构建代码抽离）预留的占位。

### `src/main.ts`（练习页）

整个应用的编排中心。负责：

- 创建 `AudioContext`，实例化 `AudioEngine`、`Synth`、`MicPitchDetector`、四个渲染视图与 `Scoring`。
- 命令式地构建整个控制条（歌曲 `<select>`、播放/拖动进度/倍速/半音/音量/话筒/录音/录音播放/录音偏移/下载录音/原唱/清除），见 `buildControls()`（`src/main.ts:436-602`）。录音与原唱的状态与操作（`startRecording`/`stopRecording`/`toggleRecPlayback`/`setRecOffset`/`downloadRecording`/`setMic`）定义在 `boot()` 内，以处理函数对象注入 `buildControls`。
- 运行**单一 `requestAnimationFrame(tick)` 循环**（`src/main.ts:138-194`），驱动所有渲染、音高比对与评分。
- 维护模块级 `state = { semitones, mic }`，渲染视图通过构造时注入的 getter 闭包读取——这是一种轻量依赖注入，避免引入正式状态管理库。

## 音频管线

两条**互相独立**的子管线，仅共享同一个 `AudioContext`：回放管线（伴奏）与话筒采集管线（音高检测）。

### 回放管线（带变调的伴奏）

`AudioEngine`（`src/audio/AudioEngine.ts:9-15`）信号链：

```
AudioBufferSourceNode（一次性，每次播放/seek 重建）
  → SoundTouchNode（复用，pitchSemitones 用于变调）
    → GainNode（音量）
      → ctx.destination
```

#### 原唱切换（可选）

`songs.json` 条目带 `original` 字段时，`loadSong()`（`src/main.ts`）额外请求 `/sign/:slug?track=original` 并解码到 `originalBuffer`。`setUseOriginal(v)`（`src/audio/AudioEngine.ts:96`）切换 `_useOriginal`，`play()` 按标志选择 buffer；**时间基准始终以伴奏时长为准**（乐谱与伴奏对齐），播放中切换会从当前位置重启。

#### 录音叠加回放

信号链与主链平行，走**独立** SoundTouch 节点（变速保音高，且**不**受伴奏变调影响——用户自己的声音不应被 transpose）：

```
AudioBufferSourceNode（录音，每次 play/seek 重建）
  → SoundTouchNode（只设 playbackRate，pitchSemitones 恒为 0）
    → GainNode → ctx.destination
```

- **录制**：`Recorder`（`src/audio/Recorder.ts`）用 MediaRecorder 录麦克风流（复用 `MicPitchDetector.stream`）；开始录音时记录 `recStartOffset = engine.getCurrentTime()`（歌曲秒数）。
- **回放对齐**：`setOverlay(buffer, startOffset)`（`src/audio/AudioEngine.ts:107`）后，`startOverlay()`（`src/audio/AudioEngine.ts:229`）在每次 play/seek 时把录音映射回歌曲时间轴——播放位置在录音起点之后则从录音内相对偏移处起播；在之前则延时到歌曲走到该点再播（ctx 时间按 `1/rate` 换算，与主链时间基准一致）。
- **偏移补偿**：练习页提供「录音偏移」滑杆（±1000ms，步进 10ms），补偿 Windows 麦克风采集延迟。正值 = 录音延后播放，实现上把 `overlayStartOffset` 前移 `ms/1000`（`setRecOffset()`，`src/main.ts`）。滑杆仅在录音属于当前歌曲且解码成功时可用。
- **下载**：录音解码后由 `audioBufferToWav()`（`src/util/wav.ts`，16-bit PCM 单声道，多声道取平均）转成 `audio/wav` 经 `<a download>` 保存，文件名含歌曲 slug；解码失败时退回 MediaRecorder 原始 webm/mp4。
- 换歌时录音文件保留（仍可下载），但叠加回放自动停用；歌曲放完时若仍在录音会自动停止。

- **加载**：`signedAudioUrl(slug)`（`src/main.ts:237-242`）请求 `${SIGN_API}/sign/${slug}` → `{ url }`（七牛私有签名 URL）；`AudioEngine.loadAudio()`（`src/audio/AudioEngine.ts:48`）再 `fetch(url)` → `arrayBuffer()` → `ctx.decodeAudioData()` → 缓存 `AudioBuffer`。该 buffer 同时是时长的唯一真相。
- **SoundTouch worklet 接线**（`init()`，`src/audio/AudioEngine.ts:39-45`）：从 `@soundtouchjs/audio-worklet` 导入 `SoundTouchNode`，从 `@soundtouchjs/audio-worklet/processor?url` 导入 processor 的 JS URL（Vite 把 `?url` 后缀解析为打包后的 worklet 脚本地址）。`SoundTouchNode.register(ctx, processorUrl)` 内部调用 `ctx.audioWorklet.addModule(processorUrl)`，SoundTouch DSP 跑在音频线程。
- **变调**：`setSemitones(n)` 设 `stNode.pitchSemitones.value = n`（`src/audio/AudioEngine.ts:119`）；`playbackRate` 默认保持 1，即“只变调不变速”的卡拉 OK 模式。
- **变速**：`setRate(r)`（`src/audio/AudioEngine.ts:133-143`）**同时**设 `source.playbackRate.value = r` 与 `stNode.playbackRate.value = r`——SoundTouch 在 playbackRate 模式下变速但保音高。变速中会从当前位置重建 source。
- **时间基准**（正确性要点）：`getCurrentTime()`（`src/audio/AudioEngine.ts:70-74`）**不**用 `performance.now()` 累加（切后台/掉帧会漂移），而是算 `startedAtOffset + (ctx.currentTime - startedAtCtxTime) * rate` 并夹到时长内。整个渲染/评分循环都读这个权威时钟。
- **Source 重建**：`AudioBufferSourceNode` 是一次性的，每次 `play()` / `seek()` 都 `stopSource()` 新建；`seek()` 会保持播放状态（若正在播放则从新偏移重启）。

### 话筒采集管线（音高检测）

`MicPitchDetector`（`src/audio/PitchDetector.ts`）：

```
getUserMedia({echoCancellation:false, noiseSuppression:false, autoGainControl:false})
  → MediaStreamSource
    → AnalyserNode（fftSize=2048，时域）
```

- **轮询循环**（`src/audio/PitchDetector.ts:43`）：`setInterval(poll, 50)`（约 20Hz），**刻意**与渲染循环解耦，避免检测阻塞 `requestAnimationFrame`。
- **检测**（`poll()`，`src/audio/PitchDetector.ts:56-73`）：
  1. `analyser.getFloatTimeDomainData(buf)` 取时域波形（注意：是时域，不是频域 `getByteFrequencyData`）。
  2. `Pitchy.forFloat32Array(2048).findPitch(buf, sampleRate)` → `[freq, clarity]`，pitchy 用自相关（McLeod Pitch Method）。
  3. **清晰度门槛**：`clarity < 0.9` 时清空历史并发出 `{freq:0, clarity}`（视为“没在唱”）。
  4. **中值平滑**：freq 压入 5 元素历史，`latest.freq = median(history)`（`src/util/math.ts`），抑制八度跳变。
- 渲染循环通过 `micGetter` 闭包读取 `latest` 槽位，完全解耦。

### 每帧音高比对（`tick()`，`src/main.ts:138-194`）

1. `state.mic = mic.latest`（读检测器最新值）。
2. `highway.draw(t)`、`pitchLine.draw(t)` 通过 getter 读 `state.mic` 与 `state.semitones`。
3. `comparePitch(targetMidiRaw, micFreq, micClarity, semitones)`（`src/data/transpose.ts`）产出 `{isActive, targetMidi, actualMidi, centsOff, verdict}`，`verdict ∈ {"in-tune" | "sharp" | "flat" | "none"}`。八度等价默认开启：音分折叠到 `[-600, 600)`，男声低八度演唱也算正确。
4. `Scoring.update(t, activeIdx, isHit, singing)` 按 note 索引累积命中时长 / 尝试时长。

### 关键工程取舍

- **八度等价是一等概念**：`src/util/octave.ts` 实现，`transpose.ts`、`HighwayCanvas.ts`、`PitchLineCanvas.ts` 一致使用。`foldToOctaveOf(micMidi, targetMidi)` 把已唱音高按整八度平移到最接近目标（用于显示对齐），`centsErrorOctaveInvariant(micMidi, targetMidi)` 算模 1200 音分的误差。
- **延迟补偿**：`PitchLineCanvas` 用硬编码 `LATENCY = 0.25s`（`src/render/PitchLineCanvas.ts:41`）——检测到的音高对应约 250ms 前的声音（分析窗口 + 轮询间隔 + 中值平滑），所以已唱轨迹段以 `t - LATENCY` 打时间戳，视觉上对齐正确目标音。
- **统一的“当前音符”容差**：练习页用每个音符 `[start, start+dur]` 周围 `±0.02s` 判定“活动音符”（`src/main.ts:167-169`、`HighwayCanvas.currentNote()`、`PitchLineCanvas.currentNote()`、`PianoRoll.findCurrent()`）——四个视图一致。

## 数据模型

### 曲目目录 `songs.json`（仓库根）

扁平数组。**前端与后端共用同一文件**：前端 `src/main.ts:10` 静态 import 用于下拉框；后端 `karaoke-api/src/songs.ts:1` import 用于按 slug 查找并签名。字段：

```json
{
  "slug": "brainrot",          // URL 安全标识，也是目录名
  "title": "ブレインロット",
  "artist": "東京真中 feat. 重音テト",
  "key": "karaoke/brainrot.mp3",         // 七牛对象 key（伴奏，私有 CDN）
  "original": "karaoke/brainrotall.mp3"  // 可选：原唱音轨 key，有此字段的歌曲可切换原唱
}
```

前端当前不使用 `key`（签名用），后端的 `/songs` 接口存在但前端目前直接读静态 import。

### 单曲数据 `song.json`（位于 `public/songs/<slug>/`）

由 `loadSongData(baseDir)`（`src/data/SongLoader.ts:7-11`）通过 `fetch("${baseDir}/song.json")` 拉取。形状定义在 `src/types.ts`：

```typescript
interface SongData {
  schemaVersion: number;       // 当前为 1
  meta: { title, artist, originalKey, originalBpm };
  audio: { file: string; durationSec: number };   // 如 "audio.wav"
  lyrics: { type: "ass"; file: string };          // 如 "lyrics.ass"
  melody: {
    unit: "midi";
    notes: MelodyNote[];
  };
}

interface MelodyNote {
  start: number;          // 秒，对齐音频时间轴
  dur: number;            // 秒
  pitch: number | null;   // MIDI 音符号；null = 休止
  lyric?: string;         // 可选音节标签，显示在下落条上
}
```

### 单曲目录布局 `public/songs/<slug>/`

每首目录固定三文件：

- `song.json` — 旋律 + 元数据
- `audio.mp3` / `audio.wav` — 伴奏音频（`song.audio.file` 引用）。**注意**：实际回放 URL 来自后端签名的七牛 URL，本地 `audio.*` 仅作本地开发兜底/源素材，`audio.file` 文件名**不**用于线上播放。
- `lyrics.ass` — K 轴逐音节时间轴的 ASS 卡拉 OK 字幕。

> `public/songs/*` 被 gitignore（`.gitignore:1`）。曲目提交在 `dist/songs/`（构建产物），`public/` 下不入库。运行时从部署后的静态路径 `/songs/<slug>/` 拉取 `song.json` 与 `lyrics.ass`。

### 运行时单曲数据流（`loadSong(slug)`，`src/main.ts:237-291`）

1. `engine.pause()`、`engine.seek(0)`；结束进行中的录音并停用录音叠加（录音文件保留）
2. `loadSongData("/songs/" + slug)` → 拉取 `song.json`
3. `signedAudioUrl(slug)` → 从 Worker 拉取七牛签名 URL
4. `engine.loadAudio(signedUrl)` → 拉取并解码伴奏音频
5. 若歌曲配置了 `original`：`signedAudioUrl(slug, "original")` + `engine.loadOriginalAudio()` 解码原唱；否则 `engine.clearOriginal()`。更新原唱按钮可用态
6. 把 `song.melody.notes` 喂给 `highway`、`piano`、`pitchLine`
7. 拉取 `${dir}/${song.lyrics.file}`（ASS 文件），用 `parseAss()` 解析，喂给 `KaraokeLyrics`

## MIDI 处理

`@tonejs/midi` **只在 `midi.html` 页**使用（`src/midi/main.ts:2`），练习页/制谱页不涉及。

### MIDI 页流程（`src/midi/main.ts`）

1. 用户用 `<input type="file" accept=".mid,.midi,audio/midi">` 选 `.mid`。
2. `file.arrayBuffer()` → `new Midi(buf)`（构造器解析整个文件，把 tick 按速度表转成秒）。
3. 抽取所有轨为 `TrackInfo[]`（`src/midi/convert.ts:10-17`）：`{ index, name, instrument, noteCount, notes: RawNote[] }`，`RawNote = { time, duration, midi }`（秒 / 整数 MIDI 号）。
4. 用有音符的轨填充轨 `<select>`，默认选中音符最多的轨（假定是旋律）。
5. 用户选轨，可选设时间偏移（秒 + 毫秒）与“忽略原始偏移”（剥掉 MIDI 开头空白）。
6. `convertTrack(rawNotes, offset, ignoreOrigOffset)`（`src/midi/convert.ts:33-47`）：若忽略原点则减去 `min(time)`；加用户偏移；映射 `{time,duration,midi}` → `{start,dur,pitch}`；按 `start` 排序。
7. 预览前 20 个音符。
8. 导出时组装完整 `SongData`（`audio.file:"audio.mp3"`、`lyrics.file:"lyrics.ass"`、`originalBpm:120` 硬编码），触发 `song.json` 下载。

### 与制谱页的区别

MIDI 页是**半自动**作者工具——从现成 MIDI 提取时序/音高；制谱页是**手工**作者工具——在频谱上手画音符。两者输出同一 `song.json` 格式。

## 制谱编辑器

桌面向钢琴卷帘制谱工具，通过在频谱图上标注音频来手工生成 `song.json`。

### 组件

- **`src/editor/main.ts`** — 编排器。启动 `AudioEngine`，建 `EditorState`（预置 3 个示例音符）、`PianoRollView`、`SpecView`、`EditorController`。维护 `Viewport = { start, duration }`（时间窗，默认 0–8s，加载后重置为整曲）。渲染循环（`src/editor/main.ts:79-91`）画钢琴卷帘 + 频谱条，并在播放头接近右缘时自动滚动视口。
- **`src/editor/EditorState.ts`** — 最小可观察状态容器。持 `EditorStateData = { notes, bpm, quantize, selectedIdx, title }`；支持 `update(patch)`（浅合并 + emit）、`notifyNotesMutated()`（就地改数组时）、`subscribe()`。默认 quantize = 2（1/8 音符）。
- **`src/editor/EditorController.ts`** — 鼠标/键盘交互状态机（`src/editor/EditorController.ts:23-29` 文档化了方案）：
  - 左键空地 + 拖 = 新建音符（拖动设时长，音高固定为按下点）
  - 左键音符体 + 拖 = 移动（时间 + 音高）
  - 左键音符右缘 8px 把手 + 拖 = 改时长
  - 左键音符（不拖） = 用 `Synth.playNote()` 试听
  - 右键音符 = 删除
  - 右键空地 = seek
  - 双击 = 删除（兜底）
  - Delete/Backspace = 删选中
  - 空格 = 播放/暂停
- **`src/editor/PianoRollView.ts`** — canvas 渲染。用“车道”模型：每个 MIDI 音符占一条横向车道，音符画在车道中央（而非网格线上）。固定范围 MIDI 36(C2)–84(C6)。含琴键列（黑白键 + C 标签）、自适应步长时间网格（`niceStep()`）、播放头、Ctrl+滚轮缩放 + 横向滚动。视口 `{start, duration}` 控制可见时间窗。
- **`src/editor/SpecView.ts`** — 频谱条 canvas 渲染。画预计算的离屏频谱 canvas，按当前视口裁剪，叠播放头。与钢琴卷帘共享视口与 MIDI 范围，垂直对齐；支持点击/拖动 seek。
- **`src/editor/Spectrogram.ts`** — 离线 STFT。输入解码后的 `AudioBuffer`，混成单声道，逐帧（FRAME=2048 样本 ≈46ms，HOP=512 样本 ≈11.6ms）加 Hann 窗跑 `fftInPlace()`；对每个 MIDI 行(36–84)在对应频段取最大幅值，转 dB，归一化到 0–1（经验范围 -80 ~ -20dB），映射“turbo”配色写入 `ImageData`。按 256 帧一批、批间 `await setTimeout(0)` 让出主线程（`src/editor/Spectrogram.ts:49-82`）。返回离屏 `<canvas>`（宽 = 帧数，高 = MIDI 跨度）。
- **`src/editor/Fft.ts`** — 手写 radix-2 迭代 Cooley-Tukey FFT（in-place，分离 re/im `Float32Array`）。含缓存位反转排列表、正/逆变换（正向省略 1/N，因频谱只需相对幅值）、`hannWindow(n)` 生成器。**全项目唯一的 FFT**，仅用于制谱页频谱可视化——实时音高检测用 pitchy，不用它。
- **`src/editor/Quantize.ts`** — 纯函数网格吸附：`gridSec(bpm, quantize)` 算步长（如 120bpm × quantize=4 → 0.125s = 1/16 音符）；`quantize(time, grid)` 吸附到最近格点；`quantize=0` 关闭。注意：当前 `EditorController` **未**调用这些——quantize 在状态模型里但尚未接入拖拽逻辑（疑似 TODO）。
- **`src/editor/exportJson.ts`** — 把 `EditorStateData` + 时长组装成 `SongData`（过滤 null 音高音符、按 start 排序），用 Blob + 临时 `<a>` 触发 `song.json` 下载。

## 后端 Worker（`karaoke-api/`）

Cloudflare Worker + TypeScript + **Hono** 框架，部署到 `karaoke-api.rotcool.me`。

### `karaoke-api/src/index.ts` — Hono 应用

`Env` 绑定接口：`CDN_DOMAIN`、`QINIU_AK`、`QINIU_SK`、`CORS_ORIGIN`、`TTL_SECONDS?`。

- **CORS 中间件**（`hono/cors`，`karaoke-api/src/index.ts:16-29`）：读 `CORS_ORIGIN`（逗号分隔白名单），用函数式 `origin` 匹配器——来源在白名单内则返回该 origin，否则 `null`。仅允许 `GET` / `OPTIONS`。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/health` | `{ ok: true, service: "karaoke-api" }` |
| GET | `/songs` | `{ songs: listSongs() }`（不含 `key`/`original` 字段） |
| GET | `/sign/:slug` | 按 slug 查曲，签名七牛 URL，返回 `{ url, expiresIn, slug, title, track }`；`?track=original` 签名原唱（无原唱返回 404） |
| * | * | 404 `{ error: "not found" }` / 500 `{ error: err.message }` |

### `karaoke-api/src/sign.ts` — 七牛私有 URL 签名

实现七牛私有 CDN 下载 token 算法（文件头注明移植自 `oshifish/apps/api/src/s3/presign.ts`）。`signQiniuUrl()`（`karaoke-api/src/sign.ts:27-44`）：

```
deadline = floor(nowMs / 1000) + expiresIn
url      = `${CDN_DOMAIN}/${encodeKey(key)}?e=${deadline}`
sign     = urlSafeBase64( HMAC-SHA1(url, QINIU_SK) )
token    = `${QINIU_AK}:${sign}`
final    = `${url}&token=${token}`
```

要点：

- HMAC-SHA1 用 Web Crypto（`crypto.subtle.importKey` + `sign`），**零外部依赖**。
- URL-safe Base64：标准 base64 后 `+→-`、`/→_`、去 `=` 填充。
- `encodeKey()`：按 `/` 切对象 key，逐段 `encodeURIComponent` 再用 `/` 拼回——保留路径分隔符，编码文件名里的特殊字符。
- 默认 TTL 1800 秒（30 分钟），可由 `TTL_SECONDS` 覆盖。

### `karaoke-api/src/songs.ts` — 目录访问

import `../../songs.json`（与前端同一文件），建 `Map<slug, SongEntry>` 做 O(1) 查找。`listSongs()` 返回**不含** `key` 的条目（安全：绝不把 CDN 对象 key 暴露给前端），`getSong(slug)` 返回含 `key` 的完整条目用于签名。

### 环境与密钥

- `[vars]`（非密钥）：`CORS_ORIGIN = "https://karaoke.rotcool.me,http://localhost:5173,http://127.0.0.1:5173"`、`TTL_SECONDS = "1800"`
- Secrets（`wrangler secret put`，不入库）：`CDN_DOMAIN`、`QINIU_AK`、`QINIU_SK`
- `compatibility_date = "2026-04-15"`、`compatibility_flags = ["nodejs_compat"]`
- `.dev.vars.example` 为本地开发密钥文件格式（`.dev.vars` 被 gitignore）
- `observability.enabled = true`（Cloudflare Workers Logs）

## 构建 / 配置

### `vite.config.ts`

多页入口：三个 Rollup 入口（`main`→`index.html`、`editor`→`editor.html`、`midi`→`midi.html`）。无插件、无代理、无额外构建选项。

### `tsconfig.json`（前端）

- `target: es2023`、`module: esnext`、`moduleResolution: bundler`
- `lib: ["ES2023", "DOM"]`
- `allowImportingTsExtensions: true` + `verbatimModuleSyntax: true` —— 所有 import 显式带 `.ts` 扩展名
- `noEmit: true`（Vite 负责打包；`tsc` 仅类型检查）
- 类严格 lint：`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`（注意：**未**开 `strict`，与 Worker 的 tsconfig 不同）

### `tsconfig.json`（Worker `karaoke-api/`）

`target: es2023`、`types: ["@cloudflare/workers-types"]`、`include: ["src", "../songs.json"]`（让 JSON import 解析）、`noEmit: true`（Wrangler 打包）。

### `vitest.config.ts`

`include: ["tests/**/*.test.ts"]`、`environment: "node"`。

### `tests/`

七个 Vitest 测试文件（node 环境）：

- `ass-parser.test.ts` — ASS 时间解析、K 标签音节累积、特效类型（`kf`/`ko`/`K`→`kf`）、纯文本兜底、文本含逗号边界、非 Events 段过滤
- `editor-fft.test.ts` — FFT 正确性：DC 信号、已知正弦波 bin 峰、实信号对称性、可逆性(FFT→IFFT)、Hann 窗端点/对称
- `editor-quantize.test.ts` — 不同 bpm/quantize 的 `gridSec` 与 `quantize`
- `midi-convert.test.ts` — `offsetTotal` 与 `convertTrack`（含/不含忽略原点、带偏移、音高/时长保留、排序、空数组）
- `octave.test.ts` — `pitchClass`、`foldToRange`、`foldToOctaveOf`、`centsErrorOctaveInvariant`、`verdictForCents`（含穷举范围）
- `transpose.test.ts` — `freqToMidi`/`midiToFreq` 往返、`applySemitones`、`comparePitch` 全覆盖（含八度等价边界）
- `wav.test.ts` — `pcmToWav` RIFF 头字段/尺寸、浮点→16-bit PCM 截断、空输入

## 依赖

| 包 | 版本 | 用在哪 | 用途 |
|---|---|---|---|
| `@soundtouchjs/audio-worklet` | ^2.1.0 | `src/audio/AudioEngine.ts` | SoundTouch 变调/变速的 AudioWorklet 封装：`SoundTouchNode`（`AudioWorkletNode` 子类，含 `pitchSemitones`/`playbackRate` 参数）+ processor JS 包（`?url` import 后用 `audioWorklet.addModule` 注册） |
| `@soundtouchjs/core` | ^2.1.0 | 间接（经 audio-worklet） | SoundTouch DSP 核心（转调 + 变速）。列为直接依赖但仅经 audio-worklet 的 processor 间接消费 |
| `@tonejs/midi` | ^2.0.28 | `src/midi/main.ts` | MIDI 文件解析。`Midi` 构造器取 `ArrayBuffer`，暴露轨/音符（`time`/`duration`/`midi` 已转秒与音符号）/乐器名。仅 MIDI 转 song.json 页用 |
| `pitchy` | ^4.1.0 | `src/audio/PitchDetector.ts` | 实时单声部音高检测（自相关 / McLeod Pitch Method）。`PitchDetector.forFloat32Array(fftSize).findPitch(waveform, sampleRate)` → `[频率Hz, 清晰度]`，作用于 `AnalyserNode` 的时域 `Float32Array` |

Worker 仅依赖 `hono ^4.12.14`（dev: `@cloudflare/workers-types`、`wrangler ^4.84.0`）；签名零 crypto 依赖，全靠 Workers 运行时的 Web Crypto API。

## 渲染架构补充

练习页四个视图彼此独立：

- `HighwayCanvas`、`PitchLineCanvas` 为 canvas，各有自己的 `draw(t)`，每帧调用。
- `PianoRoll` 为 DOM（构建 `<button>` 元素）。
- `KaraokeLyrics` 为 DOM + CSS 驱动 K 轴效果（`background-clip: text` + `--progress` CSS 变量实现 `kf` 平滑填充）。

所有视图通过构造时注入的 getter 闭包读取共享可变状态（`state.semitones`、`state.mic`），构成一套轻量依赖注入，取代正式状态管理。
