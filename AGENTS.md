# AGENTS.md

## Architecture

- `apps/web`: React + Vite + TypeScript frontend, deployed on Vercel.
- `apps/api`: Express + TypeScript REST API and Socket.IO server, deployed on Render.
- `packages/shared`: shared contracts, claim rules, and the 90-item technical bank.
- Database: Neon PostgreSQL through `pg`. Future target: AWS with PostgreSQL/RDS.
- The user chose a fresh database. Neon project `technical-tambola`
  (`polished-wind-74710779`) is provisioned with production and staging branches.
- Production and staging migrations passed, and a live Neon/API smoke check passed.
- The user will deploy Vercel and Render manually.

## Working conventions

- Preserve the original screens, routes, themes, responsive layouts, and game behavior.
- Keep route validation, game services, repositories, and database access modular.
- The API is authoritative for tickets, called numbers, claims, points, and penalties.
- Use PostgreSQL transactions and parameterized SQL. Maintain consistent lock order:
  game then ticket for claims; mark saves lock only the player's own ticket.
- Publish Socket.IO invalidations after database commits. Never broadcast private
  tickets, bearer tokens, or token hashes.
- Store only hashes of session tokens in the database. Send raw tokens only when
  issuing a host/player session. The projector state is public and excludes tickets.
- New schema changes belong in numbered SQL files under `apps/api/migrations`.
  Applied migrations are immutable and checksummed; add a new file for changes.
- `docs/legacy` contains historical InsForge references only. Do not run its SQL or
  scripts against the new database. Active application code must not depend on InsForge.
- Keep deployment settings in environment variables. API secrets belong in
  `apps/api/.env`; browser configuration belongs in `apps/web/.env.local`.
  Never expose DATABASE_URL through a VITE_ variable, log tokens, or commit secrets.

## Commands

Run commands from the repository root:

- `npm install` (or `npm ci` with the lockfile)
- `npm run dev`
- `npm run typecheck`
- `npm test` (isolated PostgreSQL/WASM tests, no cloud credentials)
- `npm run build`
- `npm run db:migrate` (configured database only)

See README.md and docs/DEPLOYMENT.md before changing deployment configuration.
