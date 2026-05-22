import { pgTable, text, timestamp, uuid, jsonb, boolean, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Full project payload (= same shape as the .dpaint v2 file).
  data: jsonb("data").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  frameCount: integer("frame_count").notNull(),
  // Project visibility — public by default (the user picked
  // "Public par défaut + URL partageable").
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index("projects_owner_idx").on(table.ownerId),
  publicIdx: index("projects_public_idx").on(table.isPublic),
}));

export type Project = typeof projectsTable.$inferSelect;
export type InsertProject = typeof projectsTable.$inferInsert;
