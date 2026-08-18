/**
 * 把 AudioBuffer 转成 16-bit PCM 单声道 WAV Blob（多声道取平均）。
 * MediaRecorder 原生只出 webm/mp4；录音下载用 WAV——零依赖、通用性最好。
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return pcmToWav(mono, buffer.sampleRate);
}

/** 单声道 Float32（-1..1）→ 16-bit PCM WAV。 */
export function pcmToWav(mono: Float32Array, sampleRate: number): Blob {
  const data = new DataView(new ArrayBuffer(44 + mono.length * 2));
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) data.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  data.setUint32(4, 36 + mono.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  data.setUint32(16, 16, true); // fmt chunk 大小
  data.setUint16(20, 1, true); // PCM
  data.setUint16(22, 1, true); // 单声道
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true); // 字节率
  data.setUint16(32, 2, true); // 块对齐
  data.setUint16(34, 16, true); // 位深
  writeStr(36, "data");
  data.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    data.setInt16(
      44 + i * 2,
      v < 0 ? Math.round(v * 32768) : Math.round(v * 32767),
      true,
    );
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}
