import { Router, type IRouter } from "express";
import { db, projectsTable } from "@workspace/db";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/session";

const router: IRouter = Router();

const projectDataSchema = z.object({
  format: z.literal("dpaint-project"),
  version: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().optional(),
  looping: z.boolean().optional(),
  currentFrame: z.number().int().nonnegative().optional(),
  // Either v1 frames or v2 layers — pass through whichever the client sends
}).passthrough();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  data: projectDataSchema,
  isPublic: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  data: projectDataSchema.optional(),
  isPublic: z.boolean().optional(),
});

// Light DTO (no `data`) — used for listings to keep responses small.
function toListItem(p: typeof projectsTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    frameCount: p.frameCount,
    isPublic: p.isPublic,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /projects — list current user's projects (newest first)
router.get("/projects", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, userId))
      .orderBy(desc(projectsTable.updatedAt))
      .limit(200);
    res.json({ projects: rows.map(toListItem) });
  } catch (err) {
    req.log?.error({ err }, "list projects error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /projects — create
router.post("/projects", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Données invalides", details: parsed.error.issues }); return; }
  const { name, data, isPublic } = parsed.data;
  // Frame count derivation: v2 layers[].frames or v1 frames
  let frameCount = 1;
  const d = data as { layers?: Array<{ frames: unknown[] }>; frames?: unknown[] };
  if (Array.isArray(d.layers) && d.layers.length > 0 && Array.isArray(d.layers[0].frames)) {
    frameCount = d.layers[0].frames.length;
  } else if (Array.isArray(d.frames)) {
    frameCount = d.frames.length;
  }
  try {
    const inserted = await db.insert(projectsTable).values({
      ownerId: req.user!.id,
      name,
      data,
      width: data.width,
      height: data.height,
      frameCount,
      isPublic: isPublic ?? true,
    }).returning();
    res.status(201).json({ project: toListItem(inserted[0]) });
  } catch (err) {
    req.log?.error({ err }, "create project error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /projects/:id — fetch one (public OR owned). Returns full `data`.
router.get("/projects/:id", async (req, res) => {
  const id = String(req.params.id);
  try {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(and(
        eq(projectsTable.id, id),
        // Public OR owned by current user
        req.user
          ? or(eq(projectsTable.isPublic, true), eq(projectsTable.ownerId, req.user.id))
          : eq(projectsTable.isPublic, true),
      ))
      .limit(1);
    const p = rows[0];
    if (!p) { res.status(404).json({ error: "Projet introuvable" }); return; }
    res.json({ project: { ...toListItem(p), data: p.data, ownerId: p.ownerId } });
  } catch (err) {
    req.log?.error({ err }, "get project error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /projects/:id — update (auth + ownership)
router.put("/projects/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Données invalides", details: parsed.error.issues }); return; }
  const userId = req.user!.id;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name != null) patch.name = parsed.data.name;
  if (parsed.data.isPublic != null) patch.isPublic = parsed.data.isPublic;
  if (parsed.data.data != null) {
    patch.data = parsed.data.data;
    patch.width = parsed.data.data.width;
    patch.height = parsed.data.data.height;
    const d = parsed.data.data as { layers?: Array<{ frames: unknown[] }>; frames?: unknown[] };
    if (Array.isArray(d.layers) && d.layers.length > 0 && Array.isArray(d.layers[0].frames)) {
      patch.frameCount = d.layers[0].frames.length;
    } else if (Array.isArray(d.frames)) {
      patch.frameCount = d.frames.length;
    }
  }
  try {
    const updated = await db
      .update(projectsTable)
      .set(patch)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.ownerId, userId)))
      .returning();
    if (updated.length === 0) { res.status(404).json({ error: "Projet introuvable" }); return; }
    res.json({ project: toListItem(updated[0]) });
  } catch (err) {
    req.log?.error({ err }, "update project error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /projects/:id
router.delete("/projects/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const userId = req.user!.id;
  try {
    const deleted = await db
      .delete(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.ownerId, userId)))
      .returning({ id: projectsTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Projet introuvable" }); return; }
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "delete project error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Suppress an unused-import lint complaint (sql is reserved for future
// search/filter endpoints — keep the import handy).
void sql;

export default router;
