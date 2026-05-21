declare module "gifenc" {
  export type Palette = number[][]; // [[r,g,b], ...] or [[r,g,b,a], ...]

  export interface WriteFrameOpts {
    palette?: Palette;
    delay?: number; // ms
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    repeat?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOpts): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
    writeHeader(): void;
    buffer: ArrayBuffer;
    stream: { writeByte(b: number): void; writeBytes(b: ArrayLike<number>): void };
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: "rgb565" | "rgb444" | "rgba4444"; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number; oneBitAlpha?: boolean | number },
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;

  export function nearestColorIndex(palette: Palette, pixel: number[]): number;
  export function snapColorsToPalette(palette: Palette, knownColors: Palette, threshold?: number): void;
}
