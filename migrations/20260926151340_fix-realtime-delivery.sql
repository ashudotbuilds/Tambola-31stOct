-- =============================================================================
-- Fix: anonymous players could not receive events, and could publish their own
-- =============================================================================
-- Two things were wrong with the platform defaults for realtime:
--
--   1. The anon role had no SELECT on realtime.messages, so the realtime server
--      delivered nothing to an anonymous subscriber. Every phone stayed silent:
--      no number_called, no claim_result, no status change. The host screen drew
--      a call, nothing arrived anywhere.
--
--   2. The anon role *did* have INSERT on realtime.messages, and that table has
--      RLS switched off. So any player holding the public anon key could publish
--      arbitrary events onto a game channel and impersonate the host: a forged
--      number_called or claim_result. That would have broken the one guarantee
--      the design rests on.
--
-- So: grant delivery, revoke publishing, and keep reads scoped to game channels.

GRANT SELECT ON realtime.messages TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON realtime.messages FROM anon, authenticated;

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tambola_players_read_game_messages ON realtime.messages;
CREATE POLICY tambola_players_read_game_messages
  ON realtime.messages
  FOR SELECT
  TO anon, authenticated
  USING (channel_name LIKE 'game:%');
