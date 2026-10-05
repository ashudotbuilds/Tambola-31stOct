-- =============================================================================
-- Migration: add reveal_calls and update_game_bank RPCs
-- =============================================================================
-- Allows host to:
-- 1. Reveal specific calls or batches of calls (clubbing questions)
-- 2. Store custom question banks on a game
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reveal_calls(
  p_game_id UUID,
  p_host_token UUID,
  p_seqs INTEGER[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game public.games%ROWTYPE;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;
  IF v_game.host_token IS DISTINCT FROM p_host_token THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only the host can reveal calls');
  END IF;

  UPDATE public.games
     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{revealed_seqs}', to_jsonb(p_seqs))
   WHERE id = p_game_id;

  PERFORM realtime.publish(
    'game:' || p_game_id::text,
    'status_changed',
    jsonb_build_object('game_id', p_game_id, 'status', v_game.status)
  );

  RETURN jsonb_build_object('ok', TRUE, 'revealed_seqs', p_seqs);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reveal_calls(UUID, UUID, INTEGER[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_game_bank(
  p_game_id UUID,
  p_host_token UUID,
  p_custom_bank JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_game public.games%ROWTYPE;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Game not found');
  END IF;
  IF v_game.host_token IS DISTINCT FROM p_host_token THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only the host can update the question bank');
  END IF;

  UPDATE public.games
     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{custom_bank}', p_custom_bank)
   WHERE id = p_game_id;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_game_bank(UUID, UUID, JSONB) TO anon, authenticated;
