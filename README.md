# Technical Tambola

A multiplayer technical tambola game for ACM Engineering Day. Players solve
computer science clues and code questions, then manually mark the matching terms
on their tickets. A host controls the game while a projector shows the live round.

This is the React/Vite and Express/TypeScript rebuild of the original application.
The existing screens, themes, ticket interactions, question bank editor, lobby
simulator, sound cues, and game flow are retained.

| Layer | Technology | Hosting |
| --- | --- | --- |
| Frontend | React 19, Vite, TypeScript, React Router, Tailwind CSS | Vercel |
| Backend | Express 5, TypeScript, Socket.IO | Render |
| Database | PostgreSQL via `pg`, versioned SQL migrations | Neon |
| Shared code | Types, claim rules, default technical question bank | npm workspace |

The rebuild uses a **fresh database**. The dedicated Neon project and its schema
are configured; Vercel and Render deployment are handled manually. See
[the current deployment setup](docs/DEPLOYMENT.md#current-setup) for details.
InsForge is no longer an application dependency.

## Quick start

Use Node.js 22.12+ and npm. Node 22 LTS is used by the deployment configuration.
Run all commands below from the repository root.

```sh
npm ci
```

Create the frontend and backend environment files:

```powershell
# PowerShell
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.env.example apps/api/.env
```

```sh
# macOS / Linux
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

Set `DATABASE_URL` in `apps/api/.env` to your Neon PostgreSQL connection string.
Keep the SSL query parameters supplied by Neon. Optionally set
`MIGRATION_DATABASE_URL` to the direct endpoint for migrations.

```sh
npm run db:migrate
npm run dev
```

Open [the frontend](http://localhost:5173). The API listens on port 3001.
`GET /health` checks the process; `GET /ready` checks database/schema access.

For a local PostgreSQL database instead of Neon:

```sh
docker compose up -d postgres
```

Then use this development-only backend connection string and run the migrations:

```dotenv
DATABASE_URL=postgresql://tambola:local-development-only@localhost:5432/tambola
```

### Environment variables

The frontend reads `apps/web/.env.local`. Vite embeds these values when it builds.

| Variable | Local value | Production value |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3001` | Your Render API origin, without `/api` |

The backend reads `apps/api/.env`, or environment variables supplied by the host.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | Application PostgreSQL connection string | Required |
| `MIGRATION_DATABASE_URL` | Optional migration connection string | Uses `DATABASE_URL` |
| `WEB_ORIGINS` | Comma-separated exact allowed frontend origins | `http://localhost:5173` |
| `PORT` | HTTP and Socket.IO port | `3001` |
| `HOST` | Network bind address | `0.0.0.0` |
| `DATABASE_POOL_MAX` | Maximum application database connections | `10` |
| `TRUST_PROXY_HOPS` | Trusted reverse proxy hops | `0` locally; `1` on Render |
| `NODE_ENV` | Runtime environment | `development` |

Never put database credentials in a `VITE_` variable. No database credentials or
service keys are needed by the browser. Environment files are ignored by Git.

## Project structure

```text
apps/
  web/
    index.html                    Browser entry and metadata
    vite.config.ts                Vite configuration and source alias
    src/
      main.tsx                    Router and theme providers
      App.tsx                     The four application routes
      pages/                      Landing, host, player, projector screens
      features/
        host/Results.tsx          Final standings and call history
        board/ProjectorCallStage.tsx
      components/                 Tickets, clue stage, claims, question editor, tutorial
      hooks/
        useGameRoom.ts            Socket lifecycle, refresh, reconnect and room state
        usePlayerMarks.ts         Instant manual selection and server restoration
      lib/
        api.ts                    Typed API operations and ordered mark saves
        http.ts                   Fetch, timeout, and error handling
        sessions.ts               Local host/player session persistence
        technicalBank.ts          Import/export and browser bank preferences
        theme.tsx                 Light/dark theme
        sound.ts                  Sound and speech helpers
      styles/globals.css          Original visual styles
  api/
    src/
      index.ts                    Process startup and graceful shutdown
      app.ts                      Express, CORS, limits, health, Socket.IO
      config.ts                   Environment loading and validation
      errors.ts                   Application errors
      db/                         pg adapter and migration runner
      modules/games/
        routes.ts                 REST handlers and bearer sessions
        validation.ts             Request schemas
        service.ts                Game lifecycle, draws, banks, marks and state
        claims.ts                 Claim judgment, scoring and penalties
        repository.ts             Game/player/ticket access and token helpers
        ticket.ts                 Standard 90-ball ticket generation
        models.ts                 Internal database row types
      realtime/rooms.ts           Room admission and device presence
    migrations/001_initial.sql    Portable PostgreSQL schema
    test/                         Game, HTTP, socket and ticket verification
packages/shared/src/
  types.ts                        Shared data contracts
  claims.ts                       Claim metadata and eligibility rules
  bank.ts                         Original 90 technical items

docs/DEPLOYMENT.md                 Vercel, Render, Neon and future AWS setup
docs/API.md                        REST and socket reference
docs/legacy/                       Historical InsForge SQL/scripts; not executable setup
render.yaml                       Render Blueprint
vercel.json                       Vercel SPA deployment settings
Dockerfile                        Backend container for Render/AWS
compose.yaml                      Optional local PostgreSQL
```

## Screens and game flow

| Route | Audience | Features |
| --- | --- | --- |
| `/` | Everyone | Create/join, six-character code, QR join link, resume session |
| `/host` | Host | Lobby, QR code, custom bank, start, call, individual/batch reveal, pause/resume/end, claim feed, standings and results |
| `/play` | Player | Lobby tutorial, technical ticket, manual marking/unmarking, claim buttons, score/rank, live clues and toasts |
| `/board?code=ABC123` | Projector | Public live question, reveal, called grid/terms, standings and recent claims |

The host moderates and receives no ticket. Space calls the next question, except
while typing or editing the question bank. Light/dark themes and sound controls
are retained. The host can read clues aloud through browser speech synthesis.

### Browser preview

![Host console](docs/screenshots/host.png)

[Player ticket](docs/screenshots/player.png) · [Projector screen](docs/screenshots/projector.png)

Each ticket has three rows and nine columns, with 15 distinct numbers, five per
row, and one to three per column. Bands are 1-9, 10-19, ..., 80-90. All four corner
cells are filled. The cells display technical terms by default; players can
switch to numbers.

**Marking is manual.** Calling or revealing a question never selects a player's
cells. Claims are checked against saved marks intersected with officially called
numbers, excluding cells cut by penalties. Extra uncalled marks never count.

| Claim | Points | Availability |
| --- | --- | --- |
| Early Five | 10 | One winner per game |
| Four Corners | 20 | One winner per game |
| Top / Middle / Bottom Line | 30 each | One winner per line |
| Full House | 50 | One winner; starts closing |
| Second Full House | 30 | Available after Full House; ends game |

A wrong claim deducts 10 points, with a floor of zero, and cuts one selected
number if available. Losing a valid claim race causes no penalty. Closing ends
at Second Full House or ten additional calls. Pause/resume remembers whether the
game was playing or closing. The default capacity is 100 people including the host.

Hosts can search, import, edit, reset, and export the 90-item question bank.
Imports accept JSON or delimited lines such as `Term | Clue`; short imports fill
remaining entries from the default bank. Bank changes are persisted on the game
and shared with players and the projector.

## State, sessions, and fairness

The browser talks only to Express over HTTP and Socket.IO. Express connects to
PostgreSQL; clients have no direct database access.

```mermaid
flowchart LR
  W[React / Vite on Vercel] -->|REST requests| A[Express / TypeScript on Render]
  A -->|Socket.IO invalidations + presence| W
  A -->|Parameterized SQL + transactions| D[(Neon PostgreSQL)]
```

There are no player accounts. Creating/joining issues a random bearer token;
hosts also receive a separate host token. Only SHA-256 token hashes are stored in
the database. Raw sessions are stored in the browser under `tt.v2.host` and
`tt.v2.player`. Clearing browser storage loses that device's session.

Game mutations use transactions. Draws and claims lock the game row, while mark
saves lock the player's own ticket. Database uniqueness constraints prevent
repeated numbers and multiple accepted winners for a claim. Rapid mark saves are
sent in order, and submitting a claim waits for the latest selection to be saved.

Socket.IO publishes a `game_changed` invalidation **after commit**. Clients then
fetch state using their own token. Private tickets and tokens are never room
broadcasts. The hook refreshes after joining/reconnecting, on page visibility,
and every 15 seconds to recover missed changes. Game data survives API restarts;
device presence is transient.

The projector is intentionally public to anyone with the game code. As in the
original game, public state includes the called numbers and the question bank;
visual answer hiding is a game presentation feature, not secrecy from a client
inspecting network responses.

## Commands and verification

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start API and frontend together |
| `npm run dev:web` / `npm run dev:api` | Start one application |
| `npm run typecheck` | Check all workspaces |
| `npm test` | Run isolated PostgreSQL/WASM, HTTP, Socket.IO and ticket tests |
| `npm run build` | Build both production applications |
| `npm run build:web` / `npm run build:api` | Build one application |
| `npm start` | Start the compiled API |
| `npm run db:migrate` | Apply pending schema migrations |
| `npm run db:status` | Show migration state |
| `npm run db:migrate:prod` | Run the compiled migration runner after API build |

The tests use PGlite, a real PostgreSQL engine compiled to WebAssembly, in an
isolated database. They require no Neon account and cover 1,000 generated tickets,
manual/official mark rules, authorization, private state, duplicate names,
concurrent claim requests, penalties, closing, all 90 draws, room isolation,
presence, and reconnection. Neon connectivity, Render/Vercel deployment, and
multi-process load still need validation after cloud configuration.

For a disposable browser test environment without a database connection:

```sh
# Terminal 1: test API; all data disappears when this process exits
npm exec -w @tambola/api -- tsx test/browser-server.ts
# Terminal 2
npm run dev:web
```

Use this only for development verification. The normal API requires PostgreSQL.

Production dependencies have a separate audit: `npm audit --omit=dev`. The retained
Tailwind 3 build tooling has upstream development dependency advisories; review
`npm audit` before upgrading the styling pipeline, since Tailwind 4 changes CSS behavior.

## Deployment and AWS portability

See [Deployment](docs/DEPLOYMENT.md) for exact settings and the first deployment
order. See [API reference](docs/API.md) for endpoints and authentication.

The backend uses a normal Node HTTP server and portable PostgreSQL. A Dockerfile
is included for the later move to AWS. The natural targets are S3/CloudFront for
the static frontend, ECS/Fargate behind an ALB for the API, and RDS PostgreSQL.
The current socket adapter and rate limit store assume **one API instance**;
multiple replicas require shared socket presence/event delivery and shared limits.

Historical InsForge migrations and diagnostics live under `docs/legacy` as a
reference. Only `apps/api/migrations` is applied to the new database.

Built by Ashutosh with love.
