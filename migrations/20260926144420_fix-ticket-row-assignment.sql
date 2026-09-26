-- =============================================================================
-- Fix: deal ticket numbers into rows without ever repeating a column
-- =============================================================================
-- The previous version shuffled a list of 15 column slots and handed 5
-- consecutive slots to each row. Nothing stopped the same column appearing
-- twice inside one row's five slots. A 3x9 ticket holds at most one number per
-- row per column, so the second write silently overwrote the first: 15
-- placements collapsed into 13 numbers and rows ended up with 4 or 6.
--
-- Dealing is now a round robin. Columns are visited in a shuffled order and a
-- column's 1-3 numbers occupy consecutive positions, so those positions map to
-- distinct rows. Fifteen positions dealt over three rows gives exactly five
-- numbers per row, each in a distinct column.
--
-- Entropy comes from the random per-column counts, the random column order and
-- the random rotation offset.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_tambola_ticket()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_counts   INTEGER[] := '{}';
  v_fallback CONSTANT INTEGER[] := ARRAY[2, 2, 2, 2, 2, 2, 1, 1, 1];
  v_order    INTEGER[] := ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9];
  v_chosen   INTEGER[] := '{}';
  v_off      INTEGER[] := '{}';
  v_used     INTEGER := 0;
  v_cum      INTEGER := 0;
  v_col      INTEGER;
  v_row      INTEGER;
  v_j        INTEGER;
  v_i        INTEGER;
  v_n        INTEGER;
  v_lo       INTEGER;
  v_hi       INTEGER;
  v_pick     INTEGER;
  v_tmp      INTEGER;
  v_cursor   INTEGER;
  v_pos      INTEGER := 0;
  v_rot      INTEGER := 0;
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

  -- 3. Shuffle the visiting order of the columns.
  FOR v_i IN 1..8 LOOP
    v_pick := floor(random() * (10 - v_i) + v_i)::integer;
    v_tmp        := v_order[v_i];
    v_order[v_i] := v_order[v_pick];
    v_order[v_pick] := v_tmp;
  END LOOP;
  v_rot := floor(random() * 3)::integer;

  -- 4. Round-robin deal. A column's 1-3 numbers take consecutive positions, so
  --    they always land in distinct rows and never collide in a cell.
  FOR v_j IN 1..9 LOOP
    v_col := v_order[v_j];
    v_cursor := 0;
    FOR v_i IN 1..v_counts[v_col] LOOP
      v_row := (v_pos + v_rot) % 3;
      v_grid[v_row + 1][v_col] := v_chosen[v_off[v_col] + v_cursor];
      v_cursor := v_cursor + 1;
      v_pos := v_pos + 1;
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

DROP FUNCTION IF EXISTS public.debug_ticket();
