-- =============================================================================
-- The host moderates, the host does not play, so the host gets no ticket
-- =============================================================================
-- create_game() minted a ticket for the host, but submit_claim() refuses claims
-- from the host, so that ticket could never be used. Removing it also stops the
-- per-call auto-daub loop from locking and rewriting a row that nobody can claim.

CREATE OR REPLACE FUNCTION public.create_game(p_host_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_name         TEXT := btrim(COALESCE(p_host_name, ''));
  v_code         TEXT;
  v_game         public.games%ROWTYPE;
  v_player       public.game_players%ROWTYPE;
  v_host_token   UUID := gen_random_uuid();
  v_player_token UUID := gen_random_uuid();
  v_tries        INTEGER := 0;
  v_i            INTEGER;
  v_settings     JSONB;
  v_chars CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I, O, 0 or 1
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

  v_settings := jsonb_build_object(
    'points', jsonb_build_object(
      'early_five',        10,
      'four_corners',      20,
      'top_line',          30,
      'middle_line',       30,
      'bottom_line',       30,
      'full_house',        50,
      'second_full_house', 30
    ),
    'wrong_claim_penalty', 10,
    'close_after_calls',   10,
    'max_players',         100,
    'reveal_seconds',      3,
    'pause_after_calls',   4
  );

  INSERT INTO public.games (code, host_token, settings)
  VALUES (v_code, v_host_token, v_settings)
  RETURNING * INTO v_game;

  INSERT INTO public.game_players (game_id, token, display_name, is_host)
  VALUES (v_game.id, v_player_token, v_name, TRUE)
  RETURNING * INTO v_player;

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
