import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { api, ApiError, type ApiUser, type ProjectListItem } from "@/lib/api";

type Tool =
  | "pencil"
  | "line"
  | "rect"
  | "rect-fill"
  | "ellipse"
  | "ellipse-fill"
  | "fill"
  | "eyedropper"
  | "eraser"
  | "text"
  | "select"
  | "stamp";

// Default canvas dimensions (Amiga preset). The runtime size is held in
// `canvasW`/`canvasH` state — see RESOLUTIONS below for available presets.
const DEFAULT_W = 320;
const DEFAULT_H = 200;

const RESOLUTIONS = [
  { id: "amiga", label: "AMIGA",  w: 320,  h: 200  },
  { id: "4k",    label: "4K",     w: 3840, h: 2160 },
] as const;
// Above this width, frame-by-frame animated exports become impractical
// (30 fps × multi-MB-per-frame). UI disables them past this threshold.
const ANIM_EXPORT_MAX_W = 1920;

const AMIGA_PALETTE = [
  "#000000","#FFFFFF","#AAAAAA","#555555",
  "#FF0000","#00AA00","#0000CC","#FFFF00",
  "#FF8800","#FF00CC","#00CCCC","#AA4400",
  "#FF8888","#88FF88","#8888FF","#FFFF88",
  "#FF88FF","#88FFFF","#0033AA","#880000",
  "#005500","#884488","#002255","#553300",
  "#226600","#AA8800","#663300","#448866",
  "#FF4422","#44FF00","#0055FF","#FF0055",
];

// Commodore 64 — 16 colors, the historical canonical palette (PAL)
const C64_PALETTE = [
  "#000000","#FFFFFF","#880000","#AAFFEE",
  "#CC44CC","#00CC55","#0000AA","#EEEE77",
  "#DD8855","#664400","#FF7777","#333333",
  "#777777","#AAFF66","#0088FF","#BBBBBB",
];

// Original Game Boy DMG — 4 greens
const GAMEBOY_PALETTE = [
  "#0F380F","#306230","#8BAC0F","#9BBC0F",
];

// PICO-8 fantasy console — 16 carefully picked colors
const PICO8_PALETTE = [
  "#000000","#1D2B53","#7E2553","#008751",
  "#AB5236","#5F574F","#C2C3C7","#FFF1E8",
  "#FF004D","#FFA300","#FFEC27","#00E436",
  "#29ADFF","#83769C","#FF77A8","#FFCCAA",
];

// Pastel — soft modern set, useful for non-retro work
const PASTEL_PALETTE = [
  "#FFFFFF","#F8E1E7","#FCD5CE","#FFD6A5",
  "#FDFFB6","#CAFFBF","#9BF6FF","#A0C4FF",
  "#BDB2FF","#FFC6FF","#E0E0E0","#B5BFC9",
  "#737373","#3D3D3D","#000000","#5C2A5E",
];

// Neon — saturated club / cyberpunk
const NEON_PALETTE = [
  "#000000","#0A0033","#1B0050","#290080",
  "#FF00C8","#FF006E","#FF2D00","#FF7A00",
  "#FFE700","#A1FF00","#00FF85","#00FFEA",
  "#00B7FF","#3A00FF","#FFFFFF","#C0C0C0",
];

// Bauhaus — Itten / Kandinsky primary triad (red / yellow / blue) plus
// black / white and warm sand/ochre supporting tones. Sober and constructed.
const BAUHAUS_PALETTE = [
  "#FFFFFF","#F5F0E8","#E8E0CC","#C7B98C",
  "#FFD500","#F39200","#E2231A","#B41B14",
  "#5C1E1A","#2A2A2A","#000000","#5F5F5F",
  "#8A8A8A","#4A6FA5","#1E4DAC","#003D7A",
];

// Dada — aged paper / newsprint / collage. Sepias and sienna grounds
// with raw red, mustard and dirty teal splashes.
const DADA_PALETTE = [
  "#F5EDDD","#E8DDC4","#C9A878","#8C6E3D",
  "#6B4226","#3D2F1F","#1A1A1A","#000000",
  "#D32F2F","#8B2C20","#58202A","#C9A227",
  "#5A5C36","#2D3A1F","#3A5A6E","#4D6883",
];

// ---- THEME ----
type ThemeId = "light" | "night";
type ThemeColors = {
  bg: string;
  panel: string;
  panelText: string;
  menubar: string;
  menubarText: string;
  canvasBg: string;
  accent: string;
  border: string;
};
const THEMES: Record<ThemeId, ThemeColors> = {
  light: {
    bg: "#F0EFED",
    panel: "#FFFFFF",
    panelText: "#000000",
    menubar: "#191919",
    menubarText: "#F0EFED",
    canvasBg: "#191919",
    accent: "#000000",
    border: "#000000",
  },
  night: {
    // Refined / chic-sober palette. Warm near-black bg, slightly warmer
    // panel, off-white cream text. Accent is a deep burgundy red used
    // sparingly; structural borders are barely-there charcoal so the
    // chrome reads as discreet rather than fenced-in by red lines.
    bg: "#0E0E0E",
    panel: "#181818",
    panelText: "#E8DDD0",
    menubar: "#121212",
    menubarText: "#E8DDD0",
    canvasBg: "#000000",
    accent: "#C04849",         // muted burgundy
    border: "#2A2A2A",         // subtle charcoal, not red
  },
};

const PALETTES = [
  { id: "amiga",   label: "AMIGA",    colors: AMIGA_PALETTE,   width: 8 },
  { id: "c64",     label: "C64",      colors: C64_PALETTE,     width: 8 },
  { id: "pico8",   label: "PICO-8",   colors: PICO8_PALETTE,   width: 8 },
  { id: "gameboy", label: "GAME BOY", colors: GAMEBOY_PALETTE, width: 4 },
  { id: "pastel",  label: "PASTEL",   colors: PASTEL_PALETTE,  width: 8 },
  { id: "neon",    label: "NEON",     colors: NEON_PALETTE,    width: 8 },
  { id: "bauhaus", label: "BAUHAUS",  colors: BAUHAUS_PALETTE, width: 8 },
  { id: "dada",    label: "DADA",     colors: DADA_PALETTE,    width: 8 },
] as const;
type PaletteId = (typeof PALETTES)[number]["id"];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function drawPixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string
) {
  ctx.fillStyle = color;
  const half = Math.floor(size / 2);
  ctx.fillRect(x - half, y - half, size, size);
}

// -------------------- Brush shapes --------------------

type BrushShape = "square" | "round" | "diamond" | "cross" | "spray" | "bug" | "insect";

const BRUSH_SHAPES: { id: BrushShape; label: string; icon: IconName }[] = [
  { id: "square",  label: "CARRÉ",   icon: "shape-square" },
  { id: "round",   label: "ROND",    icon: "shape-round" },
  { id: "diamond", label: "DIAMANT", icon: "shape-diamond" },
  { id: "cross",   label: "CROIX",   icon: "shape-cross" },
  { id: "spray",   label: "SPRAY",   icon: "shape-spray" },
  { id: "bug",     label: "BUG",     icon: "shape-bug" },
  { id: "insect",  label: "INSECTE", icon: "shape-insect" },
];

// Stamp a single brush at (x, y). `color` is the active foreground; the
// shape's own random embellishments (spray dots, BUG ghosts) may pick
// extra colors. `angle` (radians) is the heading — only the INSECTE
// shape currently uses it to face the direction of cursor motion.
function stampBrush(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  shape: BrushShape,
  angle: number = 0,
) {
  const half = Math.floor(size / 2);
  ctx.fillStyle = color;
  switch (shape) {
    case "square": {
      ctx.fillRect(x - half, y - half, size, size);
      return;
    }
    case "round": {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "diamond": {
      const r = size / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "cross": {
      const thick = Math.max(1, Math.round(size / 3));
      const hh = Math.floor(thick / 2);
      ctx.fillRect(x - half, y - hh, size, thick);
      ctx.fillRect(x - hh, y - half, thick, size);
      return;
    }
    case "spray": {
      const r2 = size / 2;
      const dots = Math.max(4, Math.round(size * 1.5));
      for (let i = 0; i < dots; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * r2;
        const dx = Math.round(Math.cos(angle) * dist);
        const dy = Math.round(Math.sin(angle) * dist);
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
      return;
    }
    case "bug": {
      // Glitch: base square + RGB-shifted ghost stamps + scanline displacement
      // + scattered noise pixels. Each cycle is partially random so a held
      // line produces varied artifacts.
      ctx.fillRect(x - half, y - half, size, size);
      const shift = Math.max(2, Math.round(size / 3));
      if (Math.random() < 0.65) {
        ctx.fillStyle = "#FF0040";
        ctx.fillRect(x - half - shift, y - half - 1, size, size);
      }
      if (Math.random() < 0.65) {
        ctx.fillStyle = "#00E5FF";
        ctx.fillRect(x - half + shift, y - half + 1, size, size);
      }
      if (Math.random() < 0.35) {
        ctx.fillStyle = Math.random() < 0.5 ? "#FFFFFF" : "#000000";
        const sx = x - size - Math.floor(Math.random() * size);
        const syy = y + Math.round((Math.random() - 0.5) * size * 2);
        ctx.fillRect(sx, syy, size * 3, 1);
      }
      const noisePalette = ["#FF00FF", "#00FF00", "#FFFF00", "#000000", "#FFFFFF"];
      const n = Math.max(2, Math.round(size / 4));
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = noisePalette[Math.floor(Math.random() * noisePalette.length)];
        const px = x + Math.round((Math.random() - 0.5) * size * 2);
        const py = y + Math.round((Math.random() - 0.5) * size * 2);
        ctx.fillRect(px, py, 1, 1);
      }
      ctx.fillStyle = color;
      return;
    }
    case "insect": {
      // Top-down beetle: oval body + round head + 2 antennae + 6 legs.
      // The whole figure is rotated to face the cursor heading.
      const s = Math.max(6, size);          // tiny insects look like a dot, enforce a minimum
      const lw = Math.max(1, s * 0.06);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      // Legs (drawn first so the body covers their root)
      const legY = s * 0.28;
      const legLen = s * 0.45;
      for (let i = -1; i <= 1; i++) {
        const lx = i * s * 0.22;
        // Each pair of legs splays slightly forward / sideways / backward
        const splay = i * 0.25;
        // upper leg
        ctx.beginPath();
        ctx.moveTo(lx, -legY * 0.6);
        ctx.lineTo(lx + splay * legLen, -legY - legLen * 0.7);
        ctx.stroke();
        // lower leg
        ctx.beginPath();
        ctx.moveTo(lx, legY * 0.6);
        ctx.lineTo(lx + splay * legLen, legY + legLen * 0.7);
        ctx.stroke();
      }
      // Body — long oval pointing forward (positive x)
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.5, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Wing case division line down the back
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, 0);
      ctx.lineTo(s * 0.35, 0);
      ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
      // Head — small disc at the front
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s * 0.55, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      // Antennae
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(s * 0.66, -s * 0.06);
      ctx.lineTo(s * 0.95, -s * 0.32);
      ctx.moveTo(s * 0.66, s * 0.06);
      ctx.lineTo(s * 0.95, s * 0.32);
      ctx.stroke();
      ctx.restore();
      return;
    }
  }
}

// Stamp a brush along a Bresenham line. Samples every step pixels (~size/4)
// so big brushes don't redundantly stamp 1000s of times along a short move.
function stampLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: string,
  shape: BrushShape,
  fallbackAngle: number = 0,
): number {
  // Tiny square brush keeps the old fast path — drawLine with strokes is
  // crisper than stamping squares pixel-by-pixel and is what the original
  // pencil expected.
  if (shape === "square" && size <= 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y0 + 0.5);
    ctx.lineTo(x1 + 0.5, y1 + 0.5);
    ctx.stroke();
    return fallbackAngle;
  }
  // Heading for directional shapes (insect) — derived from the segment,
  // falls back to the caller's last-known angle when start==end.
  const segDx = x1 - x0, segDy = y1 - y0;
  const angle = (segDx === 0 && segDy === 0) ? fallbackAngle : Math.atan2(segDy, segDx);

  // For the insect brush we space stamps further apart so the line of
  // bugs doesn't overlap into mush; ~size apart works well.
  const insectStep = Math.max(2, Math.round(size * 0.8));

  const dx = Math.abs(segDx), dy = Math.abs(segDy);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  const step = shape === "insect" ? insectStep : Math.max(1, Math.floor(size / 4));
  let i = 0;
  const limit = (dx + dy) * 2 + 8;
  while (i <= limit) {
    if (i === 0 || i % step === 0 || (x === x1 && y === y1)) {
      stampBrush(ctx, x, y, size, color, shape, angle);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
    i++;
  }
  return angle;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  size: number,
  aliased: boolean = true
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = aliased ? "square" : "round";
  ctx.beginPath();
  const off = aliased ? 0.5 : 0;
  ctx.moveTo(x0 + off, y0 + off);
  ctx.lineTo(x1 + off, y1 + off);
  ctx.stroke();
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  size: number,
  filled: boolean,
  aliased: boolean = true
) {
  const rx = Math.min(x0, x1);
  const ry = Math.min(y0, y1);
  const rw = Math.abs(x1 - x0);
  const rh = Math.abs(y1 - y0);
  if (filled) {
    ctx.fillStyle = color;
    ctx.fillRect(rx, ry, rw, rh);
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = aliased ? "square" : "round";
    const off = aliased ? 0.5 : 0;
    ctx.strokeRect(rx + off, ry + off, rw, rh);
  }
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  size: number,
  filled: boolean,
  aliased: boolean = true
) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = aliased ? "square" : "round";
    ctx.stroke();
  }
}

function floodFill(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  fillHex: string
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
  const idx = (iy * w + ix) * 4;
  const tR = data[idx], tG = data[idx + 1], tB = data[idx + 2], tA = data[idx + 3];
  const fill = hexToRgb(fillHex);
  if (!fill) return;
  if (tR === fill.r && tG === fill.g && tB === fill.b && tA === 255) return;
  const stack: number[] = [ix + iy * w];
  const visited = new Uint8Array(w * h);
  while (stack.length > 0) {
    const pos = stack.pop()!;
    if (visited[pos]) continue;
    const cx = pos % w;
    const cy = Math.floor(pos / w);
    const pi = pos * 4;
    if (data[pi] !== tR || data[pi+1] !== tG || data[pi+2] !== tB || data[pi+3] !== tA) continue;
    visited[pos] = 1;
    data[pi] = fill.r; data[pi+1] = fill.g; data[pi+2] = fill.b; data[pi+3] = 255;
    if (cx > 0) stack.push(pos - 1);
    if (cx < w - 1) stack.push(pos + 1);
    if (cy > 0) stack.push(pos - w);
    if (cy < h - 1) stack.push(pos + w);
  }
  ctx.putImageData(imageData, 0, 0);
}

function clearCanvas(ctx: CanvasRenderingContext2D, color = "#FFFFFF") {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// ---- Layer model ----------------------------------------------------
// A Layer is a "track" — it spans every frame of the project, with its
// own offscreen canvas per frame. Drawing tools target the active layer
// at the current frame. The displayed canvas (canvasRef) is purely a
// composite (re-drawn after every modification).
type Layer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  // One offscreen canvas per frame. null = blank/transparent (lazy).
  frames: (HTMLCanvasElement | null)[];
};

function makeLayerCanvas(w: number, h: number, fill?: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  if (fill) {
    const cx = c.getContext("2d")!;
    cx.fillStyle = fill;
    cx.fillRect(0, 0, w, h);
  }
  return c;
}

function makeLayer(name: string, frameCount: number): Layer {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    visible: true,
    opacity: 1,
    frames: Array.from({ length: frameCount }, () => null),
  };
}

// Scan ImageData row by row and emit one <rect> per run of identical pixels.
// Returns just the rects — wrap in <svg> or <g> at the call site.
function imageDataToRects(img: ImageData): string {
  const w = img.width;
  const h = img.height;
  const data = img.data;
  const parts: string[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a === 0) { x++; continue; }
      const r = data[i], g = data[i + 1], b = data[i + 2];
      let runEnd = x + 1;
      while (runEnd < w) {
        const j = (y * w + runEnd) * 4;
        if (data[j] !== r || data[j + 1] !== g || data[j + 2] !== b || data[j + 3] !== a) break;
        runEnd++;
      }
      const fill = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
      const len = runEnd - x;
      const opacity = a < 255 ? ` fill-opacity="${(a / 255).toFixed(3)}"` : "";
      parts.push(`<rect x="${x}" y="${y}" width="${len}" height="1" fill="${fill}"${opacity}/>`);
      x = runEnd;
    }
  }
  return parts.join("");
}

function imageDataToSvg(img: ImageData): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${img.width} ${img.height}" shape-rendering="crispEdges">${imageDataToRects(img)}</svg>`;
}

