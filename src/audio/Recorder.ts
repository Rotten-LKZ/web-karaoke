/** 用 MediaRecorder 录制麦克风流，产出可下载、可解码回放的音频 Blob。 */
export class Recorder {
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private resolveStop: ((blob: Blob) => void) | null = null;

  get isRecording(): boolean {
    return this.mr !== null && this.mr.state === "recording";
  }

  get mimeType(): string {
    return this.mr?.mimeType || "audio/webm";
  }

  /** 开始录制。需传入已获授权的麦克风流。 */
  start(stream: MediaStream): void {
    if (this.isRecording) return;
    this.chunks = [];
    this.mr = new MediaRecorder(stream);
    this.mr.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mr.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType });
      this.resolveStop?.(blob);
      this.resolveStop = null;
    };
    this.mr.start();
  }

  /** 停止并返回完整录音 Blob。 */
  stop(): Promise<Blob> {
    if (!this.mr || this.mr.state === "inactive") {
      return Promise.resolve(new Blob(this.chunks, { type: this.mimeType }));
    }
    return new Promise((resolve) => {
      this.resolveStop = resolve;
      this.mr!.stop();
    });
  }
}
