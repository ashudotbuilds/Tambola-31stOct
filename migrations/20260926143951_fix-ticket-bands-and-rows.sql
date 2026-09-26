-- =============================================================================
-- Fix: ticket column bands, row/column degrees, and blank handling in claims
-- =============================================================================
-- Two bugs, both caught by the verify-game-rules spec:
--
-- 1. generate_tambola_ticket() picked numbers as ((col-1)*10) + random(0..8) + 1,
--    so column 2 held 11-19, column 3 held 21-29 and so on. 10, 20, 30 ... 80,
--    89 and 90 could never appear on any ticket. Bands are now 1-9, 10-19,
--    20-29 ... 70-79, 80-90, which covers all 90 numbers.
--
-- 2. generate_tambola_ticket() also chose which cells were blank independently of
--    how many numbers each column had, so a column could get fewer free cells
--    than numbers and the placement walked out of step: numbers ended up in the
--    wrong column. Rows are now dealt from a shuffled list that already carries
--    the right per-column counts, guaranteeing 5 numbers per row and 1-3 per
--    column.
--
-- 3. tambola_claim_ok() treated blank cells as unsatisfied, so a complete ticket
--    could never satisfy a line or a full house. Blanks are now ignored.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_tambola_ticket()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_counts   INTEGER[] := '{}';
  v_fallback CONSTANT INTEGER[] := ARRAY[2, 2, 2, 2, 2, 2, 1, 1, 1];
  v_slots    INTEGER[] := '{}';
  v_shuffled INTEGER[] := '{}';
  v_chosen   INTEGER[] := '{}';
  v_off      INTEGER[] := '{}';
  v_used     INTEGER := 0;
  v_cum      INTEGER := 0;
  v_col      INTEGER;
  v_row      INTEGER;
  v_i        INTEGER;
  v_k        INTEGER;
  v_n        INTEGER;
  v_lo       INTEGER;
  v_hi       INTEGER;
  v_pick     INTEGER;
  v_tmp      INTEGER;
  v_cursor   INTEGER;
  v_tries    INTEGER;
  v_cand     INTEGER[];
  v_grid     INTEGER[][] := ARRAY[
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0]
                ];
BEGIN
  -- 1. Numbers per column: 1..3 each, total exactly 15.
  FOR v_tries IN 1..500 LOOP
    v_counts := '{}';
    v_used := 0;
    FOR v_col IN 1..9 LOOP
      v_n := 1 + floor(random() * 3)::integer;
      v_counts := array_append(v_counts, v_n);
      v_used := v_used + v_n;
    END LOOP;
    EXIT WHEN v_used = 15;
  END LOOP;
  IF v_used <> 15 THEN
    v_counts := v_fallback;
  END IF;

  -- 2. Distinct ascending numbers inside each column band:
  --    1-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-90.
  --    v_off records where each column's numbers start inside v_chosen.
  v_off := array_fill(0, ARRAY[10]);
  FOR v_col IN 1..9 LOOP
    v_off[v_col] := v_cum + 1;
    v_cum := v_cum + v_counts[v_col];

    v_cand := '{}';
    FOR v_i IN 1..v_counts[v_col] LOOP
      v_lo := GREATEST(1, (v_col - 1) * 10);
      v_hi := v_lo + CASE WHEN v_col = 1 THEN 8
                          WHEN v_col = 9 THEN 10
                          ELSE 9 END;
      LOOP
        v_pick := v_lo + floor(random() * (v_hi - v_lo + 1))::integer;
        EXIT WHEN NOT (v_pick = ANY (v_cand));
      END LOOP;
      v_cand := array_append(v_cand, v_pick);
    END LOOP;
    v_chosen := v_chosen || v_cand;
  END LOOP;

  -- 3. Deal the 15 numbers into rows.
  --    Build a slot list that already carries the per-column counts, shuffle it,
  --    then hand 5 consecutive slots to each row. That gives every column
  --    exactly counts[col] cells and every row exactly 5 numbers.
  v_slots := '{}';
  FOR v_col IN 1..9 LOOP
    FOR v_i IN 1..v_counts[v_col] LOOP
      v_slots := array_append(v_slots, v_col);
    END LOOP;
  END LOOP;

  FOR v_i IN 1..array_length(v_slots, 1) LOOP
    v_pick := floor(random() * array_length(v_slots, 1) + 1)::integer;
    v_shuffled := array_append(v_shuffled, v_slots[v_pick]);
    -- Remove exactly one occurrence. array_remove() would drop every duplicate
    -- of the same column number, which would shrink the deck.
    v_tmp := v_slots[v_pick];
    v_slots := v_slots[1:v_pick - 1] || v_slots[v_pick + 1:array_length(v_slots, 1)];
  END LOOP;

  -- 4. Place each column's numbers, in order, into the cells it was dealt.
  FOR v_col IN 1..9 LOOP
    v_cursor := 0;
    FOR v_row IN 0..2 LOOP
      FOR v_k IN 1..5 LOOP
        IF v_shuffled[v_row * 5 + v_k] = v_col THEN
          v_grid[v_row + 1][v_col] := v_chosen[v_off[v_col] + v_cursor];
          v_cursor := v_cursor + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- 5. Empty cells become JSON null.
  FOR v_row IN 0..2 LOOP
    FOR v_col IN 1..9 LOOP
      IF v_grid[v_row + 1][v_col] = 0 THEN
        v_grid[v_row + 1][v_col] := NULL;
      END IF;
    END LOOP;
  END LOOP;

  RETURN to_jsonb(v_grid);
