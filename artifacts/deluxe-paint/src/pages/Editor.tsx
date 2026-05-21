import { useState, useRef, useEffect, useCallback } from "react";

type Tool =
  | "pencil"
  | "line"
  | "rect"
  | "rect-fill"
  | "ellipse"
  | "ellipse-fill"
  | "fill"
  | "eyedropper"
  | "eraser";

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
  size: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 + 0.5);
  ctx.lineTo(x1 + 0.5, y1 + 0.5);
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
  filled: boolean
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
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
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
  filled: boolean
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
];

const BRUSH_SIZES = [1, 2, 4, 8];
const ZOOM_LEVELS = [1, 2, 4, 8];

export default function Editor() {
  const [tool, setTool] = useState<Tool>("pencil");
  const [fgColor, setFgColor] = useState("#FF0000");
  const [bgColor, setBgColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Animation state
  const [frameCount, setFrameCount] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(6);
  const [looping, setLooping] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const framesDataRef = useRef<(ImageData | null)[]>([null]);
  const drawingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentFrameRef = useRef(0);
  const frameCountRef = useRef(1);
  const fpsRef = useRef(fps);
  const loopingRef = useRef(looping);

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
  }, []);

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

  // Save current canvas into framesData
  function saveCurrentFrame() {
    const ctx = getCtx();
    if (!ctx) return;
    framesDataRef.current[currentFrameRef.current] = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
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
    setPlaying(false);
  }

  // Restart playback when fps changes
  useEffect(() => {
    if (playing) {
      startPlayback();
    }
  }, [fps]);

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
    if (playing) return;
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
    } else if (tool === "fill") {
      floodFill(ctx, pos.x, pos.y, color);
      drawingRef.current = false;
    } else if (tool === "eyedropper") {
      const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
      const picked = rgbToHex(pixel[0], pixel[1], pixel[2]);
      if (isRight) setBgColor(picked); else setFgColor(picked);
      drawingRef.current = false;
    }
  }, [tool, fgColor, bgColor, brushSize, zoom, playing]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasCoords(e);
    setMousePos(pos);
    if (!drawingRef.current) return;
    if (playing) return;
    const isRight = e.buttons === 2;
    const color = isRight ? bgColor : fgColor;
    const ctx = getCtx();
    const overlay = getOverlayCtx();
    if (!ctx) return;

    if (tool === "pencil" || tool === "eraser") {
      const last = lastPosRef.current ?? pos;
      drawLine(ctx, last.x, last.y, pos.x, pos.y, tool === "eraser" ? bgColor : color, brushSize);
      lastPosRef.current = pos;
    } else if (tool === "line" && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawLine(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize);
    } else if ((tool === "rect" || tool === "rect-fill") && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawRect(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "rect-fill");
    } else if ((tool === "ellipse" || tool === "ellipse-fill") && overlay && startPosRef.current) {
      overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawEllipse(overlay, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "ellipse-fill");
    }
  }, [tool, fgColor, bgColor, brushSize, zoom, playing]);

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
      drawLine(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize);
    } else if (tool === "rect" || tool === "rect-fill") {
      drawRect(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "rect-fill");
    } else if (tool === "ellipse" || tool === "ellipse-fill") {
      drawEllipse(ctx, startPosRef.current.x, startPosRef.current.y, pos.x, pos.y, color, brushSize, tool === "ellipse-fill");
    }

    if (overlay) overlay.clearRect(0, 0, CANVAS_W, CANVAS_H);
    startPosRef.current = null;
    lastPosRef.current = null;
  }, [tool, fgColor, bgColor, brushSize, zoom]);

  const onMouseLeave = useCallback(() => {
    setMousePos(null);
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
    if (ctx) clearCanvas(ctx);
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

  const canvasStyle: React.CSSProperties = {
    width: CANVAS_W * zoom,
    height: CANVAS_H * zoom,
    imageRendering: "pixelated",
    display: "block",
    cursor: tool === "eyedropper" ? "crosshair" : tool === "fill" ? "cell" : "crosshair",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#0055AA", fontFamily: "'VT323', monospace", fontSize: 16 }}>

      {/* MENUBAR */}
      <div style={{ display: "flex", alignItems: "center", background: "#0055AA", borderBottom: "2px solid #000", padding: "0 4px", flexShrink: 0, height: 28 }}>
        <MenuDropdown label="IMAGE" items={[
          { label: "NOUVEAU", action: handleNew },
          { label: "SAUVER FRAME", action: handleSave },
          { label: "SAUVER TOUTES LES FRAMES (PNG)", action: handleSaveGif },
        ]} />
        <MenuDropdown label="ZOOM" items={ZOOM_LEVELS.map(z => ({
          label: `x${z}${z === zoom ? " ✓" : ""}`,
          action: () => setZoom(z),
        }))} />
        <div style={{ marginLeft: "auto", color: "#FFF", fontSize: 14, paddingRight: 8 }}>
          DELUXE PAINT — AMIGA
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
        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "flex-start", background: "#222", position: "relative" }}>
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
            <div>ZOOM: x{zoom}</div>
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
