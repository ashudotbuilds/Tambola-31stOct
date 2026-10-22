-- =============================================================================
-- Executable spec: end-to-end game flow through the public RPCs
-- =============================================================================
-- Drives real games through create_game -> join_game -> start_game ->
-- draw_number -> submit_claim exactly the way the browser does, and asserts the
-- security, fairness and scoring rules hold. Test games are deleted at the end.
-- =============================================================================

DO $$
DECLARE
  v_a       JSONB;      -- create_game result
  v_b       JSONB;
  v_res     JSONB;
  v_game    UUID;
  v_host    UUID;       -- host token
  v_tok     UUID;       -- a player's token
  v_tok2    UUID;
  v_pid     UUID;       -- a player's id
  v_fake    UUID := gen_random_uuid();
  v_code    TEXT;
  v_num     INTEGER;
  v_i       INTEGER;
  v_seen    INTEGER[] := '{}';
  v_dupes   INTEGER := 0;
  v_count   INTEGER;
  v_expected INTEGER;
  v_marks   INTEGER[] := '{}';
  v_cells   JSONB;
  v_status  TEXT;
  v_fails   TEXT[] := '{}';
BEGIN
  ---------------------------------------------------------------- create
  v_a := public.create_game('Host');
  IF NOT (v_a ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'create_game failed: %', v_a ->> 'error';
  END IF;

  v_game := (v_a ->> 'game_id')::uuid;
  v_host := (v_a ->> 'host_token')::uuid;
  v_tok  := (v_a ->> 'player_token')::uuid;
  v_code := v_a ->> 'code';

  IF v_code IS NULL OR char_length(v_code) <> 6 THEN
    v_fails := array_append(v_fails, 'game code is not 6 characters: ' || coalesce(v_code, 'NULL'));
  END IF;
  -- The host moderates and does not play, so the host gets no ticket.
  IF (SELECT count(*) FROM public.tickets WHERE player_id = (v_a ->> 'player_id')::uuid) <> 0 THEN
    v_fails := array_append(v_fails, 'the host was given a ticket');
  END IF;

  ---------------------------------------------------------------- join
  IF (public.join_game('ZZZZZZ', 'Nobody') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'join_game accepted a bogus code');
  END IF;

  v_res := public.join_game(v_code, 'Alice');
  IF NOT (v_res ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'join_game failed: %', v_res ->> 'error';
  END IF;
  v_tok := (v_res ->> 'player_token')::uuid;

  v_res := public.join_game(v_code, 'Bob');
  v_tok2 := (v_res ->> 'player_token')::uuid;

  IF (public.join_game(v_code, 'alice') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'join_game allowed a duplicate name in a different case');
  END IF;
  IF (public.join_game(v_code, '') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'join_game allowed an empty name');
  END IF;

  ---------------------------------------------------------------- host authority
  IF (public.start_game(v_game, v_fake) ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'a non-host started the game');
  END IF;
  IF (public.draw_number(v_game, v_fake) ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'a non-host called a number');
  END IF;
  IF (public.draw_number(v_game, v_host) ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'draw_number worked before the game started');
  END IF;
  IF (public.submit_claim(v_game, v_tok, 'top_line') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'a claim was accepted before the game started');
  END IF;
  IF public.submit_claim(v_game, v_fake, 'top_line') ->> 'ok' THEN
    v_fails := array_append(v_fails, 'submit_claim accepted a forged player token');
  END IF;
  IF public.submit_claim(v_game, v_tok, 'not_a_claim') ->> 'ok' THEN
    v_fails := array_append(v_fails, 'submit_claim accepted an unknown claim type');
  END IF;

  v_res := public.start_game(v_game, v_host);
  IF v_res ->> 'status' <> 'playing' THEN
    v_fails := array_append(v_fails, 'start_game did not move the game to playing');
  END IF;

  -- The host moderates, the host does not play.
  IF public.submit_claim(v_game, (v_a ->> 'player_token')::uuid, 'early_five') ->> 'ok' THEN
    v_fails := array_append(v_fails, 'the host was allowed to claim');
  END IF;
  IF (public.join_game(v_code, 'Late') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'join_game accepted a player after the game started');
  END IF;

  ---------------------------------------------------------------- draw all 90
  FOR v_i IN 1..90 LOOP
    v_res := public.draw_number(v_game, v_host);
    IF NOT (v_res ->> 'ok')::boolean THEN
      v_fails := array_append(v_fails, 'draw_number failed on call ' || v_i || ': ' || (v_res ->> 'error'));
      EXIT;
    END IF;

    IF (v_res ->> 'seq')::integer <> v_i THEN
      v_fails := array_append(v_fails, 'call ' || v_i || ' reported seq ' || (v_res ->> 'seq'));
    END IF;
    IF coalesce(char_length(v_res ->> 'clue'), 0) < 3 THEN
      v_fails := array_append(v_fails, 'call ' || v_i || ' had an empty clue');
    END IF;

    v_num := (v_res ->> 'number')::integer;
    IF v_num = ANY (v_seen) THEN
      v_dupes := v_dupes + 1;
    END IF;
    v_seen := array_append(v_seen, v_num);
  END LOOP;

  IF v_dupes > 0 THEN
    v_fails := array_append(v_fails, v_dupes || ' duplicate numbers were called');
  END IF;
  IF array_length(v_seen, 1) <> 90 THEN
    v_fails := array_append(v_fails, 'called ' || coalesce(array_length(v_seen, 1), 0) || ' of 90 numbers');
  END IF;
  IF (public.draw_number(v_game, v_host) ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'draw_number produced a 91st number');
  END IF;

  -- Auto-daub: after 90 calls every ticket must be fully marked.
  SELECT count(*) INTO v_expected
    FROM public.game_players
   WHERE game_id = v_game AND NOT is_host;
  IF v_expected <> 2 THEN
    v_fails := array_append(v_fails, 'expected 2 players, found ' || v_expected);
  END IF;

  SELECT count(*) INTO v_count
    FROM public.tickets t
    JOIN public.game_players p ON p.id = t.player_id
   WHERE p.game_id = v_game
     AND array_length(t.marked, 1) = 15;
  IF v_count <> v_expected THEN
    v_fails := array_append(v_fails, 'auto-daub fully marked ' || v_count || ' of ' || v_expected || ' tickets');
  END IF;

  ---------------------------------------------------------------- claims
  IF public.submit_claim(v_game, v_tok, 'second_full_house') ->> 'ok' THEN
    v_fails := array_append(v_fails, 'second full house was allowed before the first');
  END IF;

  v_res := public.submit_claim(v_game, v_tok, 'full_house');
  IF NOT (v_res ->> 'accepted')::boolean THEN
    v_fails := array_append(v_fails, 'full house was rejected on a complete ticket: ' || coalesce(v_res ->> 'reason', ''));
  ELSIF (v_res ->> 'points')::integer <> 50 THEN
    v_fails := array_append(v_fails, 'full house awarded ' || (v_res ->> 'points') || ' points');
  END IF;

  SELECT status INTO v_status FROM public.games WHERE id = v_game;
  IF v_status <> 'closing' THEN
    v_fails := array_append(v_fails, 'status after the first full house is ' || v_status);
  END IF;

  -- The claim is exclusive: the second player loses the race without a penalty.
  v_res := public.submit_claim(v_game, v_tok2, 'full_house');
  IF (v_res ->> 'accepted')::boolean THEN
    v_fails := array_append(v_fails, 'a second player also won full house');
  ELSIF v_res ->> 'reason' <> 'Already claimed by another player' THEN
    v_fails := array_append(v_fails, 'the losing racer got reason: ' || coalesce(v_res ->> 'reason', 'NULL'));
  END IF;
  IF (v_res ->> 'score')::integer <> 0 THEN
    v_fails := array_append(v_fails, 'the losing racer was charged ' || (v_res ->> 'score') || ' points');
  END IF;

  IF public.submit_claim(v_game, v_tok, 'full_house') ->> 'ok' THEN
    v_fails := array_append(v_fails, 'Alice claimed full house twice');
  END IF;

  v_res := public.submit_claim(v_game, v_tok2, 'second_full_house');
  IF NOT (v_res ->> 'accepted')::boolean THEN
    v_fails := array_append(v_fails, 'second full house was rejected: ' || coalesce(v_res ->> 'reason', ''));
  END IF;

  SELECT status INTO v_status FROM public.games WHERE id = v_game;
  IF v_status <> 'finished' THEN
    v_fails := array_append(v_fails, 'status after the second full house is ' || v_status);
  END IF;
  IF (public.draw_number(v_game, v_host) ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'a number was called after the game finished');
  END IF;

  ---------------------------------------------------------------- read models
  -- me is JSON null when there is no matching token; it must never be an object.
  v_res := public.get_game_state(v_game, NULL);
  IF jsonb_typeof(v_res -> 'me') IS DISTINCT FROM 'null' THEN
    v_fails := array_append(v_fails, 'a tokenless read returned a me object');
  END IF;
  IF jsonb_array_length(v_res -> 'calls') <> 90 THEN
    v_fails := array_append(v_fails, 'a tokenless read returned the wrong call count');
  END IF;

  -- No token may ever appear in a public read.
  IF position(v_tok::text in v_res::text) > 0 THEN
    v_fails := array_append(v_fails, 'a player token leaked into get_game_state');
  END IF;
  IF position(v_host::text in v_res::text) > 0 THEN
    v_fails := array_append(v_fails, 'the host token leaked into get_game_state');
  END IF;

  v_res := public.get_game_state(v_game, v_tok);
  IF v_res -> 'me' -> 'ticket' IS NULL THEN
    v_fails := array_append(v_fails, 'the owner did not get their ticket back');
  END IF;
  IF jsonb_array_length(v_res -> 'me' -> 'ticket') <> 3 THEN
    v_fails := array_append(v_fails, 'the returned ticket has the wrong shape');
  END IF;
  IF jsonb_typeof(public.get_game_state(v_game, v_fake) -> 'me') IS DISTINCT FROM 'null' THEN
    v_fails := array_append(v_fails, 'a forged token returned a me object');
  END IF;

  v_res := public.get_game_state_by_code(v_code);
  IF v_res ->> 'code' <> v_code THEN
    v_fails := array_append(v_fails, 'get_game_state_by_code did not find the game');
  END IF;
  IF (public.get_game_state_by_code('ZZZZZZ') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'get_game_state_by_code accepted a bogus code');
  END IF;

  ---------------------------------------------------------------- wrong claims
  v_b   := public.create_game('Host Two');
  v_tok := (v_b ->> 'host_token')::uuid;
  v_res := public.join_game(v_b ->> 'code', 'Cara');
  v_tok := (v_res ->> 'player_token')::uuid;
  PERFORM public.start_game((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);

  -- Take a couple of real calls, then mark three of Cara's own numbers by hand so
  -- the cut behaviour is deterministic instead of depending on luck.
  PERFORM public.draw_number((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);
  PERFORM public.draw_number((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);

  SELECT id INTO v_pid
    FROM public.game_players
   WHERE game_id = (v_b ->> 'game_id')::uuid AND display_name = 'Cara';

  SELECT cells INTO v_cells FROM public.tickets WHERE player_id = v_pid;
  v_marks := '{}';
  FOR v_num IN 1..90 LOOP
    IF array_length(v_marks, 1) >= 3 THEN
      EXIT;
    END IF;
    IF public.tambola_has_number(v_cells, v_num) THEN
      v_marks := array_append(v_marks, v_num);
    END IF;
  END LOOP;
  UPDATE public.tickets SET marked = v_marks WHERE player_id = v_pid;

  -- Three marked numbers cannot complete any line, so this must be rejected.
  v_res := public.submit_claim((v_b ->> 'game_id')::uuid, v_tok, 'top_line');
  IF (v_res ->> 'accepted')::boolean THEN
    v_fails := array_append(v_fails, 'a top line was accepted with only 3 marks');
  ELSIF (v_res ->> 'penalty')::integer <> 10 THEN
    v_fails := array_append(v_fails, 'a wrong claim cost ' || coalesce(v_res ->> 'penalty', 'NULL') || ' points');
  END IF;
  IF (v_res ->> 'score')::integer <> 0 THEN
    v_fails := array_append(v_fails, 'score went negative: ' || (v_res ->> 'score'));
  END IF;

  -- The penalty must have cut exactly one of the marked numbers.
  SELECT array_length(cut, 1) INTO v_count
    FROM public.tickets WHERE player_id = v_pid;
  IF coalesce(v_count, 0) <> 1 THEN
    v_fails := array_append(v_fails, 'a wrong claim cut ' || coalesce(v_count, 0) || ' numbers, expected 1');
  END IF;

  -- And the cut must be visible to its owner.
  v_res := public.get_game_state((v_b ->> 'game_id')::uuid, v_tok);
  IF jsonb_array_length(v_res -> 'me' -> 'cut') <> 1 THEN
    v_fails := array_append(v_fails, 'the cut is not visible to its owner');
  END IF;

  -- Five clean marks make early five legitimately claimable.
  v_marks := '{}';
  FOR v_num IN 1..90 LOOP
    IF array_length(v_marks, 1) >= 5 THEN
      EXIT;
    END IF;
    IF public.tambola_has_number(v_cells, v_num) THEN
      v_marks := array_append(v_marks, v_num);
    END IF;
  END LOOP;
  UPDATE public.tickets SET marked = v_marks, cut = '{}' WHERE player_id = v_pid;

  v_res := public.submit_claim((v_b ->> 'game_id')::uuid, v_tok, 'early_five');
  IF NOT (v_res ->> 'accepted')::boolean THEN
    v_fails := array_append(v_fails, 'early five was rejected with 5 marks: ' || coalesce(v_res ->> 'reason', ''));
  ELSIF (v_res ->> 'points')::integer <> 10 THEN
    v_fails := array_append(v_fails, 'early five awarded ' || coalesce(v_res ->> 'points', 'NULL') || ' points');
  END IF;

  ---------------------------------------------------------------- closing timer
  v_b := public.create_game('Host Three');
  v_res := public.join_game(v_b ->> 'code', 'Dev');
  v_tok := (v_res ->> 'player_token')::uuid;
  PERFORM public.start_game((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);

  -- Make the first house close the game immediately.
  UPDATE public.games
     SET settings = jsonb_set(settings, '{close_after_calls}', '0'::jsonb)
   WHERE id = (v_b ->> 'game_id')::uuid;

  SELECT id INTO v_pid
    FROM public.game_players
   WHERE game_id = (v_b ->> 'game_id')::uuid AND display_name = 'Dev';

  -- Mark Dev's ticket complete by hand so a full house is reachable.
  SELECT cells INTO v_cells FROM public.tickets WHERE player_id = v_pid;
  v_marks := '{}';
  FOR v_num IN 1..90 LOOP
    IF public.tambola_has_number(v_cells, v_num) THEN
      v_marks := array_append(v_marks, v_num);
    END IF;
  END LOOP;
  UPDATE public.tickets SET marked = v_marks WHERE player_id = v_pid;

  -- One real call, so the game has a call sequence.
  v_res := public.draw_number((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);

  v_res := public.submit_claim((v_b ->> 'game_id')::uuid, v_tok, 'full_house');
  IF NOT (v_res ->> 'accepted')::boolean THEN
    v_fails := array_append(v_fails, 'the setup full house was rejected: ' || coalesce(v_res ->> 'reason', ''));
  END IF;

  v_res := public.draw_number((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);
  IF v_res ->> 'status' <> 'finished' THEN
    v_fails := array_append(v_fails, 'the game did not auto-finish, status is ' || coalesce(v_res ->> 'status', '?'));
  END IF;

  ---------------------------------------------------------------- pause and resume
  v_b := public.create_game('Host Four');
  PERFORM public.join_game(v_b ->> 'code', 'Eve');
  PERFORM public.start_game((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid);

  IF (public.set_game_status((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid, 'paused') ->> 'status') <> 'paused' THEN
    v_fails := array_append(v_fails, 'the host could not pause the game');
  END IF;
  IF (public.draw_number((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid) ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'a number was called while paused');
  END IF;
  IF (public.set_game_status((v_b ->> 'game_id')::uuid, v_fake, 'paused') ->> 'ok')::boolean THEN
    v_fails := array_append(v_fails, 'a non-host paused the game');
  END IF;
  IF (public.set_game_status((v_b ->> 'game_id')::uuid, (v_b ->> 'host_token')::uuid, 'playing') ->> 'status') <> 'playing' THEN
    v_fails := array_append(v_fails, 'the host could not resume the game');
  END IF;

  ---------------------------------------------------------------- cleanup
  DELETE FROM public.games WHERE created_at > now() - interval '2 hours';

  ---------------------------------------------------------------- verdict
  IF array_length(v_fails, 1) > 0 THEN
    RAISE EXCEPTION 'Game flow check FAILED (% problems): %',
      array_length(v_fails, 1), array_to_string(v_fails, ' | ');
  END IF;

  RAISE NOTICE 'Game flow check passed: lobby, host authority, 90 unique calls, auto-daub, claims, exclusivity, cuts, penalties, closing, pause, read models, token privacy.';
END;
$$;
