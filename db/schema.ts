import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const completedGames = sqliteTable("completed_games", {
  gameId: text("game_id").primaryKey(),
  combinedCoins: integer("combined_coins").notNull(),
  finishedAt: integer("finished_at").notNull(),
});
