import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// One-shot magic-link tokens delivered by email. The token is random,
// stored as the primary key, and used exactly once (used_at != null).
export const magicLinksTable = pgTable("magic_links", {
  token: text("token").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: index("magic_links_email_idx").on(table.email),
  expiresIdx: index("magic_links_expires_idx").on(table.expiresAt),
}));

// HttpOnly cookie sessions. Server-side store lets us revoke.
export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),       // random, used as cookie value
  userId: text("user_id").notNull(), // user UUID (string for portability)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  userIdx: index("sessions_user_idx").on(table.userId),
  expiresIdx: index("sessions_expires_idx").on(table.expiresAt),
}));

export type Session = typeof sessionsTable.$inferSelect;
export type MagicLink = typeof magicLinksTable.$inferSelect;
