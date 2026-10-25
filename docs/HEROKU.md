# Heroku backend deployment

Deploy the **repository root** to a Cedar-generation app using the classic
`heroku/nodejs` buildpack and `heroku-24` stack. Vercel continues hosting the
frontend. The existing Neon database is used; no Heroku Postgres add-on is needed.
`app.json` is the template for new apps. Existing apps need their config vars and
buildpack set in the dashboard or CLI because editing the template does not update them.

## Build and run

- Root `engines.node` selects Node 24 LTS.
- `heroku-postbuild` verifies shared files, installs the backend with build tools,
  compiles it, then removes backend development dependencies. It replaces the
  root `build` command, so Heroku does not install or build the Vercel frontend.
- The `release` process applies checksummed migrations using compiled JavaScript.
  A failed migration prevents the new release from replacing the current one.
- The `web` process starts `backend/dist/index.js` directly. It binds Heroku's
  assigned `PORT` on `0.0.0.0`; do not set a fixed port in config vars.
- `backend` retains its independent package/lockfile and its Render start command.

## Required settings

Set these under Heroku **Settings → Config Vars** before deploying:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Existing Neon pooled URL from the ignored backend environment, including SSL parameters |
| `MIGRATION_DATABASE_URL` | Prefer the direct Neon URL; leave unset to use `DATABASE_URL` |
| `WEB_ORIGINS` | Exact HTTPS Vercel origin, with no trailing slash; comma-separate additional allowed origins |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `TRUST_PROXY_HOPS` | `1` |
| `DATABASE_POOL_MAX` | `10` |
| `TEST_ACCOUNTS_ENABLED` | `true` while testing; switch to `false` once real accounts are ready |

Copy `POSTHOG_PROJECT_KEY` and `POSTHOG_HOST` for telemetry. Configure all three
email settings together if credential email delivery is enabled. Leave unused
optional settings unset. Never place the database URL or private keys in Vercel.

## Deploy

In Heroku, connect the GitHub repository, select `main`, and deploy from the root.
For an existing app, select the classic Node.js buildpack `heroku/nodejs` and
stack `heroku-24`. No subdirectory buildpack or npm workspace is needed.

CLI alternative, replacing `YOUR_APP` with your app name:

```sh
heroku git:remote --app YOUR_APP
heroku buildpacks:set heroku/nodejs --app YOUR_APP
git push heroku main
heroku ps:scale web=1 --app YOUR_APP
heroku releases --app YOUR_APP
heroku logs --tail --app YOUR_APP
```

The template selects one **Basic** web dyno. Choose an always-on plan for live
games. Keep one web dyno: Socket.IO room notifications are currently held in that
process. Multiple dynos require a shared Socket.IO adapter and suitable routing
for polling sessions before scaling out.

Once the release succeeds, check `https://YOUR_APP.herokuapp.com/health` and
`/ready`; both must return `{"ok":true}`. Use the actual domain from Heroku's
Settings page if it includes an additional generated suffix.

## Connect Vercel

Set Vercel's `VITE_API_URL` to the HTTPS Heroku origin **without `/api` or a trailing
slash**, then redeploy the frontend. Its existing proxy forwards `/api/*` and
`/socket.io/*`, preserving same-origin browser cookies. Keep Vercel's Root Directory
as `frontend`. Verify sign-in, game creation/joining, a live draw, and reconnects
through the Vercel site. The backend root `/` is an API, so a 404 there is expected.

Heroku Common Runtime offers US/EU regions; Singapore is a Private Spaces region.
The current Neon database is in Singapore, so common-runtime Heroku adds a
cross-region database hop. Compare real gameplay latency before moving the
database; no database is moved by this setup.

## Local packaging check

After normal repository setup, run `npm run check:heroku`. It copies only source,
lockfiles, and migrations to a temporary directory, runs the Heroku build and
pruning, then exercises the compiled API with an isolated PostgreSQL/WASM database.
It checks readiness, login, game creation, and Socket.IO polling after development
dependencies are removed. It never reads or copies your database credentials.
This verifies packaging on the local OS, not an actual Heroku release.

References: [Node build behavior](https://devcenter.heroku.com/articles/nodejs-classic-buildpack-builds),
[release migrations](https://devcenter.heroku.com/articles/release-phase),
[app manifest](https://devcenter.heroku.com/articles/app-json-schema),
[regions](https://devcenter.heroku.com/articles/regions).
