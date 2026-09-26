-- =============================================================================
-- Technical Tambola — schema, ticket generation, claim rules, authoritative RPCs
-- =============================================================================
-- Security model (no player accounts):
--   * The anon/authenticated roles get NO direct privileges on any table below.
--   * Every read and write goes through a SECURITY DEFINER function that verifies
--     a secret per-player token (or the host token).
--   * Clients cannot publish to realtime; all events come from triggers in 0003.
-- =============================================================================

-- ---------------------------------------------------------------- games
CREATE TABLE IF NOT EXISTS public.games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'lobby'
              CHECK (status IN ('lobby', 'playing', 'paused', 'closing', 'finished')),
  host_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  next_seq    INTEGER NOT NULL DEFAULT 1,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------- players
CREATE TABLE IF NOT EXISTS public.game_players (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  token        UUID NOT NULL DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 24),
  is_host      BOOLEAN NOT NULL DEFAULT FALSE,
  score        INTEGER NOT NULL DEFAULT 0,
  wrong_claims INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT game_players_token_key UNIQUE (game_id, token),
  CONSTRAINT game_players_name_key  UNIQUE (game_id, display_name)
);
CREATE INDEX IF NOT EXISTS game_players_game_idx ON public.game_players (game_id);

-- ---------------------------------------------------------------- tickets
-- cells: 3 rows x 9 cols of numbers, JSON null = blank cell.
-- Column c holds numbers in ((c-1)*10 + 1) .. ((c-1)*10 + 9), i.e. 1-9 ... 81-90.
CREATE TABLE IF NOT EXISTS public.tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES public.game_players(id) ON DELETE CASCADE,
  cells      JSONB NOT NULL,
  marked     INTEGER[] NOT NULL DEFAULT '{}',
  cut        INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tickets_player_key UNIQUE (player_id)
);
CREATE INDEX IF NOT EXISTS tickets_game_idx ON public.tickets (game_id);

-- ---------------------------------------------------------------- calls
CREATE TABLE IF NOT EXISTS public.game_calls (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  number    INTEGER NOT NULL CHECK (number BETWEEN 1 AND 90),
  clue      TEXT NOT NULL,
  called_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT game_calls_seq_key    UNIQUE (game_id, seq),
  CONSTRAINT game_calls_number_key UNIQUE (game_id, number)
);
CREATE INDEX IF NOT EXISTS game_calls_game_seq_idx ON public.game_calls (game_id, seq);

