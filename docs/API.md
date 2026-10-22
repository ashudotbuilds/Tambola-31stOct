# API and live events

The API and Socket.IO share one origin. Paths below are relative to that origin.
POST/PUT/PATCH bodies use `Content-Type: application/json`.

## Sessions

`POST /api/games` returns a host session containing `game_id`, `code`, `player_id`,
`display_name`, `player_token`, and `host_token`.
`POST /api/games/join` returns the same fields except `host_token`.

Use the appropriate token as `Authorization: Bearer <token>`. Host mutations use
`host_token`; private state, marks, and claims use `player_token`. The tokens
are 64-character random hex strings. They are hashed at rest, never query params.

The frontend retains these sessions in localStorage. There is no account,
password reset, or session recovery after the issuing browser's storage is cleared.
Host and player sessions can coexist on a device for local development.

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

Errors use `{ ok: false, error: string }` with HTTP 400 for validation, 401 for
missing/invalid sessions, 403 for host-only operations, 404 for missing games,
409 for lifecycle/rule conflicts, and 429 for rate limiting. Internal failures
return a generic HTTP 500 response. Tokens and SQL parameters are not logged.

A judged claim returns HTTP 200 with `ok: true`, `accepted`, `status`, `reason`,
and `points`. Wrong claims also include `penalty`, `cut`, `score`, and
`wrong_claims`. A lost valid race returns a rejection with no penalty. Operations
such as claiming after the game ends return a lifecycle error instead.

## Socket.IO

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
