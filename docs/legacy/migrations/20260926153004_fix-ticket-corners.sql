-- =============================================================================
-- Fix: the four corner cells must always be numbered, or Four Corners is dead
-- =============================================================================
-- scripts/claims-parity.mjs reported that the server never once judged
-- four_corners satisfiable, and a direct probe showed 278 of 300 tickets had at
-- least one blank corner. Since the four corners are a paid claim, that made it
-- unclaimable for almost every player.
--
-- The round-robin deal puts a column's 1-3 numbers into consecutive rows, so a
-- column with 3 numbers reaches all three rows while a column with 1 or 2 can
-- leave row 0 or row 2 blank. The corners are the row 0 and row 2 cells of
-- column 1 and column 9, so forcing those two columns to carry 3 numbers
-- guarantees all four corners are numbered on every ticket.
--
-- Everything else is unchanged: 15 numbers, 5 per row, 4 blanks per row, 1-3 per
-- column, all 90 numbers reachable. Only the distribution narrows, which is the
-- point.

CREATE OR REPLACE FUNCTION public.generate_tambola_ticket()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_counts   INTEGER[] := '{}';
  v_chosen   INTEGER[] := '{}';
  v_off      INTEGER[] := '{}';
  v_cum      INTEGER := 0;
  v_extra    INTEGER := 2;
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
  v_cand     INTEGER[];
  v_order    INTEGER[] := ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9];
  v_grid     INTEGER[][] := ARRAY[
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0]
                ];
BEGIN
  -- 1. Column counts. Columns 1 and 9 carry 3 numbers so that the four corner
  --    cells are always filled. Columns 2..8 start at 1 each (7 numbers) and
  --    absorb the remaining 2, keeping the total at 15.
  v_counts := ARRAY[3, 1, 1, 1, 1, 1, 1, 1, 3];
  WHILE v_extra > 0 LOOP
    v_i := 2 + floor(random() * 7)::integer;   -- columns 2..8
    IF v_counts[v_i] < 3 THEN
      v_counts[v_i] := v_counts[v_i] + 1;
      v_extra := v_extra - 1;
    END IF;
  END LOOP;

  -- 2. Distinct ascending numbers inside each column band:
  --    1-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-90.
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
    v_tmp           := v_order[v_i];
    v_order[v_i]    := v_order[v_pick];
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
