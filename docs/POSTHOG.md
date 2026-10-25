# PostHog integration

The browser sends manual page views, unexpected errors, slow/failed API requests,
room connection/reconnection events, and ticket-save problems. The backend sends
request logs through OpenTelemetry to PostHog Logs, unexpected errors to Error
Tracking, and successful game actions to Product Analytics. Official audit rows
remain in PostgreSQL with their existing transactions and retention.

## Configure the project

Get the **project token** (`phc_...`) and ingestion host from PostHog Project Settings.
Use the same project and region in both deployments. A personal `phx_` key is not
needed for application telemetry and must never be used in a browser variable.

| Location | Variables |
| --- | --- |
| Vercel frontend build | `VITE_POSTHOG_PROJECT_KEY`, `VITE_POSTHOG_HOST` |
| Render backend runtime | `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` |
| Local frontend | Same Vite variables in `frontend/.env.local` |
| Local backend | Same backend variables in `backend/.env` |

Host: `https://us.i.posthog.com` for US, or `https://eu.i.posthog.com` for EU.
The default host is US. Leave the token unset to disable telemetry. Redeploy the
frontend after changing Vite variables because they are embedded during the build.
Restart/redeploy the backend after changing its runtime configuration.

## Verify delivery

1. Open the configured website and navigate between pages. PostHog's Web Analytics
   installation screen should detect `$pageview` events after ingestion.
2. Sign in and use a dedicated test game. `game_action_completed` events identify
   the authenticated account by its existing user ID and include the game ID.
3. Inspect Logs for `service.name = tambola-api`. Request logs include method,
   normalized route, status, duration, request ID, and authenticated user/game ID
   where available. Claim outcomes include the pattern, accepted flag, and points.
4. Reconnect a test browser to check room events. An unavailable PostHog endpoint
   must not block login, saving marks, calling questions, or claiming prizes.

Local delivery checks: `npm --prefix backend run posthog:verify` sends one explicit
installation log. Start a dedicated local Vite instance with environment variable
`VITE_POSTHOG_VERIFY_AUTOMATION=true` and set `AUDIT_WEB_URL` to that instance's URL.
`node scripts/verify-posthog-browser.mjs` checks the page-view ingestion response
(requires Playwright or `PLAYWRIGHT_MODULE`). The verification setting only works
in development and allows the automated browser through the SDK bot filter;
production always retains bot filtering. These checks confirm HTTP
acceptance; dashboard visibility can follow after ingestion processing.

Successful fast GETs and health checks are excluded from backend logs. Mutations,
failed requests, and requests taking at least one second are logged. Both exports
use bounded background batches; they are diagnostic copies, not durable audit
storage. The backend flushes its queues during graceful shutdown.

## Privacy and MCP

Autocapture, session recording, surveys, and automatic feature-flag polling are
disabled. Only explicit application events are collected. No request/response
bodies, cookie/header values, passwords, bearer credentials, private tickets,
marked-cell arrays, or question-bank contents are intentionally sent. Shared
scrubbing also removes common credentials and email addresses from errors and
strips query strings from captured page URLs. User identification sends ID and
role, not names or emails. Logout resets browser identity.

`npx @posthog/wizard mcp add` configures supported coding clients; it does not add
the website SDK or populate deployment environment variables. The app setup
command is `npx -y @posthog/wizard@latest`. MCP authentication is separate from
the project token used above. No MCP credentials belong in Git.

References: [browser SDK](https://posthog.com/docs/libraries/js),
[Node SDK](https://posthog.com/docs/libraries/node),
[Node logs](https://posthog.com/docs/logs/installation/nodejs).
