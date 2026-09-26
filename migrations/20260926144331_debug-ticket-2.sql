-- TEMPORARY diagnostic helper (dropped once the generator is confirmed).
CREATE OR REPLACE FUNCTION public.debug_ticket()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_counts   INTEGER[] := '{}';
  v_slots    INTEGER[] := '{}';
  v_shuffled INTEGER[] := '{}';
  v_chosen   INTEGER[] := '{}';
  v_off      INTEGER[] := '{}';
  v_cand     INTEGER[] := '{}';
  v_grid     INTEGER[][] := ARRAY[
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0],
                  ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0]
                ];
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
  v_places   INTEGER := 0;
  v_oor      INTEGER := 0;
BEGIN
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
    v_counts := ARRAY[2,2,2,2,2,2,1,1,1];
  END IF;

  v_off := array_fill(0, ARRAY[10]);
  FOR v_col IN 1..9 LOOP
    v_off[v_col] := v_cum + 1;
    v_cum := v_cum + v_counts[v_col];
    v_cand := '{}';
    FOR v_i IN 1..v_counts[v_col] LOOP
      v_lo := GREATEST(1, (v_col - 1) * 10);
      v_hi := v_lo + CASE WHEN v_col = 1 THEN 8 WHEN v_col = 9 THEN 10 ELSE 9 END;
      LOOP
        v_pick := v_lo + floor(random() * (v_hi - v_lo + 1))::integer;
        EXIT WHEN NOT (v_pick = ANY (v_cand));
      END LOOP;
      v_cand := array_append(v_cand, v_pick);
    END LOOP;
    v_chosen := v_chosen || v_cand;
  END LOOP;

  v_slots := '{}';
  FOR v_col IN 1..9 LOOP
    FOR v_i IN 1..v_counts[v_col] LOOP
      v_slots := array_append(v_slots, v_col);
    END LOOP;
  END LOOP;

  FOR v_i IN 1..array_length(v_slots, 1) LOOP
    v_pick := floor(random() * array_length(v_slots, 1) + 1)::integer;
    v_shuffled := array_append(v_shuffled, v_slots[v_pick]);
    v_tmp := v_slots[v_pick];
    v_slots := v_slots[1:v_pick - 1] || v_slots[v_pick + 1:array_length(v_slots, 1)];
  END LOOP;

  FOR v_col IN 1..9 LOOP
    v_cursor := 0;
    FOR v_row IN 0..2 LOOP
      FOR v_k IN 1..5 LOOP
        IF v_shuffled[v_row * 5 + v_k] = v_col THEN
          v_places := v_places + 1;
          IF v_off[v_col] + v_cursor <= array_length(v_chosen, 1) THEN
            v_grid[v_row + 1][v_col] := v_chosen[v_off[v_col] + v_cursor];
          ELSE
            v_oor := v_oor + 1;
          END IF;
          v_cursor := v_cursor + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'used', v_used,
    'counts', v_counts,
    'chosen_len', array_length(v_chosen, 1),
    'chosen', v_chosen,
    'off', v_off,
    'shuffled_len', array_length(v_shuffled, 1),
    'shuffled', v_shuffled,
    'places', v_places,
    'out_of_range', v_oor,
    'grid', to_jsonb(v_grid)
  );
END;
$$;
