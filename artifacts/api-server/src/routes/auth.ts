import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { db, usersTable, magicLinksTable, sessionsTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import { sendMagicLink } from "../lib/email";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, requireAuth } from "../middlewares/session";

const router: IRouter = Router();

const LINK_TTL_MS = 15 * 60 * 1000;        // 15 minutes
const TOKEN_BYTES = 32;                     // 256-bit random token

function randomToken(bytes: number = TOKEN_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// POST /auth/login { email }
//   Creates a magic-link token + emails it. Always responds 200 even on
//   non-existing emails so we don't leak account existence.
const loginSchema = z.object({ email: z.string().email().max(320) });
router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Email invalide" }); return; }
  const email = normalizeEmail(parsed.data.email);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  try {
    await db.insert(magicLinksTable).values({ token, email, expiresAt });
  } catch (err) {
    req.log?.error({ err }, "failed to insert magic link");
    res.status(500).json({ error: "Erreur serveur" });
    return;
  }
  // The verification URL is built from the request — works on prod + local.
  const baseUrl = process.env["PUBLIC_BASE_URL"] || `${req.protocol}://${req.get("host")}`;
  const link = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendMagicLink(email, link);
  } catch (err) {
    req.log?.error({ err }, "failed to send magic link email");
    // Don't fail the request — the link is in the DB, user can retry
  }
  res.json({ ok: true });
});

// GET /auth/verify?token=...
//   Consumes the token, creates user if new, sets session cookie, redirects.
router.get("/auth/verify", async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) { res.status(400).send("Token manquant"); return; }
  let email: string | null = null;
  try {
    // Atomically mark as used (only if not used + not expired)
    const updated = await db
      .update(magicLinksTable)
      .set({ usedAt: new Date() })
      .where(and(
        eq(magicLinksTable.token, token),
        isNull(magicLinksTable.usedAt),
        gt(magicLinksTable.expiresAt, new Date()),
      ))
      .returning({ email: magicLinksTable.email });
    if (updated.length === 0) {
      res.status(400).send("Lien invalide ou expiré.");
      return;
    }
    email = updated[0].email;
  } catch (err) {
    req.log?.error({ err }, "magic-link verify DB error");
    res.status(500).send("Erreur serveur");
    return;
  }
  // Upsert user
  let userId: string;
  try {
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing[0]) {
      userId = existing[0].id;
    } else {
      const inserted = await db.insert(usersTable).values({ email }).returning({ id: usersTable.id });
      userId = inserted[0].id;
    }
  } catch (err) {
    req.log?.error({ err }, "user upsert error");
    res.status(500).send("Erreur serveur");
    return;
  }
  // Create session
  const sid = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  try {
    await db.insert(sessionsTable).values({ id: sid, userId, expiresAt });
  } catch (err) {
    req.log?.error({ err }, "session insert error");
    res.status(500).send("Erreur serveur");
    return;
  }
  res.cookie(SESSION_COOKIE_NAME, sid, {
    httpOnly: true,
    secure: req.protocol === "https" || req.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  // Redirect to root so the app picks up the new session
  res.redirect("/");
});

// POST /auth/logout — clears the session cookie + DB row.
router.post("/auth/logout", async (req, res) => {
  const sid = req.sessionId;
  if (sid) {
    try {
      await db.delete(sessionsTable).where(eq(sessionsTable.id, sid));
    } catch (err) {
      req.log?.warn({ err }, "session delete error (ignored)");
    }
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

// GET /me — returns the current user or null
router.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});

// GET /me/protected — sanity check that requireAuth works
router.get("/me/protected", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
