export function floatToWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((c) => {
    samples.set(c, offset);
    offset += c.length;
  });

  const targetRate = 16000;
  const ratio = sampleRate / targetRate;
  const outLength = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const v = sum / Math.max(1, end - start);
    pcm[i] = Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767);
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);

  const write = (s: string, p: number) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(p + i, s.charCodeAt(i));
    }
  };

  write('RIFF', 0);
  view.setUint32(4, 36 + pcm.length * 2, true);
  write('WAVE', 8);
  write('fmt ', 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  write('data', 36);
  view.setUint32(40, pcm.length * 2, true);

  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}
