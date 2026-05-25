import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---- Config ---------------------------------------------------------
const API_URL = (process.env.DPAINT_API_URL ?? "https://deluxe-paint-865031348985.europe-west9.run.app").replace(/\/$/, "");
const SESSION_COOKIE = process.env.DPAINT_SESSION_COOKIE; // raw cookie value, e.g. "dpaint_sid=..."

function authHeader(): Record<string, string> {
  return SESSION_COOKIE ? { cookie: SESSION_COOKIE } : {};
}

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      ...authHeader(),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → HTTP ${res.status} ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? (await res.json() as T) : (await res.text() as unknown as T);
}

// ---- Server ---------------------------------------------------------
const server = new McpServer({
  name: "deluxe-paint",
  version: "0.1.0",
});

// AUTH -----------------------------------------------------------------
server.tool(
  "whoami",
  "Returns the authenticated user (or null if anonymous). Use to check whether DPAINT_SESSION_COOKIE is correctly set.",
  {},
  async () => {
    const r = await api<{ user: { id: string; email: string; displayName: string | null } | null }>("GET", "/me");
    return { content: [{ type: "text", text: JSON.stringify(r.user, null, 2) }] };
  },
);

// PROJECTS -------------------------------------------------------------
server.tool(
  "list_projects",
  "List the current user's saved projects (newest first). Auth required.",
  {},
  async () => {
    const r = await api<{ projects: unknown[] }>("GET", "/projects");
    return { content: [{ type: "text", text: JSON.stringify(r.projects, null, 2) }] };
  },
);

server.tool(
  "get_project",
  "Fetch a single project by UUID. Returns full data including all layers / frames (PNG dataURLs). Works on public projects without auth.",
  {
    id: z.string().uuid().describe("Project UUID"),
  },
  async ({ id }) => {
    const r = await api<{ project: unknown }>("GET", `/projects/${encodeURIComponent(id)}`);
    return { content: [{ type: "text", text: JSON.stringify(r.project, null, 2) }] };
  },
);

const projectDataSchema = z.object({
  format: z.literal("dpaint-project").default("dpaint-project"),
  version: z.number().int().default(2),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().optional(),
  looping: z.boolean().optional(),
  layers: z.array(z.object({
    id: z.string().optional(),
    name: z.string().default("CALQUE"),
    visible: z.boolean().default(true),
    opacity: z.number().min(0).max(1).default(1),
    frames: z.array(z.string().nullable()).describe("Array of data:image/png;base64,... or null per frame slot"),
  })).optional(),
  frames: z.array(z.string().nullable()).optional().describe("v1 fallback — single-layer array of PNG dataURLs"),
}).passthrough();

server.tool(
  "create_project",
  "Create a new project. Pass a valid `data` payload (see .dpaint v2 structure: width/height/layers[]/frames). Returns the created project metadata. Auth required.",
  {
    name: z.string().min(1).max(120).describe("Display name"),
    data: projectDataSchema,
    isPublic: z.boolean().optional().default(true).describe("Public projects are reachable via /p/:id"),
  },
  async ({ name, data, isPublic }) => {
    const r = await api<{ project: unknown }>("POST", "/projects", { name, data, isPublic });
    return { content: [{ type: "text", text: JSON.stringify(r.project, null, 2) }] };
  },
);

server.tool(
  "update_project",
  "Update a project's name, isPublic, and/or full data. Owner-only.",
  {
    id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    data: projectDataSchema.optional(),
    isPublic: z.boolean().optional(),
  },
  async ({ id, name, data, isPublic }) => {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (data !== undefined) body.data = data;
    if (isPublic !== undefined) body.isPublic = isPublic;
    const r = await api<{ project: unknown }>("PUT", `/projects/${encodeURIComponent(id)}`, body);
    return { content: [{ type: "text", text: JSON.stringify(r.project, null, 2) }] };
  },
);

server.tool(
  "delete_project",
  "Permanently delete a project. Owner-only.",
  {
    id: z.string().uuid(),
  },
  async ({ id }) => {
    await api<{ ok: true }>("DELETE", `/projects/${encodeURIComponent(id)}`);
    return { content: [{ type: "text", text: `Deleted ${id}` }] };
  },
);

// FRAME RENDER ---------------------------------------------------------
server.tool(
  "render_frame_png",
  "Return the composite PNG of a specific frame as base64 image content (so the model can SEE the result). Picks the dataURL from the project payload directly — pure passthrough, no rasterization on the MCP side.",
  {
    id: z.string().uuid(),
    frameIndex: z.number().int().nonnegative().default(0),
  },
  async ({ id, frameIndex }) => {
    type Proj = { project: { data: { layers?: Array<{ frames: (string | null)[] }>; frames?: (string | null)[]; width: number; height: number } } };
    const r = await api<Proj>("GET", `/projects/${encodeURIComponent(id)}`);
    const d = r.project.data;
    // Try v2 layers, fallback to v1 frames
    const url: string | null = (d.layers && d.layers[0] && d.layers[0].frames?.[frameIndex])
      ?? (d.frames?.[frameIndex])
      ?? null;
    if (!url) {
      return { content: [{ type: "text", text: `Frame ${frameIndex} is empty` }] };
    }
    const m = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!m) return { content: [{ type: "text", text: `Frame data is not a base64 image dataURL` }] };
    return {
      content: [
        { type: "image", data: m[2], mimeType: m[1] },
        { type: "text", text: `Frame ${frameIndex} (${d.width}×${d.height}) of project ${id}` },
      ],
    };
  },
);

// SHARE LINK ----------------------------------------------------------
server.tool(
  "share_url",
  "Build the public sharing URL for a project (does not check existence).",
  { id: z.string().uuid() },
  async ({ id }) => {
    return { content: [{ type: "text", text: `${API_URL}/p/${id}` }] };
  },
);

// ---- Bootstrap -------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
// Logging to stderr only (stdout is reserved for the MCP transport).
process.stderr.write(`[dpaint-mcp] connected (API=${API_URL}, auth=${SESSION_COOKIE ? "yes" : "anonymous"})\n`);
