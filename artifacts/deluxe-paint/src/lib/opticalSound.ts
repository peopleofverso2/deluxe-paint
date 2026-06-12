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

// 16-bit PCM WAV writer — mono (one Float32Array) or stereo (two).
export function encodeWav(channels: Float32Array | Float32Array[], sampleRate: number): Blob {
  const chans = Array.isArray(channels) ? channels : [channels];
  const numCh = chans.length;
  const numSamples = chans[0].length;
  const dataBytes = numSamples * numCh * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);              // PCM chunk size
  view.setUint16(20, 1, true);               // format = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true); // byte rate
  view.setUint16(32, numCh * 2, true);       // block align
  view.setUint16(34, 16, true);              // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// ---------------------------------------------------------------------
// COLOR → TIMBRE (MetaSynth / Amiga spirit)
//
// Hue picks the waveform, saturation dials how much of that character
// blends in (grays stay pure sine — B&W drawings sound exactly as
// before), and each waveform sits at its own stereo position:
//
//   grays / blacks       → SINE      (pure)        center
//   reds / oranges       → SAW       (brassy)      left
//   greens               → TRIANGLE  (flutey)      slight right
//   blues / violets      → SQUARE    (chiptune)    right
// ---------------------------------------------------------------------

export const WAVE_NAMES = ["sine", "saw", "tri", "sqr"] as const;
export type WaveName = (typeof WAVE_NAMES)[number];
// Per-wave loudness trims (perceptual balance) + stereo pan positions
export const WAVE_TRIM: Record<WaveName, number> = { sine: 1.0, saw: 0.5, tri: 0.95, sqr: 0.6 };
export const WAVE_PAN: Record<WaveName, number> = { sine: 0, saw: -0.35, tri: 0.12, sqr: 0.35 };

// Harmonic recipes — the actual INSTRUMENTS behind the three hue anchors.
// [partial, amplitude] pairs; used identically by the live PeriodicWaves
// and the offline additive renderer (what you export = what you hear).
//   saw → CUIVRE    warm descending harmonics (brass-like)
//   tri → FLÛTE     hollow fundamental + soft odd partials
//   sqr → CARILLON  sparse high partials (glass / bell)
export const WAVE_HARMONICS: Record<WaveName, Array<[number, number]>> = {
  sine: [[1, 1]],
  saw:  [[1, 1], [2, 0.55], [3, 0.35], [4, 0.25], [5, 0.16], [6, 0.10]],
  tri:  [[1, 1], [2, 0.12], [3, 0.22], [5, 0.06]],
  sqr:  [[1, 0.8], [4, 0.5], [7, 0.35], [10, 0.22], [13, 0.12]],
};

// CONTINUOUS hue→timbre wheel: anchors at 0° (cuivre), 120° (flûte),
// 240° (carillon); any hue is an angular crossfade of its two
// neighbours — orange is a fluty brass, violet a brassy bell, teal a
// crystalline flute. Every color gets its own mix.
export function hueWaveWeights(h: number): [number, number, number] {
  const dist = (a: number) => {
    let x = Math.abs(h - a) % 360;
    if (x > 180) x = 360 - x;
    return x;
  };
  const raw = [dist(0), dist(120), dist(240)].map(x => Math.max(0, 1 - x / 120));
  const s = raw[0] + raw[1] + raw[2] || 1;
  return [raw[0] / s, raw[1] / s, raw[2] / s];
}

// Full per-pixel analysis: ink (darkness), ws (character amount from
// saturation), w (hue crossfade weights for the 3 colored banks).
export function analyzeColor(r: number, g: number, b: number): { ink: number; ws: number; w: [number, number, number] } {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ink = 1 - lum;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1);
  const ws = sat < 0.12 ? 0 : Math.min(1, (sat - 0.12) / 0.68);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { ink, ws, w: ws > 0 ? hueWaveWeights(h) : [0, 0, 0] };
}

export type ColorGrid = {
  cols: number;
  rows: number;
  // Per-wave ink intensity, rows*cols each, 0..1
  sine: Float32Array;
  saw: Float32Array;
  tri: Float32Array;
  sqr: Float32Array;
};

// Analyze a composited frame into per-waveform ink grids.
export function gridFromCanvasColor(frame: HTMLCanvasElement, cols: number, rows: number): ColorGrid {
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, cols, rows);
  ctx.drawImage(frame, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const n = rows * cols;
  const sine = new Float32Array(n);
  const saw = new Float32Array(n);
  const tri = new Float32Array(n);
  const sqr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const { ink, ws, w } = analyzeColor(r, g, b);
    if (ink < 0.02) continue;
    sine[i] = ink * (1 - ws);
    if (ws > 0) {
      const wAmp = ink * ws;
      // Continuous crossfade — every hue is its own blend of the three
      // instruments (cuivre / flûte / carillon)
      saw[i] = wAmp * w[0];
      tri[i] = wAmp * w[1];
      sqr[i] = wAmp * w[2];
    }
  }
  return { cols, rows, sine, saw, tri, sqr };
}

