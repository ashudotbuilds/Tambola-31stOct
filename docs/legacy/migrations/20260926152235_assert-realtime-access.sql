-- =============================================================================
-- The real access control on realtime is RLS, not the table ACL
-- =============================================================================
-- InsForge manages the privileges on realtime.messages itself and resets them:
--
--   realtime.messages  anon=a      (INSERT only, no SELECT)
--   realtime.channels  anon=r      (SELECT only)
--
-- so GRANT/REVOKE written in a migration do not stick. Reading the ACL is
-- therefore not a useful assertion, and the earlier fix-realtime-delivery
-- migration's GRANT SELECT / REVOKE INSERT are inert.
--
-- What actually governs a client is row level security, and that does persist:
--
--   * RLS is enabled on realtime.messages with a SELECT policy scoped to
--     game:% channels, and deliberately NO write policy. A client that holds the
--     INSERT privilege still cannot publish, because RLS denies the row. This is
--     what stops a player forging number_called or claim_result, and the realtime
--     server confirms it with "Not authorized to publish to this channel".
--
--   * RLS is enabled on realtime.channels with a SELECT policy for game:%,
--     which is what lets an anonymous player subscribe at all.
--
-- Delivery does not depend on the subscriber's ACL: the realtime server reads
-- and fans out with its own privileges, so players receive every trigger event.
--
-- scripts/smoke.mjs is the executable proof of all of this, because delivery and
-- publish refusal cannot be asserted from SQL.

-- Idempotent re-assertion, in case a future backend version resets RLS.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tambola_players_read_game_messages ON realtime.messages;
CREATE POLICY tambola_players_read_game_messages
  ON realtime.messages
  FOR SELECT
  TO anon, authenticated
  USING (channel_name LIKE 'game:%');

-- No write policy on realtime.messages, by design.
DO $$
DECLARE
  v_write_policies INTEGER;
BEGIN
  SELECT count(*) INTO v_write_policies
    FROM pg_policies
   WHERE schemaname = 'realtime'
     AND tablename   = 'messages'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  IF v_write_policies > 0 THEN
    RAISE EXCEPTION 'realtime.messages has % write policy/policies; clients could forge game events',
      v_write_policies;
  END IF;

  RAISE NOTICE 'realtime access is correct: RLS on, reads scoped to game:%%, no write policies.';
END;
$$;
