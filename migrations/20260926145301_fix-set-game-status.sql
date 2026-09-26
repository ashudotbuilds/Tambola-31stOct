-- =============================================================================
-- Fix: set_game_status() referenced games.settings with no table in scope
-- =============================================================================
-- The resume branch returned a CASE over a bare `settings` column inside a plain
-- RETURN expression, where no FROM item is visible. Resuming a paused game
-- failed with 'column "settings" does not exist'. The status is now computed into
-- a variable from the already-loaded row.

CREATE OR REPLACE FUNCTION public.set_game_status(p_game_id UUID, p_host_token UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game   public.games%ROWTYPE;
  v_next   TEXT := lower(btrim(COALESCE(p_status, '')));
  v_resume TEXT;
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

    -- Resume into the state the game was in before the pause.
    v_resume := CASE
                  WHEN COALESCE(v_game.settings ->> 'closing_seq', '0')::integer > 0
                    THEN 'closing'
                  ELSE 'playing'
                END;

    UPDATE public.games SET status = v_resume WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', TRUE, 'status', v_resume);

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