-- ---------------------------------------------------------------- claims
CREATE TABLE IF NOT EXISTS public.claims (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES public.game_players(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  points     INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Exactly one winner per exclusive claim type, even under a simultaneous race.
CREATE UNIQUE INDEX IF NOT EXISTS claims_exclusive_uniq
  ON public.claims (game_id, claim_type) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS claims_game_idx   ON public.claims (game_id, created_at);
CREATE INDEX IF NOT EXISTS claims_player_idx ON public.claims (player_id);

-- ---------------------------------------------------------------- clue bank
-- Canonical, hand-written clue variants for 1-90 (populated in 0002).
CREATE TABLE IF NOT EXISTS public.tambola_clue_bank (
  number  INTEGER NOT NULL,
  variant INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (number, variant)
);

-- Per-game copy of the clue bank so variants can be consumed without repeats.
CREATE TABLE IF NOT EXISTS public.game_clues (
  game_id UUID    NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  number  INTEGER NOT NULL,
  variant INTEGER NOT NULL,
  text    TEXT    NOT NULL,
  used    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (game_id, number, variant)
);


-- =============================================================================
-- Pure helpers
-- =============================================================================

-- Is a single ticket cell satisfied? (numbered, called, and not cut)
CREATE OR REPLACE FUNCTION public.tambola_cell_ok(
  p_num INTEGER, p_marked INTEGER[], p_cut INTEGER[]
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_num IS NOT NULL
     AND (p_num = ANY (COALESCE(p_marked, '{}'::integer[])))
     AND NOT (p_num = ANY (COALESCE(p_cut,    '{}'::integer[])));
$$;

-- Does this ticket contain the number at all? (used for auto-daub)
CREATE OR REPLACE FUNCTION public.tambola_has_number(p_cells JSONB, p_num INTEGER)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cells) = 'array' THEN p_cells ELSE '[]'::jsonb END) AS r,
         LATERAL jsonb_array_elements(r) AS e
    WHERE (e #>> '{}')::integer = p_num
  );
$$;

-- Claim points, from game settings with sane defaults.
CREATE OR REPLACE FUNCTION public.tambola_points(p_settings JSONB, p_claim TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(p_settings -> 'points' ->> p_claim, '')::integer,
    CASE p_claim
      WHEN 'early_five'        THEN 10
      WHEN 'four_corners'      THEN 20
      WHEN 'top_line'          THEN 30
      WHEN 'middle_line'       THEN 30
      WHEN 'bottom_line'       THEN 30
      WHEN 'full_house'        THEN 50
      WHEN 'second_full_house' THEN 30
      ELSE 0
    END
  );
$$;

-- Authoritative claim check. `second_full_house` uses the same predicate as
-- `full_house`; the "a house must already exist" rule lives in submit_claim.
CREATE OR REPLACE FUNCTION public.tambola_claim_ok(
  p_claim TEXT, p_cells JSONB, p_marked INTEGER[], p_cut INTEGER[]
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_r0 INTEGER[];
  v_r1 INTEGER[];
  v_r2 INTEGER[];
  v_all INTEGER[];
  v_m   INTEGER[] := COALESCE(p_marked, '{}'::integer[]);
  v_c   INTEGER[] := COALESCE(p_cut,    '{}'::integer[]);
  v_n   INTEGER;
BEGIN
  IF p_cells IS NULL OR jsonb_typeof(p_cells) <> 'array' THEN
    RETURN FALSE;
  END IF;

  SELECT array_agg((e #>> '{}')::integer ORDER BY ord) INTO v_r0
    FROM jsonb_array_elements(p_cells -> 0) WITH ORDINALITY AS t(e, ord);
  SELECT array_agg((e #>> '{}')::integer ORDER BY ord) INTO v_r1
    FROM jsonb_array_elements(p_cells -> 1) WITH ORDINALITY AS t(e, ord);
  SELECT array_agg((e #>> '{}')::integer ORDER BY ord) INTO v_r2
    FROM jsonb_array_elements(p_cells -> 2) WITH ORDINALITY AS t(e, ord);

  v_r0 := COALESCE(v_r0, '{}'::integer[]);
  v_r1 := COALESCE(v_r1, '{}'::integer[]);
  v_r2 := COALESCE(v_r2, '{}'::integer[]);
  v_all := v_r0 || v_r1 || v_r2;

  IF p_claim = 'early_five' THEN
    SELECT count(*) INTO v_n
      FROM unnest(v_all) AS x
     WHERE public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n >= 5;

  ELSIF p_claim = 'four_corners' THEN
    RETURN public.tambola_cell_ok(v_r0[1], v_m, v_c)
       AND public.tambola_cell_ok(v_r0[9], v_m, v_c)
       AND public.tambola_cell_ok(v_r2[1], v_m, v_c)
       AND public.tambola_cell_ok(v_r2[9], v_m, v_c);

  ELSIF p_claim = 'top_line'     THEN
    SELECT count(*) INTO v_n FROM unnest(v_r0) AS x
     WHERE NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;

  ELSIF p_claim = 'middle_line' THEN
    SELECT count(*) INTO v_n FROM unnest(v_r1) AS x
     WHERE NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;

  ELSIF p_claim = 'bottom_line' THEN
    SELECT count(*) INTO v_n FROM unnest(v_r2) AS x
     WHERE NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;

  ELSIF p_claim IN ('full_house', 'second_full_house') THEN
    SELECT count(*) INTO v_n FROM unnest(v_all) AS x
     WHERE NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;
  END IF;

  RETURN FALSE;
END;
$$;


-- =============================================================================
-- Ticket generation — standard 3x9 tambola, 15 numbers (5 per row)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_tambola_ticket()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_counts   INTEGER[] := '{}';
  v_fallback CONSTANT INTEGER[] := ARRAY[2, 2, 2, 2, 2, 2, 1, 1, 1];
  v_chosen   INTEGER[] := '{}';
  v_blank    BOOLEAN[] := '{}';
  v_ord      INTEGER[] := '{}';
  v_used     INTEGER := 0;
  v_col      INTEGER;
  v_row      INTEGER;
  v_i        INTEGER;
  v_n        INTEGER;
  v_pick     INTEGER;
  v_picked   INTEGER;
  v_tries    INTEGER;
  v_cand     INTEGER[];
  v_res      JSONB := '[]'::jsonb;
  v_rowj     JSONB;
BEGIN
  -- 1. Numbers per column: each of 9 columns gets 1..3, total must be 15.
  FOR v_tries IN 1..500 LOOP
    v_counts := '{}';
    v_used := 0;
    FOR v_col IN 1..9 LOOP
      v_n := 1 + floor(random() * 3)::integer;
      v_counts := array_append(v_counts, v_n);
      v_used := v_used + v_n;
    END LOOP;
    EXIT WHEN v_used = 15;
  END LOOP;
  IF v_used <> 15 THEN
    v_counts := v_fallback;
  END IF;

  -- 2. Pick ascending numbers inside each column band.
  FOR v_col IN 1..9 LOOP
    v_cand := '{}';
    FOR v_i IN 1..v_counts[v_col] LOOP
      LOOP
        v_pick := ((v_col - 1) * 10) + floor(random() * 9)::integer + 1;
        EXIT WHEN NOT (v_pick = ANY (v_cand));
      END LOOP;
      v_cand := array_append(v_cand, v_pick);
    END LOOP;
    v_chosen := v_chosen || v_cand;
  END LOOP;

  -- 3. Exactly 4 blank cells per row (so 5 numbers per row).
  v_blank := array_fill(FALSE, ARRAY[27]);
  FOR v_row IN 0..2 LOOP
    v_picked := 0;
    WHILE v_picked < 4 LOOP
      v_col := floor(random() * 9)::integer + 1;
      IF NOT v_blank[v_row * 9 + v_col] THEN
        v_blank[v_row * 9 + v_col] := TRUE;
        v_picked := v_picked + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- 4. Lay the numbers out column by column into the free slots.
  v_ord := array_fill(0, ARRAY[27]);
  v_i := 1;
  FOR v_col IN 1..9 LOOP
    FOR v_row IN 0..2 LOOP
      IF NOT v_blank[v_row * 9 + v_col] THEN
        v_ord[v_row * 9 + v_col] := v_chosen[v_i];
        v_i := v_i + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- 5. Emit 3x9 JSON, blanks as null.
  FOR v_row IN 0..2 LOOP
    v_rowj := '[]'::jsonb;
    FOR v_col IN 1..9 LOOP
      IF v_ord[v_row * 9 + v_col] = 0 THEN
        v_rowj := v_rowj || 'null'::jsonb;
      ELSE
        v_rowj := v_rowj || to_jsonb(v_ord[v_row * 9 + v_col]);
      END IF;
    END LOOP;
    v_res := v_res || v_rowj;
  END LOOP;

  RETURN v_res;
END;
$$;

-- Copy the clue bank into a game, ready for consumption.
CREATE OR REPLACE FUNCTION public.seed_game_clues(p_game_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.game_clues WHERE game_id = p_game_id;
  INSERT INTO public.game_clues (game_id, number, variant, text)
  SELECT p_game_id, number, variant, text FROM public.tambola_clue_bank;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Pick an unused clue variant for a number, falling back to any variant.
CREATE OR REPLACE FUNCTION public.pick_clue(p_game_id UUID, p_number INTEGER)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_clue TEXT;
BEGIN
  SELECT text INTO v_clue
    FROM public.game_clues
   WHERE game_id = p_game_id AND number = p_number AND NOT used
   ORDER BY random()
   LIMIT 1;

  IF v_clue IS NULL THEN
    SELECT text INTO v_clue
      FROM public.game_clues
     WHERE game_id = p_game_id AND number = p_number
     ORDER BY random()
     LIMIT 1;
  END IF;

  IF v_clue IS NULL THEN
    v_clue := 'Number ' || p_number;
  ELSE
    UPDATE public.game_clues SET used = TRUE
     WHERE game_id = p_game_id AND number = p_number AND text = v_clue;
  END IF;

  RETURN v_clue;
END;
$$;


-- =============================================================================
-- RPC: create a game (the caller becomes host)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_game(p_host_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_name        TEXT := btrim(COALESCE(p_host_name, ''));
  v_code        TEXT;
  v_game        public.games%ROWTYPE;
  v_player      public.game_players%ROWTYPE;
  v_host_token  UUID := gen_random_uuid();
  v_player_token UUID := gen_random_uuid();
  v_tries       INTEGER := 0;
  v_i           INTEGER;
  v_chars CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I,O,0,1
BEGIN
  IF char_length(v_name) < 1 OR char_length(v_name) > 24 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Host name must be 1-24 characters');
  END IF;

  LOOP
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
    END LOOP;
    v_tries := v_tries + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.games WHERE code = v_code);
    IF v_tries > 50 THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'Could not allocate a game code, please retry');
    END IF;
  END LOOP;

  INSERT INTO public.games (code, host_token, settings)
  VALUES (
    v_code,
    v_host_token,
    '{"points":{"early_five":10,"four_corners":20,"top_line":30,"middle_line":30,'
    || '"bottom_line":30,"full_house":50,"second_full_house":30},'
    || '"wrong_claim_penalty":10,"close_after_calls":10,"max_players":100,'
    || '"reveal_seconds":3,"pause_after_calls":4}'::jsonb
  )
  RETURNING * INTO v_game;

  INSERT INTO public.game_players (game_id, token, display_name, is_host)
  VALUES (v_game.id, v_player_token, v_name, TRUE)
  RETURNING * INTO v_player;

  INSERT INTO public.tickets (game_id, player_id, cells)
  VALUES (v_game.id, v_player.id, public.generate_tambola_ticket());

  PERFORM public.seed_game_clues(v_game.id);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'game_id', v_game.id,
    'code', v_game.code,
    'status', v_game.status,
    'settings', v_game.settings,
    'player_id', v_player.id,
    'display_name', v_player.display_name,
    'player_token', v_player_token,
    'host_token', v_host_token
  );
END;
$$;


-- =============================================================================
-- RPC: join a game
-- =============================================================================
CREATE OR REPLACE FUNCTION public.join_game(p_code TEXT, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_code    TEXT := upper(btrim(COALESCE(p_code, '')));
  v_name    TEXT := btrim(COALESCE(p_name, ''));
  v_game    public.games%ROWTYPE;
  v_player  public.game_players%ROWTYPE;
  v_ticket  public.tickets%ROWTYPE;
  v_token   UUID := gen_random_uuid();
  v_max     INTEGER;
  v_count   INTEGER;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE code = v_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'No game found with that code');
  END IF;
  IF v_game.status <> 'lobby' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'That game has already started');
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 24 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Name must be 1-24 characters');
  END IF;

  v_max := COALESCE((v_game.settings ->> 'max_players')::integer, 100);
  SELECT count(*) INTO v_count FROM public.game_players WHERE game_id = v_game.id;
  IF v_count >= v_max THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This game is full');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_players
     WHERE game_id = v_game.id AND lower(display_name) = lower(v_name)
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'That name is already taken in this game');
  END IF;

  INSERT INTO public.game_players (game_id, token, display_name)
  VALUES (v_game.id, v_token, v_name)
  RETURNING * INTO v_player;

  INSERT INTO public.tickets (game_id, player_id, cells)
  VALUES (v_game.id, v_player.id, public.generate_tambola_ticket())
  RETURNING * INTO v_ticket;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'game_id', v_game.id,
    'code', v_game.code,
    'status', v_game.status,
    'settings', v_game.settings,
    'player_id', v_player.id,
    'display_name', v_player.display_name,
    'player_token', v_token,
    'ticket', v_ticket.cells,
    'player_count', v_count + 1
  );
END;
$$;


-- =============================================================================
-- RPC: start the game (host only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.start_game(p_game_id UUID, p_host_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game   public.games%ROWTYPE;
  v_players INTEGER;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;
  IF v_game.host_token IS DISTINCT FROM p_host_token THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only the host can start the game');
  END IF;
  IF v_game.status <> 'lobby' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game has already started');
  END IF;

  SELECT count(*) INTO v_players FROM public.game_players
   WHERE game_id = p_game_id AND NOT is_host;
  IF v_players < 1 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'At least one player must join first');
  END IF;

  UPDATE public.games SET status = 'playing', started_at = NOW() WHERE id = p_game_id;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'playing', 'player_count', v_players);
END;
$$;


-- =============================================================================
-- RPC: pause / resume / finish (host only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_game_status(p_game_id UUID, p_host_token UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game public.games%ROWTYPE;
  v_next TEXT := lower(btrim(COALESCE(p_status, '')));
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;
  IF v_game.host_token IS DISTINCT FROM p_host_token THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only the host can do that');
  END IF;

  IF v_next = 'paused' THEN
    IF v_game.status NOT IN ('playing', 'closing') THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'Game cannot be paused right now');
    END IF;
  ELSIF v_next = 'playing' THEN
    IF v_game.status <> 'paused' THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'Game is not paused');
    END IF;
    UPDATE public.games
       SET status = CASE WHEN COALESCE(settings ->> 'closing_seq', '0')::integer > 0
                         THEN 'closing' ELSE 'playing' END
     WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', TRUE, 'status',
      CASE WHEN COALESCE(settings ->> 'closing_seq', '0')::integer > 0
           THEN 'closing' ELSE 'playing' END);
  ELSIF v_next = 'finished' THEN
    IF v_game.status IN ('lobby', 'finished') THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'Game is not in progress');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Unknown status');
  END IF;

  UPDATE public.games
     SET status = v_next,
         finished_at = CASE WHEN v_next = 'finished' THEN NOW() ELSE finished_at END
   WHERE id = p_game_id;

  RETURN jsonb_build_object('ok', TRUE, 'status', v_next);
END;
$$;


-- =============================================================================
-- RPC: draw the next number (host only) — auto-daubs every matching ticket
-- =============================================================================
CREATE OR REPLACE FUNCTION public.draw_number(p_game_id UUID, p_host_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game      public.games%ROWTYPE;
  v_ticket    public.tickets%ROWTYPE;
  v_called    INTEGER[];
  v_remaining INTEGER[];
  v_number    INTEGER;
  v_seq       INTEGER;
  v_clue      TEXT;
  v_close_at  INTEGER;
  v_close_for INTEGER;
  v_status    TEXT;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;
  IF v_game.host_token IS DISTINCT FROM p_host_token THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only the host can call numbers');
  END IF;
  IF v_game.status = 'lobby' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Start the game first');
  END IF;
  IF v_game.status = 'paused' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game is paused');
  END IF;
  IF v_game.status = 'finished' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game is over');
  END IF;

  SELECT array_agg(number) INTO v_called FROM public.game_calls WHERE game_id = p_game_id;
  v_remaining := ARRAY(
    SELECT n FROM generate_series(1, 90) AS n
     WHERE NOT (n = ANY (COALESCE(v_called, '{}'::integer[])))
  );
  IF v_remaining IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'All 90 numbers have been called');
  END IF;

  v_number := v_remaining[floor(random() * array_length(v_remaining, 1) + 1)::integer];
  v_seq    := v_game.next_seq;
  v_clue   := public.pick_clue(p_game_id, v_number);

  INSERT INTO public.game_calls (game_id, seq, number, clue)
  VALUES (p_game_id, v_seq, v_number, v_clue);

  UPDATE public.games SET next_seq = v_seq + 1 WHERE id = p_game_id;

  -- Auto-daub: mark the number on every ticket that contains it.
  FOR v_ticket IN
    SELECT * FROM public.tickets WHERE game_id = p_game_id ORDER BY player_id FOR UPDATE
  LOOP
    IF NOT (v_number = ANY (v_ticket.cut))
       AND public.tambola_has_number(v_ticket.cells, v_number) THEN
      UPDATE public.tickets SET marked = marked || v_number WHERE id = v_ticket.id;
    END IF;
  END LOOP;

  -- Close the game out after the configured number of calls past the first house.
  v_status := v_game.status;
  v_close_for := COALESCE((v_game.settings ->> 'close_after_calls')::integer, 10);
  v_close_at  := COALESCE((v_game.settings ->> 'closing_seq')::integer, 0);

  IF v_status = 'closing' AND v_close_at > 0 AND (v_seq - v_close_at) >= v_close_for THEN
    UPDATE public.games SET status = 'finished', finished_at = NOW() WHERE id = p_game_id;
    v_status := 'finished';
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'seq', v_seq,
    'number', v_number,
    'clue', v_clue,
    'status', v_status,
    'called_count', array_length(v_remaining, 1) - 1
  );
END;
$$;


-- =============================================================================
-- RPC: submit a claim — the only path to points, validated against stored state
-- =============================================================================
CREATE OR REPLACE FUNCTION public.submit_claim(p_game_id UUID, p_player_token UUID, p_claim TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game     public.games%ROWTYPE;
  v_player   public.game_players%ROWTYPE;
  v_ticket   public.tickets%ROWTYPE;
  v_claim    TEXT := lower(btrim(COALESCE(p_claim, '')));
  v_points   INTEGER;
  v_penalty  INTEGER;
  v_houses   INTEGER;
  v_cut      INTEGER;
  v_score    INTEGER;
  v_seq_now  INTEGER;
BEGIN
  IF v_claim NOT IN ('early_five', 'four_corners', 'top_line', 'middle_line',
                     'bottom_line', 'full_house', 'second_full_house') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Unknown claim type');
  END IF;

  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;
  IF v_game.status IN ('lobby', 'finished') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'The game is not in progress');
  END IF;

  SELECT * INTO v_player FROM public.game_players
   WHERE game_id = p_game_id AND token = p_player_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'You are not in this game');
  END IF;
  IF v_player.is_host THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'The host does not play');
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE player_id = v_player.id FOR UPDATE;

  SELECT count(*) INTO v_houses FROM public.claims
   WHERE game_id = p_game_id AND status = 'accepted'
     AND claim_type IN ('full_house', 'second_full_house');
  IF v_claim = 'second_full_house' AND v_houses = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'The first full house has not been claimed yet');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.claims
     WHERE game_id = p_game_id AND player_id = v_player.id
       AND claim_type = v_claim AND status = 'accepted'
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'You already claimed that', 'code', 'already_claimed');
  END IF;

  -- Invalid claim: penalty plus a cut number.
  IF NOT public.tambola_claim_ok(v_claim, v_ticket.cells, v_ticket.marked, v_ticket.cut) THEN
    v_penalty := COALESCE((v_game.settings ->> 'wrong_claim_penalty')::integer, 10);

    SELECT n INTO v_cut
      FROM unnest(v_ticket.marked) AS n
     WHERE NOT (n = ANY (COALESCE(v_ticket.cut, '{}'::integer[])))
     ORDER BY random()
     LIMIT 1;

    IF v_cut IS NOT NULL THEN
      UPDATE public.tickets SET cut = cut || v_cut WHERE id = v_ticket.id;
    END IF;

    UPDATE public.game_players
       SET score = greatest(0, score - v_penalty), wrong_claims = wrong_claims + 1
     WHERE id = v_player.id
    RETURNING score INTO v_score;

    INSERT INTO public.claims (game_id, player_id, claim_type, status, points, reason)
    VALUES (p_game_id, v_player.id, v_claim, 'rejected', -v_penalty, 'Not valid on your ticket');

    RETURN jsonb_build_object(
      'ok', TRUE, 'accepted', FALSE, 'status', 'rejected',
      'reason', 'Not valid on your ticket',
      'penalty', v_penalty, 'cut', v_cut, 'score', v_score,
      'wrong_claims', v_player.wrong_claims + 1
    );
  END IF;

  -- Valid claim. The partial unique index settles simultaneous winners.
  v_points := public.tambola_points(v_game.settings, v_claim);

  BEGIN
    INSERT INTO public.claims (game_id, player_id, claim_type, status, points)
    VALUES (p_game_id, v_player.id, v_claim, 'accepted', v_points);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.claims (game_id, player_id, claim_type, status, points, reason)
    VALUES (p_game_id, v_player.id, v_claim, 'rejected', 0, 'Already claimed by another player');
    RETURN jsonb_build_object(
      'ok', TRUE, 'accepted', FALSE, 'status', 'rejected',
      'reason', 'Already claimed by another player',
      'score', v_player.score
    );
  END;

  UPDATE public.game_players SET score = score + v_points
   WHERE id = v_player.id RETURNING score INTO v_score;

  SELECT max(seq) INTO v_seq_now FROM public.game_calls WHERE game_id = p_game_id;

  IF v_claim = 'full_house' AND v_game.status = 'playing' THEN
    UPDATE public.games
       SET status = 'closing',
           settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{closing_seq}', to_jsonb(v_seq_now))
     WHERE id = p_game_id;
  ELSIF v_claim = 'second_full_house' AND v_game.status = 'closing' THEN
    UPDATE public.games SET status = 'finished', finished_at = NOW() WHERE id = p_game_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE, 'accepted', TRUE, 'status', 'accepted',
    'points', v_points, 'score', v_score, 'reason', NULL
  );