// Waveform value from the harmonic recipes — partial sums, identical
// timbres to the live PeriodicWaves (export = what you hear). Normalized
// so each instrument peaks near ±1.
const RECIPES: Array<Array<[number, number]>> = [
  WAVE_HARMONICS.sine, WAVE_HARMONICS.saw, WAVE_HARMONICS.tri, WAVE_HARMONICS.sqr,
];
const RECIPE_NORM = RECIPES.map(rec => 1 / rec.reduce((s, [, a]) => s + a, 0));
function waveValue(w: number, p: number): number {
  const rec = RECIPES[w];
  let v = 0;
  for (let i = 0; i < rec.length; i++) v += rec[i][1] * Math.sin(rec[i][0] * p);
  return v * RECIPE_NORM[w];
}
const TWO_PI = Math.PI * 2;

// Color-aware additive synthesis → STEREO pair [left, right].
// opts.freqs: per-band frequencies (row 0 = top); defaults to log C2→C8.
// opts.gamma: amplitude response curve (>1 = more contrast, faint marks
// whisper / bold marks roar).
export function synthSpectroColor(
  grids: ColorGrid[],
  frameDur: number,
  sampleRate = 44100,
  opts: { freqs?: ArrayLike<number>; gamma?: number; fMin?: number; fMax?: number } = {},
): [Float32Array, Float32Array] {
  const fMin = opts.fMin ?? 65.41;
  const fMax = opts.fMax ?? 4186.01;
  const gamma = opts.gamma ?? 1;
  const frameSamples = Math.max(1, Math.round(frameDur * sampleRate));
  const total = Math.max(1, grids.length * frameSamples);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  if (grids.length === 0) return [L, R];
  const rows = grids[0].rows;
  const cols = grids[0].cols;

  const omega = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let f: number;
    if (opts.freqs && opts.freqs.length >= rows) {
      f = opts.freqs[r];
    } else {
      const frac = r / (rows - 1);
      f = fMax * Math.pow(fMin / fMax, frac);
    }
    // Human micro-detune (±0.15%) — removes electric-organ sterility
    f *= 1 + (Math.random() - 0.5) * 0.003;
    omega[r] = (TWO_PI * f) / sampleRate;
  }
  // Independent phase per (wave, band)
  const phases = [0, 1, 2, 3].map(() => {
    const p = new Float32Array(rows);
    for (let r = 0; r < rows; r++) p[r] = Math.random() * TWO_PI;
    return p;
  });
  const waveArrs = (g: ColorGrid) => [g.sine, g.saw, g.tri, g.sqr] as const;
  const trims = [WAVE_TRIM.sine, WAVE_TRIM.saw, WAVE_TRIM.tri, WAVE_TRIM.sqr];
  // Equal-power pan gains per wave
  const panL = new Float32Array(4), panR = new Float32Array(4);
  [WAVE_PAN.sine, WAVE_PAN.saw, WAVE_PAN.tri, WAVE_PAN.sqr].forEach((pan, w) => {
    const a = ((pan + 1) / 2) * (Math.PI / 2);
    panL[w] = Math.cos(a);
    panR[w] = Math.sin(a);
  });

  const EPS = 0.01;
  for (let gi = 0; gi < grids.length; gi++) {
    const g = grids[gi];
    const arrs = waveArrs(g);
    const base = gi * frameSamples;
    for (let col = 0; col < cols; col++) {
      const start = Math.round((col / cols) * frameSamples);
      const end = Math.round(((col + 1) / cols) * frameSamples);
      const blockLen = end - start;
      if (blockLen <= 0) continue;
      const colNext = Math.min(cols - 1, col + 1);
      for (let w = 0; w < 4; w++) {
        const arr = arrs[w];
        const ph = phases[w];
        const trim = trims[w];
        const gL = panL[w], gR = panR[w];
        for (let r = 0; r < rows; r++) {
          const raw0 = arr[r * cols + col];
          const raw1 = arr[r * cols + colNext];
          if (raw0 < EPS && raw1 < EPS) {
            ph[r] = (ph[r] + omega[r] * blockLen) % TWO_PI;
            continue;
          }
          const a0 = gamma === 1 ? raw0 : Math.pow(raw0, gamma);
          const a1 = gamma === 1 ? raw1 : Math.pow(raw1, gamma);
          let p = ph[r];
          const om = omega[r];
          const da = (a1 - a0) / blockLen;
          let a = a0 * trim;
          const daT = da * trim;
          for (let n = 0; n < blockLen; n++) {
            const v = a * waveValue(w, p);
            L[base + start + n] += v * gL;
            R[base + start + n] += v * gR;
            p += om;
            if (p >= TWO_PI) p -= TWO_PI;
            a += daT;
          }
          ph[r] = p;
        }
      }
    }
  }

  // Joint normalization to 0.9 peak
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (v > peak) peak = v;
  }
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < total; i++) { L[i] *= k; R[i] *= k; }
  }
  return [L, R];
}