// Build an animated SVG from a list of frames using SMIL.
// One <g> per frame, an <animate calcMode="discrete"> toggles its `display`
// attribute so only the active frame is rendered at any given time.
// Empty (null) frames render as blank.
function framesToAnimatedSvg(
  frames: (ImageData | null)[],
  w: number,
  h: number,
  fps: number,
  loop: boolean,
): string {
  const n = frames.length;
  if (n === 0) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"/>`;
  const dur = (n / Math.max(fps, 1)).toFixed(4);
  const repeat = loop ? "indefinite" : "1";
  const keyTimes = Array.from({ length: n }, (_, i) => (i / n).toFixed(4)).join(";");
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`);
  parts.push(`<rect width="${w}" height="${h}" fill="#FFFFFF"/>`); // opaque background so frames overlay cleanly
  for (let i = 0; i < n; i++) {
    const values = Array.from({ length: n }, (_, k) => k === i ? "inline" : "none").join(";");
    const initial = i === 0 ? "inline" : "none";
    const rects = frames[i] ? imageDataToRects(frames[i]!) : "";
    parts.push(`<g display="${initial}">`);
    parts.push(`<animate attributeName="display" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" repeatCount="${repeat}" fill="freeze"/>`);
    parts.push(rects);
    parts.push(`</g>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type IconName =
  | "pencil" | "line" | "rect" | "rect-fill" | "ellipse" | "ellipse-fill"
  | "fill" | "eyedropper" | "eraser" | "text" | "select" | "stamp"
  | "shape-square" | "shape-round" | "shape-diamond" | "shape-cross"
  | "shape-spray" | "shape-bug" | "shape-insect";

// Inline pixel-style SVG icons. All use currentColor so they pick up the
// theme automatically (cream in night mode, black in light mode). Drawn
// on a 24x24 grid with crispEdges for the chunky feel.
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    shapeRendering: "geometricPrecision" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "pencil": return (
      <svg {...common}><path d="M3 21 L7 17 L17 7 L17 7 L20 4 L20 4 L17 7" /><path d="M14 7 L17 10" /><path d="M3 21 L7 17" /></svg>
    );
    case "line": return (
      <svg {...common}><path d="M4 20 L20 4" /></svg>
    );
    case "rect": return (
      <svg {...common}><rect x="4" y="6" width="16" height="12" /></svg>
    );
    case "rect-fill": return (
      <svg {...common} fill="currentColor"><rect x="4" y="6" width="16" height="12" /></svg>
    );
    case "ellipse": return (
      <svg {...common}><ellipse cx="12" cy="12" rx="8" ry="6" /></svg>
    );
    case "ellipse-fill": return (
      <svg {...common} fill="currentColor"><ellipse cx="12" cy="12" rx="8" ry="6" stroke="none" /></svg>
    );
    case "fill": return (
      // Paint bucket: tilted bucket + drop
      <svg {...common}>
        <path d="M5 11 L13 3 L21 11 L13 19 Z" />
        <path d="M5 11 L13 19" />
        <circle cx="19" cy="18" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
    case "eyedropper": return (
      // Dropper barrel + tip
      <svg {...common}>
        <path d="M14 4 L20 10" />
        <path d="M16 6 L8 14 L6 18 L4 20 L6 18 L10 16 L18 8" />
      </svg>
    );
    case "eraser": return (
      // Slanted rubber + crumbs
      <svg {...common}>
        <path d="M4 18 L12 10 L18 16 L14 20 L6 20 Z" />
        <path d="M9 13 L15 19" />
      </svg>
    );
    case "text": return (
      <svg {...common}><path d="M6 5 L18 5 M12 5 L12 19 M9 19 L15 19" strokeWidth={2} /></svg>
    );
    case "select": return (
      // Dashed-rect marquee (selection)
      <svg {...common}><rect x="4" y="6" width="16" height="12" strokeDasharray="2 2" /></svg>
    );
    case "stamp": return (
      // Rubber stamp: round head + handle + base line
      <svg {...common}>
        <circle cx="12" cy="6" r="3" fill="currentColor" stroke="none" />
        <path d="M9 9 L8 16 L16 16 L15 9 Z" />
        <path d="M5 20 L19 20" strokeWidth={2} />
      </svg>
    );

    // ---- brush shapes ----
    case "shape-square": return (
      <svg {...common} fill="currentColor"><rect x="5" y="5" width="14" height="14" stroke="none" /></svg>
    );
    case "shape-round": return (
      <svg {...common} fill="currentColor"><circle cx="12" cy="12" r="7" stroke="none" /></svg>
    );
    case "shape-diamond": return (
      <svg {...common} fill="currentColor"><polygon points="12,3 21,12 12,21 3,12" stroke="none" /></svg>
    );
    case "shape-cross": return (
      <svg {...common} fill="currentColor"><path d="M10 3 H14 V10 H21 V14 H14 V21 H10 V14 H3 V10 H10 Z" stroke="none" /></svg>
    );
    case "shape-spray": return (
      // Scattered dots
      <svg {...common} fill="currentColor" stroke="none">
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="6" cy="9" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="16" cy="6" r="1" />
        <circle cx="19" cy="11" r="1" /><circle cx="18" cy="17" r="1" /><circle cx="12" cy="20" r="1" />
        <circle cx="5" cy="16" r="1" /><circle cx="4" cy="13" r="0.8" /><circle cx="15" cy="14" r="1" />
        <circle cx="9" cy="17" r="0.8" /><circle cx="20" cy="14" r="0.6" />
      </svg>
    );
    case "shape-bug": return (
      // Glitch: stacked offset rectangles
      <svg {...common} stroke="none">
        <rect x="5" y="5" width="12" height="12" fill="currentColor" opacity="0.4" />
        <rect x="7" y="7" width="12" height="12" fill="currentColor" />
        <rect x="3" y="11" width="18" height="2" fill="currentColor" opacity="0.6" />
      </svg>
    );
    case "shape-insect": return (
      // Beetle: oval body + head + antennae + legs, facing right
      <svg {...common}>
        <ellipse cx="11" cy="12" rx="6" ry="4" fill="currentColor" stroke="none" />
        <circle cx="17" cy="12" r="2.2" fill="currentColor" stroke="none" />
        {/* antennae */}
        <path d="M18.5 11 L22 8 M18.5 13 L22 16" strokeWidth={1.2} />
        {/* legs */}
        <path d="M8 8 L5 5 M11 8 L11 4 M14 8 L17 4" strokeWidth={1.2} />
        <path d="M8 16 L5 19 M11 16 L11 20 M14 16 L17 20" strokeWidth={1.2} />
      </svg>
    );
  }
}

const TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: "pencil",       label: "CRAYON",     icon: "pencil" },
  { id: "line",         label: "LIGNE",      icon: "line" },
  { id: "rect",         label: "RECT",       icon: "rect" },
  { id: "rect-fill",    label: "RECT PL",    icon: "rect-fill" },
  { id: "ellipse",      label: "ELLIPSE",    icon: "ellipse" },
  { id: "ellipse-fill", label: "ELLIPSE PL", icon: "ellipse-fill" },
  { id: "fill",         label: "REMPLIR",    icon: "fill" },
  { id: "eyedropper",   label: "PIPETTE",    icon: "eyedropper" },
  { id: "eraser",       label: "GOMME",      icon: "eraser" },
  { id: "text",         label: "TEXTE",      icon: "text" },
  { id: "select",       label: "SÉLECTION",  icon: "select" },
  { id: "stamp",        label: "TAMPON",     icon: "stamp" },
];

const BRUSH_SIZES = [1, 2, 4, 8, 16, 32, 64, 128];
const BRUSH_SIZE_MIN = 1;
const BRUSH_SIZE_MAX = 512;
// 320 × 12 = 3840 (4K width). Last level fills a 4K display horizontally.
const ZOOM_LEVELS = [1, 2, 4, 8, 12];

// Curated set of Google Fonts surfaced in the picker dropdown. The user
// can also type any exact name via "Autre…" if their favourite isn't here.
const POPULAR_GOOGLE_FONTS: { group: string; names: string[] }[] = [
  { group: "Pixel · Rétro", names: [
    "VT323", "Press Start 2P", "Silkscreen", "Pixelify Sans",
    "Major Mono Display", "Orbitron", "Bungee", "Monoton",
  ]},
  { group: "Display", names: [
    "Lobster", "Pacifico", "Righteous", "Audiowide", "Black Ops One",
    "Faster One", "Special Elite", "Abril Fatface",
  ]},
  { group: "Handwriting", names: [
    "Caveat", "Dancing Script", "Permanent Marker", "Indie Flower",
    "Satisfy", "Sacramento", "Kalam", "Shadows Into Light",
  ]},
  { group: "Sans", names: [
    "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
    "Raleway", "Ubuntu", "Nunito", "Work Sans", "Inter",
  ]},
  { group: "Serif", names: [
    "Playfair Display", "Merriweather", "Lora", "EB Garamond", "PT Serif",
  ]},
  { group: "Mono", names: [
    "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "Roboto Mono",
  ]},
];

const TEXT_FONTS: { label: string; family: string; pixel?: boolean }[] = [
  // Pixel-art webfonts (Amiga vibe)
  { label: "VT323",   family: "'VT323', monospace", pixel: true },
  { label: "8-BIT",   family: "'Press Start 2P', monospace", pixel: true },
  // HD system fonts — vector, rendered by the OS at any size, crisp on 4K
  { label: "SYSTÈME", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  { label: "SERIF",   family: "Georgia, 'Times New Roman', Times, serif" },
  { label: "MONO",    family: "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, 'Courier New', monospace" },
  { label: "INTER",   family: "'Inter', sans-serif" },
];
const TEXT_SIZES = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const TEXT_SIZE_MIN = 4;
const TEXT_SIZE_MAX = 1024;

function stampText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  text: string,
  family: string,
  size: number,
  aliased: boolean,
  isPixelFont: boolean,
) {
  ctx.save();
  // Pixel-art fonts pair with the aliased toggle (so they stay crisp);
  // HD fonts always render with smooth anti-aliasing — they're vector and
  // would look broken if forced into nearest-neighbor mode.
  const forceAliased = aliased && isPixelFont;
  ctx.imageSmoothingEnabled = !forceAliased;
  ctx.fillStyle = color;
  ctx.font = `${size}px ${family}`;
  ctx.textBaseline = "top";
  if (forceAliased) {
    (ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = "geometricPrecision";
  } else {
    (ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = "optimizeLegibility";
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

export default function Editor() {
  // Canvas dimensions are state so we can switch resolution at runtime.
  const [canvasW, setCanvasW] = useState(DEFAULT_W);
  const [canvasH, setCanvasH] = useState(DEFAULT_H);
  const canvasWRef = useRef(canvasW);
  const canvasHRef = useRef(canvasH);
  useEffect(() => { canvasWRef.current = canvasW; }, [canvasW]);
  useEffect(() => { canvasHRef.current = canvasH; }, [canvasH]);

  const [tool, setTool] = useState<Tool>("pencil");
  const [fgColor, setFgColor] = useState("#FF0000");
  const [bgColor, setBgColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(1);
  const [brushShape, setBrushShape] = useState<BrushShape>("square");
  const [zoom, setZoom] = useState(() => window.innerWidth <= 640 ? 1 : 2);
  const [fit, setFit] = useState(true);
  const [aliased, setAliased] = useState(true);
  const [paletteId, setPaletteId] = useState<PaletteId>("amiga");
  const [theme, setTheme] = useState<"light" | "night">("light");
  const [splashOpen, setSplashOpen] = useState(true);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  // RAF-throttled mousePos: pointer events fire at 60-120 Hz and every
  // setMousePos triggers a React render (whose layout-effect recomposites
  // the whole canvas — 33 MB at 4K). Coalesce to ≤1 state update per frame.
  const mousePosPendingRef = useRef<{ x: number; y: number } | null>(null);
  const mousePosRafRef = useRef<number | null>(null);
  function updateMousePos(pos: { x: number; y: number } | null) {
    mousePosPendingRef.current = pos;
    if (mousePosRafRef.current != null) return;
    mousePosRafRef.current = requestAnimationFrame(() => {
      mousePosRafRef.current = null;
      setMousePos(prev => {
        const next = mousePosPendingRef.current;
        if (prev && next && prev.x === next.x && prev.y === next.y) return prev;
        return next;
      });
    });
  }

  // ---- TABLE (turntable / panoramic loop drawing modes) ----
  // "turn": the canvas rotates under the brush like a record player —
  //         hold the pencil still and it draws arcs/spirals.
  // "pan":  the canvas scrolls horizontally and wraps — strokes wrap
  //         around the seam, ideal for seamless looping panoramas.
  // Visual only: exports stay unrotated / unshifted.
  const [spinMode, setSpinMode] = useState<"off" | "turn" | "pan">("off");
  const spinModeRef = useRef(spinMode);
  useEffect(() => { spinModeRef.current = spinMode; }, [spinMode]);
  const [spinSpeed, setSpinSpeed] = useState(25);   // -100..100 (% of max)
  const spinSpeedRef = useRef(spinSpeed);
  useEffect(() => { spinSpeedRef.current = spinSpeed; }, [spinSpeed]);
  const spinAngleRef = useRef(0);   // degrees (turn mode)
  const panOffsetRef = useRef(0);   // canvas px (pan mode)
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  // Raw client coords of the last pointer/touch event — the continuous-
  // stamping RAF re-maps them through the live rotation/offset.
  const lastClientRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // Rotation angle at the last stamp — lets the RAF subdivide the arc
  // travelled since then into small chords (smooth spirals at high RPM).
  const lastStampAngleRef = useRef<number>(0);
  // PANO repaint gating: the offset advances fractionally but only integer
  // changes are visible. Track the last drawn offset + a dirty flag set by
  // strokes so slow speeds don't recomposite 60×/s for identical pixels.
  const lastPanDrawnRef = useRef(-1);
  const panDirtyRef = useRef(false);

  // TABLE driver: one RAF that (a) advances the rotation / pan offset,
  // (b) applies the visual (CSS rotate for turn — GPU-cheap; recomposite
  // for pan), and (c) keeps the stroke flowing while the pointer is held
  // still — because the canvas is moving underneath it (spin-art!).
  useEffect(() => {
    if (spinMode === "off") {
      if (canvasWrapRef.current) canvasWrapRef.current.style.transform = "";
      panOffsetRef.current = 0;
      spinAngleRef.current = 0;
      composite();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const sp = spinSpeedRef.current;
      if (spinModeRef.current === "turn") {
        // ±100% → ±240°/s (40 RPM max)
        spinAngleRef.current = (spinAngleRef.current + sp * 2.4 * dt) % 360;
        const wEl = canvasWrapRef.current;
        if (wEl) wEl.style.transform = `rotate(${spinAngleRef.current}deg)`;
      } else {
        // ±100% → one full loop every 4 s
        const W = canvasWRef.current;
        panOffsetRef.current = (((panOffsetRef.current + (sp / 100) * (W / 4) * dt) % W) + W) % W;
        // Composite NOW (we're already in a RAF) — but only when the
        // visible integer offset moved or a stroke dirtied the frame.
        // At slow speeds this skips most ticks entirely.
        const rounded = Math.round(panOffsetRef.current) % W;
        if (rounded !== lastPanDrawnRef.current || panDirtyRef.current) {
          composite();
          lastPanDrawnRef.current = rounded;
          panDirtyRef.current = false;
        }
      }
      // Continuous stroke while pointer held (skip during move/paste drags)
      if (drawingRef.current && lastClientRef.current && !movingRef.current && !pasteDragRef.current) {
        const t = toolRef.current;
        if (t === "pencil" || t === "eraser") {
          const ctx = getCtx();
          if (ctx) {
            const lc = lastClientRef.current;
            const c = t === "eraser" ? bgColorRef.current : fgColorRef.current;
            const shape: BrushShape = t === "eraser" ? "square" : brushShapeRef.current;
            const sz = brushSizeRef.current;
            if (spinModeRef.current === "turn") {
              // ARC SUBDIVISION: between two RAF ticks the canvas rotated
              // by Δ degrees; a single chord between the two mapped points
              // cuts across the arc and makes fast spirals polygonal.
              // Sample the mapping at intermediate angles (≤2° steps) so
              // the stroke follows the true circular path.
              const curAngle = spinAngleRef.current;
              let delta = curAngle - lastStampAngleRef.current;
              delta = ((delta + 540) % 360) - 180; // normalize to [-180, 180]
              const steps = Math.min(48, Math.max(1, Math.ceil(Math.abs(delta) / 2)));
              let prev = lastPosRef.current ?? mapClientToCanvas(lc.clientX, lc.clientY, lastStampAngleRef.current);
              let moved = false;
              for (let i = 1; i <= steps; i++) {
                const a = lastStampAngleRef.current + (delta * i) / steps;
                const p = mapClientToCanvas(lc.clientX, lc.clientY, a);
                if (p.x !== prev.x || p.y !== prev.y) {
                  lastAngleRef.current = stampLineWrapped(ctx, prev.x, prev.y, p.x, p.y, sz, c, shape, lastAngleRef.current);
                  prev = p;
                  moved = true;
                }
              }
              lastStampAngleRef.current = curAngle;
              if (moved) {
                lastPosRef.current = prev;
                saveLiveCanvas();
              }
            } else {
              const pos = mapClientToCanvas(lc.clientX, lc.clientY);
              const lastP = lastPosRef.current;
              if (!lastP || lastP.x !== pos.x || lastP.y !== pos.y) {
                lastAngleRef.current = stampLineWrapped(ctx, (lastP ?? pos).x, (lastP ?? pos).y, pos.x, pos.y, sz, c, shape, lastAngleRef.current);
                lastPosRef.current = pos;
                saveLiveCanvas();
              }
            }
          }
        } else if (t === "stamp" && clipboardRef.current) {
          const pos = mapClientToCanvas(lastClientRef.current.clientX, lastClientRef.current.clientY);
          const cb = clipboardRef.current;
          const lastS = lastStampPosRef.current;
          const step = Math.max(8, Math.round(Math.max(cb.canvas.width, cb.canvas.height) * stampScaleRef.current * 0.6));
          if (!lastS || Math.hypot(pos.x - lastS.x, pos.y - lastS.y) >= step) {
            stampClipboardAt(pos.x, pos.y);
            lastStampPosRef.current = pos;
            saveLiveCanvas();
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // canvasW/H in deps so getCtx's closure refreshes after a RÉSO switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinMode, canvasW, canvasH]);

  // ---- Cloud project state (login + project manager) ----
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  // Currently-loaded cloud project (so SAVER posts an UPDATE, not a new row)
  const [cloudProject, setCloudProject] = useState<{ id: string; name: string; ownerId: string } | null>(null);
  // Fetch current user on mount
  useEffect(() => {
    api.me().then(r => setCurrentUser(r.user)).catch(() => setCurrentUser(null));
  }, []);
  // If the URL is /p/:id, fetch and load that project on mount
  useEffect(() => {
    const m = window.location.pathname.match(/^\/p\/([A-Za-z0-9-]+)/);
    if (!m) return;
    const id = m[1];
    api.getProject(id).then(r => {
      loadProjectData(r.project.data, r.project.name);
      setCloudProject({ id: r.project.id, name: r.project.name, ownerId: r.project.ownerId });
    }).catch(err => {
      console.error("Failed to load shared project:", err);
      // Reset URL so subsequent navigation isn't stuck on a broken /p/:id
      window.history.replaceState({}, "", "/");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePalette = PALETTES.find(p => p.id === paletteId) ?? PALETTES[0];
  const t = THEMES[theme];

  // Touch-friendly sizing: on coarse pointers (iPad, phones) the 16px
  // palette swatches are far below the ~44pt touch-target guideline.
  const isCoarsePointer = useMemo(
    () => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false),
    [],
  );
  const swatchSize = isCoarsePointer ? 30 : 16;

  // Text-tool state (tampon / stamp mode)
  const [textInput, setTextInput] = useState("TEXTE");
  const [textFontIdx, setTextFontIdx] = useState(0);
  const [textSize, setTextSize] = useState(16);
  // User-added Google Fonts — appended to TEXT_FONTS. Persisted in
  // localStorage so they survive reloads.
  const [googleFonts, setGoogleFonts] = useState<{ label: string; family: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem("dpaint-google-fonts") || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("dpaint-google-fonts", JSON.stringify(googleFonts)); } catch {}
  }, [googleFonts]);
  // Combined font list (TEXT_FONTS + user-added Google Fonts)
  const allFonts = useMemo(() => [
    ...TEXT_FONTS,
    ...googleFonts.map(f => ({ ...f, pixel: false })),
  ], [googleFonts]);
  const allFontsRef = useRef(allFonts);
  useEffect(() => { allFontsRef.current = allFonts; }, [allFonts]);

  // Inject the Google Fonts stylesheet for a given family name. Idempotent.
  function loadGoogleFontStylesheet(family: string) {
    const safe = encodeURIComponent(family.replace(/\s+/g, "+"));
    const href = `https://fonts.googleapis.com/css2?family=${safe}&display=swap`;
    if (document.querySelector(`link[data-google-font="${family}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-google-font", family);
    document.head.appendChild(link);
  }
  // Re-load every persisted font on mount
  useEffect(() => {
    googleFonts.forEach(f => {
      // family is stored as `"Roboto", sans-serif` — extract the bare name
      const m = f.family.match(/^"([^"]+)"/);
      if (m) loadGoogleFontStylesheet(m[1]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAndAddGoogleFont(family: string) {
    family = family.trim();
    if (!family) return;
    loadGoogleFontStylesheet(family);
    try { await document.fonts.load(`16px "${family}"`); } catch {}
    if (!document.fonts.check(`16px "${family}"`)) {
      alert(`Police "${family}" introuvable sur Google Fonts.\nVérifie l'orthographe exacte sur https://fonts.google.com.`);
      return;
    }
    const familySpec = `"${family}", sans-serif`;
    // Already loaded — just switch to it
    const existing = googleFonts.findIndex(f => f.family === familySpec);
    if (existing >= 0) {
      setTextFontIdx(TEXT_FONTS.length + existing);
      return;
    }
    const added = { label: family.toUpperCase().slice(0, 14), family: familySpec };
    setGoogleFonts(prev => {
      const next = [...prev, added];
      setTextFontIdx(TEXT_FONTS.length + next.length - 1);
      return next;
    });
  }

  async function handleAddGoogleFont() {
    const raw = prompt(
      "Nom de la police Google Fonts (orthographe exacte, ex : Roboto, Bungee, Lobster, Press Start 2P, Caveat) :",
      "Roboto",
    );
    if (!raw) return;
    await loadAndAddGoogleFont(raw);
  }

  function handleRemoveGoogleFont(idx: number) {
    setGoogleFonts(prev => prev.filter((_, i) => i !== idx));
    // If the active font was removed or shifted, reset to the first preset
    if (textFontIdx >= TEXT_FONTS.length + idx) setTextFontIdx(0);
  }

  // Selection state. A selection is either a rectangle or a polygon
  // (lasso); both carry their bounding box for clipboard / crop ops.
  type Selection =
    | { kind: "rect";  x: number; y: number; w: number; h: number }
    | { kind: "lasso"; points: { x: number; y: number }[]; bbox: { x: number; y: number; w: number; h: number } };
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const antsOffsetRef = useRef(0);
  // Mode toggle for the SÉLECTION tool
  const [selectMode, setSelectMode] = useState<"rect" | "lasso">("rect");
  const selectModeRef = useRef(selectMode);
  // In-progress lasso path while dragging
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  // While the user is dragging an existing selection: the lifted pixels +
  // the original sel position and the mouse-down position. Cleared on
  // mouseup (commits the float) or cancellation.
  const movingRef = useRef<{ float: HTMLCanvasElement; startMouseX: number; startMouseY: number; startSelX: number; startSelY: number } | null>(null);
  // Clipboard for copy/paste. Stored as an offscreen canvas so masked
  // (lasso) copies keep their alpha; .x/.y remember the original position
  // so PASTE can drop it back in place.
  const clipboardRef = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);
  // Undo / redo — per-frame ImageData snapshots, trimmed to a memory
  // budget so a 4K canvas (33MB per snapshot) doesn't OOM the tab.
  const historyRef = useRef<Map<number, { undo: HTMLCanvasElement[]; redo: HTMLCanvasElement[] }>>(new Map());
  const UNDO_MEM_BUDGET = 100 * 1024 * 1024; // 100 MB per frame
  const [historyTick, setHistoryTick] = useState(0); // bumps to re-enable/disable buttons
  const [clipboardKey, setClipboardKey] = useState(0); // bumps to re-render the COLLER button enabled state
  // Floating paste — when non-null, the pasted bitmap is shown as a
  // movable preview on the overlay. It's committed to the frame only
  // when the user clicks outside, presses Enter / a tool button, or
  // selects another tool. ESC aborts without committing.
  const [pasteFloat, setPasteFloat] = useState<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);
  const pasteFloatRef = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);
  // Mouse-drag state while the user is repositioning the paste float
  const pasteDragRef = useRef<{ startMouseX: number; startMouseY: number; startFloatX: number; startFloatY: number } | null>(null);
  // TAMPON tool — uses the clipboard as a stamp. Scale lets the user
  // re-size before stamping; lastStampPos lets drag-stamp space marks
  // out so they don't overlap on rapid mouse moves.
  const [stampScale, setStampScale] = useState(1);
  const stampScaleRef = useRef(1);
  useEffect(() => { stampScaleRef.current = stampScale; }, [stampScale]);
  const lastStampPosRef = useRef<{ x: number; y: number } | null>(null);

  // Animation state
  const [frameCount, setFrameCount] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(6);
  const [looping, setLooping] = useState(true);
  // Scratch / scrub mode (used during REC for "vinyl-style" playback control)
  const [playDir, setPlayDir] = useState<1 | -1>(1);  // forward / reverse
  const [playSpeed, setPlaySpeed] = useState<1 | 2 | 4>(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Layer model — see Layer type above. layersRef is the single source of
  // truth for project pixels; each layer holds one offscreen canvas per
  // frame. The displayed <canvas> is purely a composite refreshed by
  // composite() after every modification.
  const layersRef = useRef<Layer[]>([makeLayer("CALQUE 1", 1)]);
  const [activeLayerIdx, setActiveLayerIdx] = useState(0);
  const activeLayerIdxRef = useRef(0);
  useEffect(() => { activeLayerIdxRef.current = activeLayerIdx; }, [activeLayerIdx]);
  // Bumped whenever layer metadata or content changes so panel UI / thumbnails re-render
  const [layerVersion, setLayerVersion] = useState(0);
  const bumpLayers = () => setLayerVersion(v => v + 1);

  // Legacy helpers kept as wrappers so the dozens of call sites still compile.
  // - liveDataRef is no longer used (layer canvases ARE the persistent storage)
  // - saveCurrentFrame / saveLiveCanvas become no-ops
  // - loadFrame is just composite()
  const liveDataRef = useRef<ImageData | null>(null); // deprecated, kept for type compat
  void liveDataRef;
  const drawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastAngleRef = useRef(0); // remembered cursor heading — directional brushes (INSECTE) reuse it for the down-stamp
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playRafRef = useRef<number | null>(null);
  const playLastTimeRef = useRef<number>(0);
  const playAccumRef = useRef<number>(0);
  const currentFrameRef = useRef(0);
  const frameCountRef = useRef(1);
  const fpsRef = useRef(fps);
  const loopingRef = useRef(looping);
  const playDirRef = useRef<1 | -1>(1);
  const playSpeedRef = useRef<1 | 2 | 4>(1);

  // Video recording (magnétoscope)
  const [recording, setRecording] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef<number>(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);
  useEffect(() => { frameCountRef.current = frameCount; }, [frameCount]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { playDirRef.current = playDir; }, [playDir]);
  useEffect(() => { playSpeedRef.current = playSpeed; }, [playSpeed]);

  // Initialize canvas — composite the empty starting frame
  useEffect(() => {
    composite();
  }, []);

  // Apply imageSmoothingEnabled when aliased toggles (affects scaled draws / putImageData blits)
  useEffect(() => {
    const ctx = getCtx();
    const overlay = getOverlayCtx();
    if (ctx) ctx.imageSmoothingEnabled = !aliased;
    if (overlay) overlay.imageSmoothingEnabled = !aliased;
  }, [aliased]);

  // FIT mode: auto-scale zoom so the canvas fills the available area on
  // every container resize. Integer zoom keeps pixels crisp; fall back to
  // fractional only when the area is smaller than one logical canvas (mobile).
  useEffect(() => {
    if (!fit) return;
    const area = canvasAreaRef.current;
    if (!area) return;
    const MARGIN = 32; // matches the 16px margin on the inner wrapper, both sides
    const compute = () => {
      const w = area.clientWidth - MARGIN;
      const h = area.clientHeight - MARGIN;
      if (w <= 0 || h <= 0) return;
      const fitW = w / canvasW;
      const fitH = h / canvasH;
      const raw = Math.min(fitW, fitH);
      const next = raw >= 1 ? Math.floor(raw) : raw;
      setZoom(prev => Math.abs(prev - next) < 0.001 ? prev : next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(area);
    return () => ro.disconnect();
  }, [fit, canvasW, canvasH]);

  // Layer helpers ----------------------------------------------------

  // Return the displayed <canvas>'s 2D context (read-only for our model:
  // we never draw onto it directly, composite() rebuilds it from layers).
  function getDisplayCtx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  // Get (and lazily allocate) the active layer's offscreen canvas at the
  // current frame. Drawing tools always target this.
  function getActiveCanvas(): HTMLCanvasElement | null {
    const layer = layersRef.current[activeLayerIdxRef.current];
    if (!layer) return null;
    const f = currentFrameRef.current;
    let c = layer.frames[f];
    if (!c) {
      c = makeLayerCanvas(canvasW, canvasH);
      layer.frames[f] = c;
    } else if (c.width !== canvasW || c.height !== canvasH) {
      // Resolution changed since this canvas was created — allocate fresh
      const fresh = makeLayerCanvas(canvasW, canvasH);
      const fctx = fresh.getContext("2d")!;
      fctx.imageSmoothingEnabled = false;
      fctx.drawImage(c, 0, 0, fresh.width, fresh.height);
      c = fresh;
      layer.frames[f] = c;
    }
    return c;
  }

  // The main tool entry point — kept named getCtx so existing draw sites
  // don't have to change. Returns the ACTIVE LAYER's context.
  function getCtx() {
    return getActiveCanvas()?.getContext("2d") ?? null;
  }

  function getOverlayCtx() {
    return overlayRef.current?.getContext("2d") ?? null;
  }

  // Composite all visible layers (in order) at the current frame onto the
  // displayed canvas. White background fill so frame transparency reads
  // as "the project's paper", consistent with the original Amiga look.
  function composite() {
    const dctx = getDisplayCtx();
    if (!dctx) return;
    dctx.save();
    dctx.imageSmoothingEnabled = false;
    dctx.fillStyle = "#FFFFFF";
    dctx.fillRect(0, 0, canvasW, canvasH);
    const f = currentFrameRef.current;
    // PANO mode: the view scrolls by panOffset and wraps — draw each layer
    // twice (shifted + the wrap-around copy). Exports are NOT affected
    // (compositeFrameToCanvas has no offset).
    const off = spinModeRef.current === "pan" ? Math.round(panOffsetRef.current) % canvasW : 0;
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      const c = layer.frames[f];
      if (!c) continue;
      dctx.globalAlpha = layer.opacity;
      if (off === 0) {
        dctx.drawImage(c, 0, 0);
      } else {
        dctx.drawImage(c, -off, 0);
        dctx.drawImage(c, canvasW - off, 0);
      }
    }
    dctx.restore();
  }

  // Recomposite when something that affects the displayed pixels changes.
  // This used to run after EVERY render (and mousePos updates render at up
  // to 60 Hz), which at 4K meant 33 MB of pixel writes per hover event.
  // The canvas element is only wiped by the browser when its width/height
  // attributes change — covered by the canvasW/canvasH deps; pixel-content
  // changes during strokes go through saveLiveCanvas → scheduleComposite.
  // PANO mode is excluded: its RAF already repaints every frame.
  useLayoutEffect(() => {
    if (spinModeRef.current === "pan") return;
    composite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrame, layerVersion, canvasW, canvasH, zoom, fit]);

  // Composite an arbitrary frame index to a fresh offscreen canvas
  // (used by exports / thumbnails — anything outside the live display).
  function compositeFrameToCanvas(idx: number): HTMLCanvasElement {
    const off = document.createElement("canvas");
    off.width = canvasW;
    off.height = canvasH;
    const cx = off.getContext("2d")!;
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = "#FFFFFF";
    cx.fillRect(0, 0, canvasW, canvasH);
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      const c = layer.frames[idx];
      if (!c) continue;
      cx.globalAlpha = layer.opacity;
      cx.drawImage(c, 0, 0);
    }
    return off;
  }
  function compositeFrameToImageData(idx: number): ImageData {
    const c = compositeFrameToCanvas(idx);
    return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  }

  // Thumbnail cache — tiny 48×30 canvases built by drawing each visible
  // layer DIRECTLY at thumbnail scale (GPU drawImage). The previous
  // implementation materialized a full-resolution ImageData per frame per
  // render — at 4K that's a 33 MB GPU→CPU readback × frameCount × 60 Hz,
  // the single biggest source of instability on big canvases.
  //
  // Validity:
  //   - Per-frame invalidation in saveLiveCanvas() (frame just edited)
  //   - Structural changes (layers, frame count, dims) wipe the cache
  //   - Cache is used during edit AND playback — invalidation keeps it
  //     honest, and a 48×30 rebuild costs microseconds anyway
  const THUMB_W = 48, THUMB_H = 30;
  const thumbCacheRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  useEffect(() => {
    thumbCacheRef.current.clear();
  }, [layerVersion, frameCount, canvasW, canvasH]);
  function getThumbForRender(i: number): HTMLCanvasElement {
    const cached = thumbCacheRef.current.get(i);
    if (cached) return cached;
    const c = document.createElement("canvas");
    c.width = THUMB_W;
    c.height = THUMB_H;
    const cx = c.getContext("2d")!;
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = "#FFFFFF";
    cx.fillRect(0, 0, THUMB_W, THUMB_H);
    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      const lc = layer.frames[i];
      if (!lc) continue;
      cx.globalAlpha = layer.opacity;
      cx.drawImage(lc, 0, 0, THUMB_W, THUMB_H);
    }
    cx.globalAlpha = 1;
    thumbCacheRef.current.set(i, c);
    return c;
  }
  // Project-wide frame count is derived from the first layer's frames.
  function frameCountOf() { return layersRef.current[0]?.frames.length ?? 1; }
  // Returns true if any layer has any non-null frame (used to decide
  // whether to show "rescale frames" confirms etc.).
  function hasAnyContent() {
    return layersRef.current.some(l => l.frames.some(f => f !== null));
  }

  // ---- Layer mutations -----------------------------------------------
  function addNewLayer() {
    const layers = layersRef.current;
    const newName = `CALQUE ${layers.length + 1}`;
    const fc = frameCountOf();
    layers.splice(activeLayerIdxRef.current + 1, 0, makeLayer(newName, fc));
    setActiveLayerIdx(activeLayerIdxRef.current + 1);
    activeLayerIdxRef.current = activeLayerIdxRef.current + 1;
    bumpLayers();
    composite();
  }
  function deleteLayer(idx: number) {
    const layers = layersRef.current;
    if (layers.length <= 1) return;
    layers.splice(idx, 1);
    const newActive = Math.min(activeLayerIdxRef.current, layers.length - 1);
    setActiveLayerIdx(newActive);
    activeLayerIdxRef.current = newActive;
    bumpLayers();
    composite();
  }
  function selectLayer(idx: number) {
    setActiveLayerIdx(idx);
    activeLayerIdxRef.current = idx;
    // Undo history is captured per active layer's pixels; switching the
    // active layer would let an undo restore the wrong layer. Reset.
    historyRef.current.clear();
    setHistoryTick(k => k + 1);
    bumpLayers();
  }
  function toggleLayerVisible(idx: number) {
    const l = layersRef.current[idx];
    if (!l) return;
    l.visible = !l.visible;
    bumpLayers();
    composite();
  }
  function setLayerOpacity(idx: number, opacity: number) {
    const l = layersRef.current[idx];
    if (!l) return;
    l.opacity = Math.max(0, Math.min(1, opacity));
    bumpLayers();
    composite();
  }
  function renameLayer(idx: number, name: string) {
    const l = layersRef.current[idx];
    if (!l) return;
    l.name = name.trim().slice(0, 24) || `CALQUE ${idx + 1}`;
    bumpLayers();
  }

  // Map client (screen) coords → canvas pixel coords, accounting for the
  // active TABLE mode:
  // - turn: invert the CSS rotation around the canvas center (the AABB
  //   center of a rotated element IS the rotation center, so it's stable)
  // - pan:  add the wrap offset modulo canvas width
  // Uses zoomRef / canvasW/H refs so the same math also works from RAF
  // callbacks that outlive a render.
  // angleDegOverride lets the turn-mode arc-subdivision sample the mapping
  // at intermediate rotation angles between two RAF ticks.
  function mapClientToCanvas(clientX: number, clientY: number, angleDegOverride?: number): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const z = zoomRef.current;
    const mode = spinModeRef.current;
    if (mode === "turn") {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const a = (-(angleDegOverride ?? spinAngleRef.current) * Math.PI) / 180;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const ux = dx * Math.cos(a) - dy * Math.sin(a);
      const uy = dx * Math.sin(a) + dy * Math.cos(a);
      return {
        x: Math.floor(ux / z + canvasWRef.current / 2),
        y: Math.floor(uy / z + canvasHRef.current / 2),
      };
    }
    let x = Math.floor((clientX - rect.left) / z);
    const y = Math.floor((clientY - rect.top) / z);
    if (mode === "pan") {
      const w = canvasWRef.current;
      x = (((x + Math.round(panOffsetRef.current)) % w) + w) % w;
    }
    return { x, y };
  }

  function getCanvasCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
    return mapClientToCanvas(e.clientX, e.clientY);
  }

  function getTouchCoords(touch: Touch): { x: number; y: number } {
    return mapClientToCanvas(touch.clientX, touch.clientY);
  }

  // Layer-aware shims for the old per-frame functions. saveCurrentFrame
  // is a no-op (layer canvases ARE the storage). saveLiveCanvas was
  // called at every drawing site to snapshot the canvas; now it just
  // triggers a recomposite so the displayed canvas reflects the latest
  // change to the active layer. loadFrame just composites the new frame.
  function saveCurrentFrame() { /* no-op */ }
  // RAF-throttled composite: multiple drawing events within one animation
  // frame collapse into a single display refresh. Crucial at 4K, where
  // each composite() reads/writes ~33 MB of pixels.
  const compositeRafRef = useRef<number | null>(null);
  function scheduleComposite() {
    if (compositeRafRef.current != null) return;
    compositeRafRef.current = requestAnimationFrame(() => {
      compositeRafRef.current = null;
      composite();
    });
  }
  function saveLiveCanvas() {
    // In PANO mode the spin RAF owns repainting — flag the stroke so its
    // next tick composites even if the offset hasn't visibly moved.
    if (spinModeRef.current === "pan") {
      panDirtyRef.current = true;
    } else {
      scheduleComposite();
    }
    // Invalidate the thumbnail cache for the frame we just modified so
    // the next render (or the next playback start) recomputes it.
    thumbCacheRef.current.delete(currentFrameRef.current);
  }
  function loadFrame(_idx: number) { composite(); /* immediate — frame switch should be visible right away */ }

  function switchToFrame(idx: number) {
    saveCurrentFrame();
    setCurrentFrame(idx);
    currentFrameRef.current = idx;
    loadFrame(idx);
  }

  // Animation playback
  function startPlayback() {
    // requestAnimationFrame + a time accumulator gives smoother frame
    // timing than setInterval (which drifts and queues backed-up calls
    // when a tick takes longer than the interval).
    if (playRafRef.current != null) cancelAnimationFrame(playRafRef.current);
    if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
    // Reset the thumb cache so the very first PLAY render captures fresh
    // composites (covers the "drew on a frame then hit PLAY without any
    // intervening re-render" case).
    thumbCacheRef.current.clear();
    setPlaying(true);
    let f = currentFrameRef.current;
    playLastTimeRef.current = performance.now();
    playAccumRef.current = 0;
    const loop = (now: number) => {
      const dt = now - playLastTimeRef.current;
      playLastTimeRef.current = now;
      playAccumRef.current += dt;
      const interval = Math.max(20, 1000 / (fpsRef.current * playSpeedRef.current));
      // Catch up by at most a few frames to avoid death-spirals on slow tabs
      let safety = 4;
      while (playAccumRef.current >= interval && safety-- > 0) {
        playAccumRef.current -= interval;
        const n = frameCountRef.current;
        const dir = playDirRef.current;
        const next = (f + dir + n) % n;
        if (!loopingRef.current && ((dir > 0 && next === 0) || (dir < 0 && next === n - 1))) {
          stopPlayback();
          return;
        }
        f = next;
        currentFrameRef.current = f;
        setCurrentFrame(f);
        composite();
      }
      // If we skipped ahead because of large dt, drop the remainder so we
      // don't keep stuttering
      if (playAccumRef.current > interval * 4) playAccumRef.current = 0;
      playRafRef.current = requestAnimationFrame(loop);
    };
    playRafRef.current = requestAnimationFrame(loop);
  }

  function stopPlayback() {
    if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
    if (playRafRef.current != null) { cancelAnimationFrame(playRafRef.current); playRafRef.current = null; }
    setPlaying(false);
  }

  // Restart playback when fps / direction / speed change so the interval picks up the new rate
  useEffect(() => {
    if (playing) {
      startPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fps, playDir, playSpeed]);

  // Video recording (magnétoscope) - records the canvas in real-time
  function startRecording() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof (canvas as HTMLCanvasElement & { captureStream?: () => MediaStream }).captureStream !== "function") {
      alert("Votre navigateur ne supporte pas l'enregistrement vidéo du canvas.");
      return;
    }
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(30);
    const mimeCandidates = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc1",
      "video/mp4;codecs=h264",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = typeof MediaRecorder !== "undefined"
      ? (mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "")
      : "";
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      alert("Impossible de démarrer l'enregistrement: " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    const actualMime = recorder.mimeType || mimeType || "video/webm";
    const ext = actualMime.includes("mp4") ? "mp4" : "webm";
    recChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recChunksRef.current, { type: actualMime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `dpaint-session-${ts}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      recChunksRef.current = [];
    };
    mediaRecorderRef.current = recorder;
    recorder.start(250);
    recStartRef.current = Date.now();
    setRecDuration(0);
    setRecording(true);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    recTimerRef.current = setInterval(() => {
      setRecDuration(Math.floor((Date.now() - recStartRef.current) / 1000));
    }, 250);
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      recorder.stream.getTracks().forEach(t => t.stop());
    }
    mediaRecorderRef.current = null;
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    setRecording(false);
  }

  // Stop recording on unmount
  useEffect(() => {
    return () => {
      const rec = mediaRecorderRef.current;
      if (rec) {
        try { if (rec.state !== "inactive") rec.stop(); } catch {}
        try { rec.stream.getTracks().forEach(t => t.stop()); } catch {}
      }
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, []);

  // Stop playback on unmount
  useEffect(() => () => {
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    if (playRafRef.current != null) cancelAnimationFrame(playRafRef.current);
  }, []);

  // Add blank frame
  function addFrame() {
    stopPlayback();
    const newIdx = currentFrameRef.current + 1;
    // Insert a fresh empty slot in every layer
    for (const layer of layersRef.current) layer.frames.splice(newIdx, 0, null);
    const newCount = frameCountOf();
    frameCountRef.current = newCount;
    setFrameCount(newCount);
    switchToFrame(newIdx);
    bumpLayers();
  }

  // Duplicate current frame — clone every layer's current-frame canvas
  function duplicateFrame() {
    stopPlayback();
    const idx = currentFrameRef.current;
    const newIdx = idx + 1;
    for (const layer of layersRef.current) {
      const src = layer.frames[idx];
      if (src) {
        const dup = makeLayerCanvas(canvasW, canvasH);
        const dctx = dup.getContext("2d")!;
        dctx.imageSmoothingEnabled = false;
        dctx.drawImage(src, 0, 0);
        layer.frames.splice(newIdx, 0, dup);
      } else {
        layer.frames.splice(newIdx, 0, null);
      }
    }
    const newCount = frameCountOf();
    frameCountRef.current = newCount;
    setFrameCount(newCount);
    switchToFrame(newIdx);
    bumpLayers();
  }

  // Delete current frame — drop the slot from every layer
  function deleteFrame() {
    if (frameCountRef.current <= 1) {
      // Last frame: clear every layer's only slot instead of removing
      for (const layer of layersRef.current) layer.frames[0] = null;
      composite();
      bumpLayers();
      return;
    }
    stopPlayback();
    for (const layer of layersRef.current) layer.frames.splice(currentFrameRef.current, 1);
    const newCount = frameCountOf();
    frameCountRef.current = newCount;
    setFrameCount(newCount);
    const newIdx = Math.min(currentFrameRef.current, newCount - 1);
    currentFrameRef.current = newIdx;
    setCurrentFrame(newIdx);
    composite();
    bumpLayers();
  }

  // Drawing handlers
  const onMouseDown = useCallback((e: React.PointerEvent) => {
    // Pointer events fire for touch too — skip those so the dedicated
    // touch handler (with multi-touch logic + passive:false) keeps owning
    // them. Mouse + pen flow through here.
    if (e.pointerType === "touch") return;
    e.preventDefault();
    const isRight = e.button === 2;
    const color = isRight ? bgColor : fgColor;
    const pos = getCanvasCoords(e);

    // PASTE FLOAT mode: a fresh paste is awaiting placement.
    // Click inside the float → drag to reposition.
    // Click outside → commit at current position.
    const pf = pasteFloatRef.current;
    if (pf) {
      const inside =
        pos.x >= pf.x && pos.x < pf.x + pf.canvas.width &&
        pos.y >= pf.y && pos.y < pf.y + pf.canvas.height;
      if (inside) {
        pasteDragRef.current = { startMouseX: pos.x, startMouseY: pos.y, startFloatX: pf.x, startFloatY: pf.y };
        drawingRef.current = true;
        return;
      } else {
        commitPasteFloat();
        // fall through so the click also starts a normal interaction (e.g. new selection)
      }
    }

    drawingRef.current = true;
    startPosRef.current = pos;
    lastPosRef.current = pos;
    lastClientRef.current = { clientX: e.clientX, clientY: e.clientY };
    lastStampAngleRef.current = spinAngleRef.current;

    const ctx = getCtx();
    if (!ctx) return;

    if (tool === "pencil" || tool === "eraser") {
      pushUndo();
      const c = tool === "eraser" ? bgColor : color;
      // Eraser always uses a plain square; brush shapes are for the pencil.
      const shape: BrushShape = tool === "eraser" ? "square" : brushShape;
      stampBrushWrapped(ctx, pos.x, pos.y, brushSize, c, shape, lastAngleRef.current);
      saveLiveCanvas();
    } else if (tool === "fill") {
      pushUndo();
      floodFill(ctx, pos.x, pos.y, color);
      saveLiveCanvas();
      drawingRef.current = false;
    } else if (tool === "eyedropper") {
      const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
      const picked = rgbToHex(pixel[0], pixel[1], pixel[2]);
      if (isRight) setBgColor(picked); else setFgColor(picked);
      drawingRef.current = false;
    } else if (tool === "text") {
      if (textInput) {
        pushUndo();
        const font = allFonts[textFontIdx] ?? TEXT_FONTS[0];
        stampText(ctx, pos.x, pos.y, color, textInput, font.family, textSize, aliased, !!font.pixel);
        saveLiveCanvas();
      }
      drawingRef.current = false;
    } else if (tool === "stamp") {
      if (!clipboardRef.current) {
        alert("Presse-papier vide. Copie (⌘C) ou détoure d'abord un élément avec l'outil SÉLECTION.");
        drawingRef.current = false;
        return;
      }
      pushUndo();
      stampClipboardAt(pos.x, pos.y);
      lastStampPosRef.current = pos;
      saveLiveCanvas();
    } else if (tool === "select") {
      // Existing selection + mouse inside → enter MOVE mode (lift pixels)
      const sel = selectionRef.current;
      if (sel && selectionHit(sel, pos.x, pos.y)) {
        pushUndo();
        liftSelection(sel, pos.x, pos.y);
        renderFloat(pos.x, pos.y);
        // drawingRef stays true so move/up are recognized as a drag
        return;
      }
      // Otherwise start defining a new selection. For lasso, seed the
      // points list with the down position.
      setSelection(null);
      if (selectMode === "lasso") {
        lassoPointsRef.current = [{ x: pos.x, y: pos.y }];
      }
    }
  }, [tool, fgColor, bgColor, brushSize, brushShape, zoom, playing, aliased, textInput, textFontIdx, textSize, selectMode]);

  const onMouseMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const pos = getCanvasCoords(e);
    updateMousePos(pos);
    if (drawingRef.current) lastClientRef.current = { clientX: e.clientX, clientY: e.clientY };
    if (!drawingRef.current) return;
    // Paste-float drag — update its position
    if (pasteDragRef.current && pasteFloatRef.current) {
      const d = pasteDragRef.current;
      const f = pasteFloatRef.current;
      setPasteFloat({ canvas: f.canvas, x: d.startFloatX + (pos.x - d.startMouseX), y: d.startFloatY + (pos.y - d.startMouseY) });
      return;
    }
    // Move mode takes priority — float follows the cursor on the overlay
    if (movingRef.current) {
      renderFloat(pos.x, pos.y);
      return;
    }
    const isRight = e.buttons === 2;
    const color = isRight ? bgColor : fgColor;
    const ctx = getCtx();
    const overlay = getOverlayCtx();
    if (!ctx) return;

    if (tool === "pencil" || tool === "eraser") {
      // High-frequency input: use getCoalescedEvents() to recover the
      // sub-frame positions the browser merged into this one synthetic
      // event. Fast strokes then trace ALL the intermediate points
      // instead of jumping in straight segments between sparse samples.
      const native = e.nativeEvent as PointerEvent;
      const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
      const positions = coalesced.length > 0 ? coalesced.map(getCanvasCoords) : [pos];
      const c = tool === "eraser" ? bgColor : color;
      const shape: BrushShape = tool === "eraser" ? "square" : brushShape;
      let prev = lastPosRef.current ?? positions[0];
      for (const p of positions) {
        lastAngleRef.current = stampLineWrapped(ctx, prev.x, prev.y, p.x, p.y, brushSize, c, shape, lastAngleRef.current);
        prev = p;
      }
      lastPosRef.current = prev;
      // The move handler just stamped up to the CURRENT rotation — reset
      // the arc-subdivision baseline so the RAF doesn't re-cover it.
      lastStampAngleRef.current = spinAngleRef.current;
      saveLiveCanvas();
    } else if (tool === "stamp") {
      const cb = clipboardRef.current;
      if (!cb) return;
      const last = lastStampPosRef.current;
      const step = Math.max(8, Math.round(Math.max(cb.canvas.width, cb.canvas.height) * stampScale * 0.6));
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= step) {
        stampClipboardAt(pos.x, pos.y);
        lastStampPosRef.current = pos;
        saveLiveCanvas();
      }
    } else if (tool === "line" && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, canvasW, canvasH);
      drawLine(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, aliased);
    } else if ((tool === "rect" || tool === "rect-fill") && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, canvasW, canvasH);
      drawRect(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "rect-fill", aliased);
    } else if ((tool === "ellipse" || tool === "ellipse-fill") && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, canvasW, canvasH);
      drawEllipse(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "ellipse-fill", aliased);
    } else if (tool === "select" && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, canvasW, canvasH);
      overlay.save();
      overlay.lineWidth = 1;
      overlay.setLineDash([3, 3]);
      if (selectMode === "lasso") {
        // Only record points that move enough to matter (≥1 px), keeps
        // the polygon manageable even on long drags
        const last = lassoPointsRef.current[lassoPointsRef.current.length - 1];
        if (!last || Math.abs(last.x - pos.x) + Math.abs(last.y - pos.y) >= 1) {
          lassoPointsRef.current.push({ x: pos.x, y: pos.y });
        }
        const pts = lassoPointsRef.current;
        const path = new Path2D();
        path.moveTo(pts[0].x + 0.5, pts[0].y + 0.5);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x + 0.5, pts[i].y + 0.5);
        overlay.strokeStyle = "#000";
        overlay.stroke(path);
        overlay.lineDashOffset = 3;
        overlay.strokeStyle = "#FFF";
        overlay.stroke(path);
      } else {
        const x0 = Math.min(startPosRef.current.x, pos.x);
        const y0 = Math.min(startPosRef.current.y, pos.y);
        const w = Math.abs(pos.x - startPosRef.current.x);
        const h = Math.abs(pos.y - startPosRef.current.y);
        overlay.strokeStyle = "#000";
        overlay.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
        overlay.lineDashOffset = 3;
        overlay.strokeStyle = "#FFF";
        overlay.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
      }
      overlay.restore();
    }
  }, [tool, fgColor, bgColor, brushSize, brushShape, zoom, playing, aliased, selectMode]);

  const onMouseUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastClientRef.current = null;
    const pos = getCanvasCoords(e);
    // Paste-float drag: end the drag but keep the float parked (not yet committed)
    if (pasteDragRef.current) {
      pasteDragRef.current = null;
      return;
    }
    // Move mode wins: commit the float then bail out
    if (movingRef.current) {
      commitMove(pos.x, pos.y);
      return;
    }
    const isRight = e.button === 2;
    const color = isRight ? bgColor : fgColor;
    const ctx = getCtx();
    const overlay = getOverlayCtx();

    if (!ctx || !startPosRef.current) return;

    if (tool === "line") {
      pushUndo();
      drawLine(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, aliased);
      saveLiveCanvas();
    } else if (tool === "rect" || tool === "rect-fill") {
      pushUndo();
      drawRect(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "rect-fill", aliased);
      saveLiveCanvas();
    } else if (tool === "ellipse" || tool === "ellipse-fill") {
      pushUndo();
      drawEllipse(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "ellipse-fill", aliased);
      saveLiveCanvas();
    } else if (tool === "select") {
      if (selectMode === "lasso") {
        const pts = lassoPointsRef.current;
        // Need at least a triangle to be a useful polygon
        if (pts.length >= 3) {
          // Clamp points to canvas and compute bbox
          const clamped = pts.map(p => ({
            x: Math.max(0, Math.min(canvasW, p.x)),
            y: Math.max(0, Math.min(canvasH, p.y)),
          }));
          let minX = clamped[0].x, maxX = clamped[0].x;
          let minY = clamped[0].y, maxY = clamped[0].y;
          for (const p of clamped) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          }
          const bw = maxX - minX, bh = maxY - minY;
          if (bw >= 2 && bh >= 2) {
            setSelection({ kind: "lasso", points: clamped, bbox: { x: minX, y: minY, w: bw, h: bh } });
          } else {
            setSelection(null);
          }
        } else {
          setSelection(null);
        }
        lassoPointsRef.current = [];
      } else {
        const x0 = Math.min(startPosRef.current.x, pos.x);
        const y0 = Math.min(startPosRef.current.y, pos.y);
        const w = Math.abs(pos.x - startPosRef.current.x);
        const h = Math.abs(pos.y - startPosRef.current.y);
        const cx = Math.max(0, Math.min(canvasW, x0));
        const cy = Math.max(0, Math.min(canvasH, y0));
        const cw = Math.max(0, Math.min(canvasW - cx, w));
        const ch = Math.max(0, Math.min(canvasH - cy, h));
        if (cw >= 2 && ch >= 2) {
          setSelection({ kind: "rect", x: cx, y: cy, w: cw, h: ch });
        } else {
          setSelection(null);
        }
      }
    }

    // The marching-ants effect owns the overlay while a selection exists;
    // only clear when no selection so we don't wipe the marquee mid-effect.
    if (overlay && tool !== "select") overlay.clearRect(0, 0, canvasW, canvasH);
    startPosRef.current = null;
    lastPosRef.current = null;
  }, [tool, fgColor, bgColor, brushSize, zoom, aliased, selectMode]);

  const onMouseLeave = useCallback(() => {
    setMousePos(null);
    // Stop the continuous-stamp RAF from drawing with a stale position
    // once the pointer has left the canvas.
    lastClientRef.current = null;
  }, []);

  // Touch events — attached imperatively so we can use passive:false
  const toolRef = useRef(tool);
  const fgColorRef = useRef(fgColor);
  const bgColorRef = useRef(bgColor);
  const brushSizeRef = useRef(brushSize);
  const brushShapeRef = useRef<BrushShape>(brushShape);
  const zoomRef = useRef(zoom);
  const playingRef = useRef(playing);
  const aliasedRef = useRef(aliased);
  const textInputRef = useRef(textInput);
  const textFontIdxRef = useRef(textFontIdx);
  const textSizeRef = useRef(textSize);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { fgColorRef.current = fgColor; }, [fgColor]);
  useEffect(() => { bgColorRef.current = bgColor; }, [bgColor]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { brushShapeRef.current = brushShape; }, [brushShape]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { aliasedRef.current = aliased; }, [aliased]);
  useEffect(() => { textInputRef.current = textInput; }, [textInput]);
  useEffect(() => { textFontIdxRef.current = textFontIdx; }, [textFontIdx]);
  useEffect(() => { textSizeRef.current = textSize; }, [textSize]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);
  useEffect(() => { pasteFloatRef.current = pasteFloat; }, [pasteFloat]);

  // Auto-commit the paste float when the user switches away from the
  // SÉLECTION tool — keeps the pasted pixels at their current position.
  useEffect(() => {
    if (tool !== "select" && pasteFloatRef.current) {
      commitPasteFloat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Build a Path2D from any selection shape (rect or lasso polygon).
  function selectionPath(sel: Selection): Path2D {
    const p = new Path2D();
    if (sel.kind === "rect") {
      p.rect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
    } else {
      p.moveTo(sel.points[0].x + 0.5, sel.points[0].y + 0.5);
      for (let i = 1; i < sel.points.length; i++) p.lineTo(sel.points[i].x + 0.5, sel.points[i].y + 0.5);
      p.closePath();
    }
    return p;
  }

  // Paste float renderer — keeps the floating bitmap visible on the
  // overlay while the user positions it. Re-runs on x/y changes (drag).
  useEffect(() => {
    const ov = getOverlayCtx();
    if (!ov) return;
    if (!pasteFloat) return;
    ov.clearRect(0, 0, canvasW, canvasH);
    ov.save();
    ov.imageSmoothingEnabled = false;
    ov.globalAlpha = 0.92;
    ov.drawImage(pasteFloat.canvas, pasteFloat.x, pasteFloat.y);
    ov.restore();
    // Dashed marquee around the float so it's obvious it's not committed
    ov.save();
    ov.lineWidth = 1;
    ov.setLineDash([3, 3]);
    ov.strokeStyle = "#000";
    ov.strokeRect(pasteFloat.x + 0.5, pasteFloat.y + 0.5, pasteFloat.canvas.width, pasteFloat.canvas.height);
    ov.lineDashOffset = 3;
    ov.strokeStyle = "#FFF";
    ov.strokeRect(pasteFloat.x + 0.5, pasteFloat.y + 0.5, pasteFloat.canvas.width, pasteFloat.canvas.height);
    ov.restore();
  }, [pasteFloat, canvasW, canvasH]);

  // Marching-ants animation: redraws the selection outline on the overlay
  // with a stepping dash offset, ~6 fps so it doesn't burn CPU.
  useEffect(() => {
    if (pasteFloat) return; // paste float owns the overlay
    if (!selection) {
      const ov = getOverlayCtx();
      if (ov) ov.clearRect(0, 0, canvasW, canvasH);
      return;
    }
    const id = setInterval(() => {
      antsOffsetRef.current = (antsOffsetRef.current + 1) % 8;
      const ov = getOverlayCtx();
      if (!ov) return;
      ov.clearRect(0, 0, canvasW, canvasH);
      const dash = Math.max(2, Math.round(Math.min(canvasW, canvasH) / 100));
      const path = selectionPath(selection);
      ov.save();
      ov.lineWidth = 1;
      ov.setLineDash([dash, dash]);
      ov.lineDashOffset = -antsOffsetRef.current;
      ov.strokeStyle = "#000000";
      ov.stroke(path);
      ov.lineDashOffset = -antsOffsetRef.current + dash;
      ov.strokeStyle = "#FFFFFF";
      ov.stroke(path);
      ov.restore();
    }, 160);
    return () => clearInterval(id);
  }, [selection, canvasW, canvasH, pasteFloat]);

  // Keyboard shortcuts for selection + clipboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;

      // Paste-float keyboard handling
      if (pasteFloatRef.current) {
        if (e.key === "Escape") { cancelPasteFloat(); e.preventDefault(); return; }
        if (e.key === "Enter")  { commitPasteFloat(); e.preventDefault(); return; }
      }

      const mod = e.metaKey || e.ctrlKey;
      // Undo / redo
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) redo(); else undo();
        e.preventDefault(); return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        redo(); e.preventDefault(); return;
      }
      if (mod && (e.key === "c" || e.key === "C")) {
        if (selectionRef.current) { copySelection(); e.preventDefault(); }
      } else if (mod && (e.key === "x" || e.key === "X")) {
        if (selectionRef.current) { copySelection(); eraseSelection(); e.preventDefault(); }
      } else if (mod && (e.key === "v" || e.key === "V")) {
        if (clipboardRef.current) { pasteClipboard(); e.preventDefault(); }
      } else if (selectionRef.current) {
        if (e.key === "Escape") {
          // If actively moving, restore pixels at the original position
          if (movingRef.current) {
            const m = movingRef.current;
            const ctx = getCtx();
            if (ctx) {
              ctx.save();
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(m.float, m.startSelX, m.startSelY);
              ctx.restore();
              saveLiveCanvas();
              saveCurrentFrame();
            }
            movingRef.current = null;
            drawingRef.current = false;
            const overlay = getOverlayCtx();
            if (overlay) overlay.clearRect(0, 0, canvasW, canvasH);
          }
          setSelection(null);
          e.preventDefault();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          eraseSelection(); e.preventDefault();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getTouchPos(touch: Touch) {
      const rect = canvas!.getBoundingClientRect();
      return {
        x: Math.floor((touch.clientX - rect.left) / zoomRef.current),
        y: Math.floor((touch.clientY - rect.top) / zoomRef.current),
      };
    }

    function handleTouchStart(e: TouchEvent) {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const pos = getTouchPos(touch);

      // PASTE FLOAT mode (touch): same logic as mouse
      const pf = pasteFloatRef.current;
      if (pf) {
        const inside =
          pos.x >= pf.x && pos.x < pf.x + pf.canvas.width &&
          pos.y >= pf.y && pos.y < pf.y + pf.canvas.height;
        if (inside) {
          pasteDragRef.current = { startMouseX: pos.x, startMouseY: pos.y, startFloatX: pf.x, startFloatY: pf.y };
          drawingRef.current = true;
          return;
        } else {
          commitPasteFloat();
        }
      }

      drawingRef.current = true;
      startPosRef.current = pos;
      lastPosRef.current = pos;
      lastClientRef.current = { clientX: touch.clientX, clientY: touch.clientY };
      lastStampAngleRef.current = spinAngleRef.current;
      updateMousePos(pos);
      const ctx = getCtx();
      if (!ctx) return;
      const color = fgColorRef.current;
      const t = toolRef.current;
      if (t === "pencil" || t === "eraser") {
        pushUndo();
        const c = t === "eraser" ? bgColorRef.current : color;
        const shape: BrushShape = t === "eraser" ? "square" : brushShapeRef.current;
        stampBrushWrapped(ctx, pos.x, pos.y, brushSizeRef.current, c, shape, lastAngleRef.current);
        composite();
      } else if (t === "fill") {
        pushUndo();
        floodFill(ctx, pos.x, pos.y, color);
        composite();
        drawingRef.current = false;
      } else if (t === "eyedropper") {
        const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
        setFgColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
        drawingRef.current = false;
      } else if (t === "text") {
        const txt = textInputRef.current;
        if (txt) {
          pushUndo();
          const font = allFontsRef.current[textFontIdxRef.current] ?? TEXT_FONTS[0];
          stampText(ctx, pos.x, pos.y, color, txt, font.family, textSizeRef.current, aliasedRef.current, !!font.pixel);
          composite();
        }
        drawingRef.current = false;
      } else if (t === "stamp") {
        if (!clipboardRef.current) {
          drawingRef.current = false;
        } else {
          pushUndo();
          stampClipboardAt(pos.x, pos.y);
          lastStampPosRef.current = pos;
          composite();
        }
      } else if (t === "select") {
        const sel = selectionRef.current;
        if (sel && selectionHit(sel, pos.x, pos.y)) {
          pushUndo();
          liftSelection(sel, pos.x, pos.y);
          renderFloat(pos.x, pos.y);
        } else {
          setSelection(null);
          if (selectModeRef.current === "lasso") {
            lassoPointsRef.current = [{ x: pos.x, y: pos.y }];
          }
        }
      }
    }

    function handleTouchMove(e: TouchEvent) {
      if (!drawingRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const pos = getTouchPos(touch);
      updateMousePos(pos);
      lastClientRef.current = { clientX: touch.clientX, clientY: touch.clientY };
      // Capture the previous position BEFORE overwriting — the pencil
      // branch needs it to draw a continuous segment (was a bug: the
      // overwrite happened first, collapsing strokes to dots).
      const prevPos = lastPosRef.current;
      lastPosRef.current = pos; // touchEnd uses this as the final position for move-commit
      if (pasteDragRef.current && pasteFloatRef.current) {
        const d = pasteDragRef.current;
        const f = pasteFloatRef.current;
        setPasteFloat({ canvas: f.canvas, x: d.startFloatX + (pos.x - d.startMouseX), y: d.startFloatY + (pos.y - d.startMouseY) });
        return;
      }
      if (movingRef.current) { renderFloat(pos.x, pos.y); return; }
      const ctx = getCtx();
      const overlay = getOverlayCtx();
      if (!ctx) return;
      const color = fgColorRef.current;
      const t = toolRef.current;
      const sz = brushSizeRef.current;
      const al = aliasedRef.current;
      if (t === "pencil" || t === "eraser") {
        const last = prevPos ?? pos;
        const c = t === "eraser" ? bgColorRef.current : color;
        const shape: BrushShape = t === "eraser" ? "square" : brushShapeRef.current;
        lastAngleRef.current = stampLineWrapped(ctx, last.x, last.y, pos.x, pos.y, sz, c, shape, lastAngleRef.current);
        lastStampAngleRef.current = spinAngleRef.current;
        composite();
      } else if (t === "stamp") {
        const cb = clipboardRef.current;
        if (cb) {
          const last = lastStampPosRef.current;
          const step = Math.max(8, Math.round(Math.max(cb.canvas.width, cb.canvas.height) * stampScaleRef.current * 0.6));
          if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= step) {
            stampClipboardAt(pos.x, pos.y);
            lastStampPosRef.current = pos;
            composite();
          }
        }
      } else if (t === "line" && overlay && startPosRef.current) {
        overlay.clearRect(0, 0, canvasW, canvasH);
        drawLine(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, al);
      } else if ((t === "rect" || t === "rect-fill") && overlay && startPosRef.current) {
        overlay.clearRect(0, 0, canvasW, canvasH);
        drawRect(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "rect-fill", al);
      } else if ((t === "ellipse" || t === "ellipse-fill") && overlay && startPosRef.current) {
        overlay.clearRect(0, 0, canvasW, canvasH);
        drawEllipse(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "ellipse-fill", al);
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!drawingRef.current) return;
      e.preventDefault();
      drawingRef.current = false;
      lastClientRef.current = null;
      if (pasteDragRef.current) { pasteDragRef.current = null; return; }
      if (movingRef.current) {
        const pos = lastPosRef.current ?? startPosRef.current ?? { x: 0, y: 0 };
        commitMove(pos.x, pos.y);
        return;
      }
      const ctx = getCtx();
      const overlay = getOverlayCtx();
      if (!ctx || !startPosRef.current) return;
      const color = fgColorRef.current;
      const t = toolRef.current;
      const sz = brushSizeRef.current;
      const al = aliasedRef.current;
      const pos = lastPosRef.current ?? startPosRef.current;
      if (t === "line") {
        pushUndo();
        drawLine(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, al);
        composite();
      } else if (t === "rect" || t === "rect-fill") {
        pushUndo();
        drawRect(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "rect-fill", al);
        composite();
      } else if (t === "ellipse" || t === "ellipse-fill") {
        pushUndo();
        drawEllipse(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "ellipse-fill", al);
        composite();
      }
      if (overlay) overlay.clearRect(0, 0, canvasW, canvasH);
      startPosRef.current = null;
      lastPosRef.current = null;
      setMousePos(null);
    }

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
    };
    // Re-register on resolution change so handlers close over the fresh dims.
  }, [canvasW, canvasH]);

  function handleSave() {
    saveCurrentFrame();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `frame-${currentFrame + 1}.png`;
    a.click();
  }

  function handleNew() {
    stopPlayback();
    if (!confirm("Effacer tout et recommencer ?")) return;
    layersRef.current = [makeLayer("CALQUE 1", 1)];
    setActiveLayerIdx(0);
    activeLayerIdxRef.current = 0;
    frameCountRef.current = 1;
    setFrameCount(1);
    currentFrameRef.current = 0;
    setCurrentFrame(0);
    clearHistory();
    bumpLayers();
    composite();
  }

  // -------------------- Selection actions --------------------

  function selBox(sel: Selection): { x: number; y: number; w: number; h: number } {
    return sel.kind === "rect" ? sel : sel.bbox;
  }

  // Fill the selection with bgColor on the current frame. For lasso the
  // fill is masked via Path2D clip so only the polygon area is touched.
  function eraseSelection() {
    const sel = selectionRef.current;
    if (!sel) return;
    const ctx = getCtx();
    if (!ctx) return;
    pushUndo();
    ctx.save();
    if (sel.kind === "lasso") ctx.clip(selectionPath(sel));
    ctx.fillStyle = bgColor;
    const b = selBox(sel);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
    saveLiveCanvas();
    saveCurrentFrame();
  }

  // DÉTOURER — keep only what's inside the selection on the current frame.
  // The canvas dimensions are unchanged; everything outside the selection
  // is filled with the current bgColor (for lasso, the mask is applied
  // so only the polygon's pixels survive).
  function detourSelection() {
    const sel = selectionRef.current;
    if (!sel) return;
    const ctx = getCtx();
    const src = canvasRef.current;
    if (!ctx || !src) return;
    const b = sel.kind === "rect" ? sel : sel.bbox;
    if (b.w < 1 || b.h < 1) return;
    pushUndo();
    // 1) Snapshot the selected content into an offscreen (mask-aware)
    const off = document.createElement("canvas");
    off.width = b.w;
    off.height = b.h;
    const octx = off.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    if (sel.kind === "lasso") {
      const local = new Path2D();
      local.moveTo(sel.points[0].x - b.x, sel.points[0].y - b.y);
      for (let i = 1; i < sel.points.length; i++) local.lineTo(sel.points[i].x - b.x, sel.points[i].y - b.y);
      local.closePath();
      octx.save();
      octx.clip(local);
      octx.drawImage(src, -b.x, -b.y);
      octx.restore();
    } else {
      octx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    }
    // 2) Wipe the frame to bg and paste the snapshot back at its place
    ctx.save();
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.drawImage(off, b.x, b.y);
    ctx.restore();
    saveLiveCanvas();
    saveCurrentFrame();
    // Selection persists so the user can iterate
  }

  // RECADRER — resize the canvas (and rescale every frame) so it matches
  // the selection's bounding box. Lasso also masks each frame so areas
  // outside the polygon become bg-fill.
  function cropFrameToSelection() {
    const sel = selectionRef.current;
    if (!sel) return;
    const b = selBox(sel);
    if (b.w < 1 || b.h < 1) return;
    stopPlayback();
    clearHistory();
    // Crop every layer's every frame canvas to the selection bbox
    for (const layer of layersRef.current) {
      layer.frames = layer.frames.map(c => {
        if (!c) return null;
        const out = makeLayerCanvas(b.w, b.h);
        const octx = out.getContext("2d")!;
        octx.imageSmoothingEnabled = false;
        if (sel.kind === "lasso") {
          const local = new Path2D();
          local.moveTo(sel.points[0].x - b.x, sel.points[0].y - b.y);
          for (let i = 1; i < sel.points.length; i++) local.lineTo(sel.points[i].x - b.x, sel.points[i].y - b.y);
          local.closePath();
          octx.save();
          octx.clip(local);
          octx.drawImage(c, -b.x, -b.y);
          octx.restore();
        } else {
          octx.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        }
        return out;
      });
    }
    setCanvasW(b.w);
    setCanvasH(b.h);
    canvasWRef.current = b.w;
    canvasHRef.current = b.h;
    setSelection(null);
    bumpLayers();
  }

  // Snapshot the selected pixels into the clipboard. Lasso uses Path2D
  // clipping so only the polygon's pixels are captured (rest stays
  // transparent).
  function copySelection() {
    const sel = selectionRef.current;
    if (!sel) return;
    const src = canvasRef.current;
    if (!src) return;
    const b = selBox(sel);
    if (b.w < 1 || b.h < 1) return;
    const off = document.createElement("canvas");
    off.width = b.w;
    off.height = b.h;
    const octx = off.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    if (sel.kind === "lasso") {
      const local = new Path2D();
      local.moveTo(sel.points[0].x - b.x, sel.points[0].y - b.y);
      for (let i = 1; i < sel.points.length; i++) local.lineTo(sel.points[i].x - b.x, sel.points[i].y - b.y);
      local.closePath();
      octx.save();
      octx.clip(local);
      octx.drawImage(src, -b.x, -b.y);
      octx.restore();
    } else {
      octx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    }
    clipboardRef.current = { canvas: off, x: b.x, y: b.y };
    setClipboardKey(k => k + 1);
  }

  // ---- Undo / redo --------------------------------------------------
  function getHist(idx: number) {
    let h = historyRef.current.get(idx);
    if (!h) { h = { undo: [], redo: [] }; historyRef.current.set(idx, h); }
    return h;
  }

  // GPU-side snapshot of the active layer's current frame. drawImage
  // canvas→canvas stays on the GPU — unlike getImageData, which forces a
  // full GPU→CPU readback (33 MB + pipeline stall at 4K) and made every
  // stroke START hitch on big canvases.
  function snapshotActiveLayer(): HTMLCanvasElement | null {
    const src = getActiveCanvas();
    if (!src) return null;
    const c = makeLayerCanvas(src.width, src.height);
    c.getContext("2d")!.drawImage(src, 0, 0);
    return c;
  }
  const canvasBytes = (c: HTMLCanvasElement) => c.width * c.height * 4;

  // Capture current state onto the undo stack. Trims by memory budget.
  // Clears redo (a new action invalidates the redo line).
  function pushUndo() {
    const snap = snapshotActiveLayer();
    if (!snap) return;
    const h = getHist(currentFrameRef.current);
    h.undo.push(snap);
    let total = h.undo.reduce((s, c) => s + canvasBytes(c), 0);
    while (total > UNDO_MEM_BUDGET && h.undo.length > 1) {
      const drop = h.undo.shift()!;
      total -= canvasBytes(drop);
    }
    h.redo = [];
    setHistoryTick(k => k + 1);
  }

  function undo() {
    const h = getHist(currentFrameRef.current);
    const prev = h.undo.pop();
    if (!prev) return;
    const ctx = getCtx();
    if (!ctx) return;
    // Snapshots are tied to the dimensions captured at that time; bail if
    // they no longer match (e.g. after a RÉSO switch).
    if (prev.width !== canvasW || prev.height !== canvasH) return;
    const cur = snapshotActiveLayer();
    if (cur) h.redo.push(cur);
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(prev, 0, 0);
    saveLiveCanvas();
    saveCurrentFrame();
    setHistoryTick(k => k + 1);
  }

  function redo() {
    const h = getHist(currentFrameRef.current);
    const next = h.redo.pop();
    if (!next) return;
    const ctx = getCtx();
    if (!ctx) return;
    if (next.width !== canvasW || next.height !== canvasH) return;
    const cur = snapshotActiveLayer();
    if (cur) h.undo.push(cur);
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(next, 0, 0);
    saveLiveCanvas();
    saveCurrentFrame();
    setHistoryTick(k => k + 1);
  }

  function clearHistory() {
    historyRef.current.clear();
    setHistoryTick(k => k + 1);
  }

  // Re-derive button enable state when history mutates or frame switches.
  const canUndo = useMemo(() => {
    void historyTick; // include in deps so the memo recomputes on bump
    return (historyRef.current.get(currentFrame)?.undo.length ?? 0) > 0;
  }, [historyTick, currentFrame]);
  const canRedo = useMemo(() => {
    void historyTick;
    return (historyRef.current.get(currentFrame)?.redo.length ?? 0) > 0;
  }, [historyTick, currentFrame]);

  // Paste: enter floating mode — the clipboard is shown as a movable
  // preview on the overlay (NOT yet committed). The user repositions it,
  // then commits by clicking outside / pressing Enter / switching tools.
  function pasteClipboard() {
    const cb = clipboardRef.current;
    if (!cb) return;
    // If another float was in progress, commit it first
    if (pasteFloatRef.current) commitPasteFloat();
    setSelection(null);
    pasteDragRef.current = null;
    setPasteFloat({ canvas: cb.canvas, x: cb.x, y: cb.y });
    setTool("select");
  }

  function commitPasteFloat() {
    const f = pasteFloatRef.current;
    if (!f) return;
    const ctx = getCtx();
    if (!ctx) { setPasteFloat(null); return; }
    pushUndo();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.canvas, f.x, f.y);
    ctx.restore();
    saveLiveCanvas();
    saveCurrentFrame();
    pasteFloatRef.current = null;
    pasteDragRef.current = null;
    setPasteFloat(null);
    // Create a fresh selection over the dropped area
    setSelection({ kind: "rect", x: f.x, y: f.y, w: f.canvas.width, h: f.canvas.height });
  }

  // Stamp the clipboard (rect or lasso copy) centered at (x, y) on the
  // active layer's current frame. Honors stampScale. In PANO mode also
  // stamps the two wrap ghosts at x ± canvasW so marks crossing the seam
  // reappear on the other side.
  function stampClipboardAt(x: number, y: number) {
    const cb = clipboardRef.current;
    if (!cb) return false;
    const ctx = getCtx();
    if (!ctx) return false;
    const s = stampScaleRef.current;
    const w = Math.max(1, Math.round(cb.canvas.width * s));
    const h = Math.max(1, Math.round(cb.canvas.height * s));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const draw = (px: number) => ctx.drawImage(cb.canvas, Math.round(px - w / 2), Math.round(y - h / 2), w, h);
    draw(x);
    if (spinModeRef.current === "pan") {
      const W = canvasWRef.current;
      // Ghosts only when the stamp can straddle the seam
      if (x - w / 2 <= 0) draw(x + W);
      if (x + w / 2 >= W) draw(x - W);
    }
    ctx.restore();
    return true;
  }

  // Seam-aware variants used by pencil / eraser. In PANO mode, strokes are
  // repeated at x ± canvasW so they tile seamlessly; segments that jump
  // across the wrap (offset rollover) take the short path through the seam
  // instead of streaking across the whole canvas.
  function stampBrushWrapped(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, shape: BrushShape, angle: number) {
    stampBrush(ctx, x, y, size, color, shape, angle);
    if (spinModeRef.current === "pan") {
      const W = canvasWRef.current;
      // Ghost copies only when the mark can actually reach across the seam
      const margin = size * 2 + 4;
      if (x <= margin) stampBrush(ctx, x + W, y, size, color, shape, angle);
      if (x >= W - margin) stampBrush(ctx, x - W, y, size, color, shape, angle);
    }
  }

  function stampLineWrapped(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, size: number, color: string, shape: BrushShape, fallbackAngle: number): number {
    if (spinModeRef.current === "pan") {
      const W = canvasWRef.current;
      // Take the short way around the seam when the segment wrapped
      if (x1 - x0 > W / 2) x1 -= W;
      else if (x0 - x1 > W / 2) x1 += W;
      const a = stampLine(ctx, x0, y0, x1, y1, size, color, shape, fallbackAngle);
      // Ghost copies only when the segment's x-range gets near an edge —
      // unconditional triple-stamping costs 3× draw for nothing in the
      // middle of the canvas.
      const margin = size * 2 + 4;
      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      if (minX <= margin) stampLine(ctx, x0 + W, y0, x1 + W, y1, size, color, shape, fallbackAngle);
      if (maxX >= W - margin) stampLine(ctx, x0 - W, y0, x1 - W, y1, size, color, shape, fallbackAngle);
      return a;
    }
    return stampLine(ctx, x0, y0, x1, y1, size, color, shape, fallbackAngle);
  }

  function cancelPasteFloat() {
    pasteFloatRef.current = null;
    pasteDragRef.current = null;
    setPasteFloat(null);
    const ov = getOverlayCtx();
    if (ov) ov.clearRect(0, 0, canvasW, canvasH);
  }

  // Test whether a canvas-space point falls inside the current selection.
  function selectionHit(sel: Selection, x: number, y: number): boolean {
    if (sel.kind === "rect") {
      return x >= sel.x && x < sel.x + sel.w && y >= sel.y && y < sel.y + sel.h;
    }
    const ov = getOverlayCtx();
    if (!ov) return false;
    return ov.isPointInPath(selectionPath(sel), x, y);
  }

  // Lift the selection's pixels into a float canvas and erase the source
  // so the user sees the float "detach" from the frame as they drag.
  function liftSelection(sel: Selection, mouseX: number, mouseY: number) {
    const src = canvasRef.current;
    const ctx = getCtx();
    if (!src || !ctx) return;
    const b = sel.kind === "rect" ? sel : sel.bbox;
    const off = document.createElement("canvas");
    off.width = b.w;
    off.height = b.h;
    const octx = off.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    if (sel.kind === "lasso") {
      const local = new Path2D();
      local.moveTo(sel.points[0].x - b.x, sel.points[0].y - b.y);
      for (let i = 1; i < sel.points.length; i++) local.lineTo(sel.points[i].x - b.x, sel.points[i].y - b.y);
      local.closePath();
      octx.save();
      octx.clip(local);
      octx.drawImage(src, -b.x, -b.y);
      octx.restore();
    } else {
      octx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    }
    // Erase original area on the frame
    ctx.save();
    if (sel.kind === "lasso") ctx.clip(selectionPath(sel));
    ctx.fillStyle = bgColor;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
    saveLiveCanvas();
    movingRef.current = { float: off, startMouseX: mouseX, startMouseY: mouseY, startSelX: b.x, startSelY: b.y };
  }

  // Paint the float at the current cursor offset on the overlay (preview).
  function renderFloat(curX: number, curY: number) {
    const m = movingRef.current;
    const overlay = getOverlayCtx();
    if (!m || !overlay) return;
    overlay.clearRect(0, 0, canvasW, canvasH);
    overlay.save();
    overlay.imageSmoothingEnabled = false;
    overlay.drawImage(m.float, m.startSelX + (curX - m.startMouseX), m.startSelY + (curY - m.startMouseY));
    overlay.restore();
  }

  // Drop the float onto the frame at the final position and shift the
  // selection accordingly so subsequent actions act on the new spot.
  function commitMove(endX: number, endY: number) {
    const m = movingRef.current;
    const ctx = getCtx();
    if (!m || !ctx) { movingRef.current = null; return; }
    const dx = endX - m.startMouseX;
    const dy = endY - m.startMouseY;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(m.float, m.startSelX + dx, m.startSelY + dy);
    ctx.restore();
    saveLiveCanvas();
    saveCurrentFrame();
    // Shift the selection by (dx, dy)
    const sel = selectionRef.current;
    if (sel) {
      if (sel.kind === "rect") {
        setSelection({ kind: "rect", x: sel.x + dx, y: sel.y + dy, w: sel.w, h: sel.h });
      } else {
        setSelection({
          kind: "lasso",
          points: sel.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
          bbox: { x: sel.bbox.x + dx, y: sel.bbox.y + dy, w: sel.bbox.w, h: sel.bbox.h },
        });
      }
    }
    movingRef.current = null;
  }

  // Nearest-neighbor rescale via an offscreen canvas (imageSmoothingEnabled off).
  function rescaleImageData(src: ImageData, dstW: number, dstH: number): ImageData {
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = src.width;
    srcCanvas.height = src.height;
    srcCanvas.getContext("2d")!.putImageData(src, 0, 0);
    const dstCanvas = document.createElement("canvas");
    dstCanvas.width = dstW;
    dstCanvas.height = dstH;
    const dstCtx = dstCanvas.getContext("2d")!;
    dstCtx.imageSmoothingEnabled = false;
    dstCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);
    return dstCtx.getImageData(0, 0, dstW, dstH);
  }

  function switchResolution(newW: number, newH: number) {
    if (newW === canvasW && newH === canvasH) return;
    stopPlayback();
    clearHistory();
    // Rescale every layer's every frame canvas via nearest-neighbor
    for (const layer of layersRef.current) {
      layer.frames = layer.frames.map(c => {
        if (!c) return null;
        const out = makeLayerCanvas(newW, newH);
        const octx = out.getContext("2d")!;
        octx.imageSmoothingEnabled = false;
        octx.drawImage(c, 0, 0, newW, newH);
        return out;
      });
    }
    setCanvasW(newW);
    setCanvasH(newH);
    canvasWRef.current = newW;
    canvasHRef.current = newH;
    bumpLayers();
  }

  function handleSaveGif() {
    // Save all frames as individual PNGs in a zip-like sequence
    const n = frameCountOf();
    for (let i = 0; i < n; i++) {
      const off = compositeFrameToCanvas(i);
      const a = document.createElement("a");
      a.href = off.toDataURL("image/png");
      a.download = `animation-frame-${String(i + 1).padStart(3, "0")}.png`;
      a.click();
    }
  }

  function handleSaveSvg() {
    const img = compositeFrameToImageData(currentFrameRef.current);
    const svg = imageDataToSvg(img);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `frame-${currentFrame + 1}.svg`);
  }

  function handleSaveAllSvg() {
    const n = frameCountOf();
    for (let i = 0; i < n; i++) {
      const img = compositeFrameToImageData(i);
      const svg = imageDataToSvg(img);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `animation-frame-${String(i + 1).padStart(3, "0")}.svg`);
    }
  }

  // Build the same payload as a .dpaint file (so save-to-cloud and
  // save-to-disk emit the same structure).
  function buildProjectPayload() {
    const layers = layersRef.current.map(layer => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      frames: layer.frames.map(c => c ? c.toDataURL("image/png") : null),
    }));
    return {
      format: "dpaint-project" as const,
      version: 2,
      width: canvasW,
      height: canvasH,
      fps,
      looping,
      currentFrame,
      activeLayerIdx,
      layers,
    };
  }

  // Replace the in-memory project state with a freshly loaded payload.
  // Used by both the file-input loader and the /p/:id deep-link loader.
  async function loadProjectData(data: unknown, _suggestedName?: string) {
    if (typeof data !== "object" || data === null) throw new Error("Format inconnu");
    const d = data as {
      format?: string; width?: number; height?: number; fps?: number; looping?: boolean;
      currentFrame?: number; activeLayerIdx?: number;
      layers?: Array<{ id?: string; name?: string; visible?: boolean; opacity?: number; frames: (string | null)[] }>;
      frames?: (string | null)[];
    };
    if (d.format !== "dpaint-project") throw new Error("Format inconnu (attendu : dpaint-project)");
    const targetW = typeof d.width === "number" && d.width > 0 ? d.width : canvasW;
    const targetH = typeof d.height === "number" && d.height > 0 ? d.height : canvasH;
    stopPlayback();

    const loadCanvas = (url: string | null): Promise<HTMLCanvasElement | null> => {
      if (!url) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = makeLayerCanvas(targetW, targetH);
          const cx = c.getContext("2d")!;
          cx.imageSmoothingEnabled = false;
          cx.drawImage(img, 0, 0);
          resolve(c);
        };
        img.onerror = () => reject(new Error("Frame illisible"));
        img.src = url;
      });
    };

    let newLayers: Layer[];
    if (Array.isArray(d.layers)) {
      newLayers = await Promise.all(
        d.layers.map(async (l, i) => {
          const frames = await Promise.all((l.frames ?? []).map(loadCanvas));
          return {
            id: l.id ?? `${Date.now().toString(36)}-${i}`,
            name: l.name ?? `CALQUE ${i + 1}`,
            visible: typeof l.visible === "boolean" ? l.visible : true,
            opacity: typeof l.opacity === "number" ? l.opacity : 1,
            frames,
          } as Layer;
        })
      );
    } else if (Array.isArray(d.frames)) {
      const frames = await Promise.all(d.frames.map(loadCanvas));
      newLayers = [{ id: `${Date.now().toString(36)}-1`, name: "CALQUE 1", visible: true, opacity: 1, frames }];
    } else {
      throw new Error("Aucun calque ni frame dans le projet");
    }

    if (targetW !== canvasW || targetH !== canvasH) {
      setCanvasW(targetW); setCanvasH(targetH);
      canvasWRef.current = targetW; canvasHRef.current = targetH;
    }
    layersRef.current = newLayers.length ? newLayers : [makeLayer("CALQUE 1", 1)];
    const n = frameCountOf();
    frameCountRef.current = n;
    setFrameCount(n);
    clearHistory();
    if (typeof d.fps === "number") setFps(d.fps);
    if (typeof d.looping === "boolean") { setLooping(d.looping); loopingRef.current = d.looping; }
    const startFrame = typeof d.currentFrame === "number" ? Math.min(Math.max(0, d.currentFrame), n - 1) : 0;
    currentFrameRef.current = startFrame;
    setCurrentFrame(startFrame);
    const startLayer = typeof d.activeLayerIdx === "number" ? Math.min(Math.max(0, d.activeLayerIdx), layersRef.current.length - 1) : 0;
    setActiveLayerIdx(startLayer); activeLayerIdxRef.current = startLayer;
    bumpLayers();
    composite();
  }

  // ---- Cloud save / save-as / open ----
  async function handleCloudSave() {
    if (!currentUser) { setShowLogin(true); return; }
    const payload = buildProjectPayload();
    try {
      if (cloudProject && cloudProject.ownerId === currentUser.id) {
        const r = await api.updateProject(cloudProject.id, { data: payload });
        setCloudProject({ id: r.project.id, name: r.project.name, ownerId: currentUser.id });
        alert(`✓ Projet sauvegardé : ${r.project.name}`);
      } else {
        const defaultName = cloudProject?.name || `Projet du ${new Date().toLocaleDateString("fr-FR")}`;
        const name = prompt("Nom du projet :", defaultName);
        if (!name) return;
        const r = await api.createProject({ name, data: payload, isPublic: true });
        setCloudProject({ id: r.project.id, name: r.project.name, ownerId: currentUser.id });
        // Update URL so the share link points at this project
        window.history.replaceState({}, "", `/p/${r.project.id}`);
        alert(`✓ Projet créé : ${r.project.name}\nURL partageable : ${window.location.href}`);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert("Erreur de sauvegarde : " + msg);
    }
  }

  async function handleCloudOpen(id: string) {
    try {
      const r = await api.getProject(id);
      await loadProjectData(r.project.data, r.project.name);
      setCloudProject({ id: r.project.id, name: r.project.name, ownerId: r.project.ownerId });
      window.history.replaceState({}, "", `/p/${r.project.id}`);
      setShowProjects(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert("Impossible d'ouvrir : " + msg);
    }
  }

  function handleShareLink() {
    if (!cloudProject) { alert("Sauvegarde le projet d'abord pour obtenir un lien."); return; }
    const url = `${window.location.origin}/p/${cloudProject.id}`;
    navigator.clipboard?.writeText(url).then(
      () => alert(`Lien copié :\n${url}`),
      () => prompt("Copie le lien :", url),
    );
  }

  function handleSaveProject() {
    // version 2: layers as tracks. Each layer carries meta + an array of
    // dataURLs (or nulls) for its per-frame canvases.
    const layers = layersRef.current.map(layer => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      frames: layer.frames.map(c => c ? c.toDataURL("image/png") : null),
    }));
    const data = {
      format: "dpaint-project",
      version: 2,
      width: canvasW,
      height: canvasH,
      fps,
      looping,
      currentFrame,
      activeLayerIdx,
      layers,
    };
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `dpaint-project-${ts}.dpaint`);
  }

  function handleOpenProject() {
    projectInputRef.current?.click();
  }

  async function onProjectFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data?.format !== "dpaint-project") throw new Error("Format inconnu (attendu : dpaint-project)");
      const targetW = typeof data.width === "number" && data.width > 0 ? data.width : canvasW;
      const targetH = typeof data.height === "number" && data.height > 0 ? data.height : canvasH;
      stopPlayback();

      // Helper: load a dataURL into a fresh layer-sized canvas
      const loadCanvas = (url: string | null): Promise<HTMLCanvasElement | null> => {
        if (!url) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const c = makeLayerCanvas(targetW, targetH);
            const cx = c.getContext("2d")!;
            cx.imageSmoothingEnabled = false;
            cx.drawImage(img, 0, 0);
            resolve(c);
          };
          img.onerror = () => reject(new Error("Frame illisible"));
          img.src = url;
        });
      };

      let newLayers: Layer[];
      // version 2: layers as tracks
      if (Array.isArray(data.layers)) {
        newLayers = await Promise.all(
          (data.layers as Array<{ id?: string; name?: string; visible?: boolean; opacity?: number; frames: (string | null)[] }>).map(async (l, i) => {
            const frames = await Promise.all((l.frames ?? []).map(loadCanvas));
            return {
              id: l.id ?? `${Date.now().toString(36)}-${i}`,
              name: l.name ?? `CALQUE ${i + 1}`,
              visible: typeof l.visible === "boolean" ? l.visible : true,
              opacity: typeof l.opacity === "number" ? l.opacity : 1,
              frames,
            } as Layer;
          })
        );
      // version 1: flat frames array → wrap as a single layer
      } else if (Array.isArray(data.frames)) {
        const frames = await Promise.all((data.frames as (string | null)[]).map(loadCanvas));
        newLayers = [{
          id: `${Date.now().toString(36)}-1`,
          name: "CALQUE 1",
          visible: true,
          opacity: 1,
          frames,
        }];
      } else {
        throw new Error("Aucun calque ni frame dans le projet");
      }

      if (targetW !== canvasW || targetH !== canvasH) {
        setCanvasW(targetW);
        setCanvasH(targetH);
        canvasWRef.current = targetW;
        canvasHRef.current = targetH;
      }
      layersRef.current = newLayers.length ? newLayers : [makeLayer("CALQUE 1", 1)];
      const n = frameCountOf();
      frameCountRef.current = n;
      setFrameCount(n);
      clearHistory();
      if (typeof data.fps === "number") setFps(data.fps);
      if (typeof data.looping === "boolean") { setLooping(data.looping); loopingRef.current = data.looping; }
      const startFrame = typeof data.currentFrame === "number" ? Math.min(Math.max(0, data.currentFrame), n - 1) : 0;
      currentFrameRef.current = startFrame;
      setCurrentFrame(startFrame);
      const startLayer = typeof data.activeLayerIdx === "number" ? Math.min(Math.max(0, data.activeLayerIdx), layersRef.current.length - 1) : 0;
      setActiveLayerIdx(startLayer);
      activeLayerIdxRef.current = startLayer;
      bumpLayers();
      composite();
    } catch (err) {
      alert("Impossible de charger le projet : " + (err instanceof Error ? err.message : String(err)));
    }
    e.target.value = "";
  }

  // ---- Image import ---------------------------------------------------
  function handleImportImage() {
    imageInputRef.current?.click();
  }

  function onImageFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ctx = getCtx();
      if (!ctx) return;
      stopPlayback();
      pushUndo();
      // Fit image inside canvas while preserving aspect ratio; letterbox
      // the empty area with the current bgColor so the frame stays opaque.
      const ratio = Math.min(canvasW / img.width, canvasH / img.height);
      const drawW = Math.max(1, Math.round(img.width * ratio));
      const drawH = Math.max(1, Math.round(img.height * ratio));
      const dx = Math.floor((canvasW - drawW) / 2);
      const dy = Math.floor((canvasH - drawH) / 2);
      ctx.save();
      // imageSmoothingEnabled mirrors the global ALIAS toggle so imports
      // stay pixel-crisp when aliased=ON, or upscale-smooth otherwise.
      ctx.imageSmoothingEnabled = !aliased;
      // Background fill first (replaces previous frame)
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();
      saveLiveCanvas();
      saveCurrentFrame();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert("Image illisible — formats supportés : PNG, JPG, GIF, WEBP, SVG.");
    };
    img.src = url;
    e.target.value = "";
  }

  function handleSaveAnimGif() {
    const gif = GIFEncoder();
    const delay = Math.max(20, Math.round(1000 / Math.max(fps, 1))); // ms per frame; min 20ms (50fps cap)
    const n = frameCountOf();
    for (let i = 0; i < n; i++) {
      const frameImg = compositeFrameToImageData(i);
      const palette = quantize(frameImg.data, 256);
      const index = applyPalette(frameImg.data, palette);
      gif.writeFrame(index, canvasW, canvasH, { palette, delay });
    }
    gif.finish();
    const bytes = gif.bytes();
    // Loop count: 0 = infinite, 1 = play once. GIFEncoder sets infinite by
    // default; for one-shot we slice the loop extension out — but gifenc has
    // no toggle for that, so we'll just trust the BOUCLE state by patching
    // the NETSCAPE extension. Simpler: when looping is OFF, drop the loop
    // extension entirely (bytes 13..31 in standard gifenc output start with
    // the NETSCAPE block).
    // Instead of byte surgery, we always loop — most GIF viewers ignore the
    // setting anyway. The BOUCLE toggle still affects SVG/MP4 exports.
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    // Re-wrap into a fresh ArrayBuffer to satisfy the BlobPart type (gifenc
    // returns a Uint8Array<ArrayBufferLike> which TS narrows incorrectly).
    const buf = new Uint8Array(bytes).buffer;
    downloadBlob(new Blob([buf], { type: "image/gif" }), `dpaint-anim-${ts}.gif`);
  }

  function handleSaveAnimSvg() {
    // Composite each frame's visible layers into a single ImageData
    const n = frameCountOf();
    const baked: ImageData[] = Array.from({ length: n }, (_, i) => compositeFrameToImageData(i));
    const svg = framesToAnimatedSvg(baked, canvasW, canvasH, fps, looping);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `dpaint-anim-${ts}.svg`);
  }

  const canvasStyle: React.CSSProperties = {
    width: canvasW * zoom,
    height: canvasH * zoom,
    imageRendering: aliased ? "pixelated" : "auto",
    display: "block",
    cursor:
      pasteFloat && mousePos && mousePos.x >= pasteFloat.x && mousePos.x < pasteFloat.x + pasteFloat.canvas.width
        && mousePos.y >= pasteFloat.y && mousePos.y < pasteFloat.y + pasteFloat.canvas.height
        ? "move"
      : tool === "text" ? "text"
      : tool === "stamp" ? "copy"
      : tool === "fill" ? "cell"
      : (tool === "select" && selection && mousePos && (
          selection.kind === "rect"
            ? (mousePos.x >= selection.x && mousePos.x < selection.x + selection.w &&
               mousePos.y >= selection.y && mousePos.y < selection.y + selection.h)
            : (mousePos.x >= selection.bbox.x && mousePos.x < selection.bbox.x + selection.bbox.w &&
               mousePos.y >= selection.bbox.y && mousePos.y < selection.bbox.y + selection.bbox.h)
        )) ? "move"
      : "crosshair",
  };

  return (
    <div data-theme={theme} style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: t.bg, color: t.panelText, fontFamily: "'VT323', monospace", fontSize: 16 }}>

      {/* SPLASH */}
      {splashOpen && <SplashScreen theme={t} onDismiss={() => setSplashOpen(false)} />}

      {/* LOGIN MODAL */}
      {showLogin && (
        <LoginModal
          theme={t}
          onClose={() => setShowLogin(false)}
          onSuccess={() => { setShowLogin(false); api.me().then(r => setCurrentUser(r.user)).catch(() => {}); }}
        />
      )}

      {/* PROJECTS MODAL */}
      {showProjects && (
        <ProjectsModal
          theme={t}
          currentUser={currentUser}
          onClose={() => setShowProjects(false)}
          onOpen={handleCloudOpen}
          onRequireLogin={() => { setShowProjects(false); setShowLogin(true); }}
        />
      )}

      {/* MENUBAR */}
      <div style={{ display: "flex", alignItems: "center", background: t.menubar, borderBottom: `1px solid ${t.border}`, padding: "0 4px", flexShrink: 0, height: 28 }}>
        <MenuDropdown label="IMAGE" items={(() => {
          const animOk = canvasW <= ANIM_EXPORT_MAX_W;
          const animSuffix = animOk ? "" : ` — désactivé en ${canvasW}×${canvasH}`;
          return [
            { label: "NOUVEAU", action: handleNew },
            { label: "IMPORTER IMAGE (PNG/JPG/SVG)", action: handleImportImage },
            { label: "▸ MES PROJETS (CLOUD)", action: () => setShowProjects(true) },
            { label: "▸ SAUVER DANS LE CLOUD", action: handleCloudSave },
            { label: "▸ COPIER LIEN PARTAGEABLE", action: handleShareLink },
            { label: "—", action: () => {} },
            { label: "OUVRIR PROJET (.dpaint)", action: handleOpenProject },
            { label: "SAUVER PROJET (.dpaint)", action: handleSaveProject },
            { label: "SAUVER FRAME (PNG)", action: handleSave },
            { label: "SAUVER FRAME (SVG)", action: handleSaveSvg },
            { label: "SAUVER TOUTES LES FRAMES (PNG)", action: handleSaveGif },
            { label: "SAUVER TOUTES LES FRAMES (SVG)", action: handleSaveAllSvg },
            {
              label: `SAUVER ANIMATION (GIF)${animSuffix}`,
              action: animOk ? handleSaveAnimGif : () => alert(`Export GIF désactivé au-dessus de ${ANIM_EXPORT_MAX_W}px de large (trop lourd). Repasse en AMIGA pour exporter.`),
            },
            {
              label: `SAUVER ANIMATION (SVG ANIMÉ)${animSuffix}`,
              action: animOk ? handleSaveAnimSvg : () => alert(`Export SVG animé désactivé au-dessus de ${ANIM_EXPORT_MAX_W}px de large (trop lourd). Repasse en AMIGA pour exporter.`),
            },
          ];
        })()} />
        <input
          ref={projectInputRef}
          type="file"
          accept=".dpaint,application/json"
          style={{ display: "none" }}
          onChange={onProjectFileSelected}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onImageFileSelected}
        />
        <button
          className="amiga-button"
          onClick={undo}
          disabled={!canUndo}
          title="Annuler (⌘Z)"
          style={{ padding: "2px 10px", height: 24, minWidth: 36, marginLeft: 4, opacity: canUndo ? 1 : 0.4 }}
        >↶</button>
        <button
          className="amiga-button"
          onClick={redo}
          disabled={!canRedo}
          title="Rétablir (⌘⇧Z / ⌘Y)"
          style={{ padding: "2px 10px", height: 24, minWidth: 36, opacity: canRedo ? 1 : 0.4 }}
        >↷</button>
        <MenuDropdown label="RÉSO" items={RESOLUTIONS.map(r => ({
          label: `${r.label} ${r.w}×${r.h}${r.w === canvasW && r.h === canvasH ? " ✓" : ""}`,
          action: () => {
            if (r.w === canvasW && r.h === canvasH) return;
            if (hasAnyContent() && !confirm(`Passer en ${r.label} (${r.w}×${r.h}) ? Toutes les frames seront rescalées au plus proche voisin.`)) return;
            switchResolution(r.w, r.h);
          },
        }))} />
        <MenuDropdown label="ZOOM" items={ZOOM_LEVELS.map(z => ({
          label: `x${z}${z === 12 ? "  (4K)" : ""}${!fit && z === zoom ? " ✓" : ""}`,
          action: () => { setFit(false); setZoom(z); },
        }))} />
        <button
          className="amiga-button"
          onClick={() => setFit(v => !v)}
          data-active={fit}
          title="REMPLIR LA FENÊTRE (AUTO-ZOOM)"
          style={{ padding: "2px 10px", height: 24, marginLeft: 4 }}
        >
          {fit ? "FIT ON" : "FIT"}
        </button>
        <button
          className="amiga-button"
          onClick={() => { setFit(false); setZoom(12); }}
          data-active={!fit && zoom === 12}
          title="ZOOM x12 — REMPLIT UN ÉCRAN 4K"
          style={{ padding: "2px 10px", height: 24, marginLeft: 4 }}
        >
          4K
        </button>
        <button
          className="amiga-button"
          onClick={() => setAliased(v => !v)}
          data-active={aliased}
          title={aliased ? "RENDU ALIASÉ (PIXEL ART)" : "RENDU LISSÉ (ANTI-ALIASING)"}
          style={{ padding: "2px 10px", height: 24, marginLeft: 4 }}
        >
          {aliased ? "ALIAS ON" : "ALIAS OFF"}
        </button>
        <MenuDropdown label="PALETTE" items={PALETTES.map(p => ({
          label: `${p.label} (${p.colors.length})${p.id === paletteId ? " ✓" : ""}`,
          action: () => setPaletteId(p.id),
        }))} />
        <button
          className="amiga-button"
          onClick={() => setTheme(theme === "light" ? "night" : "light")}
          data-active={theme === "night"}
          title="THÈME — JOUR / NUIT"
          style={{ padding: "2px 10px", height: 24, marginLeft: 4 }}
        >
          {theme === "night" ? "☾ NUIT" : "☀ JOUR"}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {currentUser ? (
            <>
              <span style={{ color: t.menubarText, fontSize: 12, opacity: 0.85 }}>{currentUser.email}</span>
              <button
                className="amiga-button"
                onClick={async () => {
                  try { await api.logout(); } catch {}
                  setCurrentUser(null);
                  setCloudProject(null);
                }}
                title="Se déconnecter"
                style={{ padding: "2px 10px", height: 24 }}
              >LOGOUT</button>
            </>
          ) : (
            <button
              className="amiga-button"
              onClick={() => setShowLogin(true)}
              title="Se connecter pour sauvegarder dans le cloud"
              style={{ padding: "2px 10px", height: 24 }}
            >LOGIN</button>
          )}
          <div style={{ color: t.menubarText, fontSize: 14, paddingRight: 8, letterSpacing: 1 }}>
            DELUXE PAINT · PEOPLE OF VERSO
          </div>
        </div>
      </div>

      {/* MAIN AREA */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* TOOLBOX */}
        <div className="amiga-panel" style={{ width: 54, display: "flex", flexDirection: "column", gap: 2, padding: 4, flexShrink: 0, overflowY: "auto" }}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className="amiga-button"
              data-active={tool === t.id}
              title={t.label}
              onClick={() => setTool(t.id)}
              style={{ width: "100%", height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "inherit" }}
            >
              <Icon name={t.icon} size={22} />
            </button>
          ))}
          <div style={{ marginTop: 8, borderTop: `1px solid ${t.border}`, paddingTop: 4 }}>
            <div style={{ color: t.panelText, fontSize: 10, textAlign: "center", marginBottom: 2 }}>TAILLE</div>
            <input
              type="number"
              min={BRUSH_SIZE_MIN}
              max={BRUSH_SIZE_MAX}
              step={1}
              value={brushSize}
              onChange={e => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setBrushSize(Math.max(BRUSH_SIZE_MIN, Math.min(BRUSH_SIZE_MAX, Math.round(v))));
              }}
              title={`Taille libre (${BRUSH_SIZE_MIN}–${BRUSH_SIZE_MAX} px)`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#FFF",
                color: t.panelText,
                border: `1px solid ${t.border}`,
                padding: "2px 2px",
                fontFamily: "'VT323', monospace",
                fontSize: 14,
                textAlign: "center",
                marginBottom: 4,
              }}
            />
            {BRUSH_SIZES.map(s => (
              <button
                key={s}
                className="amiga-button"
                data-active={brushSize === s}
                onClick={() => setBrushSize(s)}
                title={`${s} px`}
                style={{ width: "100%", height: 22, marginBottom: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: 0 }}
              >
                <div style={{ width: Math.min(s, 12) + 2, height: Math.min(s, 12) + 2, background: "#000", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: t.panelText, lineHeight: 1, fontFamily: "'VT323', monospace" }}>{s}</span>
              </button>
            ))}
          </div>
          {/* Brush shape (applies to the pencil) */}
          <div style={{ marginTop: 8, borderTop: `1px solid ${t.border}`, paddingTop: 4 }}>
            <div style={{ color: t.panelText, fontSize: 10, textAlign: "center", marginBottom: 2 }}>FORME</div>
            {BRUSH_SHAPES.map(s => (
              <button
                key={s.id}
                className="amiga-button"
                data-active={brushShape === s.id}
                onClick={() => setBrushShape(s.id)}
                title={s.label}
                style={{
                  width: "100%",
                  height: 26,
                  marginBottom: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  padding: 0,
                  color: s.id === "bug" ? "#E61B1B" : "inherit",
                  fontWeight: s.id === "bug" ? "bold" : "normal",
                }}
              >
                <Icon name={s.icon} size={16} />
                <span style={{ fontSize: 10, lineHeight: 1, fontFamily: "'VT323', monospace", letterSpacing: 0.5 }}>{s.label}</span>
              </button>
            ))}
          </div>
          {/* Color swatches */}
          <div style={{ marginTop: 8, borderTop: `1px solid ${t.border}`, paddingTop: 4 }}>
            <div style={{ position: "relative", width: isCoarsePointer ? 46 : 46, height: isCoarsePointer ? 44 : 36 }}>
              <div style={{ position: "absolute", right: 0, bottom: 0, width: isCoarsePointer ? 30 : 24, height: isCoarsePointer ? 30 : 24, background: bgColor, border: `1px solid ${t.border}`, cursor: "pointer" }}
                title="Couleur de fond (clic droit)" />
              <div style={{ position: "absolute", left: 0, top: 0, width: isCoarsePointer ? 30 : 24, height: isCoarsePointer ? 30 : 24, background: fgColor, border: `2px solid ${t.accent}`, cursor: "pointer" }}
                title="Couleur principale" />
            </div>
          </div>
        </div>

        {/* CANVAS AREA */}
        <div ref={canvasAreaRef} style={{ flex: 1, overflow: spinMode === "turn" ? "hidden" : "auto", display: "flex", alignItems: "center", justifyContent: "center", background: t.canvasBg, position: "relative" }}>
          <div ref={canvasWrapRef} style={{ position: "relative", margin: 16, display: "inline-block", transformOrigin: "center center", willChange: spinMode === "turn" ? "transform" : undefined }}>
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              style={{ ...canvasStyle, position: "relative", zIndex: 1, border: `1px solid ${t.border}` }}
              onPointerDown={onMouseDown}
              onPointerMove={onMouseMove}
              onPointerUp={onMouseUp}
              onPointerLeave={onMouseLeave}
              onPointerCancel={onMouseUp}
              onContextMenu={e => e.preventDefault()}
            />
            <canvas
              ref={overlayRef}
              width={canvasW}
              height={canvasH}
              style={{ ...canvasStyle, position: "absolute", top: 0, left: 0, zIndex: 2, pointerEvents: "none" }}
            />
          </div>
        </div>
      </div>

      {/* PASTE FLOAT — interactive placement bar */}
      {pasteFloat && (
        <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: t.panelText, fontSize: 14, fontWeight: "bold" }}>COLLAGE FLOTTANT :</div>
            <div style={{ color: t.panelText, fontSize: 12, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
              {pasteFloat.x},{pasteFloat.y} · {pasteFloat.canvas.width}×{pasteFloat.canvas.height} px
            </div>
            <button className="amiga-button" onClick={commitPasteFloat} title="Pose le collage (Enter)" style={{ padding: "2px 10px" }}>POSER</button>
            <button className="amiga-button" onClick={cancelPasteFloat} title="Annule le collage (ESC)" style={{ padding: "2px 10px" }}>ANNULER</button>
            <div style={{ color: t.panelText, opacity: 0.55, fontSize: 12, marginLeft: "auto" }}>
              GLISSE POUR DÉPLACER · ENTER POSE · ESC ANNULE
            </div>
          </div>
        </div>
      )}

      {/* SELECTION CONFIG + ACTIONS — visible when the SÉLECTION tool is
          active OR when there's already a selection on the canvas. */}
      {!pasteFloat && (tool === "select" || selection) && (
        <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: t.panelText, fontSize: 14, fontWeight: "bold" }}>SÉLECTION :</div>

            {/* Mode toggle (RECT / LASSO) */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                className="amiga-button"
                data-active={selectMode === "rect"}
                onClick={() => setSelectMode("rect")}
                title="Sélection rectangulaire"
                style={{ padding: "2px 8px" }}
              >RECT</button>
              <button
                className="amiga-button"
                data-active={selectMode === "lasso"}
                onClick={() => setSelectMode("lasso")}
                title="Sélection libre (lasso)"
                style={{ padding: "2px 8px" }}
              >LASSO</button>
            </div>

            {selection && (
              <div style={{ color: t.panelText, fontSize: 12, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                {(() => {
                  const b = selection.kind === "rect" ? selection : selection.bbox;
                  return `${selection.kind === "lasso" ? "⌒ " : ""}${b.x},${b.y} · ${b.w}×${b.h} px`;
                })()}
              </div>
            )}

            {selection && (
              <>
                <button className="amiga-button" onClick={copySelection} title="Copier (⌘C)" style={{ padding: "2px 10px" }}>COPIER</button>
                <button className="amiga-button" onClick={() => { copySelection(); eraseSelection(); }} title="Couper (⌘X)" style={{ padding: "2px 10px" }}>COUPER</button>
              </>
            )}
            {/* Paste is available whenever the clipboard has content,
                even without an active selection on the canvas. */}
            <button
              key={clipboardKey}
              className="amiga-button"
              onClick={pasteClipboard}
              disabled={!clipboardRef.current}
              title="Coller (⌘V) — colle au point d'origine"
              style={{ padding: "2px 10px", opacity: clipboardRef.current ? 1 : 0.4 }}
            >COLLER</button>
            {selection && (
              <>
                <button
                  className="amiga-button"
                  onClick={detourSelection}
                  title="Détoure : isole la forme, le reste devient la couleur de fond (canvas inchangé)"
                  style={{ padding: "2px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>✂</span>
                  DÉTOURER
                </button>
                <button
                  className="amiga-button"
                  onClick={cropFrameToSelection}
                  title="Recadre le canvas et toutes les frames à la sélection (change la taille du projet)"
                  style={{ padding: "2px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" aria-hidden>
                    {/* Crop marks: # shape with 4 right-angle brackets */}
                    <path d="M3 9 L21 9 M3 15 L21 15 M9 3 L9 21 M15 3 L15 21" />
                  </svg>
                  RECADRER
                </button>
                <button className="amiga-button" onClick={eraseSelection} title="Efface le contenu (couleur de fond)" style={{ padding: "2px 10px" }}>EFFACER</button>
                <button className="amiga-button" onClick={() => setSelection(null)} title="Annule la sélection (ESC)" style={{ padding: "2px 10px" }}>ANNULER</button>
              </>
            )}

            <div style={{ color: t.panelText, opacity: 0.55, fontSize: 12, marginLeft: "auto" }}>
              ⌘C/⌘X/⌘V · DEL EFFACER · ESC ANNULER
            </div>
          </div>
        </div>
      )}

      {/* TAMPON tool config — preview of the current clipboard + scale */}
      {tool === "stamp" && (
        <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: t.panelText, fontSize: 14, fontWeight: "bold" }}>TAMPON :</div>
            {clipboardRef.current ? (
              <>
                <div
                  style={{
                    width: 48, height: 48,
                    border: `1px solid ${t.border}`,
                    background: theme === "night" ? "#222" : "#F0EFED",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    imageRendering: "pixelated",
                  }}
                  title={`${clipboardRef.current.canvas.width}×${clipboardRef.current.canvas.height}`}
                  ref={el => {
                    if (!el || !clipboardRef.current) return;
                    // Build a small img preview each render
                    el.innerHTML = "";
                    const cb = clipboardRef.current.canvas;
                    const img = document.createElement("img");
                    img.src = cb.toDataURL();
                    img.style.maxWidth = "100%";
                    img.style.maxHeight = "100%";
                    img.style.imageRendering = "pixelated";
                    el.appendChild(img);
                  }}
                  key={clipboardKey}
                />
                <span style={{ color: t.panelText, fontSize: 12, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                  {clipboardRef.current.canvas.width}×{clipboardRef.current.canvas.height} px
                </span>
                <span style={{ color: t.panelText, fontSize: 14 }}>ÉCHELLE :</span>
                <input
                  type="range" min={25} max={400} value={Math.round(stampScale * 100)}
                  onChange={e => setStampScale(Number(e.target.value) / 100)}
                  style={{ width: 100, accentColor: t.accent }}
                />
                <span style={{ color: t.panelText, fontSize: 12, minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(stampScale * 100)}%
                </span>
                <div style={{ color: t.panelText, opacity: 0.55, fontSize: 12, marginLeft: "auto" }}>
                  CLIQUE OU GLISSE POUR TAMPONNER
                </div>
              </>
            ) : (
              <div style={{ color: t.panelText, opacity: 0.7, fontSize: 13 }}>
                Presse-papier vide — sélectionne quelque chose puis ⌘C (ou DÉTOURER) pour charger le tampon.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TEXT-TOOL CONFIG (visible only when text tool is active) */}
      {tool === "text" && (
        <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: t.panelText, fontSize: 14 }}>TEXTE (TAMPON) :</div>
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder="Tape ton texte puis clique"
              style={{
                background: "#FFF",
                color: t.panelText,
                border: `1px solid ${t.border}`,
                padding: "2px 6px",
                fontFamily: (allFonts[textFontIdx] ?? TEXT_FONTS[0]).family,
                fontSize: 14,
                minWidth: 200,
                flex: "1 1 200px",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={{ color: t.panelText, fontSize: 14 }}>POLICE :</span>
              {TEXT_FONTS.map((f, i) => (
                <button
                  key={f.label}
                  className="amiga-button"
                  data-active={textFontIdx === i}
                  onClick={() => setTextFontIdx(i)}
                  style={{ padding: "2px 8px", color: t.panelText, fontFamily: f.family }}
                  title={f.label}
                >
                  {f.label}
                </button>
              ))}
              {googleFonts.map((f, gi) => {
                const idx = TEXT_FONTS.length + gi;
                return (
                  <span
                    key={f.family}
                    style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                  >
                    <button
                      className="amiga-button"
                      data-active={textFontIdx === idx}
                      onClick={() => setTextFontIdx(idx)}
                      style={{ padding: "2px 8px", color: t.panelText, fontFamily: f.family }}
                      title={`${f.label} (Google Font)`}
                    >
                      {f.label}
                    </button>
                    <button
                      className="amiga-button"
                      onClick={() => { if (confirm(`Retirer "${f.label}" de la liste ?`)) handleRemoveGoogleFont(gi); }}
                      title="Retirer cette police Google"
                      style={{ padding: "0 4px", fontSize: 10, color: "#C04849" }}
                    >×</button>
                  </span>
                );
              })}
              <MenuDropdown
                label="+ GOOGLE ▾"
                items={[
                  ...POPULAR_GOOGLE_FONTS.flatMap(group => [
                    { label: `— ${group.group} —`, action: () => {} },
                    ...group.names.map(name => ({
                      label: `   ${name}`,
                      action: () => loadAndAddGoogleFont(name),
                    })),
                  ]),
                  { label: "—", action: () => {} },
                  { label: "✎ Autre… (nom exact)", action: handleAddGoogleFont },
                ]}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={{ color: t.panelText, fontSize: 14 }}>TAILLE :</span>
              <input
                type="number"
                min={TEXT_SIZE_MIN}
                max={TEXT_SIZE_MAX}
                step={1}
                value={textSize}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setTextSize(Math.max(TEXT_SIZE_MIN, Math.min(TEXT_SIZE_MAX, Math.round(v))));
                }}
                style={{
                  background: "#FFF",
                  color: t.panelText,
                  border: `1px solid ${t.border}`,
                  padding: "2px 4px",
                  fontFamily: "'VT323', monospace",
                  fontSize: 14,
                  width: 64,
                }}
                title={`Taille libre (${TEXT_SIZE_MIN}–${TEXT_SIZE_MAX} px)`}
              />
              <span style={{ color: t.panelText, fontSize: 12 }}>px</span>
              {TEXT_SIZES.map(s => (
                <button
                  key={s}
                  className="amiga-button"
                  data-active={textSize === s}
                  onClick={() => setTextSize(s)}
                  style={{ padding: "2px 6px", color: t.panelText, minWidth: 32 }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ color: t.panelText, opacity: 0.55, fontSize: 12, marginLeft: "auto" }}>
              {(allFonts[textFontIdx]?.pixel) ? "PIXEL · " : "HD · "}
              CLIC SUR LE CANVAS POUR TAMPONNER
            </div>
          </div>
        </div>
      )}

      {/* SCRATCH / SCRUB PANEL — drag the slider to "scratch" the animation;
          if REC is on, this scratching is baked into the recorded video. */}
      <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: t.panelText, fontSize: 14, fontWeight: "bold", minWidth: 70 }}>SCRATCH :</span>
          <button
            className="amiga-button"
            onClick={() => setPlayDir(playDir === 1 ? -1 : 1)}
            data-active={playDir === -1}
            title="SENS DE LECTURE — INVERSER"
            style={{ padding: "2px 8px", color: t.panelText, minWidth: 56 }}
          >
            {playDir === -1 ? "◀◀ REV" : "▶▶ FWD"}
          </button>
          {([1, 2, 4] as const).map(s => (
            <button
              key={s}
              className="amiga-button"
              onClick={() => setPlaySpeed(s)}
              data-active={playSpeed === s}
              title={`VITESSE ×${s}`}
              style={{ padding: "2px 6px", color: t.panelText, minWidth: 28 }}
            >
              {s}×
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={Math.max(0, frameCount - 1)}
            value={currentFrame}
            step={1}
            onMouseDown={() => { if (playing) stopPlayback(); }}
            onTouchStart={() => { if (playing) stopPlayback(); }}
            onChange={e => switchToFrame(Number(e.target.value))}
            style={{ flex: 1, minWidth: 100, cursor: "grab", accentColor: "#191919" }}
            title="GLISSE POUR SCRATCHER L'ANIMATION (CAPTURÉ PAR REC)"
            disabled={frameCount < 2}
          />
          <span style={{ color: t.panelText, fontSize: 12, minWidth: 80, fontVariantNumeric: "tabular-nums" }}>
            {String(currentFrame + 1).padStart(3, "0")} / {String(frameCount).padStart(3, "0")}
          </span>

          {/* TABLE — turntable / pano-loop drawing modes */}
          <span style={{ color: t.panelText, fontSize: 14, fontWeight: "bold", marginLeft: 12 }}>TABLE :</span>
          <button
            className="amiga-button"
            data-active={spinMode === "off"}
            onClick={() => setSpinMode("off")}
            title="Canvas fixe (normal)"
            style={{ padding: "2px 8px", color: t.panelText }}
          >FIXE</button>
          <button
            className="amiga-button"
            data-active={spinMode === "turn"}
            onClick={() => setSpinMode("turn")}
            title="Le canvas tourne comme une platine vinyle — pinceau immobile = spirales (spin art). REC capture le canvas non-tourné."
            style={{ padding: "2px 8px", color: t.panelText }}
          >⟳ PLATINE</button>
          <button
            className="amiga-button"
            data-active={spinMode === "pan"}
            onClick={() => {
              // The selection/paste overlays don't track the pan offset —
              // clear them so the marquee can't end up visually desynced.
              setSelection(null);
              if (pasteFloatRef.current) cancelPasteFloat();
              setSpinMode("pan");
            }}
            title="Le canvas défile en boucle horizontale — les traits se recousent au bord (panorama sans couture)"
            style={{ padding: "2px 8px", color: t.panelText }}
          >⇄ PANO</button>
          {spinMode !== "off" && (
            <>
              <input
                type="range"
                min={-100}
                max={100}
                value={spinSpeed}
                onChange={e => setSpinSpeed(Number(e.target.value))}
                style={{ width: 90, accentColor: t.accent }}
                title="Vitesse (négatif = sens inverse)"
              />
              <span style={{ color: t.panelText, fontSize: 12, minWidth: 70, fontVariantNumeric: "tabular-nums" }}>
                {spinMode === "turn"
                  ? `${(spinSpeed * 0.4).toFixed(1)} RPM`
                  : spinSpeed === 0 ? "pause" : `${(400 / Math.abs(spinSpeed)).toFixed(1)}s/boucle`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* LAYER PANEL — calques (pistes) */}
      <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: t.panelText, fontSize: 14, fontWeight: "bold" }}>CALQUES :</span>
          <button className="amiga-button" onClick={addNewLayer} title="Nouveau calque au-dessus de l'actif" style={{ padding: "2px 8px" }}>+ CALQUE</button>
          <div style={{ display: "flex", gap: 4, overflowX: "auto", flex: 1, alignItems: "center" }} key={`layers-${layerVersion}`}>
            {layersRef.current.map((layer, i) => {
              const isActive = i === activeLayerIdx;
              return (
                <div
                  key={layer.id}
                  onClick={() => selectLayer(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 6px",
                    cursor: "pointer",
                    background: isActive ? `${t.accent}22` : "transparent",
                    border: `1px solid ${isActive ? t.accent : t.border}`,
                    color: t.panelText,
                    fontSize: 12,
                    minWidth: 100,
                  }}
                  title={isActive ? "Calque actif" : "Cliquer pour activer"}
                >
                  <button
                    onClick={e => { e.stopPropagation(); toggleLayerVisible(i); }}
                    title={layer.visible ? "Masquer" : "Afficher"}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: t.panelText, fontSize: 14, padding: "0 2px", opacity: layer.visible ? 1 : 0.35 }}
                  >
                    {layer.visible ? "👁" : "·"}
                  </button>
                  <span style={{ fontWeight: isActive ? "bold" : "normal", flex: 1 }}>{layer.name}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(layer.opacity * 100)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setLayerOpacity(i, Number(e.target.value) / 100)}
                    title={`Opacité ${Math.round(layer.opacity * 100)}%`}
                    style={{ width: 50, accentColor: t.accent }}
                  />
                  {layersRef.current.length > 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm(`Supprimer "${layer.name}" ?`)) deleteLayer(i); }}
                      title="Supprimer le calque"
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "#AA0000", fontSize: 14, padding: "0 2px" }}
                    >×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ANIMATION PANEL */}
      <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Playback controls */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="amiga-button" onClick={() => switchToFrame(0)} title="DEBUT" style={{ padding: "2px 6px" }}>|◀</button>
            <button className="amiga-button" onClick={() => switchToFrame(Math.max(0, currentFrame - 1))} title="PRECEDENT" style={{ padding: "2px 6px" }}>◀</button>
            {playing ? (
              <button className="amiga-button" onClick={stopPlayback} style={{ padding: "2px 10px", background: "#FF6600", color: "#FFF", fontWeight: "bold" }}>STOP</button>
            ) : (
              <button className="amiga-button" onClick={startPlayback} style={{ padding: "2px 10px", background: "#006600", color: "#FFF", fontWeight: "bold" }}>PLAY</button>
            )}
            <button className="amiga-button" onClick={() => switchToFrame(Math.min(frameCount - 1, currentFrame + 1))} title="SUIVANT" style={{ padding: "2px 6px" }}>▶</button>
            <button className="amiga-button" onClick={() => switchToFrame(frameCount - 1)} title="FIN" style={{ padding: "2px 6px" }}>▶|</button>
            {recording ? (
              <button
                className="amiga-button"
                onClick={stopRecording}
                title="ARRETER L'ENREGISTREMENT"
                style={{ padding: "2px 8px", background: "#000", color: "#FF3030", fontWeight: "bold", border: "2px solid #FF3030" }}
              >
                ■ REC {Math.floor(recDuration / 60).toString().padStart(2, "0")}:{(recDuration % 60).toString().padStart(2, "0")}
              </button>
            ) : (
              <button
                className="amiga-button"
                onClick={startRecording}
                title="ENREGISTRER LA SESSION EN VIDEO"
                style={{ padding: "2px 8px", background: "#AA0000", color: "#FFF", fontWeight: "bold" }}
              >
                ● REC
              </button>
            )}
          </div>

          {/* Loop toggle — affects PLAY only (boucle infinie vs lecture une fois) */}
          <button
            className="amiga-button"
            data-active={looping}
            onClick={() => { const v = !looping; setLooping(v); loopingRef.current = v; }}
            style={{ padding: "2px 8px", color: looping ? "#00CC44" : t.panelText }}
            title={looping ? "PLAY boucle à l'infini — clic pour passer en lecture une fois" : "PLAY joue une fois et s'arrête — clic pour activer la boucle"}
          >
            {looping ? "↻ BOUCLE" : "→ 1 FOIS"}
          </button>

          {/* FPS */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: t.panelText, fontSize: 14 }}>
            <span>VIT:</span>
            <input
              type="range" min={1} max={24} value={fps}
              onChange={e => setFps(Number(e.target.value))}
              style={{ width: 60 }}
            />
            <span style={{ minWidth: 24 }}>{fps}</span>
          </div>

          {/* Frame counter */}
          <div style={{ color: t.panelText, minWidth: 70, fontSize: 14 }}>
            IMG {currentFrame + 1}/{frameCount}
          </div>

          {/* Frame management */}
          <button className="amiga-button" onClick={addFrame} title="AJOUTER UNE FRAME" style={{ padding: "2px 6px" }}>+IMG</button>
          <button className="amiga-button" onClick={duplicateFrame} title="DUPLIQUER LA FRAME" style={{ padding: "2px 6px" }}>DUPL</button>
          <button className="amiga-button" onClick={deleteFrame} title="SUPPRIMER LA FRAME" style={{ padding: "2px 6px", color: "#AA0000" }}>DEL</button>

          {/* Frame strip */}
          <div style={{ display: "flex", gap: 2, overflowX: "auto", flex: 1, alignItems: "center" }}>
            {Array.from({ length: frameCount }, (_, i) => (
              <FrameThumb
                key={`${i}-${layerVersion}`}
                index={i}
                current={currentFrame === i}
                frameData={getThumbForRender(i)}
                onClick={() => !playing && switchToFrame(i)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* PALETTE + STATUS */}
      <div className="amiga-panel" style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: "4px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Palette */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 10, color: t.panelText, opacity: 0.7 }}>
              {activePalette.label} · {activePalette.colors.length} couleurs
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${activePalette.width}, ${swatchSize}px)`,
                gap: isCoarsePointer ? 4 : 2,
              }}
            >
              {activePalette.colors.map((color, i) => (
                <div
                  key={`${activePalette.id}-${i}-${color}`}
                  style={{
                    width: swatchSize,
                    height: swatchSize,
                    background: color,
                    border: fgColor === color ? `2px solid ${t.accent}` : bgColor === color ? "2px dashed " + t.accent : `1px solid ${t.border}`,
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                  title={color}
                  onClick={() => setFgColor(color)}
                  onContextMenu={e => { e.preventDefault(); setBgColor(color); }}
                />
              ))}
            </div>
          </div>

          {/* Status bar */}
          <div style={{ flex: 1, color: t.panelText, fontSize: 14, paddingLeft: 8 }}>
            <div>OUTIL: {TOOLS.find(t => t.id === tool)?.label ?? tool.toUpperCase()}</div>
            <div>POS: {mousePos ? `${mousePos.x},${mousePos.y}` : "--,--"}</div>
            <div>ZOOM: x{zoom < 1 ? zoom.toFixed(2) : zoom}{fit ? " (FIT)" : ""}</div>
          </div>

          {/* FG/BG color display */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 11, color: t.panelText }}>AVANT</div>
            <div style={{ width: isCoarsePointer ? 44 : 32, height: isCoarsePointer ? 24 : 16, background: fgColor, border: `1px solid ${t.border}` }} />
            <div style={{ fontSize: 11, color: t.panelText }}>FOND</div>
            <div style={{ width: isCoarsePointer ? 44 : 32, height: isCoarsePointer ? 24 : 16, background: bgColor, border: `1px solid ${t.border}` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Mini frame thumbnail component
function FrameThumb({ index, current, frameData, onClick }: {
  index: number;
  current: boolean;
  // Pre-scaled 48×30 canvas from the parent's thumb cache (no readbacks)
  frameData: HTMLCanvasElement | null;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (frameData) {
      ctx.drawImage(frameData, 0, 0);
    } else {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, 48, 30);
    }
  }, [frameData]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }} onClick={onClick}>
      <canvas
        ref={ref}
        width={48}
        height={30}
        style={{
          border: current ? "2px solid #FF8800" : "1px solid #000",
          imageRendering: "pixelated",
          display: "block",
        }}
      />
      <div style={{ fontSize: 11, color: "currentColor" }}>{index + 1}</div>
    </div>
  );
}

