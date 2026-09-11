ALTER TABLE "match_data" ADD COLUMN IF NOT EXISTS "game_version" text DEFAULT '' NOT NULL;
