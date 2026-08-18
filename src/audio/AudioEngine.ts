import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";

/**
 * 音频引擎：负责加载/解码音频、SoundTouch 实时变调、播放控制，
 * 并提供唯一权威时间基准 getCurrentTime()（基于 AudioContext.currentTime，
 * 绝不用 performance.now 累加——会因 tab 切换/掉帧漂移）。
 *
 * 信号链：AudioBufferSourceNode（一次性，每次 play/seek 重建）
 *        → SoundTouchNode（可复用，pitchSemitones 变调）
 *        → GainNode（音量）
 *        → destination
 *
 * 原唱切换：originalBuffer 可选，_useOriginal 决定用伴奏还是原唱；
 * 时间基准始终以伴奏（buffer）时长为准（乐谱与伴奏对齐）。
 *
 * 录音叠加：overlayBuffer（用户录音）走独立 SoundTouchNode（只变速保音高、
 * 不变调——用户自己的声音不应被 transpose），与主链按歌曲时间轴同步启停。
 *
 * 卡拉OK「只变调不变速」：保持 playbackRate=1，不改 source.playbackRate，
 * 否则 SoundTouch 会按文档「补偿变速时的音高」导致变调+变速叠加。
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private originalBuffer: AudioBuffer | null = null;
  private _useOriginal = false;
  private source: AudioBufferSourceNode | null = null;
  private stNode: SoundTouchNode | null = null;
  private gain: GainNode;
  private overlayBuffer: AudioBuffer | null = null;
  /** 录音起点对应的歌曲秒数（录音可能从歌曲中途开始）。 */
  private overlayStartOffset = 0;
  private overlayEnabled = false;
  private overlaySource: AudioBufferSourceNode | null = null;
  private overlayStNode: SoundTouchNode | null = null;
  private overlayGain: GainNode;

  private startedAtCtxTime = 0; // 上次 play 时的 ctx.currentTime
  private startedAtOffset = 0; // 上次 play 时从音频的哪个秒数开始
  private _isPlaying = false;
  private _duration = 0;
  /** 播放倍速（1=原速）。source.playbackRate 与 stNode.playbackRate 同步，
   *  SoundTouch 保持音高不变（只变速），用于慢速/快速练习。 */
  private _rate = 1;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.connect(ctx.destination);
    this.overlayGain = ctx.createGain();
    this.overlayGain.connect(ctx.destination);
  }

  /** 注册 SoundTouch worklet processor（必须在首次使用前调用）。 */
  async init(): Promise<void> {
    if (this.stNode) return;
    await SoundTouchNode.register(this.ctx, processorUrl);
    this.stNode = new SoundTouchNode({ context: this.ctx });
    this.stNode.connect(this.gain);
    this.overlayStNode = new SoundTouchNode({ context: this.ctx });
    this.overlayStNode.connect(this.overlayGain);
    // 保持 playbackRate=1：只变调不变速。
  }

  /** 加载并解码伴奏音频文件。 */
  async loadAudio(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`音频加载失败: ${res.status} ${url}`);
    const arr = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
    this._duration = this.buffer.duration;
  }

  /** 加载并解码原唱音轨。 */
  async loadOriginalAudio(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`原唱加载失败: ${res.status} ${url}`);
    this.originalBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  /** 清除原唱（本曲无原唱时调用）。 */
  clearOriginal(): void {
    this.originalBuffer = null;
  }

  get hasOriginal(): boolean {
    return this.originalBuffer !== null;
  }

  get useOriginal(): boolean {
    return this._useOriginal;
  }

  /** 切换原唱/伴奏。播放中从当前位置重启。 */
  async setUseOriginal(v: boolean): Promise<void> {
    if (v === this._useOriginal) return;
    if (v && !this.originalBuffer) return;
    this._useOriginal = v;
    await this.restartIfPlaying();
  }

  /**
   * 设置录音叠加音轨。startOffset = 录音起点对应的歌曲秒数；
   * 传 null 清除。
   */
  async setOverlay(buffer: AudioBuffer | null, startOffset = 0): Promise<void> {
    this.overlayBuffer = buffer;
    this.overlayStartOffset = startOffset;
    await this.restartIfPlaying();
  }

  /** 是否随伴奏一起播放录音。 */
  async setOverlayEnabled(v: boolean): Promise<void> {
    if (v && !this.overlayBuffer) return;
    this.overlayEnabled = v;
    await this.restartIfPlaying();
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get duration(): number {
    return this._duration;
  }

  /** 暴露解码后的 AudioBuffer（编辑器用于离线频谱分析）。 */
  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /** 当前播放位置（秒，音频时间轴）。暂停时返回暂停点。 */
  getCurrentTime(): number {
    if (!this._isPlaying) return this.startedAtOffset;
    const elapsed = (this.ctx.currentTime - this.startedAtCtxTime) * this._rate;
    return Math.min(this.startedAtOffset + elapsed, this._duration);
  }

  /** 从指定位置开始播放；不传则从当前位置。 */
  async play(fromSec?: number): Promise<void> {
    if (this._isPlaying || !this.buffer || !this.stNode || !this.overlayStNode)
      return;
    const buf = this._useOriginal ? this.originalBuffer : this.buffer;
    if (!buf) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const offset =
      fromSec !== undefined
        ? Math.max(0, Math.min(fromSec, this._duration))
        : this.startedAtOffset;

    this.startedAtCtxTime = this.ctx.currentTime;
    this.startedAtOffset = offset;

    // bufferSource 是一次性的，每次 play/seek 都要重建。
    this.source = this.ctx.createBufferSource();
    this.source.buffer = buf;
    this.source.playbackRate.value = this._rate;
    this.source.connect(this.stNode);
    // SoundTouch playbackRate 同步：保持音高不变，按 rate 变速
    this.stNode.playbackRate.value = this._rate;
    this.source.start(0, offset);

    this.startOverlay(offset);
    this._isPlaying = true;
  }

  /** 暂停并保存当前位置。 */
  pause(): void {
    if (!this._isPlaying) return;
    this.startedAtOffset = this.getCurrentTime();
    this.stopAll();
    this._isPlaying = false;
  }

  /** 跳转到指定秒数，保持原播放状态。 */
  async seek(sec: number): Promise<void> {
    const wasPlaying = this._isPlaying;
    this.stopAll();
    this._isPlaying = false;
    this.startedAtOffset = Math.max(0, Math.min(sec, this._duration));
    if (wasPlaying) await this.play();
  }

  /** 设置变调（半音）。 */
  setSemitones(semitones: number): void {
    if (this.stNode) this.stNode.pitchSemitones.value = semitones;
  }

  /** 设置音量（0..1）。 */
  setVolume(v: number): void {
    this.gain.gain.value = v;
  }

  get rate(): number {
    return this._rate;
  }

  /** 设置倍速（如 0.75 慢练、1.5 快速）。播放中改会从当前位置按新速率重启，
   *  SoundTouch 保持音高不变（只变速）。 */
  async setRate(rate: number): Promise<void> {
    const r = Math.max(0.25, Math.min(2, rate));
    if (Math.abs(r - this._rate) < 1e-4) return;
    const pos = this.getCurrentTime();
    this._rate = r;
    if (this._isPlaying) {
      this.stopAll();
      this._isPlaying = false;
      await this.play(pos);
    }
  }

  /** 播放中生效的设置变更：从当前位置无缝重启。 */
  private async restartIfPlaying(): Promise<void> {
    if (!this._isPlaying) return;
    const pos = this.getCurrentTime();
    this.stopAll();
    this._isPlaying = false;
    await this.play(pos);
  }

  /**
   * 与伴奏同步启动录音叠加。录音的 0 秒对应歌曲时间 overlayStartOffset：
   * - 播放位置在录音起点之后 → 立即从录音内相对偏移处播；
   * - 在录音起点之前 → 延时到歌曲走到该点再播（ctx 时间按 1/_rate 换算）。
   * 走独立 SoundTouch 节点：变速保音高，且不受伴奏变调影响。
   */
  private startOverlay(songOffset: number): void {
    this.stopOverlay();
    if (!this.overlayEnabled || !this.overlayBuffer || !this.overlayStNode)
      return;
    const rel = songOffset - this.overlayStartOffset;
    if (rel >= this.overlayBuffer.duration) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.overlayBuffer;
    src.playbackRate.value = this._rate;
    src.connect(this.overlayStNode);
    this.overlayStNode.playbackRate.value = this._rate;
    if (rel >= 0) {
      src.start(this.startedAtCtxTime, rel);
    } else {
      src.start(this.startedAtCtxTime - rel / this._rate, 0);
    }
    this.overlaySource = src;
  }

  private stopOverlay(): void {
    if (this.overlaySource) {
      try {
        this.overlaySource.onended = null;
        this.overlaySource.stop();
      } catch {
        /* 已停止 */
      }
      this.overlaySource.disconnect();
      this.overlaySource = null;
    }
  }

  private stopAll(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* 已停止 */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.stopOverlay();
  }
}
