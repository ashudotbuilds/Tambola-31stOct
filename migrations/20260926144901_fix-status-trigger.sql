-- =============================================================================
-- Fix: the game status trigger referenced NEW.game_id, but games.id is the column
-- =============================================================================
-- The trigger fires on public.games, whose primary key is id. Every status change
-- (lobby -> playing -> closing -> finished) failed with
-- 'record "new" has no field "game_id"', which aborted start_game entirely.

CREATE OR REPLACE FUNCTION public.tambola_emit_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM realtime.publish(
      'game:' || NEW.id::text,
      'status_changed',
      jsonb_build_object('game_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;
