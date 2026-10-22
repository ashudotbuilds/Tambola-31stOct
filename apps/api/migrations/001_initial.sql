-- Plain PostgreSQL: works on Neon, local PostgreSQL, and Amazon RDS.
CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{6}$'),
  status text NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','paused','closing','finished')),
  host_token_hash text NOT NULL,
  next_seq integer NOT NULL DEFAULT 1 CHECK (next_seq BETWEEN 1 AND 91),
  settings jsonb NOT NULL,
  paused_from_status text CHECK (paused_from_status IN ('playing','closing')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE game_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 24),
  is_host boolean NOT NULL DEFAULT false,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  wrong_claims integer NOT NULL DEFAULT 0 CHECK (wrong_claims >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, token_hash),
  UNIQUE (game_id, id)
);
CREATE UNIQUE INDEX game_players_name_key ON game_players (game_id, lower(display_name));
CREATE UNIQUE INDEX game_players_host_key ON game_players (game_id) WHERE is_host;

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL UNIQUE,
  cells jsonb NOT NULL,
  marked integer[] NOT NULL DEFAULT '{}',
  cut integer[] NOT NULL DEFAULT '{}',
  FOREIGN KEY (game_id, player_id) REFERENCES game_players(game_id, id) ON DELETE CASCADE
);
CREATE INDEX tickets_game_idx ON tickets(game_id);

CREATE TABLE game_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 90),
  number integer NOT NULL CHECK (number BETWEEN 1 AND 90),
  clue text NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, seq),
  UNIQUE (game_id, number)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  claim_type text NOT NULL CHECK (claim_type IN ('early_five','four_corners','top_line','middle_line','bottom_line','full_house','second_full_house')),
  status text NOT NULL CHECK (status IN ('accepted','rejected')),
  points integer NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (game_id, player_id) REFERENCES game_players(game_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX claims_exclusive_uniq ON claims(game_id, claim_type) WHERE status = 'accepted';
CREATE INDEX claims_game_idx ON claims(game_id, created_at);