// Simple dropdown menu
function MenuDropdown({ label, items }: { label: string; items: { label: string; action: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="amiga-button"
        onClick={() => setOpen(v => !v)}
        style={{ padding: "2px 10px", height: 24 }}
      >
        {label}
      </button>
      {open && (
        <div className="amiga-panel" style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, minWidth: 200 }}>
          {items.map(item => (
            <button
              key={item.label}
              className="amiga-button"
              onClick={() => { item.action(); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 8px", color: "currentColor" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Splash screen — full-screen overlay shown on app load, click/key dismisses.
// Auto-hides after 2.5s if untouched.
// Common modal shell — backdrop + centered card
function ModalShell({ theme: t, onClose, children, width = 480 }: { theme: ThemeColors; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'VT323', monospace",
    }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: t.panel, color: t.panelText,
          border: `1px solid ${t.border}`,
          padding: 24, width: "90%", maxWidth: width, maxHeight: "90vh", overflow: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LoginModal({ theme: t, onClose, onSuccess }: { theme: ThemeColors; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending"); setError("");
    try {
      await api.login(email);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }
  return (
    <ModalShell theme={t} onClose={onClose} width={420}>
      <h2 style={{ fontSize: 22, margin: "0 0 16px", letterSpacing: 1 }}>CONNEXION</h2>
      {status === "sent" ? (
        <div>
          <p>📧 Vérifie ta boîte <strong>{email}</strong>.</p>
          <p style={{ fontSize: 13, opacity: 0.75 }}>
            On t'a envoyé un lien magique. Clique-le pour te connecter (valable 15 minutes).
            Il s'ouvre dans ce navigateur et te ramène ici.
          </p>
          <button className="amiga-button" onClick={onSuccess} style={{ padding: "6px 14px", marginTop: 16 }}>OK</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p style={{ marginTop: 0, fontSize: 13, opacity: 0.75 }}>
            Connexion sans mot de passe. Entre ton email, on t'envoie un lien magique à cliquer.
          </p>
          <input
            type="email"
            autoFocus
            required
            placeholder="email@exemple.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={status === "sending"}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "8px 10px", marginTop: 8,
              background: "#FFF", color: "#000",
              border: `2px solid ${t.border}`,
              fontFamily: "'VT323', monospace", fontSize: 18,
            }}
          />
          {error && <div style={{ color: "#C04849", marginTop: 8, fontSize: 13 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button type="button" className="amiga-button" onClick={onClose} style={{ padding: "6px 14px" }}>ANNULER</button>
            <button type="submit" className="amiga-button" disabled={status === "sending"} style={{ padding: "6px 14px", fontWeight: "bold" }}>
              {status === "sending" ? "ENVOI…" : "ENVOYER LE LIEN"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function ProjectsModal({ theme: t, currentUser, onClose, onOpen, onRequireLogin }: {
  theme: ThemeColors;
  currentUser: ApiUser | null;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
  onRequireLogin: () => void;
}) {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!currentUser) { setLoading(false); return; }
    api.listProjects()
      .then(r => { setProjects(r.projects); setLoading(false); })
      .catch(err => { setError(err instanceof ApiError ? err.message : String(err)); setLoading(false); });
  }, [currentUser]);
  async function del(id: string, name: string) {
    if (!confirm(`Supprimer définitivement "${name}" ?`)) return;
    try {
      await api.deleteProject(id);
      setProjects(p => p?.filter(x => x.id !== id) ?? null);
    } catch (err) {
      alert("Erreur : " + (err instanceof ApiError ? err.message : String(err)));
    }
  }
  function copyLink(id: string) {
    const url = `${window.location.origin}/p/${id}`;
    navigator.clipboard?.writeText(url).then(
      () => alert(`Lien copié :\n${url}`),
      () => prompt("Copie le lien :", url),
    );
  }
  return (
    <ModalShell theme={t} onClose={onClose} width={640}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, margin: 0, letterSpacing: 1 }}>MES PROJETS</h2>
        <button className="amiga-button" onClick={onClose} style={{ padding: "4px 10px" }}>×</button>
      </div>
      {!currentUser ? (
        <div>
          <p style={{ opacity: 0.8 }}>Connecte-toi pour accéder à tes projets sauvegardés dans le cloud.</p>
          <button className="amiga-button" onClick={onRequireLogin} style={{ padding: "6px 14px", marginTop: 8, fontWeight: "bold" }}>
            SE CONNECTER
          </button>
        </div>
      ) : loading ? (
        <div style={{ opacity: 0.7 }}>Chargement…</div>
      ) : error ? (
        <div style={{ color: "#C04849" }}>{error}</div>
      ) : !projects || projects.length === 0 ? (
        <div style={{ opacity: 0.7 }}>
          Aucun projet pour l'instant. Crée une animation puis utilise <strong>IMAGE › SAUVER DANS LE CLOUD</strong>.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {projects.map(p => (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px",
              border: `1px solid ${t.border}`,
              background: "transparent",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                  {p.width}×{p.height} · {p.frameCount} frame{p.frameCount > 1 ? "s" : ""}
                  {" · "}{p.isPublic ? "public" : "privé"}
                  {" · "}MAJ {new Date(p.updatedAt).toLocaleString("fr-FR")}
                </div>
              </div>
              <button className="amiga-button" onClick={() => onOpen(p.id)} title="Ouvrir" style={{ padding: "4px 10px" }}>OUVRIR</button>
              <button className="amiga-button" onClick={() => copyLink(p.id)} title="Copier le lien partageable" style={{ padding: "4px 10px" }}>LIEN</button>
              <button className="amiga-button" onClick={() => del(p.id, p.name)} title="Supprimer" style={{ padding: "4px 10px", color: "#C04849" }}>×</button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function SplashScreen({ theme: t, onDismiss }: { theme: ThemeColors; onDismiss: () => void }) {
  useEffect(() => {
    const onKey = () => onDismiss();
    window.addEventListener("keydown", onKey, { once: true });
    const timer = setTimeout(onDismiss, 2500);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [onDismiss]);

  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: t.bg,
        color: t.panelText,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontFamily: "'VT323', monospace",
        userSelect: "none",
        animation: "splashFade 2.5s ease-in forwards",
      }}
    >
      <style>{`
        @keyframes splashFade {
          0%, 75%   { opacity: 1; }
          100%      { opacity: 0; pointer-events: none; }
        }
        @keyframes splashPulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.03); }
        }
        @keyframes splashSlide {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      <div style={{
        fontSize: "min(14vw, 140px)",
        letterSpacing: "0.05em",
        lineHeight: 1,
        animation: "splashPulse 1.4s ease-in-out infinite",
      }}>
        DELUXE PAINT
      </div>

      <div style={{
        marginTop: 24,
        fontSize: "min(3.5vw, 32px)",
        letterSpacing: "0.4em",
        opacity: 0.9,
        animation: "splashSlide 0.6s ease-out 0.2s both",
      }}>
        PEOPLE · OF · VERSO
      </div>

      {/* Small Amiga-style palette strip for character */}
      <div style={{
        marginTop: 48,
        display: "flex",
        gap: 0,
        animation: "splashSlide 0.6s ease-out 0.4s both",
      }}>
        {["#FF1F1F", "#FF8800", "#FFEE00", "#44FF44", "#00CCCC", "#5588FF", "#AA44FF", "#FFFFFF"].map(c => (
          <div key={c} style={{ width: 24, height: 8, background: c }} />
        ))}
      </div>

      <div style={{
        position: "absolute",
        bottom: 32,
        fontSize: 14,
        letterSpacing: "0.2em",
        opacity: 0.6,
      }}>
        CLIQUE POUR ENTRER
      </div>
    </div>
  );
}
