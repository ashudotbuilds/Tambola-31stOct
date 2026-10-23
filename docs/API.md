# API and live events

The API and Socket.IO share one origin. Paths below are relative to that origin.
POST/PUT/PATCH bodies use `Content-Type: application/json`.

All game and display APIs now require an authenticated account cookie. Game
bearer tokens provide an additional game scope and do not replace account login.
Only Admins create games; members join with codes using their account names.
`GET /api/games` lists the same latest 100 games for Admins and Super Admins,
including `host_name` and an account-specific `can_manage` flag. Only the owner
or a Super Admin can restore or operate the host session. Other Admins can view
the public game board. The list is not cached, and
`POST /api/games/:id/session` restores an authorized Admin's host session.
`PATCH /api/v1/auth/profile` updates name/email/password after verifying
`currentPassword`; changing email preserves the login ID.

## Game sessions

`POST /api/games` returns a host session containing `game_id`, `code`, `player_id`,
`display_name`, `player_token`, and `host_token`.
`POST /api/games/join` returns the same fields except `host_token`.

Use the appropriate token as `Authorization: Bearer <token>`. Host mutations use
`host_token`; private state, marks, and claims use `player_token`. The tokens
are 64-character random hex strings. They are hashed at rest, never query params.

The existing `/api/games` proof-of-concept retains these sessions in localStorage.
They are separate from registered account sessions below. Host and player sessions
can coexist on a device for local development.

## Registered accounts and participants

The account API is rooted at `/api/v1`. Login issues an opaque `tt_session`
HttpOnly cookie; the JSON response never contains the raw token. Browser requests
include credentials. Mutations authenticated by this cookie must include the exact
allowed `Origin`. Cookie sessions are revocable and expire after seven days.

Bootstrap the first Super Admin once with `POST /api/v1/auth/bootstrap-super-admin`
and `x-bootstrap-secret`; bootstrap is disabled after a Super Admin exists. Do not
leave the bootstrap secret configured after provisioning. Login uses
`POST /api/v1/auth/login` with `{ email, password }`; inspect the current principal
with `GET /api/v1/auth/me`, and revoke the session with `POST /api/v1/auth/logout`.
Credential issuance creates a temporary password, sends it through the configured
HTTP email adapter, and stores only its password hash.