END;
$$;


-- =============================================================================
-- Read models
-- =============================================================================

-- Full game state. p_player_token is optional: when supplied and valid, the
-- response also includes that player's own ticket, marks and cuts.
CREATE OR REPLACE FUNCTION public.get_game_state(p_game_id UUID, p_player_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game    public.games%ROWTYPE;
  v_players JSONB;
  v_calls   JSONB;
  v_claims  JSONB;
  v_me      JSONB := NULL;
  v_player  public.game_players%ROWTYPE;
  v_ticket  public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.display_name, 'is_host', p.is_host,
           'score', p.score, 'wrong_claims', p.wrong_claims
         ) ORDER BY p.score DESC, p.created_at), '[]'::jsonb)
    INTO v_players
    FROM public.game_players p
   WHERE p.game_id = p_game_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'seq', c.seq, 'number', c.number, 'clue', c.clue, 'called_at', c.called_at
         ) ORDER BY c.seq), '[]'::jsonb)
    INTO v_calls
    FROM public.game_calls c
   WHERE c.game_id = p_game_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cl.id, 'player_id', cl.player_id, 'name', pl.display_name,
           'claim_type', cl.claim_type, 'status', cl.status,
           'points', cl.points, 'reason', cl.reason, 'created_at', cl.created_at
         ) ORDER BY cl.created_at), '[]'::jsonb)
    INTO v_claims
    FROM public.claims cl
    JOIN public.game_players pl ON pl.id = cl.player_id
   WHERE cl.game_id = p_game_id;

  IF p_player_token IS NOT NULL THEN
    SELECT * INTO v_player FROM public.game_players
     WHERE game_id = p_game_id AND token = p_player_token;
    IF FOUND THEN
      SELECT * INTO v_ticket FROM public.tickets WHERE player_id = v_player.id;
      v_me := jsonb_build_object(
        'player_id', v_player.id,
        'name', v_player.display_name,
        'is_host', v_player.is_host,
        'score', v_player.score,
        'wrong_claims', v_player.wrong_claims,
        'ticket', v_ticket.cells,
        'marked', to_jsonb(v_ticket.marked),
        'cut', to_jsonb(v_ticket.cut)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'game_id', v_game.id,
    'code', v_game.code,
    'status', v_game.status,
    'settings', v_game.settings,
    'created_at', v_game.created_at,
    'players', v_players,
    'calls', v_calls,
    'claims', v_claims,
    'me', v_me
  );
