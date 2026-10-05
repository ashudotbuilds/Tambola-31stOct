-- =============================================================================
-- Migration: Manual Marking / Knowledge-based selection (No Auto-Select)
-- =============================================================================
-- 1. draw_number: Remove the auto-daub loop so the game NEVER auto-selects cells.
-- 2. set_player_marks: RPC allowing players to click/unclick cells to mark/unmark them.
-- 3. submit_claim: Evaluates claims against the player's manually clicked marks
--    intersected with officially called numbers, enforcing that players must use
--    their knowledge to click the right answers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. draw_number without auto-daubing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draw_number(p_game_id UUID, p_host_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game      public.games%ROWTYPE;
  v_called    INTEGER[];
  v_remaining INTEGER[];
  v_left      INTEGER;
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

  v_left := COALESCE(array_length(v_remaining, 1), 0);
  IF v_left = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'All 90 numbers have been called');
  END IF;

  v_number := v_remaining[floor(random() * v_left + 1)::integer];
  v_seq    := v_game.next_seq;
  v_clue   := public.pick_clue(p_game_id, v_number);

  INSERT INTO public.game_calls (game_id, seq, number, clue)
  VALUES (p_game_id, v_seq, v_number, v_clue);

  UPDATE public.games SET next_seq = v_seq + 1 WHERE id = p_game_id;

  -- NOTE: AUTO-DAUB REMOVED!
  -- Players must manually click their tickets based on their own knowledge.

  v_status  := v_game.status;
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
    'called_count', v_left - 1
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. set_player_marks: RPC to click and unclick cells on ticket
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_player_marks(
  p_game_id UUID,
  p_player_token UUID,
  p_marked INTEGER[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_player public.game_players%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_valid_marked INTEGER[];
BEGIN
  SELECT * INTO v_player FROM public.game_players
   WHERE game_id = p_game_id AND token = p_player_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Player not found');
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
   WHERE player_id = v_player.id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Ticket not found');
  END IF;

  -- Filter to numbers that exist on this ticket and are not cut
  SELECT COALESCE(array_agg(DISTINCT n), '{}'::integer[]) INTO v_valid_marked
    FROM unnest(COALESCE(p_marked, '{}'::integer[])) AS n
   WHERE public.tambola_has_number(v_ticket.cells, n)
     AND NOT (n = ANY (COALESCE(v_ticket.cut, '{}'::integer[])));

  UPDATE public.tickets
     SET marked = v_valid_marked
   WHERE id = v_ticket.id;

  RETURN jsonb_build_object('ok', TRUE, 'marked', v_valid_marked);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_player_marks(UUID, UUID, INTEGER[]) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. submit_claim: Checked against manually marked cells that have been called
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_claim(p_game_id UUID, p_player_token UUID, p_claim TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game              public.games%ROWTYPE;
  v_player            public.game_players%ROWTYPE;
  v_ticket            public.tickets%ROWTYPE;
  v_claim             TEXT := lower(btrim(COALESCE(p_claim, '')));
  v_called            INTEGER[];
  v_effective_marked  INTEGER[];
  v_points            INTEGER;
  v_penalty           INTEGER;
  v_houses            INTEGER;
  v_cut               INTEGER;
  v_score             INTEGER;
  v_seq_now           INTEGER := 0;
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

  -- Officially called numbers
  SELECT COALESCE(array_agg(number), '{}'::integer[]) INTO v_called
    FROM public.game_calls WHERE game_id = p_game_id;

  -- Effective marks: only what the player manually clicked AND what was actually called
  SELECT COALESCE(array_agg(n), '{}'::integer[]) INTO v_effective_marked
    FROM unnest(COALESCE(v_ticket.marked, '{}'::integer[])) AS n
   WHERE n = ANY (v_called);

  -- Claim validation: must be valid on effective marks
  IF NOT public.tambola_claim_ok(v_claim, v_ticket.cells, v_effective_marked, v_ticket.cut) THEN
    v_penalty := COALESCE((v_game.settings ->> 'wrong_claim_penalty')::integer, 10);

    -- Cut one of their marked numbers (or a number on ticket if any)
    SELECT n INTO v_cut
      FROM unnest(COALESCE(v_ticket.marked, '{}'::integer[])) AS n
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

  SELECT COALESCE(max(seq), 0) INTO v_seq_now FROM public.game_calls WHERE game_id = p_game_id;

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
