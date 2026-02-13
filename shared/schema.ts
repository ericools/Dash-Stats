import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const coreBlockFees = pgTable("core_block_fees", {
  hash: varchar("hash", { length: 128 }).primaryKey(),
  height: integer("height").notNull(),
  time: integer("time").notNull(),
  totalFees: real("total_fees").notNull(),
  reward: real("reward").notNull(),
  txCount: integer("tx_count").notNull(),
});

export const platformEpochFees = pgTable("platform_epoch_fees", {
  epochNumber: integer("epoch_number").primaryKey(),
  startTime: bigint("start_time", { mode: "number" }).notNull(),
  endTime: bigint("end_time", { mode: "number" }).notNull(),
  totalCollectedFees: bigint("total_collected_fees", { mode: "number" }).notNull(),
  feeMultiplier: integer("fee_multiplier").notNull().default(1),
});

export const insertCoreBlockFeesSchema = createInsertSchema(coreBlockFees);
export const insertPlatformEpochFeesSchema = createInsertSchema(platformEpochFees);

export type CoreBlockFee = typeof coreBlockFees.$inferSelect;
export type InsertCoreBlockFee = z.infer<typeof insertCoreBlockFeesSchema>;
export type PlatformEpochFee = typeof platformEpochFees.$inferSelect;
export type InsertPlatformEpochFee = z.infer<typeof insertPlatformEpochFeesSchema>;

export const syncState = pgTable("sync_state", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type SyncState = typeof syncState.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
