# k6 game load test

This first test measures repeated authenticated game-state reads against the
backend. It creates one temporary game during setup and soft-deletes it after the
run. It does not simulate 100 distinct accounts or Socket.IO connections.

## Install k6 on Windows

Open PowerShell and run:

```powershell
winget install k6 --source winget
k6 version
```

## Start with a smoke run

Use the **backend's HTTPS origin** for `BASE_URL` so Vercel caching/proxying does
not hide backend latency. Use a test admin account, not a personal admin login.
The seeded testing admin is accepted as an ID; put its test password into the
hidden prompt below rather than committing it or writing it into the script.

```powershell
$env:BASE_URL = 'https://YOUR-BACKEND-ORIGIN'
$env:ADMIN_LOGIN = 'tt-test-superadmin'
$env:ADMIN_PASSWORD = Read-Host 'Test admin password' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:MAX_VUS = '1'
k6 run .\loadtest\k6\game-read.js
```

The script creates and removes a temporary game. If the run is interrupted before
cleanup, remove the game named `k6 Load Test` from the admin game list.

## Increase gradually

Only after the smoke run succeeds, run `MAX_VUS` at `10`, `15`, `20`, `50`, and
`100`, in that order. Each run ramps through all earlier checkpoints and holds
at its selected maximum for one minute. Each virtual user polls game updates
roughly once per second. Watch k6's p95 duration and failures, along with Heroku
dyno CPU/memory, request logs, and Neon query/connection metrics.

Use a quiet time and an isolated testing database when possible. A load run writes
a login audit/session and creates then soft-deletes a test game. Do not point this
at an event currently in progress. Heroku's single Basic dyno and current setup
should be tested at one instance; adding dynos would require the app's Socket.IO
adapter/routing to be changed first.

The API limits login attempts to 15 per IP per minute, so this script logs in once
and shares that test session among its virtual users. It measures concurrent
authenticated state reads, not 100 separate sign-ins or 100 actual player
connections. A later test should use a pool of dedicated accounts and exercise
player joins, marks, and Socket.IO using a staging database.

## What to send back

Share the k6 summary plus the same-time Heroku and Neon graphs. Do not share the
password, session cookie, or full environment output.
