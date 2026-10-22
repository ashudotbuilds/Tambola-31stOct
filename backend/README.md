# Tambola backend

Express + TypeScript + Socket.IO, using Neon PostgreSQL. This folder is
self-contained and deploys to Render.

## Local development

Run inside `backend/`:

```sh
npm ci
```

Copy `.env.example` to `.env` unless a configured local file already exists.
Set `DATABASE_URL` to the pooled Neon connection and `MIGRATION_DATABASE_URL` to
the direct connection. Set `WEB_ORIGINS=http://localhost:5173` for local use.

```sh
npm run db:migrate
npm run dev
```

The API defaults to port 3001. `GET /health` checks the process and `GET /ready`
checks the database/schema. The database connection strings stay server-side.

## Deploy to Render

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/ready` |
| Instances | `1` |

Set the following Render environment variables:

- `DATABASE_URL`: pooled production Neon URL.
- `MIGRATION_DATABASE_URL`: direct production Neon URL.
- `WEB_ORIGINS`: exact Vercel origin, without a trailing slash.
- `NODE_ENV=production`.
- `HOST=0.0.0.0`.
- `TRUST_PROXY_HOPS=1`.

Render supplies `PORT`. The same HTTP server handles REST and Socket.IO.
On a plan supporting pre-deploy commands, use `npm run db:migrate:prod`.
Otherwise apply migrations locally before deployment. The dedicated production
and staging databases already have migration `001_initial.sql` applied.

The root `render.yaml` sets `rootDir: backend` and a paid Starter instance.
For a free instance, choose Free manually and run migrations separately.

## Commands

- `npm run dev`: TypeScript development server.
- `npm run build`: typecheck and compile to `dist`.
- `npm start`: run the compiled server.
- `npm test`: isolated PostgreSQL/WASM and HTTP/socket tests.
- `npm run db:migrate`: apply migrations using the local environment.
- `npm run db:status`: inspect migration state.
- `npm run db:migrate:prod`: run the compiled migration runner.
- `npm run test:browser`: disposable test API for frontend verification.

## Docker

From the repository root: `docker build -t technical-tambola-api backend`.
The build context needs only this folder. Inject environment variables when
running the container; environment files are excluded from the image.

Files in `src/shared` are the canonical contracts, claim rules, and technical
bank. After editing them, run `npm run sync:shared` from the repository root to
update the frontend's independent copy. CI checks that the copies match.
