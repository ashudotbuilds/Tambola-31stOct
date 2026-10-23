ALTER TABLE games ADD COLUMN account_user_id uuid REFERENCES users(id);
ALTER TABLE game_players ADD COLUMN account_user_id uuid REFERENCES users(id);
CREATE UNIQUE INDEX game_players_account_idx ON game_players(game_id,account_user_id) WHERE account_user_id IS NOT NULL;