END;
$$;

-- Public, token-free lookup (projector screen, deep links).
CREATE OR REPLACE FUNCTION public.get_game_state_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.games WHERE code = upper(btrim(COALESCE(p_code, '')));
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'No game found with that code');
  END IF;
  RETURN public.get_game_state(v_id, NULL);
END;
$$;

-- Public, token-free state for a known game id.
CREATE OR REPLACE FUNCTION public.get_public_game_state(p_game_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.get_game_state(p_game_id, NULL);
END;
$$;


-- =============================================================================
-- Lock down direct table access
-- =============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;

REVOKE ALL ON public.games, public.game_players, public.tickets,
             public.game_calls, public.claims,
             public.game_clues, public.tambola_clue_bank
  FROM anon, authenticated;

ALTER TABLE public.games           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_calls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_clues      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tambola_clue_bank ENABLE ROW LEVEL SECURITY;
-- No policies are created: with RLS enabled and no table privileges, the only
-- way in is the SECURITY DEFINER functions above.

GRANT EXECUTE ON FUNCTION
  public.create_game(TEXT),
  public.join_game(TEXT, TEXT),
  public.start_game(UUID, UUID),
  public.set_game_status(UUID, UUID, TEXT),
  public.draw_number(UUID, UUID),
  public.submit_claim(UUID, UUID, TEXT),
  public.get_game_state(UUID, UUID),
  public.get_game_state_by_code(TEXT),
  public.get_public_game_state(UUID)
TO anon, authenticated;
