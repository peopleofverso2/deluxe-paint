// Optical sound — turn drawn frames into audio, two historical ways:
//
// SPECTRO ("ANS" / MetaSynth style): the image is a spectrogram.
//   X = time across the frame, Y = pitch on a log scale (top = high),
//   ink density = oscillator amplitude. Additive synthesis over N bands.
//   Drawing a diagonal = glissando; dots = blips; rows = drones.
//
// DENSITY (McLaren / variable-density film track): each column's mean
//   ink IS the waveform amplitude — the frame is read like the optical
//   soundtrack strip of 35mm film. Gritty, buzzy, very "pellicule".
//
// All pure functions — no DOM state, easily testable.

export type OpticalMode = "spectro" | "density";

export type FrameGrid = {
  cols: number;
  rows: number;
  // ink[row * cols + col] in 0..1 (1 = full ink / dark pixel)
  ink: Float32Array;
};

// Downscale a composited frame into an ink grid. The scaled drawImage does
// the area-averaging for us (smoothing ON — we WANT averaged coverage),
// and the only getImageData readback is grid-sized (tiny).
export function gridFromCanvas(frame: HTMLCanvasElement, cols: number, rows: number): FrameGrid {
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, cols, rows);
  ctx.drawImage(frame, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const ink = new Float32Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    ink[i] = 1 - lum;
  }
  return { cols, rows, ink };
}

// Additive log-band synthesis. Per-band running phases keep oscillators
// continuous across columns AND frames (no clicks at boundaries); bands
// silent on both ends of a column block are skipped (their phase still
// advances) so sparse drawings synthesize very fast.
export function synthSpectro(
  grids: FrameGrid[],
  frameDur: number,
  sampleRate = 44100,
  fMin = 65.41,   // C2
  fMax = 4186.01, // C8
): Float32Array {
  const frameSamples = Math.max(1, Math.round(frameDur * sampleRate));
  const total = grids.length * frameSamples;
  const out = new Float32Array(Math.max(1, total));
  if (grids.length === 0) return out;
  const rows = grids[0].rows;
  const cols = grids[0].cols;

  const omega = new Float32Array(rows);
  const phase = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    const frac = rows === 1 ? 0 : r / (rows - 1);
    const f = fMax * Math.pow(fMin / fMax, frac); // row 0 (top) = highest
    omega[r] = (2 * Math.PI * f) / sampleRate;
    phase[r] = Math.random() * Math.PI * 2; // decorrelate band phases
  }

  const EPS = 0.01;
  for (let gi = 0; gi < grids.length; gi++) {
    const g = grids[gi];
    const base = gi * frameSamples;
    for (let col = 0; col < cols; col++) {
      const start = Math.round((col / cols) * frameSamples);
      const end = Math.round(((col + 1) / cols) * frameSamples);
      const blockLen = end - start;
      if (blockLen <= 0) continue;
      const colNext = Math.min(cols - 1, col + 1);
      for (let r = 0; r < rows; r++) {
        const a0 = g.ink[r * cols + col];
        const a1 = g.ink[r * cols + colNext];
        if (a0 < EPS && a1 < EPS) {
          // Inaudible — advance the oscillator silently
          phase[r] = (phase[r] + omega[r] * blockLen) % (2 * Math.PI);
          continue;
        }
        let p = phase[r];
        const w = omega[r];
        const da = (a1 - a0) / blockLen;
        let a = a0;
        for (let n = 0; n < blockLen; n++) {
          out[base + start + n] += a * Math.sin(p);
          p += w;
          a += da;
        }
        phase[r] = p % (2 * Math.PI);
      }
    }
  }

  // Normalize to 0.9 peak
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
  }
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

// Variable-density film-track reading: column mean ink → amplitude,
// linearly interpolated between columns, then DC-blocked (one-pole HPF)
// so solid fills don't produce a constant offset, just their edges —
// exactly like a photocell reading a density track.
export function synthDensity(
  grids: FrameGrid[],
  frameDur: number,
  sampleRate = 44100,
): Float32Array {
  const frameSamples = Math.max(1, Math.round(frameDur * sampleRate));
  const total = grids.length * frameSamples;
  const out = new Float32Array(Math.max(1, total));
  if (grids.length === 0) return out;
  const cols = grids[0].cols;
  const rows = grids[0].rows;

  // Pre-compute per-frame column means
  const means: Float32Array[] = grids.map((g) => {
    const m = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let r = 0; r < rows; r++) s += g.ink[r * cols + c];
      m[c] = s / rows;
    }
    return m;
  });

  // Raw signal: interpolated column density
  for (let gi = 0; gi < grids.length; gi++) {
    const m = means[gi];
    const base = gi * frameSamples;
    for (let n = 0; n < frameSamples; n++) {
      const x = (n / frameSamples) * (cols - 1);
      const c0 = Math.floor(x);
      const c1 = Math.min(cols - 1, c0 + 1);
      const tt = x - c0;
      out[base + n] = m[c0] + (m[c1] - m[c0]) * tt;
    }
  }

  // DC-block: y[n] = x[n] - x[n-1] + R·y[n-1]
  const R = 0.995;
  let prevX = out[0];
  let prevY = 0;
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    const y = x - prevX + R * prevY;
    out[i] = y;
    prevX = x;
    prevY = y;
  }

  // Normalize
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
  }
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

// Minimal 16-bit PCM mono WAV writer.
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // format = PCM
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
