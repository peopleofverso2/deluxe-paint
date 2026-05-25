import { build } from "esbuild";
import { rm, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "dist");
await rm(distDir, { recursive: true, force: true });

await build({
  entryPoints: [path.resolve(__dirname, "src/index.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  banner: { js: "#!/usr/bin/env node\n" },
  sourcemap: "linked",
});

// Make the entry executable so `npx` / direct invocation works
await chmod(path.resolve(distDir, "index.mjs"), 0o755);
