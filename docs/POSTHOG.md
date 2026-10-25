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

## Error tracking and source maps

Browser uncaught errors and unhandled rejections are captured once by the app's
central listeners. Unexpected API exceptions use the same privacy filtering.
Run `npm --prefix backend run posthog:verify:errors` to send one explicitly labeled
test exception through the actual backend integration and check HTTP acceptance.
Dashboard processing may take longer than the ingestion response.
For the local browser check described above, set `POSTHOG_VERIFY_ERRORS=true` to
also exercise both global browser exception listeners with intentional test errors.

Both apps support optional source-map uploads during their independent builds.
Set these **private build variables** on Vercel and Render/Heroku:

| Variable | Value |
| --- | --- |
| `POSTHOG_CLI_API_KEY` | Personal key with error tracking write and organization read scopes |
| `POSTHOG_CLI_PROJECT_ID` | `687005` |
| `POSTHOG_CLI_HOST` | `https://us.posthog.com` (EU: `https://eu.posthog.com`) |
| `POSTHOG_RELEASE_VERSION` | Optional commit SHA override; deployment commit variables are used when available |

Never put the private upload key in a `VITE_` variable. It is distinct from the
public runtime project token. With the key unset, normal builds skip uploads.
With it set, failed uploads fail the build so an unverified artifact is not
deployed. Source maps are deleted after successful upload; the deployed JavaScript
retains PostHog's chunk identifiers. Releases are named `tambola-web` and
`tambola-api`. Check the project's Error Tracking symbol sets after deployment.
Heroku installs the CLI only during build, before pruning development packages.

The wizard can display a browser success page before exchanging the OAuth code.
If its log reports `invalid_grant`, that wizard run did not authenticate even if
the browser says login is complete. The SDK setup does not depend on wizard OAuth.

See PostHog's [Vite source maps](https://posthog.com/docs/error-tracking/upload-source-maps/vite)
and [Node source maps](https://posthog.com/docs/error-tracking/upload-source-maps/node).

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
