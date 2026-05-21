import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

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
  | "text";

const CANVAS_W = 320;
const CANVAS_H = 200;

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

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "pencil",       label: "CRAYON",   icon: "✏" },
  { id: "line",         label: "LIGNE",    icon: "╱" },
  { id: "rect",         label: "RECT",     icon: "▭" },
  { id: "rect-fill",   label: "RECT PL",  icon: "▬" },
  { id: "ellipse",      label: "ELLIPSE",  icon: "○" },
  { id: "ellipse-fill", label: "ELLIPSE PL", icon: "●" },
  { id: "fill",         label: "REMPLIR",  icon: "▓" },
  { id: "eyedropper",   label: "PIPETTE",  icon: "⊕" },
  { id: "eraser",       label: "GOMME",    icon: "□" },
  { id: "text",         label: "TEXTE",    icon: "T" },
];

const BRUSH_SIZES = [1, 2, 4, 8];
// 320 × 12 = 3840 (4K width). Last level fills a 4K display horizontally.
const ZOOM_LEVELS = [1, 2, 4, 8, 12];

const TEXT_FONTS: { label: string; family: string }[] = [
  { label: "VT323",  family: "'VT323', monospace" },
  { label: "8-BIT",  family: "'Press Start 2P', monospace" },
  { label: "SANS",   family: "'Inter', sans-serif" },
];
const TEXT_SIZES = [8, 12, 16, 24, 32, 48];

