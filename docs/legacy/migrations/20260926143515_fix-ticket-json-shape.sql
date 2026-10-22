-- =============================================================================
-- Fix: generate_tambola_ticket() must return [[9 cells],[9 cells],[9 cells]]
-- =============================================================================
-- The jsonb || operator concatenates arrays element-wise, so building rows with
-- '[]'::jsonb || <cell> flattened everything into a single 27-element array.
-- Build a 2D integer array instead and let to_jsonb() respect the dimensions.

CREATE OR REPLACE FUNCTION public.generate_tambola_ticket()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_counts   INTEGER[] := '{}';
  v_fallback CONSTANT INTEGER[] := ARRAY[2, 2, 2, 2, 2, 2, 1, 1, 1];
  v_chosen   INTEGER[] := '{}';
  v_blank    BOOLEAN[] := '{}';
  v_used     INTEGER := 0;
  v_col      INTEGER;
  v_row      INTEGER;
  v_i        INTEGER;
  v_n        INTEGER;
  v_pick     INTEGER;
  v_picked   INTEGER;
  v_tries    INTEGER;
  v_cand     INTEGER[];
  v_grid     INTEGER[][] := ARRAY[
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0]
                ];
BEGIN
  -- 1. Numbers per column: each of the 9 columns gets 1..3, total must be 15.
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

  -- 2. Pick distinct numbers inside each column band.
  FOR v_col IN 1..9 LOOP
    v_cand := '{}';
    FOR v_i IN 1..v_counts[v_col] LOOP
      LOOP
        v_pick := ((v_col - 1) * 10) + floor(random() * 9)::integer + 1;
        EXIT WHEN NOT (v_pick = ANY (v_cand));
      END LOOP;
      v_cand := array_append(v_cand, v_pick);
    END LOOP;
    v_chosen := v_chosen || v_cand;
  END LOOP;

  -- 3. Exactly 4 blank cells per row, so 5 numbers per row.
  v_blank := array_fill(FALSE, ARRAY[27]);
  FOR v_row IN 0..2 LOOP
    v_picked := 0;
    WHILE v_picked < 4 LOOP
      v_col := floor(random() * 9)::integer + 1;
      IF NOT v_blank[v_row * 9 + v_col] THEN
        v_blank[v_row * 9 + v_col] := TRUE;
        v_picked := v_picked + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- 4. Lay the numbers out column by column into the free slots.
  --    v_grid is a SQL array, so its row index is 1-based (v_row + 1).
  v_i := 1;
  FOR v_col IN 1..9 LOOP
    FOR v_row IN 0..2 LOOP
      IF v_blank[v_row * 9 + v_col] THEN
        v_grid[v_row + 1][v_col] := NULL;
      ELSE
        v_grid[v_row + 1][v_col] := v_chosen[v_i];
        v_i := v_i + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- 5. to_jsonb() respects the array dimensions: [[9 cells],[9 cells],[9 cells]]
  RETURN to_jsonb(v_grid);
END;
$$;

-- Guard: the shape must be 3 rows of 9 cells with 15 numbers in total.
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
    FROM (SELECT public.generate_tambola_ticket() AS c FROM generate_series(1, 200)) s
   WHERE jsonb_typeof(c) <> 'array'
      OR jsonb_array_length(c) <> 3
      OR EXISTS (
            SELECT 1 FROM generate_series(0, 2) AS g(i)
             WHERE jsonb_array_length(c -> g.i) <> 9
          );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ticket shape invalid for % of 200 generated tickets', v_bad;
  END IF;
END;
$$;
