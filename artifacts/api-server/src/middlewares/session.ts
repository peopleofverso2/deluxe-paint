import type { Request, Response, NextFunction } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, gt, and } from "drizzle-orm";

const SESSION_COOKIE = "dpaint_sid";

declare global {
  namespace Express {
    interface Request {
      // null until middleware runs; user object if session is valid; null if no/invalid session
      user?: { id: string; email: string; displayName: string | null } | null;
      sessionId?: string | null;
    }
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Middleware: load the session+user from the cookie (if any) and attach to req.
// Doesn't reject unauthenticated requests — routes choose whether to require auth.
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const sid = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
  req.user = null;
  req.sessionId = null;
  if (!sid) return next();
  try {
    const rows = await db
      .select({
        sessionId: sessionsTable.id,
        userId: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
      })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
      .where(and(eq(sessionsTable.id, sid), gt(sessionsTable.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (row) {
      req.sessionId = row.sessionId;
      req.user = { id: row.userId, email: row.email, displayName: row.displayName };
    }
  } catch (err) {
    // DB hiccup — treat as unauthenticated rather than 500
    req.log?.warn({ err }, "session middleware DB error");
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentification requise" });
    return;
  }
  next();
}
