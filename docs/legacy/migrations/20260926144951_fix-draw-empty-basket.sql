-- =============================================================================
-- Fix: draw_number() must detect an exhausted basket, not a NULL basket
-- =============================================================================
-- ARRAY(SELECT ...) returns an empty array when the subquery matches no rows,
-- never NULL. The guard tested "v_remaining IS NULL", so once all 90 numbers had
-- been called the function carried on, array_length() returned NULL, the
-- subscript returned NULL and the insert failed with a not-null violation
-- instead of the intended "All 90 numbers have been called" message.

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

  -- An exhausted basket is an empty array, so test the length.
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

  -- Auto-daub: mark the number on every ticket that contains it.
  FOR v_ticket IN
    SELECT * FROM public.tickets WHERE game_id = p_game_id ORDER BY player_id FOR UPDATE
  LOOP
    IF NOT (v_number = ANY (COALESCE(v_ticket.cut, '{}'::integer[])))
       AND public.tambola_has_number(v_ticket.cells, v_number) THEN
      UPDATE public.tickets SET marked = marked || v_number WHERE id = v_ticket.id;
    END IF;
  END LOOP;

  -- Close the game out a fixed number of calls after the first full house.
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
