# k6 game load test

`game-read.js` signs in a Super Admin host plus dedicated participant accounts,
joins them to a temporary game, starts it, and measures authenticated game-state
polling from distinct sessions. The game is soft-deleted after the run. It tests
HTTP polling, not Socket.IO connections or browser rendering.

## Prepare the accounts

1. Sign in as Super Admin on the app and open **Load test setup** from the public
   landing page, Super Admin dashboard, or admin navigation.
2. Select **Create / reset accounts** and save the one-time generated password.
   The account IDs are `tt-load-user0001` through `tt-load-user0100`. Resetting
   rotates the shared password and revokes those accounts' existing sessions.
3. Install k6 on Windows if needed:

   ```powershell
   winget install k6 --source winget
   k6 version
   ```

## Start with a smoke run

Use the **backend's HTTPS origin** for `BASE_URL` so Vercel caching/proxying does
not hide backend latency. Use a test Super Admin account, not a personal admin
login. The API has a 15-login-per-minute limit; setup spaces account sign-ins to
stay below it. The 100-VU setup phase takes around seven minutes.

```powershell
$env:BASE_URL = 'https://YOUR-BACKEND-ORIGIN'
$env:FRONTEND_ORIGIN = 'https://YOUR-FRONTEND-ORIGIN'
$env:ADMIN_LOGIN = 'your-super-admin-email'
$env:ADMIN_PASSWORD = Read-Host 'Super Admin password' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:LOAD_TEST_PASSWORD = Read-Host 'Generated load-test password' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:MAX_VUS = '10'
k6 run .\loadtest\k6\game-read.js
```

The script creates a host plus up to `MAX_VUS - 1` participant seats. At 100
virtual users, the host occupies one seat and 99 dedicated participants occupy
the rest of the game's 100 seats. The 100th generated participant is spare.

## Increase gradually

After a successful smoke run, test maximums `10`, `15`, `20`, `50`, and `100`, in
that order. Each run ramps through earlier checkpoints and holds at its selected
maximum for one minute. Each VU polls game updates roughly once per second. Watch
k6's p95 duration and failures, along with backend CPU/memory and request logs,
and Neon query/connection metrics.

The run creates login/session and game audit records, joins 99 accounts at most,
and soft-deletes its temporary game. Use an isolated testing database and a quiet
time; do not run against an event in progress. The Super Admin page's **Disable
accounts** action suspends the dedicated users and revokes their sessions when
you finish. Heroku's single Basic dyno and current deployment should be tested
at one instance; adding dynos would require the Socket.IO adapter/routing to be
changed first.

If the process is interrupted, the temporary game may remain in the admin game
list. Remove the game named `k6 Load Test` from there. Do not share passwords,
session cookies, or full environment output when reporting the k6 summary.
