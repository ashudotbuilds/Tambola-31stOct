-- =============================================================================
-- Executable spec: asserts the Technical Tambola rules actually hold
-- =============================================================================
-- This migration is a test, not a schema change. It runs several hundred
-- generated tickets and a set of hand-built claim fixtures through the
-- production functions and RAISEs if anything is off, so the migration fails
-- loudly instead of shipping a broken game.
-- =============================================================================

DO $$
DECLARE
  -- Hand-built ticket. 3 rows x 9 cols, 15 numbers, 5 per row, 4 blanks per
  -- row, every number inside its column band, ascending within each column.
  v_ticket JSONB := '[[1,   null, 22, null, 44, 55, null, null, 83],
                       [4,   12,   25, null, null, null, 66,  71,  null],
                       [7,   15,   null, 33, 41, null, null, null, 88]]'::jsonb;

  v_all  INTEGER[] := ARRAY[1,4,7,12,15,22,25,33,41,44,55,66,71,83,88];
  v_r0   INTEGER[] := ARRAY[1,22,44,55,83];
  v_r1   INTEGER[] := ARRAY[4,12,25,66,71];
  v_r2   INTEGER[] := ARRAY[7,15,33,41,88];
  v_fail TEXT;
  v_failures TEXT[] := '{}';
BEGIN
  ------------------------------------------------------------------ ticket totals
  WITH t AS (SELECT public.generate_tambola_ticket() AS c FROM generate_series(1, 500)),
  flat AS (
    SELECT t.c,
           x.ord - 1                                     AS ci,
           (x.val #>> '{}')::integer                     AS n
      FROM t,
           LATERAL jsonb_array_elements(t.c) AS r(val),
           LATERAL jsonb_array_elements(r.val) WITH ORDINALITY AS x(val, ord)
  ),
  per_ticket AS (
    SELECT c,
           count(n)                                                          AS nums,
           count(*) - count(n)                                               AS blanks,
           count(*) FILTER (WHERE n IS NOT NULL AND LEAST(9, n / 10 + 1) <> ci + 1) AS band_bad,
           count(*) FILTER (WHERE n IS NOT NULL AND (n < 1 OR n > 90))      AS range_bad,
           count(n) - count(DISTINCT n)                                      AS dup_bad,
           bool_or(jsonb_array_length(c) <> 3)                              AS shape_bad
      FROM flat
     GROUP BY c
  )
  SELECT string_agg(
           'nums=' || nums || ' blanks=' || blanks || ' band=' || band_bad ||
           ' range=' || range_bad || ' dup=' || dup_bad || ' shape=' || shape_bad, ', ')
    INTO v_fail
    FROM per_ticket
   WHERE nums <> 15 OR blanks <> 12 OR band_bad > 0 OR range_bad > 0
      OR dup_bad <> 0 OR shape_bad;

  IF v_fail IS NOT NULL THEN
    v_failures := array_append(v_failures, 'generator totals: ' || left(v_fail, 400));
  END IF;

  ------------------------------------------------------------------ five per row
  WITH t AS (SELECT public.generate_tambola_ticket() AS c FROM generate_series(1, 400)),
  flat AS (
    SELECT t.c, r.ord AS ri, (x.val #>> '{}')::integer AS n
      FROM t,
           LATERAL jsonb_array_elements(t.c) WITH ORDINALITY AS r(val, ord),
           LATERAL jsonb_array_elements(r.val) WITH ORDINALITY AS x(val, ord)
  )
  SELECT count(*)::text INTO v_fail
    FROM (SELECT c, ri FROM flat GROUP BY c, ri HAVING count(n) <> 5) s;

  IF v_fail <> '0' THEN
    v_failures := array_append(v_failures, 'generator rows: ' || v_fail || ' rows without 5 numbers');
  END IF;

  ------------------------------------------------------------------ one to three per column
  WITH t AS (SELECT public.generate_tambola_ticket() AS c FROM generate_series(1, 400)),
  flat AS (
    SELECT t.c, x.ord AS ci, (x.val #>> '{}')::integer AS n
      FROM t,
           LATERAL jsonb_array_elements(t.c) AS r(val),
           LATERAL jsonb_array_elements(r.val) WITH ORDINALITY AS x(val, ord)
     WHERE (x.val #>> '{}') IS NOT NULL
  )
  SELECT count(*)::text INTO v_fail
    FROM (SELECT c, ci FROM flat
           GROUP BY c, ci
          HAVING count(*) <> count(DISTINCT n) OR count(*) > 3 OR count(*) < 1) s;

  IF v_fail <> '0' THEN
    v_failures := array_append(v_failures, 'generator columns: ' || v_fail || ' bad columns');
  END IF;

  ------------------------------------------------------------------ all 90 numbers reachable
  WITH t AS (SELECT public.generate_tambola_ticket() AS c FROM generate_series(1, 400)),
  nums AS (
    SELECT DISTINCT (x.val #>> '{}')::integer AS n
      FROM t,
           LATERAL jsonb_array_elements(t.c) AS r(val),
           LATERAL jsonb_array_elements(r.val) AS x(val)
     WHERE (x.val #>> '{}') IS NOT NULL
  )
  SELECT count(*)::text INTO v_fail
    FROM generate_series(1, 90) g(n)
   WHERE NOT EXISTS (SELECT 1 FROM nums WHERE nums.n = g.n);

  IF v_fail <> '0' THEN
    v_failures := array_append(v_failures, v_fail || ' numbers never appeared on any ticket');
  END IF;

  ------------------------------------------------------------------ corners are numbered
  -- Four Corners is a paid claim, so all four corner cells must be numbered on
  -- every ticket. Columns 1 and 9 carry 3 numbers each to guarantee it.
  WITH t AS (SELECT public.generate_tambola_ticket() AS c FROM generate_series(1, 500))
  SELECT count(*)::text INTO v_fail
    FROM t
   WHERE c -> 0 ->> 0 IS NULL
      OR c -> 0 ->> 8 IS NULL
      OR c -> 2 ->> 0 IS NULL
      OR c -> 2 ->> 8 IS NULL;

  IF v_fail <> '0' THEN
    v_failures := array_append(v_failures, v_fail || ' tickets have a blank corner, so four_corners is unclaimable');
  END IF;

  ------------------------------------------------------------------ has_number
  IF NOT public.tambola_has_number(v_ticket, 44) THEN
    v_failures := array_append(v_failures, 'has_number missed 44');
  END IF;
  IF public.tambola_has_number(v_ticket, 45) THEN
    v_failures := array_append(v_failures, 'has_number found 45, which is not on the ticket');
  END IF;

  ------------------------------------------------------------------ early five
  IF NOT public.tambola_claim_ok('early_five', v_ticket, ARRAY[1,4,7,12,15], '{}') THEN
    v_failures := array_append(v_failures, 'early_five rejected 5 marked numbers');
  END IF;
  IF public.tambola_claim_ok('early_five', v_ticket, ARRAY[1,4,7,12], '{}') THEN
    v_failures := array_append(v_failures, 'early_five accepted only 4 marked numbers');
  END IF;
  IF public.tambola_claim_ok('early_five', v_ticket, ARRAY[1,4,7,12,15], ARRAY[15]) THEN
    v_failures := array_append(v_failures, 'early_five ignored a cut number');
  END IF;

  ------------------------------------------------------------------ four corners
  -- corners of the fixture: 1, 83 (top) and 7, 88 (bottom)
  IF public.tambola_claim_ok('four_corners', v_ticket, ARRAY[1,83,7], '{}') THEN
    v_failures := array_append(v_failures, 'four_corners accepted 3 of 4 corners');
  END IF;
  IF NOT public.tambola_claim_ok('four_corners', v_ticket, ARRAY[1,83,7,88], '{}') THEN
    v_failures := array_append(v_failures, 'four_corners rejected all 4 corners');
  END IF;

  ------------------------------------------------------------------ lines
  IF NOT public.tambola_claim_ok('top_line', v_ticket, v_r0, '{}') THEN
    v_failures := array_append(v_failures, 'top_line rejected a complete top row');
  END IF;
  IF public.tambola_claim_ok('top_line', v_ticket, v_r0[1:4], '{}') THEN
    v_failures := array_append(v_failures, 'top_line accepted an incomplete top row');
  END IF;
  IF public.tambola_claim_ok('top_line', v_ticket, v_r0, ARRAY[44]) THEN
    v_failures := array_append(v_failures, 'top_line ignored a cut number');
  END IF;
  IF NOT public.tambola_claim_ok('middle_line', v_ticket, v_r1, '{}') THEN
    v_failures := array_append(v_failures, 'middle_line rejected a complete middle row');
  END IF;
  IF NOT public.tambola_claim_ok('bottom_line', v_ticket, v_r2, '{}') THEN
    v_failures := array_append(v_failures, 'bottom_line rejected a complete bottom row');
  END IF;
  -- Completing one line must not satisfy another.
  IF public.tambola_claim_ok('middle_line', v_ticket, v_r0, '{}') THEN
    v_failures := array_append(v_failures, 'middle_line accepted the top row numbers');
  END IF;
  -- Blanks must not be treated as missing numbers.
  IF NOT public.tambola_claim_ok('top_line', v_ticket, v_r0, '{}') THEN
    v_failures := array_append(v_failures, 'top_line treated blank cells as failures');
  END IF;

  ------------------------------------------------------------------ full house
  IF NOT public.tambola_claim_ok('full_house', v_ticket, v_all, '{}') THEN
    v_failures := array_append(v_failures, 'full_house rejected a complete ticket');
  END IF;
  IF public.tambola_claim_ok('full_house', v_ticket, v_all[1:14], '{}') THEN
    v_failures := array_append(v_failures, 'full_house accepted 14 of 15 numbers');
  END IF;
  IF public.tambola_claim_ok('full_house', v_ticket, v_all, ARRAY[88]) THEN
    v_failures := array_append(v_failures, 'full_house ignored a cut number');
  END IF;
  IF NOT public.tambola_claim_ok('second_full_house', v_ticket, v_all, '{}') THEN
    v_failures := array_append(v_failures, 'second_full_house rejected a complete ticket');
  END IF;

  ------------------------------------------------------------------ bad input
  IF public.tambola_claim_ok('full_house', NULL, v_all, '{}') THEN
    v_failures := array_append(v_failures, 'claim check accepted a NULL ticket');
  END IF;
  IF public.tambola_claim_ok('nonsense', v_ticket, v_all, '{}') THEN
    v_failures := array_append(v_failures, 'claim check accepted an unknown claim type');
  END IF;

  ------------------------------------------------------------------ points
  IF public.tambola_points('{}'::jsonb, 'full_house') <> 50 THEN
    v_failures := array_append(v_failures, 'default full_house points are not 50');
  END IF;
  IF public.tambola_points('{"points":{"full_house":99}}'::jsonb, 'full_house') <> 99 THEN
    v_failures := array_append(v_failures, 'settings did not override full_house points');
  END IF;

  ------------------------------------------------------------------ clue bank
  IF (SELECT count(*) FROM public.tambola_clue_bank) < 180 THEN
    v_failures := array_append(v_failures, 'clue bank has fewer than 180 rows');
  END IF;
  IF (SELECT count(*) FROM generate_series(1, 90) n
       WHERE (SELECT count(*) FROM public.tambola_clue_bank b WHERE b.number = n) < 2) <> 0 THEN
    v_failures := array_append(v_failures, 'some numbers have fewer than 2 clue variants');
  END IF;
  IF (SELECT count(*) FROM public.tambola_clue_bank WHERE char_length(text) < 3) <> 0 THEN
    v_failures := array_append(v_failures, 'clue bank contains empty clues');
  END IF;

  ------------------------------------------------------------------ table access
  -- No player-facing role may read or write game state directly; everything goes
  -- through the token-checked SECURITY DEFINER functions.
  IF has_table_privilege('anon', 'public.games', 'SELECT')
     OR has_table_privilege('anon', 'public.tickets', 'SELECT')
     OR has_table_privilege('anon', 'public.game_players', 'SELECT')
     OR has_table_privilege('anon', 'public.game_calls', 'SELECT')
     OR has_table_privilege('anon', 'public.claims', 'SELECT')
     OR has_table_privilege('anon', 'public.game_clues', 'SELECT') THEN
    v_failures := array_append(v_failures, 'anon can read a game table directly');
  END IF;
  IF has_table_privilege('anon', 'public.games', 'INSERT')
     OR has_table_privilege('anon', 'public.games', 'UPDATE')
     OR has_table_privilege('anon', 'public.games', 'DELETE') THEN
    v_failures := array_append(v_failures, 'anon can write the games table directly');
  END IF;
  IF has_table_privilege('anon', 'public.tickets', 'UPDATE') THEN
    v_failures := array_append(v_failures, 'anon can mark or cut their own ticket directly');
  END IF;
  IF NOT has_function_privilege('anon', 'public.create_game(text)', 'EXECUTE') THEN
    v_failures := array_append(v_failures, 'anon cannot call create_game');
  END IF;

  ------------------------------------------------------------------ realtime
  IF NOT EXISTS (SELECT 1 FROM realtime.channels WHERE pattern = 'game:%' AND enabled) THEN
    v_failures := array_append(v_failures, 'realtime channel pattern game:% is missing or disabled');
  END IF;

  -- InsForge manages realtime table privileges and resets them, so the effective
  -- control is RLS: reads scoped to game:%, and no write policy at all, which is
  -- what stops a client forging number_called or claim_result. scripts/smoke.mjs
  -- proves delivery and publish refusal over a real socket.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'realtime' AND c.relname = 'channels') THEN
    v_failures := array_append(v_failures, 'RLS is off on realtime.channels');
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'realtime' AND c.relname = 'messages') THEN
    v_failures := array_append(v_failures,
      'RLS is off on realtime.messages, so a client holding INSERT could forge game events');
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'realtime' AND tablename = 'messages'
         AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')) <> 0 THEN
    v_failures := array_append(v_failures, 'realtime.messages has a write policy, clients could publish');
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'realtime' AND tablename = 'messages'
         AND cmd = 'SELECT') = 0 THEN
    v_failures := array_append(v_failures, 'realtime.messages has no read policy for players');
  END IF;

  ------------------------------------------------------------------ verdict
  IF array_length(v_failures, 1) > 0 THEN
    RAISE EXCEPTION 'Tambola rule check FAILED (% problems): %',
      array_length(v_failures, 1), array_to_string(v_failures, ' | ');
  END IF;

  RAISE NOTICE 'Tambola rule check passed: tickets, claims, points, clues, table access, realtime delivery and publishing.';
END;
$$;
