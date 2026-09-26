# Technical Tambola

Multiplayer tambola for a room of about fifty people, where every number is
announced as a tech clue.

> **The clue:** "404 — Not Found" → the host counts down → the number **4** is
> revealed and stamped on every ticket that carries it.

Classic 90-ball tambola rules, so it plays like the real thing. The twist is that
the host never says a number: they read a clue, everyone decodes it, and the
reveal decides whether anyone should be shouting.

---

## The game

A standard 3×9 ticket: 15 numbers, 5 per row, 4 blanks per row, and 1–3 numbers
in each of the nine columns (1–9, 10–19, … 80–90). All four corner cells are
always numbered, so Four Corners is always winnable.

| Claim | Points | Who can win it |
| --- | --- | --- |
| Early Five | 10 | first only |
| Four Corners | 20 | first only |
| Top / Middle / Bottom Line | 30 each | first only |
| Full House | 50 | first only |
| Second Full House | 30 | first only |

- Numbers are **auto-daubed** the instant they are called, so nobody loses a
  claim to a laggy phone. Decoding the clue is the only test.
- A **wrong claim costs 10 points and cuts one of your marked numbers** — that
  cell can no longer count toward a full house.
- The first Full House puts the game into *closing*. It ends at the second Full
  House, or 10 calls later, whichever comes first.

### Clues

Every number from 1 to 90 has two hand-written variants in
`migrations/*_clue-bank.sql`, so a repeat call never sounds the same. The host
reveals a clue, gives a few seconds, then reveals the number, which also removes
any ambiguity in the clue itself.

```
 8   →  8 bits make a byte          56  →  56k, the dial-up modem speed
42   →  The Answer to Life...       64  →  64-bit architecture
80   →  80 columns, 80×24 terminal  90  →  the upper bound of a tambola ticket
```

---

## Screens

| Route | Who | What it does |
| --- | --- | --- |
| `/` | everyone | create a game, or join with a code |
| `/host` | the host | lobby with QR code, clue stage, call button (space bar), claim feed, standings, pause/end, results |
| `/play` | players | ticket, claim buttons, score and rank, standings, toasts |
| `/board?code=XXXXXX` | projector | big clue and number, called board, standings. No token, shareable |

The host is a moderator and does not play. Pressing **space** calls the next
number, so the host never has to look at the mouse.

---

## How fairness works

There are no accounts. Identity is a random secret token handed out by
`create_game` / `join_game`, and all the rules live in Postgres.

- The `anon` role has **no privileges on any game table**. Every read and write
  goes through a `SECURITY DEFINER` function that checks a token.
- Only `draw_number()` can produce a number, and only the host's token can call
  it. No client can invent a call.
- Only `submit_claim()` can award points. It re-checks the claim against the
  stored ticket, so a client cannot claim a line it never completed.
- Marks are written by the server at draw time. A client cannot mark, or unmark,
  its own ticket.
- Realtime events are published by **database triggers**. Clients hold no
  publish privilege, so a player cannot forge a `number_called` or `claim_result`.
  Row level security on `realtime.messages` has no write policy, which is what
  actually enforces this.
- Simultaneous claims are settled by a partial unique index on
  `claims(game_id, claim_type) WHERE status = 'accepted'`, so exactly one player
  can win a given claim. The loser is told they were beaten and pays nothing.

Read more about the access model in `migrations/*_assert-realtime-access.sql`.

---

## Running it

```bash
npm install

# keys come from the linked InsForge project
cp .env.example .env.local     # or use the values already in .env.local

npm run db:migrate             # apply migrations
npm run dev                    # http://localhost:3000
```

### Tests

```bash
npm test              # typecheck + parity + smoke, in that order
npm run typecheck
npm run test:parity   # client claim logic vs the SQL rules
npm run test:smoke    # real backend: lobby, draw, claim, realtime, security
```

Two of these are worth knowing about:

- **The migrations test themselves.** `verify-game-rules` and `verify-game-flow`
  are migrations whose only job is to assert the game's rules and then fail the
  migration if an assertion breaks. They run hundreds of generated tickets
  through the real generator, drive four complete games through the public RPCs,
  and check that no table is reachable by `anon`.
- **`test:parity` compares the two implementations of the rules.** The claim
  buttons in the UI are gated by `isClaimEligible()` in `src/lib/claims.ts`, a
  mirror of the SQL function `tambola_claim_ok()`. `claim_parity_fixture()`
  returns random tickets with the server's verdict; the test recomputes each
  verdict in TypeScript and compares. This caught a bug where blank cells were
  treated as failures, which would have made **no line claim ever light up**,
  because every row has four blanks.

---

## Deploying

```bash
npm run build
npx -y @insforge/cli deployments deploy .
```

Set `NEXT_PUBLIC_INSFORGE_URL` and `NEXT_PUBLIC_INSFORGE_ANON_KEY` in the
deployment environment. Put the URL on the projector; players scan the QR code
and play from their own phones.

---

## Layout

```
app/                     Next.js App Router screens
  page.tsx               landing: create or join
  host/page.tsx          host console
  play/page.tsx          player ticket
  board/page.tsx         projector view
src/lib/
  insforge.ts            SDK client
  api.ts                 RPC wrappers and localStorage sessions
  claims.ts              claim metadata + the client mirror of the SQL rules
  sound.ts               generated sound cues, no audio assets
  types.ts               shared shapes
src/hooks/useGameRoom.ts realtime subscription and game state
src/components/          ticket, called board, claim buttons, clue stage, …
migrations/              SQL, applied in filename order
scripts/
  smoke.mjs              end-to-end test against the real backend
  claims-parity.ts       client rules vs server rules
```

### Migrations

They run in filename order and each one is applied once, so the history is the
record of what changed and why. Several of them are bug fixes with the original
symptom explained in the header comment, because the failure modes here are not
obvious: Postgres's `jsonb ||` concatenates arrays instead of nesting them,
`array_remove()` strips every duplicate at once, and `ARRAY(SELECT ...)` returns
an empty array rather than NULL when nothing matches.
