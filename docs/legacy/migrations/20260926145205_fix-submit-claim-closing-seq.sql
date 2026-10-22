-- =============================================================================
-- Fix: submit_claim() must not write a NULL closing_seq into games.settings
-- =============================================================================
-- to_jsonb(NULL) is NULL, and jsonb_set(target, path, NULL) is NULL, so a full
-- house accepted before any number had been called wiped the whole settings
-- object and tripped the NOT NULL constraint. The column is also NOT NULL on
-- games.settings, so the whole transaction aborted.

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
  v_seq_now  INTEGER := 0;
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
