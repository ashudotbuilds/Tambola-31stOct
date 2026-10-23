# Deployment

The intended first deployment is Vercel for the frontend, Render for the API, and
Neon for PostgreSQL. This guide prepares those services; no cloud resources are
created by running the build or tests.

## Current setup

As of October 22, 2026:

- Active Neon project: `technical-tambola-singapore` (`rough-darkness-08881760`),
  in AWS Asia Pacific (Singapore), `aws-ap-southeast-1`, PostgreSQL 17.
- Database: `tambola`; role: `tambola_owner`.
- Production branch: `br-plain-boat-az7tbcjw`.
- Staging branch: `br-divine-haze-azd11d7z`.
- Migration `001_initial.sql` is applied on both branches. The API passed a live
  check against the production database: create/join, start, draw, reveal, private
  and public state, and finish. Finished verification games remain in the database.
- Existing data was copied from the Oregon production/staging branches and verified
  row-for-row before switching connections. The Oregon project
  `polished-wind-74710779` is retained as a fallback, with local connection backups
  in ignored `backend/.env.oregon` and `backend/.env.oregon.staging`.
- Backend connection strings are stored locally in ignored `backend/.env` and
  `backend/.env.staging`. They are not included in the repository.
- Render and Vercel are awaiting manual deployment. Copy the production database
  connection variables from the local backend environment into Render, then set
  the resulting API URL in Vercel as described below.

