import { PitchDetector as Pitchy } from "pitchy";
import type { MicPitch } from "../render/HighwayCanvas.ts";
import { median } from "../util/math.ts";

const FFT_SIZE = 2048; // 必须等于 Pitchy detector 长度；2048@44100Hz ≈ 46ms 窗口
const HISTORY = 5; // median filter 长度（奇数，抗八度跳变）
const CLARITY_GATE = 0.9;

/**
 * 麦克风实时音高检测：getUserMedia + AnalyserNode（时域波形）
 * + pitchy + median 平滑。
 *
 * 检测在独立 setInterval（~50ms）里跑，结果写入 latest slot；
 * 渲染循环（rAF）只读 slot，二者解耦避免阻塞。
 */
export class MicPitchDetector {
  private detector = Pitchy.forFloat32Array(FFT_SIZE);
  private buf = new Float32Array(FFT_SIZE);
  private analyser: AnalyserNode;
  /** 当前麦克风流（录音复用）；未开启时为 null。 */
  stream: MediaStream | null = null;
  private timer: number | null = null;
  private history: number[] = [];

  latest: MicPitch = { freq: 0, clarity: 0 };

  constructor(private ctx: AudioContext) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    // 默认的 smoothingTimeConstant 影响频域，不影响时域 getFloatTimeDomainData。
  }

  /** 请求麦克风权限并启动检测。 */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, // 关闭以免影响音高
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    src.connect(this.analyser);
    this.timer = window.setInterval(() => this.poll(), 50);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.latest = { freq: 0, clarity: 0 };
    this.history = [];
  }

  private poll(): void {
    // 时域波形（非频域）
    this.analyser.getFloatTimeDomainData(this.buf);
    const [freq, clarity] = this.detector.findPitch(
      this.buf,
      this.ctx.sampleRate,
    );

    if (clarity < CLARITY_GATE) {
      this.history = [];
      this.latest = { freq: 0, clarity };
      return;
    }

    this.history.push(freq);
    if (this.history.length > HISTORY) this.history.shift();
    this.latest = { freq: median(this.history), clarity };
  }
}
