CREATE TABLE IF NOT EXISTS completed_games (
  game_id TEXT PRIMARY KEY NOT NULL,
  combined_coins INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS completed_games_finished_at_idx ON completed_games (finished_at);
