import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Pekerja favorit milik pemberi kerja. Hanya pekerja yang pernah diterima
 * oleh pemberi kerja yang sama yang boleh difavoritkan (dicek di route).
 */
export const favoriteWorkersTable = pgTable(
  "favorite_workers",
  {
    employerId: text("employer_id").notNull(),
    workerId: text("worker_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.employerId, table.workerId] })],
);

export type FavoriteWorker = typeof favoriteWorkersTable.$inferSelect;
