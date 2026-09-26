-- =============================================================================
-- Fix: the one-cut parity scenario marked a single number instead of all 15
-- =============================================================================
-- The first version grouped by (i, cells, n), so array_agg collapsed to a
-- one-element array and every "cut" scenario had just one marked number, which
-- made all seven claims trivially false. The scenario now starts from the full
-- number list and cuts one number at a time, which is the interesting case: a
-- player who has a complete ticket and gets one number cut for a wrong claim.

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
per_ticket AS (
  SELECT i, cells, array_agg(n ORDER BY rnk) AS all_nums
    FROM ranked
   GROUP BY i, cells
),
prefix AS (
  -- marked = the first k numbers of the ticket, in reading order
  SELECT p.i,
         p.cells,
         g.k,
         COALESCE(
           (SELECT array_agg(q.n ORDER BY q.rnk)
              FROM ranked q
             WHERE q.i = p.i AND q.rnk <= g.k),
           '{}'::integer[]
         ) AS marked,
         '{}'::integer[] AS cut
    FROM per_ticket p
    CROSS JOIN generate_series(0, 15) AS g(k)
),
one_cut AS (
  -- a complete ticket with exactly one number cut
  SELECT p.i,
         p.cells,
         99 AS k,
         p.all_nums AS marked,
         ARRAY[q.n] AS cut
    FROM per_ticket p
    CROSS JOIN LATERAL unnest(p.all_nums) AS q(n)
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
