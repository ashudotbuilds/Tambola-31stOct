-- =============================================================================
-- Test helper: claim_parity_fixture()
-- =============================================================================
-- The claim buttons on a player's phone are gated by a client-side mirror of
-- tambola_claim_ok() in src/lib/claims.ts. If that mirror ever drifts from the
-- SQL, a player either cannot claim something they have earned, or gets a button
-- that the server will punish. Nothing at runtime can catch that, so this
-- function hands out random tickets together with the server's own verdicts, and
-- scripts/claims-parity.mjs recomputes every verdict with the TypeScript mirror
-- and compares.
--
-- The scenarios are chosen to land on every threshold:
--   * marked = the first k numbers in reading order, for k = 0..15, which walks
--     through early five, all three lines, the four corners and the full house.
--   * a fully marked ticket with one number cut, for each number in turn, which
--     is what a wrong claim does to a player.
--
-- This is a pure function over synthetic tickets. It reads no game data and
-- reveals nothing, which is why it is safe to expose to the anon role so the
-- Node test can call it with the public key.

CREATE OR REPLACE FUNCTION public.claim_parity_fixture(p_cases INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE sql
AS $$
WITH t AS (
  SELECT i, public.generate_tambola_ticket() AS cells
    FROM generate_series(1, GREATEST(1, p_cases)) AS i
),
ordered AS (
  SELECT t.i,
         t.cells,
         (x.val #>> '{}')::integer AS n,
         (r.ord * 10 + x.ord)      AS cell_pos
    FROM t,
         LATERAL jsonb_array_elements(t.cells) WITH ORDINALITY AS r(val, ord),
         LATERAL jsonb_array_elements(r.val) WITH ORDINALITY AS x(val, ord)
   WHERE (x.val #>> '{}') IS NOT NULL
),
ranked AS (
  SELECT i,
         cells,
         n,
         dense_rank() OVER (PARTITION BY i ORDER BY cell_pos) AS rnk
    FROM ordered
),
prefix AS (
  -- marked = the first k numbers of the ticket, in reading order
  SELECT r.i,
         r.cells,
         g.k,
         COALESCE(
           (SELECT array_agg(q.n ORDER BY q.rnk)
              FROM ranked q
             WHERE q.i = r.i AND q.rnk <= g.k),
           '{}'::integer[]
         ) AS marked,
         '{}'::integer[] AS cut
    FROM (SELECT DISTINCT i, cells FROM ranked) r
    CROSS JOIN generate_series(0, 15) AS g(k)
),
one_cut AS (
  -- a complete ticket with exactly one number cut
  SELECT r.i,
         r.cells,
         99 AS k,
         r.nums AS marked,
         ARRAY[r.n] AS cut
    FROM (
      SELECT i, cells, n, array_agg(n ORDER BY rnk) AS nums
        FROM ranked
       GROUP BY i, cells, n
    ) r
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'family', s.family,
           'cells', s.cells,
           'marked', to_jsonb(s.marked),
           'cut', to_jsonb(s.cut),
           'server', jsonb_build_object(
             'early_five',        public.tambola_claim_ok('early_five',        s.cells, s.marked, s.cut),
             'four_corners',      public.tambola_claim_ok('four_corners',      s.cells, s.marked, s.cut),
             'top_line',          public.tambola_claim_ok('top_line',          s.cells, s.marked, s.cut),
             'middle_line',       public.tambola_claim_ok('middle_line',       s.cells, s.marked, s.cut),
             'bottom_line',       public.tambola_claim_ok('bottom_line',       s.cells, s.marked, s.cut),
             'full_house',        public.tambola_claim_ok('full_house',        s.cells, s.marked, s.cut),
             'second_full_house', public.tambola_claim_ok('second_full_house', s.cells, s.marked, s.cut)
           )
         ) ORDER BY s.family, s.i, s.k), '[]'::jsonb)
  FROM (
    SELECT 'prefix'::text AS family, i, cells, k, marked, cut FROM prefix
    UNION ALL
    SELECT 'one_cut'::text, i, cells, k, marked, cut FROM one_cut
  ) s;
$$;

GRANT EXECUTE ON FUNCTION public.claim_parity_fixture(INTEGER) TO anon, authenticated;
