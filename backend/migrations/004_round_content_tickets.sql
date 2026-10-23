CREATE TABLE rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  round_no integer NOT NULL CHECK (round_no > 0),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 150),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','ACTIVE','PAUSED','RECOVERY_REQUIRED','COMPLETED','CANCELLED')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  close_after_calls integer NOT NULL DEFAULT 10 CHECK (close_after_calls BETWEEN 1 AND 90),
  wrong_claim_penalty integer NOT NULL DEFAULT 10 CHECK (wrong_claim_penalty BETWEEN 0 AND 1000),
  closing_seq integer CHECK (closing_seq BETWEEN 1 AND 90),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (event_id, round_no),
  UNIQUE (id, event_id)
);
CREATE UNIQUE INDEX rounds_one_operational_per_event_idx ON rounds(event_id)
  WHERE status IN ('ACTIVE','PAUSED','RECOVERY_REQUIRED');
CREATE INDEX rounds_event_idx ON rounds(event_id, round_no);

CREATE UNIQUE INDEX events_one_operational_idx ON events((true))
  WHERE status IN ('LIVE','PAUSED');

ALTER TABLE participant_profiles ADD CONSTRAINT participant_profile_event_pair UNIQUE(id, event_id);

CREATE TABLE event_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  value text NOT NULL CHECK (char_length(trim(value)) BETWEEN 2 AND 50),
  normalized_value text NOT NULL CHECK (char_length(normalized_value) BETWEEN 2 AND 50),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, normalized_value),
  UNIQUE (id, event_id)
);
CREATE INDEX event_keys_event_idx ON event_keys(event_id, active);

CREATE TABLE round_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  round_id uuid NOT NULL,
  key_id uuid NOT NULL,
  question text NOT NULL CHECK (char_length(trim(question)) BETWEEN 1 AND 4000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (round_id, event_id) REFERENCES rounds(id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (key_id, event_id) REFERENCES event_keys(id, event_id) ON DELETE RESTRICT,
  UNIQUE (round_id, key_id),
  UNIQUE (id, round_id, key_id)
);
CREATE INDEX round_questions_round_idx ON round_questions(round_id, active, key_id);

CREATE TABLE round_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  pattern text NOT NULL CHECK (pattern IN ('early_five','four_corners','top_line','middle_line','bottom_line','full_house','second_full_house')),
  enabled boolean NOT NULL DEFAULT true,
  max_winners integer NOT NULL DEFAULT 1 CHECK (max_winners BETWEEN 1 AND 500),
  points integer NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 1000000),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  UNIQUE (round_id, pattern)
);

CREATE TABLE round_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  round_id uuid NOT NULL,
  participant_profile_id uuid NOT NULL,
  cells jsonb NOT NULL,
  marked_cell_ids uuid[] NOT NULL DEFAULT '{}',
  cut_cell_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (round_id, event_id) REFERENCES rounds(id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (participant_profile_id, event_id) REFERENCES participant_profiles(id, event_id) ON DELETE RESTRICT,
  UNIQUE (round_id, participant_profile_id),
  UNIQUE (id, round_id, participant_profile_id)
);
CREATE INDEX round_tickets_participant_idx ON round_tickets(participant_profile_id, round_id);

CREATE TABLE round_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 90),
  question_id uuid,
  key_id uuid NOT NULL,
  question_snapshot text NOT NULL,
  key_snapshot text NOT NULL,
  drawn_by uuid REFERENCES users(id) ON DELETE SET NULL,
  manual boolean NOT NULL DEFAULT false,
  drawn_at timestamptz NOT NULL DEFAULT now(),
  revealed_at timestamptz,
  FOREIGN KEY (round_id, event_id) REFERENCES rounds(id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (key_id, event_id) REFERENCES event_keys(id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (question_id, round_id, key_id) REFERENCES round_questions(id, round_id, key_id) ON DELETE RESTRICT,
  UNIQUE (round_id, seq),
  UNIQUE (round_id, key_id)
);
CREATE INDEX round_draws_history_idx ON round_draws(round_id, seq);

CREATE TABLE round_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  participant_profile_id uuid NOT NULL REFERENCES participant_profiles(id) ON DELETE RESTRICT,
  pattern text NOT NULL CHECK (pattern IN ('early_five','four_corners','top_line','middle_line','bottom_line','full_house','second_full_house')),
  status text NOT NULL CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','REJECTED_PATTERN_ALREADY_CLOSED')),
  points integer NOT NULL DEFAULT 0,
  penalty integer NOT NULL DEFAULT 0 CHECK (penalty >= 0),
  cut_cell_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  FOREIGN KEY (round_id, event_id) REFERENCES rounds(id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (participant_profile_id, event_id) REFERENCES participant_profiles(id, event_id) ON DELETE RESTRICT,
  UNIQUE (round_id, participant_profile_id, pattern)
);
CREATE INDEX round_claims_review_idx ON round_claims(round_id, status, submitted_at, id);
CREATE INDEX round_claims_participant_idx ON round_claims(participant_profile_id, submitted_at DESC);

CREATE TABLE round_player_scores (
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  participant_profile_id uuid NOT NULL REFERENCES participant_profiles(id) ON DELETE RESTRICT,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  wrong_claims integer NOT NULL DEFAULT 0 CHECK (wrong_claims >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, participant_profile_id),
  FOREIGN KEY (round_id,event_id) REFERENCES rounds(id,event_id) ON DELETE RESTRICT,
  FOREIGN KEY (participant_profile_id,event_id) REFERENCES participant_profiles(id,event_id) ON DELETE RESTRICT
);
CREATE INDEX round_player_scores_leaderboard_idx ON round_player_scores(round_id, score DESC, wrong_claims, participant_profile_id);