Neon currently has no Mumbai region; Singapore is the selected region for this
India-focused deployment. Choose Singapore for the Render API too so backend
queries stay close to the database. See [Neon regions](https://neon.com/docs/introduction/regions)
and [Render regions](https://render.com/docs/regions).

If you already copied Oregon connection strings into Render, replace both
`DATABASE_URL` and `MIGRATION_DATABASE_URL` with the current Singapore values from
`backend/.env`, then redeploy. The existing Neon project `techtombola` was not modified.

## 1. Neon PostgreSQL

Create a fresh PostgreSQL database in your Neon account. Choose a region close
to the Render backend to reduce the latency of game transactions.

Copy the pooled connection string into `DATABASE_URL` and optionally the direct
connection string into `MIGRATION_DATABASE_URL`. Keep the supplied SSL parameters.
Set these in `backend/.env` locally and Render's environment for production.
Never set either variable in Vercel or expose it with a `VITE_` prefix.

```sh
npm run db:status
npm run db:migrate
```

The migration runner applies only `backend/migrations/*.sql`, in filename order.
It records a checksum in `schema_migrations`; changing an applied file is an error.
Add a new numbered migration for future schema changes. A transaction advisory
lock prevents concurrent migration runners; all pending migrations commit together.
Take a backup or Neon branch before future migrations that modify existing data.

The default question bank is shared TypeScript data copied into each new game's
settings. No external seed service or InsForge RPC setup is needed.

Reference: [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app).

## 2. Render API

Connect the repository and use `render.yaml` as a Blueprint, or create a Node web
service with the following settings. Set the service Root Directory to **`backend`**.
It has its own package manifest, lockfile, source, and TypeScript configuration.

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Region | Singapore |
| Build command | `npm ci --include=dev && npm run build` |
| Pre-deploy command | `npm run db:migrate:prod` |
| Start command | `npm start` |
| Health path | `/ready` |
| Instances | `1` |
| Node | `22.22.0` in the Blueprint; Node 22.12+ supported |

Set `DATABASE_URL`, `MIGRATION_DATABASE_URL` if used, `NODE_ENV=production`,
`HOST=0.0.0.0`, `TRUST_PROXY_HOPS=1`, and `WEB_ORIGINS` to the exact Vercel origin,
for example `https://your-tambola.vercel.app`. Avoid trailing slashes or paths.
Render supplies `PORT`; the server binds that port for both HTTP and Socket.IO.

`npm start` also runs the compiled migration runner before launching the API, so
manually configured Render services apply pending migrations even when their
pre-deploy command is unset. Repeated runs verify checksums and skip applied files.

During the current testing stage, `TEST_ACCOUNTS_ENABLED=true` (the default) keeps
the Super Admin, Admin 1–3, and Member 1–6 sign-in buttons available in production.
The backend creates persistent test accounts in a reserved namespace on startup,
using the existing database schema; redeploying preserves their IDs and games.
The shared test password is `DemoPass123!`. These are public login shortcuts with
the displayed role's normal permissions, including Super Admin access.
No email provider is needed for these accounts.

When testing ends, set `TEST_ACCOUNTS_ENABLED=false` in Render and redeploy. This
hides the shortcuts, suspends the reserved test accounts and revokes their active
sessions while preserving their games and history. Real accounts stay unchanged.
Existing Render services do not need a new variable now because the default is true.

The Blueprint selects an always-on Starter service, with a pre-deploy migration
command. Creating that service is a choice you make in Render and may incur
charges. If you choose a plan without pre-deploy commands, apply migrations from
your machine before starting the service. Sleeping instances can interrupt the
experience when a game starts after an idle period.

Once the service starts, check `/health` and `/ready`. Both should return
`{"ok":true}`. If `/ready` fails, check the connection string and migration state.
Database failures return generic messages and do not log credentials.

Reference: [Render Express deployment](https://render.com/docs/deploy-node-express-app),
[Blueprint settings](https://render.com/docs/blueprint-spec).

## 3. Vercel frontend

Import the repository into Vercel with **`frontend`** as the Root Directory.
`frontend/vercel.json` supplies these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

Set `VITE_API_URL` to your Render origin, for example
`https://technical-tambola-api.onrender.com`, with no `/api` suffix. The HTTP
client adds `/api`; Socket.IO connects directly to the same origin.

Vite embeds this variable into the frontend bundle, so rebuild/redeploy after
changing it. The SPA rewrite lets `/host`, `/play`, and `/board` load directly.

If you use a preview or custom frontend domain, add its exact origin to
Render's `WEB_ORIGINS`, separated by commas, and redeploy the API. Broad wildcard
origin matching is intentionally absent. A custom domain uses fresh browser
storage; old sessions remain on the origin that issued them.

Reference: [Vercel Vite guide](https://vercel.com/docs/frameworks/frontend/vite),
[Vite environment variables](https://vite.dev/guide/env-and-mode).

## First deployment order

1. Use the already-configured Neon project, or create a fresh database for another environment.
2. Create/import the Vercel project to determine its frontend origin.
3. Configure Render's database variables and exact `WEB_ORIGINS`; build and migrate.
4. Set Vercel's `VITE_API_URL` to the Render URL and deploy the frontend.
5. Open the frontend, create a game, join from a second device, start, mark, call,
   reveal, pause/resume, and verify the projector route.

The local tests do not validate your Neon credentials, production proxy settings,
or connectivity between deployed services. Complete the last step after configuration.

## Backend container

`backend/Dockerfile` produces a Node backend container. It runs as the `node` user
and includes the compiled migration runner and SQL files.

```sh
docker build -t technical-tambola-api backend
docker run --rm --env-file backend/.env technical-tambola-api npm run db:migrate:prod
docker run --rm --env-file backend/.env -e NODE_ENV=production -p 3001:3001 technical-tambola-api
```

For a database running on the host, use the host address appropriate to your
Docker platform in the connection string. `localhost` inside a container refers
to that container. No environment files are copied into the image.

## Future AWS migration

The same application can move to the following services:

| Current | AWS target | Application change |
| --- | --- | --- |
| Vercel static frontend | S3 + CloudFront | SPA route fallback and a new `VITE_API_URL` build |
| Render API | ECS/Fargate + ALB | Deploy the container; allow WebSocket upgrades |
| Neon PostgreSQL | RDS PostgreSQL | Export/import data and replace connection strings |
| Environment variables | Secrets Manager / task configuration | Inject the same backend variables |

Set `WEB_ORIGINS` to the CloudFront/custom domain and configure proxy hops for the
actual ALB topology. Configure an ALB idle timeout compatible with persistent
sockets and route `/ready` as the health check. Handle graceful termination during
rolling deployments; browser clients reconnect and reload saved state.

The current deployment uses one API instance. Before scaling to multiple API
processes, add a Socket.IO adapter backed by shared infrastructure (for example
Redis), shared presence and rate limiting, and the required load balancer session
routing for HTTP long polling. PostgreSQL locks already serialize game writes
across instances, but the in-process socket adapter cannot distribute events.

The Dockerfile and AWS steps are prepared for that migration. AWS resources and
an AWS deployment have not been provisioned or tested here.
