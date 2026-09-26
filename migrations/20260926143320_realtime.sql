-- =============================================================================
-- Technical Tambola — realtime channels and event triggers
-- =============================================================================
-- One channel per game: game:<uuid>. Every player, the host and the projector
-- screen share it.
--
-- Clients CANNOT publish: there is no INSERT policy on realtime.messages.
-- Every event below is published by a database trigger, so a player can never
-- broadcast a number, a claim or a score.
-- =============================================================================

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('game:%', 'Technical Tambola live game room', TRUE)
ON CONFLICT (pattern) DO UPDATE
   SET description = EXCLUDED.description,
       enabled = TRUE;

-- Anonymous players must be able to subscribe. Game events carry no secrets:
-- the only private payload (a player's own ticket) is only ever served through
-- get_game_state(game_id, player_token), which is token-gated in SQL.
ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tambola_anon_subscribes_games ON realtime.channels;
CREATE POLICY tambola_anon_subscribes_games
  ON realtime.channels
  FOR SELECT
  TO anon, authenticated
  USING (pattern = 'game:%');


-- ---------------------------------------------------------------- a number was called
CREATE OR REPLACE FUNCTION public.tambola_emit_number_called()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM realtime.publish(
    'game:' || NEW.game_id::text,
    'number_called',
    jsonb_build_object(
      'game_id', NEW.game_id,
      'seq', NEW.seq,
      'number', NEW.number,
      'clue', NEW.clue,
      'called_at', NEW.called_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tambola_number_called_trigger ON public.game_calls;
CREATE TRIGGER tambola_number_called_trigger
  AFTER INSERT ON public.game_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.tambola_emit_number_called();


-- ---------------------------------------------------------------- a claim was judged
CREATE OR REPLACE FUNCTION public.tambola_emit_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM realtime.publish(
    'game:' || NEW.game_id::text,
    'claim_result',
    jsonb_build_object(
      'game_id', NEW.game_id,
      'id', NEW.id,
      'player_id', NEW.player_id,
      'name', (SELECT display_name FROM public.game_players WHERE id = NEW.player_id),
      'claim_type', NEW.claim_type,
      'status', NEW.status,
      'points', NEW.points,
      'reason', NEW.reason,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tambola_claim_trigger ON public.claims;
CREATE TRIGGER tambola_claim_trigger
  AFTER INSERT ON public.claims
  FOR EACH ROW
  EXECUTE FUNCTION public.tambola_emit_claim();


-- ---------------------------------------------------------------- scoreboard changed
CREATE OR REPLACE FUNCTION public.tambola_emit_scoreboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.score IS DISTINCT FROM OLD.score THEN
    PERFORM realtime.publish(
      'game:' || NEW.game_id::text,
      'scoreboard',
      jsonb_build_object(
        'game_id', NEW.game_id,
        'players', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'name', p.display_name,
                   'score', p.score,
                   'is_host', p.is_host
                 ) ORDER BY p.score DESC, p.created_at), '[]'::jsonb)
            FROM public.game_players p
           WHERE p.game_id = NEW.game_id
        )
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tambola_scoreboard_trigger ON public.game_players;
CREATE TRIGGER tambola_scoreboard_trigger
  AFTER UPDATE ON public.game_players
  FOR EACH ROW
  EXECUTE FUNCTION public.tambola_emit_scoreboard();


-- ---------------------------------------------------------------- someone joined the lobby
CREATE OR REPLACE FUNCTION public.tambola_emit_player_joined()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM realtime.publish(
    'game:' || NEW.game_id::text,
    'player_joined',
    jsonb_build_object(
      'game_id', NEW.game_id,
      'player_id', NEW.id,
      'name', NEW.display_name,
      'is_host', NEW.is_host,
      'player_count', (SELECT count(*) FROM public.game_players WHERE game_id = NEW.game_id)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tambola_player_joined_trigger ON public.game_players;
CREATE TRIGGER tambola_player_joined_trigger
  AFTER INSERT ON public.game_players
  FOR EACH ROW
  EXECUTE FUNCTION public.tambola_emit_player_joined();


-- ---------------------------------------------------------------- a number got cut
CREATE OR REPLACE FUNCTION public.tambola_emit_ticket_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.cut IS DISTINCT FROM OLD.cut THEN
    -- Announce only that *someone* was cut; the affected player refetches their
    -- own ticket through get_game_state with their token.
    PERFORM realtime.publish(
      'game:' || NEW.game_id::text,
      'ticket_updated',
      jsonb_build_object('game_id', NEW.game_id, 'player_id', NEW.player_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tambola_ticket_updated_trigger ON public.tickets;
CREATE TRIGGER tambola_ticket_updated_trigger
  AFTER UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tambola_emit_ticket_updated();


-- ---------------------------------------------------------------- game status changed
CREATE OR REPLACE FUNCTION public.tambola_emit_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM realtime.publish(
      'game:' || NEW.game_id::text,
      'status_changed',
      jsonb_build_object('game_id', NEW.game_id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tambola_status_trigger ON public.games;
CREATE TRIGGER tambola_status_trigger
  AFTER UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.tambola_emit_status();