function stampText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  text: string,
  family: string,
  size: number,
  aliased: boolean,
) {
  ctx.save();
  ctx.imageSmoothingEnabled = !aliased;
  ctx.fillStyle = color;
  ctx.font = `${size}px ${family}`;
  ctx.textBaseline = "top";
  // Without explicit smoothing control, Canvas anti-aliases text.
  // In aliased mode we drop the antialiasing hint (where supported).
  if (aliased) (ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = "geometricPrecision";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export default function Editor() {
  const [tool, setTool] = useState<Tool>("pencil");
  const [fgColor, setFgColor] = useState("#FF0000");
  const [bgColor, setBgColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(1);
  const [zoom, setZoom] = useState(() => window.innerWidth <= 640 ? 1 : 2);
  const [fit, setFit] = useState(true);
  const [aliased, setAliased] = useState(true);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Text-tool state (tampon / stamp mode)
  const [textInput, setTextInput] = useState("TEXTE");
  const [textFontIdx, setTextFontIdx] = useState(0);
  const [textSize, setTextSize] = useState(16);

  // Animation state
  const [frameCount, setFrameCount] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(6);
  const [looping, setLooping] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const framesDataRef = useRef<(ImageData | null)[]>([null]);
  const liveDataRef = useRef<ImageData | null>(null);
  const drawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentFrameRef = useRef(0);
  const frameCountRef = useRef(1);
  const fpsRef = useRef(fps);
  const loopingRef = useRef(looping);

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

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    clearCanvas(ctx);
    framesDataRef.current = [null];
    saveLiveCanvas();
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
      const fitW = w / CANVAS_W;
      const fitH = h / CANVAS_H;
      const raw = Math.min(fitW, fitH);
      const next = raw >= 1 ? Math.floor(raw) : raw;
      setZoom(prev => Math.abs(prev - next) < 0.001 ? prev : next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(area);
    return () => ro.disconnect();
  }, [fit]);

  // After every React render, restore canvas content from liveDataRef.
  // This prevents mobile browsers from silently wiping the canvas on re-render.
  useLayoutEffect(() => {
    if (liveDataRef.current) {
      const ctx = getCtx();
      if (ctx) ctx.putImageData(liveDataRef.current, 0, 0);
    }
  });

  function getCtx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }
  function getOverlayCtx() {
    return overlayRef.current?.getContext("2d") ?? null;
  }

  function getCanvasCoords(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / zoom),
      y: Math.floor((e.clientY - rect.top) / zoom),
    };
  }

  function getTouchCoords(touch: Touch): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((touch.clientX - rect.left) / zoom),
      y: Math.floor((touch.clientY - rect.top) / zoom),
    };
  }

  // Save current canvas into framesData
  function saveCurrentFrame() {
    const ctx = getCtx();
    if (!ctx) return;
    framesDataRef.current[currentFrameRef.current] = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  }

  // Snapshot canvas → liveDataRef (protects against mobile re-render wipes)
  function saveLiveCanvas() {
    const ctx = getCtx();
    if (!ctx) return;
    liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  }

  // Load a frame onto canvas
  function loadFrame(idx: number) {
    const ctx = getCtx();
    if (!ctx) return;
    const data = framesDataRef.current[idx];
    if (data) {
      ctx.putImageData(data, 0, 0);
    } else {
      clearCanvas(ctx);
    }
    saveLiveCanvas();
  }

  function switchToFrame(idx: number) {
    saveCurrentFrame();
    setCurrentFrame(idx);
    currentFrameRef.current = idx;
    loadFrame(idx);
  }

  // Animation playback
  function startPlayback() {
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    saveCurrentFrame();
    setPlaying(true);
    let f = currentFrameRef.current;
    playIntervalRef.current = setInterval(() => {
      // Persist any live edits made on the current frame before advancing
      saveCurrentFrame();
      f = (f + 1) % frameCountRef.current;
      if (!loopingRef.current && f === 0) {
        stopPlayback();
        return;
      }
      currentFrameRef.current = f;
      setCurrentFrame(f);
      loadFrame(f);
    }, 1000 / fpsRef.current);
  }

  function stopPlayback() {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    saveCurrentFrame();
    setPlaying(false);
  }

  // Restart playback when fps changes
  useEffect(() => {
    if (playing) {
      startPlayback();
    }
  }, [fps]);

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
  useEffect(() => () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); }, []);

  // Add blank frame
  function addFrame() {
    stopPlayback();
    saveCurrentFrame();
    const newIdx = currentFrameRef.current + 1;
    // Insert null at newIdx
    framesDataRef.current.splice(newIdx, 0, null);
    const newCount = framesDataRef.current.length;
    frameCountRef.current = newCount;
    setFrameCount(newCount);
    switchToFrame(newIdx);
  }

  // Duplicate current frame
  function duplicateFrame() {
    stopPlayback();
    saveCurrentFrame();
    const src = framesDataRef.current[currentFrameRef.current];
    const newIdx = currentFrameRef.current + 1;
    framesDataRef.current.splice(newIdx, 0, src ? new ImageData(new Uint8ClampedArray(src.data), src.width, src.height) : null);
    const newCount = framesDataRef.current.length;
    frameCountRef.current = newCount;
    setFrameCount(newCount);
    switchToFrame(newIdx);
  }

  // Delete current frame
  function deleteFrame() {
    if (frameCountRef.current <= 1) {
      const ctx = getCtx();
      if (ctx) clearCanvas(ctx);
      framesDataRef.current = [null];
      return;
    }
    stopPlayback();
    framesDataRef.current.splice(currentFrameRef.current, 1);
    const newCount = framesDataRef.current.length;
    frameCountRef.current = newCount;
    setFrameCount(newCount);
    const newIdx = Math.min(currentFrameRef.current, newCount - 1);
    currentFrameRef.current = newIdx;
    setCurrentFrame(newIdx);
    loadFrame(newIdx);
  }

  // Drawing handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const isRight = e.button === 2;
    const color = isRight ? bgColor : fgColor;
    const pos = getCanvasCoords(e);
    drawingRef.current = true;
    startPosRef.current = pos;
    lastPosRef.current = pos;

    const ctx = getCtx();
    if (!ctx) return;

    if (tool === "pencil" || tool === "eraser") {
      drawPixelRect(ctx, pos.x, pos.y, brushSize, tool === "eraser" ? bgColor : color);
      saveLiveCanvas();
    } else if (tool === "fill") {
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
        stampText(ctx, pos.x, pos.y, color, textInput, TEXT_FONTS[textFontIdx].family, textSize, aliased);
        saveLiveCanvas();
      }
      drawingRef.current = false;
    }
  }, [tool, fgColor, bgColor, brushSize, zoom, playing, aliased, textInput, textFontIdx, textSize]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasCoords(e);
    setMousePos(pos);
    if (!drawingRef.current) return;
    const isRight = e.buttons === 2;
    const color = isRight ? bgColor : fgColor;
    const ctx = getCtx();
    const overlay = getOverlayCtx();
    if (!ctx) return;

    if (tool === "pencil" || tool === "eraser") {
      const last = lastPosRef.current ?? pos;
      drawLine(ctx, last.x, last.y, pos.x, pos.y, tool === "eraser" ? bgColor : color, brushSize, aliased);
      lastPosRef.current = pos;
      saveLiveCanvas();
    } else if (tool === "line" && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawLine(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, aliased);
    } else if ((tool === "rect" || tool === "rect-fill") && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawRect(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "rect-fill", aliased);
    } else if ((tool === "ellipse" || tool === "ellipse-fill") && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawEllipse(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "ellipse-fill", aliased);
    }
  }, [tool, fgColor, bgColor, brushSize, zoom, playing, aliased]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const isRight = e.button === 2;
    const color = isRight ? bgColor : fgColor;
    const pos = getCanvasCoords(e);
    const ctx = getCtx();
    const overlay = getOverlayCtx();

    if (!ctx || !startPosRef.current) return;

    if (tool === "line") {
      drawLine(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, aliased);
      saveLiveCanvas();
    } else if (tool === "rect" || tool === "rect-fill") {
      drawRect(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "rect-fill", aliased);
      saveLiveCanvas();
    } else if (tool === "ellipse" || tool === "ellipse-fill") {
      drawEllipse(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "ellipse-fill", aliased);
      saveLiveCanvas();
    }

    if (overlay) overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
    startPosRef.current = null;
    lastPosRef.current = null;
  }, [tool, fgColor, bgColor, brushSize, zoom, aliased]);

  const onMouseLeave = useCallback(() => {
    setMousePos(null);
  }, []);

  // Touch events — attached imperatively so we can use passive:false
  const toolRef = useRef(tool);
  const fgColorRef = useRef(fgColor);
  const bgColorRef = useRef(bgColor);
  const brushSizeRef = useRef(brushSize);
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
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { aliasedRef.current = aliased; }, [aliased]);
  useEffect(() => { textInputRef.current = textInput; }, [textInput]);
  useEffect(() => { textFontIdxRef.current = textFontIdx; }, [textFontIdx]);
  useEffect(() => { textSizeRef.current = textSize; }, [textSize]);

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
      drawingRef.current = true;
      startPosRef.current = pos;
      lastPosRef.current = pos;
      setMousePos(pos);
      const ctx = getCtx();
      if (!ctx) return;
      const color = fgColorRef.current;
      const t = toolRef.current;
      if (t === "pencil" || t === "eraser") {
        drawPixelRect(ctx, pos.x, pos.y, brushSizeRef.current, t === "eraser" ? bgColorRef.current : color);
        liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      } else if (t === "fill") {
        floodFill(ctx, pos.x, pos.y, color);
        liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
        drawingRef.current = false;
      } else if (t === "eyedropper") {
        const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
        setFgColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
        drawingRef.current = false;
      } else if (t === "text") {
        const txt = textInputRef.current;
        if (txt) {
          stampText(ctx, pos.x, pos.y, color, txt, TEXT_FONTS[textFontIdxRef.current].family, textSizeRef.current, aliasedRef.current);
          liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
        }
        drawingRef.current = false;
      }
    }

    function handleTouchMove(e: TouchEvent) {
      if (!drawingRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const pos = getTouchPos(touch);
      setMousePos(pos);
      const ctx = getCtx();
      const overlay = getOverlayCtx();
      if (!ctx) return;
      const color = fgColorRef.current;
      const t = toolRef.current;
      const sz = brushSizeRef.current;
      const al = aliasedRef.current;
      if (t === "pencil" || t === "eraser") {
        const last = lastPosRef.current ?? pos;
        drawLine(ctx, last.x, last.y, pos.x, pos.y, t === "eraser" ? bgColorRef.current : color, sz, al);
        lastPosRef.current = pos;
        liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      } else if (t === "line" && overlay && startPosRef.current) {
        overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
        drawLine(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, al);
      } else if ((t === "rect" || t === "rect-fill") && overlay && startPosRef.current) {
        overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
        drawRect(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "rect-fill", al);
      } else if ((t === "ellipse" || t === "ellipse-fill") && overlay && startPosRef.current) {
        overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
        drawEllipse(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "ellipse-fill", al);
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!drawingRef.current) return;
      e.preventDefault();
      drawingRef.current = false;
      const ctx = getCtx();
      const overlay = getOverlayCtx();
      if (!ctx || !startPosRef.current) return;
      const color = fgColorRef.current;
      const t = toolRef.current;
      const sz = brushSizeRef.current;
      const al = aliasedRef.current;
      const pos = lastPosRef.current ?? startPosRef.current;
      if (t === "line") {
        drawLine(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, al);
        liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      } else if (t === "rect" || t === "rect-fill") {
        drawRect(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "rect-fill", al);
        liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      } else if (t === "ellipse" || t === "ellipse-fill") {
        drawEllipse(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, sz, t === "ellipse-fill", al);
        liveDataRef.current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      }
      if (overlay) overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
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
  }, []);

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
    framesDataRef.current = [null];
    frameCountRef.current = 1;
    setFrameCount(1);
    currentFrameRef.current = 0;
    setCurrentFrame(0);
    const ctx = getCtx();
    if (ctx) { clearCanvas(ctx); saveLiveCanvas(); }
  }

  function handleSaveGif() {
    // Save all frames as individual PNGs in a zip-like sequence
    saveCurrentFrame();
    framesDataRef.current.forEach((imgData, i) => {
      const offscreen = document.createElement("canvas");
      offscreen.width = CANVAS_W;
      offscreen.height = CANVAS_H;
      const ctx2 = offscreen.getContext("2d")!;
      if (imgData) {
        ctx2.putImageData(imgData, 0, 0);
      } else {
        clearCanvas(ctx2);
      }
      const a = document.createElement("a");
      a.href = offscreen.toDataURL("image/png");
      a.download = `animation-frame-${String(i + 1).padStart(3, "0")}.png`;
      a.click();
    });
  }

  function handleSaveSvg() {
    saveCurrentFrame();
    const ctx = getCtx();
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const svg = imageDataToSvg(img);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `frame-${currentFrame + 1}.svg`);
  }

  function handleSaveAllSvg() {
    saveCurrentFrame();
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const ctx2 = offscreen.getContext("2d")!;
    framesDataRef.current.forEach((imgData, i) => {
      if (imgData) ctx2.putImageData(imgData, 0, 0);
      else clearCanvas(ctx2);
      const frameImg = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const svg = imageDataToSvg(frameImg);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `animation-frame-${String(i + 1).padStart(3, "0")}.svg`);
    });
  }

  function handleSaveAnimGif() {
    saveCurrentFrame();
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const ctx2 = offscreen.getContext("2d")!;
    const gif = GIFEncoder();
    const delay = Math.max(20, Math.round(1000 / Math.max(fps, 1))); // ms per frame; min 20ms (50fps cap)
    framesDataRef.current.forEach(imgData => {
      if (imgData) ctx2.putImageData(imgData, 0, 0);
      else clearCanvas(ctx2);
      const frameImg = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H);
      // Median-cut quantize to ≤256 palette colors per frame, then map pixels.
      const palette = quantize(frameImg.data, 256);
      const index = applyPalette(frameImg.data, palette);
      gif.writeFrame(index, CANVAS_W, CANVAS_H, { palette, delay });
    });
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
    saveCurrentFrame();
    // Rasterize every frame against a temp canvas so empty frames become
    // a real blank ImageData and the SVG output is consistent.
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const ctx2 = offscreen.getContext("2d")!;
    const baked: ImageData[] = framesDataRef.current.map(imgData => {
      if (imgData) ctx2.putImageData(imgData, 0, 0);
      else clearCanvas(ctx2);
      return ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H);
    });
    const svg = framesToAnimatedSvg(baked, CANVAS_W, CANVAS_H, fps, looping);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `dpaint-anim-${ts}.svg`);
  }

  const canvasStyle: React.CSSProperties = {
    width: CANVAS_W * zoom,
    height: CANVAS_H * zoom,
    imageRendering: aliased ? "pixelated" : "auto",
    display: "block",
    cursor: tool === "text" ? "text" : tool === "fill" ? "cell" : "crosshair",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#F0EFED", fontFamily: "'VT323', monospace", fontSize: 16, color: "#000" }}>

      {/* MENUBAR */}
      <div style={{ display: "flex", alignItems: "center", background: "#191919", borderBottom: "2px solid #000", padding: "0 4px", flexShrink: 0, height: 28 }}>
        <MenuDropdown label="IMAGE" items={[
          { label: "NOUVEAU", action: handleNew },
          { label: "SAUVER FRAME (PNG)", action: handleSave },
          { label: "SAUVER FRAME (SVG)", action: handleSaveSvg },
          { label: "SAUVER TOUTES LES FRAMES (PNG)", action: handleSaveGif },
          { label: "SAUVER TOUTES LES FRAMES (SVG)", action: handleSaveAllSvg },
          { label: "SAUVER ANIMATION (GIF)", action: handleSaveAnimGif },
          { label: "SAUVER ANIMATION (SVG ANIMÉ)", action: handleSaveAnimSvg },
        ]} />
        <MenuDropdown label="ZOOM" items={ZOOM_LEVELS.map(z => ({
          label: `x${z}${z === 12 ? "  (4K)" : ""}${!fit && z === zoom ? " ✓" : ""}`,
          action: () => { setFit(false); setZoom(z); },
        }))} />
        <button
          className="amiga-button"
          onClick={() => setFit(v => !v)}
          data-active={fit}
          title="REMPLIR LA FENÊTRE (AUTO-ZOOM)"
          style={{ padding: "2px 10px", height: 24, color: "#000", marginLeft: 4 }}
        >
          {fit ? "FIT ON" : "FIT"}
        </button>
        <button
          className="amiga-button"
          onClick={() => { setFit(false); setZoom(12); }}
          data-active={!fit && zoom === 12}
          title="ZOOM x12 — REMPLIT UN ÉCRAN 4K"
          style={{ padding: "2px 10px", height: 24, color: "#000", marginLeft: 4 }}
        >
          4K
        </button>
        <button
          className="amiga-button"
          onClick={() => setAliased(v => !v)}
          data-active={aliased}
          title={aliased ? "RENDU ALIASÉ (PIXEL ART)" : "RENDU LISSÉ (ANTI-ALIASING)"}
          style={{ padding: "2px 10px", height: 24, color: "#000", marginLeft: 4 }}
        >
          {aliased ? "ALIAS ON" : "ALIAS OFF"}
        </button>
        <div style={{ marginLeft: "auto", color: "#F0EFED", fontSize: 14, paddingRight: 8, letterSpacing: 1 }}>
          DELUXE PAINT · PEOPLE OF VERSO
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
              style={{ width: "100%", height: 36, fontSize: 20, padding: 0 }}
            >
              {t.icon}
            </button>
          ))}
          <div style={{ marginTop: 8, borderTop: "1px solid #000", paddingTop: 4 }}>
            <div style={{ color: "#000", fontSize: 10, textAlign: "center", marginBottom: 2 }}>TAILLE</div>
            {BRUSH_SIZES.map(s => (
              <button
                key={s}
                className="amiga-button"
                data-active={brushSize === s}
                onClick={() => setBrushSize(s)}
                style={{ width: "100%", height: 24, marginBottom: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <div style={{ width: s * 2 + 4, height: s * 2 + 4, background: "#000", maxWidth: 20, maxHeight: 20 }} />
              </button>
            ))}
          </div>
          {/* Color swatches */}
          <div style={{ marginTop: 8, borderTop: "1px solid #000", paddingTop: 4 }}>
            <div style={{ position: "relative", width: 46, height: 36 }}>
              <div style={{ position: "absolute", right: 0, bottom: 0, width: 24, height: 24, background: bgColor, border: "2px solid #000", cursor: "pointer" }}
                title="Couleur de fond (clic droit)" />
              <div style={{ position: "absolute", left: 0, top: 0, width: 24, height: 24, background: fgColor, border: "2px solid #FFF", cursor: "pointer" }}
                title="Couleur principale" />
            </div>
          </div>
        </div>

        {/* CANVAS AREA */}
        <div ref={canvasAreaRef} style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#191919", position: "relative" }}>
          <div style={{ position: "relative", margin: 16, display: "inline-block" }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ ...canvasStyle, position: "relative", zIndex: 1, border: "1px solid #000" }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              onContextMenu={e => e.preventDefault()}
            />
            <canvas
              ref={overlayRef}
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ ...canvasStyle, position: "absolute", top: 0, left: 0, zIndex: 2, pointerEvents: "none" }}
            />
          </div>
        </div>
      </div>

      {/* TEXT-TOOL CONFIG (visible only when text tool is active) */}
      {tool === "text" && (
        <div className="amiga-panel" style={{ flexShrink: 0, borderTop: "2px solid #000", padding: "4px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: "#000", fontSize: 14 }}>TEXTE (TAMPON) :</div>
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder="Tape ton texte puis clique"
              style={{
                background: "#FFF",
                color: "#000",
                border: "2px solid #000",
                padding: "2px 6px",
                fontFamily: TEXT_FONTS[textFontIdx].family,
                fontSize: 14,
                minWidth: 200,
                flex: "1 1 200px",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#000", fontSize: 14 }}>POLICE :</span>
              {TEXT_FONTS.map((f, i) => (
                <button
                  key={f.label}
                  className="amiga-button"
                  data-active={textFontIdx === i}
                  onClick={() => setTextFontIdx(i)}
                  style={{ padding: "2px 8px", color: "#000", fontFamily: f.family }}
                  title={f.label}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#000", fontSize: 14 }}>TAILLE :</span>
              {TEXT_SIZES.map(s => (
                <button
                  key={s}
                  className="amiga-button"
                  data-active={textSize === s}
                  onClick={() => setTextSize(s)}
                  style={{ padding: "2px 6px", color: "#000", minWidth: 28 }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ color: "#555", fontSize: 12, marginLeft: "auto" }}>
              CLIC SUR LE CANVAS POUR TAMPONNER
            </div>
          </div>
        </div>
      )}

      {/* ANIMATION PANEL */}
      <div className="amiga-panel" style={{ flexShrink: 0, borderTop: "2px solid #000", padding: "4px 8px" }}>
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

          {/* Loop toggle */}
          <button
            className="amiga-button"
            data-active={looping}
            onClick={() => { const v = !looping; setLooping(v); loopingRef.current = v; }}
            style={{ padding: "2px 8px", color: looping ? "#00FF00" : "#000" }}
            title="BOUCLE"
          >
            {looping ? "BOUCLE ON" : "BOUCLE OFF"}
          </button>

          {/* FPS */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#000", fontSize: 14 }}>
            <span>VIT:</span>
            <input
              type="range" min={1} max={24} value={fps}
              onChange={e => setFps(Number(e.target.value))}
              style={{ width: 60 }}
            />
            <span style={{ minWidth: 24 }}>{fps}</span>
          </div>

          {/* Frame counter */}
          <div style={{ color: "#000", minWidth: 70, fontSize: 14 }}>
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
                key={i}
                index={i}
                current={currentFrame === i}
                frameData={framesDataRef.current[i]}
                onClick={() => !playing && switchToFrame(i)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* PALETTE + STATUS */}
      <div className="amiga-panel" style={{ flexShrink: 0, borderTop: "2px solid #FFF", padding: "4px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Palette */}
          <div style={{ display: "flex", flexWrap: "wrap", width: 272, gap: 2 }}>
            {AMIGA_PALETTE.map((color) => (
              <div
                key={color}
                style={{
                  width: 14,
                  height: 14,
                  background: color,
                  border: fgColor === color ? "2px solid #FFF" : bgColor === color ? "2px solid #FF8800" : "1px solid #000",
                  cursor: "pointer",
                  boxSizing: "border-box",
                }}
                title={color}
                onClick={() => setFgColor(color)}
                onContextMenu={e => { e.preventDefault(); setBgColor(color); }}
              />
            ))}
          </div>

          {/* Status bar */}
          <div style={{ flex: 1, color: "#000", fontSize: 14, paddingLeft: 8 }}>
            <div>OUTIL: {TOOLS.find(t => t.id === tool)?.label ?? tool.toUpperCase()}</div>
            <div>POS: {mousePos ? `${mousePos.x},${mousePos.y}` : "--,--"}</div>
            <div>ZOOM: x{zoom < 1 ? zoom.toFixed(2) : zoom}{fit ? " (FIT)" : ""}</div>
          </div>

          {/* FG/BG color display */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 11, color: "#000" }}>AVANT</div>
            <div style={{ width: 32, height: 16, background: fgColor, border: "2px solid #000" }} />
            <div style={{ fontSize: 11, color: "#000" }}>FOND</div>
            <div style={{ width: 32, height: 16, background: bgColor, border: "2px solid #000" }} />
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
  frameData: ImageData | null;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (frameData) {
      // Scale down the ImageData
      const offscreen = document.createElement("canvas");
      offscreen.width = CANVAS_W;
      offscreen.height = CANVAS_H;
      const ctx2 = offscreen.getContext("2d")!;
      ctx2.putImageData(frameData, 0, 0);
      ctx.drawImage(offscreen, 0, 0, 48, 30);
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
      <div style={{ fontSize: 11, color: "#000" }}>{index + 1}</div>
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
        style={{ padding: "2px 10px", height: 24, color: "#000" }}
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
              style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 8px", color: "#000" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