| Method | Path | Access | Body / result |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/bootstrap-super-admin` | One-time secret | `{ email, name, password }` |
| POST | `/api/v1/auth/login` | Public, rate limited | `{ email, password }` -> user/principal and HttpOnly cookie |
| GET | `/api/v1/auth/me` | Account session | Current user and participant/Admin principal |
| POST | `/api/v1/auth/logout` | Account session | Revokes current cookie session |
| GET/POST | `/api/v1/super-admin/admins` | Super Admin | List or create Admin `{ email, name, role }` |
| DELETE | `/api/v1/super-admin/admins/:id` | Super Admin | Delete another administrator |
| POST | `/api/v1/super-admin/admins/:id/credentials` | Super Admin | Issue a new temporary password by email |
| GET | `/api/v1/admin/participants` | Admin | All participants and credential delivery status |
| POST | `/api/v1/admin/participants/import` | Admin | CSV text or `{ rows: [...] }`; requires `Idempotency-Key` |
| POST | `/api/v1/admin/participants/:profileId/credentials` | Admin | Issue or regenerate credentials by email |
| GET | `/api/v1/admin/dashboard`, `/api/v1/admin/audit` | Admin | Operational snapshot and paginated audit |
| GET | `/api/v1/super-admin/system` | Super Admin | Safe readiness and migration diagnostics |

Participants are imported directly and join a game by code. There are no event
or round APIs. The server validates each game action against the authenticated
account, host ownership, ticket, called numbers, and saved manual marks. Claims
are validated automatically. Answer reveal never marks a ticket automatically.

CSV imports require an `Idempotency-Key` header of 8–128 letters, digits, dots,
underscores, tildes or hyphens. Replaying the same key and payload returns the
committed result; reusing the key for a different payload is rejected.

Errors from `/api/v1` use `{ ok:false, error:{ code, message }, requestId }`.
Validation, authentication, authorization, missing resources, conflicts and
ineligible game actions use stable codes; unexpected failures return a generic
message and never expose SQL errors or secrets.

## Endpoints

| Method | Path | Authorization | Body / result |
| --- | --- | --- | --- |
| GET | `/health` | None | Process health |
| GET | `/ready` | None | PostgreSQL/schema readiness |
| POST | `/api/games` | None | `{ hostName, bank? }` -> host session, settings, status |
| POST | `/api/games/join` | None | `{ code, name }` -> player session, settings, status |
| GET | `/api/games/code/:code` | None | Public game state |
| GET | `/api/games/:id` | Optional player token | Public state plus own `me` if authenticated |
| POST | `/api/games/:id/start` | Host | Starts lobby with at least one player |
| POST | `/api/games/:id/calls` | Host | Calls a random remaining number |
| PATCH | `/api/games/:id/status` | Host | `{ status: 'paused' \| 'playing' \| 'finished' }` |
| PUT | `/api/games/:id/reveals` | Host | `{ seqs: number[] }` sets revealed sequences |
| PUT | `/api/games/:id/bank` | Host | `{ bank: TechnicalItem[90] }` |
| PUT | `/api/games/:id/marks` | Player | `{ marked: number[] }` -> filtered saved marks |
| POST | `/api/games/:id/claims` | Player | `{ claim: ClaimType }` -> accepted/rejected result |

Names are trimmed, required, and limited to 24 characters. Names within one game
are unique without regard to case. Game codes contain six characters. Joining
is allowed only in the lobby; bearer authentication is scoped to the game ID.

`TechnicalItem` contains `id` (1-90), `term`, `clue`, `category`, and optional
`codeSnippet`. A bank contains all 90 IDs exactly once. The browser's importer
fills short lists from the original default bank before submitting them.

`ClaimType` is one of `early_five`, `four_corners`, `top_line`, `middle_line`,
`bottom_line`, `full_house`, and `second_full_house`.

Mark saves permit selecting and deselecting numbers from the player's own ticket,
including in the lobby tutorial. They filter duplicates, absent numbers, and cut
numbers. Claims count only officially called, manually marked, uncut numbers.
The host cannot mark or claim, and claims are disabled while paused or finished.

## Game state

Shared TypeScript definitions live in `backend/src/shared/types.ts`. The state
has `game_id`, `code`, `status`, `settings`, `players`, `calls`, `claims`, and `me`.
`me` is null for public requests. A player receives only their own ticket, marks,
and cuts. Host state contains an empty ticket because the host does not play.
No state response contains raw session tokens or database token hashes.

Call sequences and called numbers are unique within a game. Settings contain
the shared question bank and `revealed_seqs`. Calls are public, including before
a visual reveal; the reveal controls how the UI presents the answer.

## Errors and claim outcomes

Legacy `/api/games` errors use `{ ok: false, error: string }` with HTTP 400 for validation, 401 for
missing/invalid sessions, 403 for host-only operations, 404 for missing games,
409 for lifecycle/rule conflicts, and 429 for rate limiting. Internal failures
return a generic HTTP 500 response. Tokens and SQL parameters are not logged.

A judged claim returns HTTP 200 with `ok: true`, `accepted`, `status`, `reason`,
and `points`. Wrong claims also include `penalty`, `cut`, `score`, and
`wrong_claims`. A lost valid race returns a rejection with no penalty. Operations
such as claiming after the game ends return a lifecycle error instead.

## Socket.IO

Administrator dashboards connect with `auth: { channel: 'admin-dashboard' }`
and the account session cookie. Members cannot join this channel. After a game
change commits, the server emits a payload-free `dashboard_changed` invalidation.
Both dashboard pages refresh the shared catalogue and operations counters on
this event, room readiness, tab focus, and every 15 seconds as a fallback.

Connect with the normal Socket.IO path `/socket.io` and handshake authentication:

```ts
io(API_ORIGIN, {
  auth: { gameId, token: playerToken },
})
```

The projector omits `token`. The server validates the game and any supplied token
before admitting the socket. Origin checks apply to both HTTP and sockets.

| Server event | Payload | Client action |
| --- | --- | --- |
| `room_ready` | None | Fetch current state after room admission |
| `presence` | Number | Update the connected device count |
| `game_changed` | None | Fetch current state with the device's player token |

Each connection belongs to one `game:<id>` room. API writes publish invalidations
after committing. Private mark saves return to the requesting player without a
room broadcast. Reconnecting clients join again and fetch a fresh snapshot.
Presence counts connected sockets, not registered players.

There are no client mutation or broadcast handlers. All mutations use the
validated REST API; emitting a fake `game_changed` from a browser cannot change
game data or publish an authoritative room event.

The web hook also refreshes every 15 seconds and when a tab becomes visible.
This recovers missed events and API restarts without persisting socket presence.