END;
$$;

-- ---------------------------------------------------------------- claim rules
CREATE OR REPLACE FUNCTION public.tambola_claim_ok(
  p_claim TEXT, p_cells JSONB, p_marked INTEGER[], p_cut INTEGER[]
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_r0  INTEGER[];
  v_r1  INTEGER[];
  v_r2  INTEGER[];
  v_all INTEGER[];
  v_m   INTEGER[] := COALESCE(p_marked, '{}'::integer[]);
  v_c   INTEGER[] := COALESCE(p_cut,    '{}'::integer[]);
  v_n   INTEGER;
BEGIN
  IF p_cells IS NULL OR jsonb_typeof(p_cells) <> 'array' THEN
    RETURN FALSE;
  END IF;

  SELECT array_agg((e #>> '{}')::integer ORDER BY ord) INTO v_r0
    FROM jsonb_array_elements(p_cells -> 0) WITH ORDINALITY AS t(e, ord);
  SELECT array_agg((e #>> '{}')::integer ORDER BY ord) INTO v_r1
    FROM jsonb_array_elements(p_cells -> 1) WITH ORDINALITY AS t(e, ord);
  SELECT array_agg((e #>> '{}')::integer ORDER BY ord) INTO v_r2
    FROM jsonb_array_elements(p_cells -> 2) WITH ORDINALITY AS t(e, ord);

  v_r0  := COALESCE(v_r0, '{}'::integer[]);
  v_r1  := COALESCE(v_r1, '{}'::integer[]);
  v_r2  := COALESCE(v_r2, '{}'::integer[]);
  v_all := v_r0 || v_r1 || v_r2;

  -- early_five: any 5 usable cells anywhere on the ticket.
  IF p_claim = 'early_five' THEN
    SELECT count(*) INTO v_n
      FROM unnest(v_all) AS x
     WHERE public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n >= 5;

  -- four_corners: the four corner cells. Corners are never blank by construction.
  ELSIF p_claim = 'four_corners' THEN
    RETURN public.tambola_cell_ok(v_r0[1], v_m, v_c)
       AND public.tambola_cell_ok(v_r0[9], v_m, v_c)
       AND public.tambola_cell_ok(v_r2[1], v_m, v_c)
       AND public.tambola_cell_ok(v_r2[9], v_m, v_c);

  -- Lines: every numbered cell in the row must be usable. Blanks do not count.
  ELSIF p_claim = 'top_line' THEN
    SELECT count(*) INTO v_n FROM unnest(v_r0) AS x
     WHERE x IS NOT NULL AND NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;

  ELSIF p_claim = 'middle_line' THEN
    SELECT count(*) INTO v_n FROM unnest(v_r1) AS x
     WHERE x IS NOT NULL AND NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;

  ELSIF p_claim = 'bottom_line' THEN
    SELECT count(*) INTO v_n FROM unnest(v_r2) AS x
     WHERE x IS NOT NULL AND NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;

  -- Full house: all 15 numbers usable. Blanks are not numbers, so a full house
  -- is exactly "no numbered cell is missing or cut".
  ELSIF p_claim IN ('full_house', 'second_full_house') THEN
    SELECT count(*) INTO v_n FROM unnest(v_all) AS x
     WHERE x IS NOT NULL AND NOT public.tambola_cell_ok(x, v_m, v_c);
    RETURN v_n = 0;
  END IF;

  RETURN FALSE;
END;
$$;
