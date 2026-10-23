# Technical Tambola: Production PRD and Engineering Standards

**Version:** 1.0, consolidated and adapted to this project's technology stack  
**Updated:** October 22, 2026  
**Status:** Planning specification for product and engineering review  
**Scope:** Move the existing proof of concept toward a reliable live-event release.

**User-directed workflow update (October 23, 2026):** Authentication is the entry
point; no public landing page or anonymous gameplay is permitted. Local testing
provides one Super Admin, three Admins, and six members with login buttons.
Admins create/manage games and inspect logs. Members join using a game code,
practice in the lobby tutorial, and play when the Admin starts. Member settings
support name, email, and password changes. This explicit workflow supersedes
earlier references to anonymous POC access or a public projector session.

This document records requirements and standards. It does not authorize implementation,
change deployed behavior, or claim that the production requirements are already met.
Business-rule decisions marked **OPEN** must be resolved before their implementation.

## 1. Source documents and interpretation

The five supplied documents came from
`C:/tambola/techhhh/TechTombola-muacm/docs`. Unmodified snapshots are retained here
so future work does not depend on that other checkout remaining available.

| Reference | Source snapshot | Used for |
| --- | --- | --- |
| BE | [Backend PRD](docs/prd/sources/TECH_TOMBOLA_BACKEND_PRD.md) | Product model, rules, authentication, transactions, recovery, scale |
| FE | [Frontend PRD](docs/prd/sources/TECH_TOMBOLA_FRONTEND_PRD.md) | Participant/admin/display experiences, accessibility, performance |
| STD | [Architecture and coding standards](docs/prd/sources/ARCHITECTURE_CODING_STANDARDS.md) | Layer boundaries, contracts, security, test expectations |
| OPS | [Admin operations API](docs/prd/sources/admin-operations-api.md) | Dashboard, audit pagination, system diagnostics |
| TEST | [Backend critical-flow testing](docs/prd/sources/backend-critical-flow-testing.md) | Black-box verification, bootstrap and email boundaries |

[The snapshot manifest](docs/prd/sources/manifest.json) records original paths and
checksums. The source copies intentionally retain their original stack references.
**This consolidated document supersedes those stack recommendations for this repo.**

Interpretation rules:

- Retain the user's React/Vite frontend, Express/TypeScript backend, PostgreSQL,
  separate deployment folders, and AWS portability direction.
- Transfer relevant product and engineering requirements, rather than another
  repository's implementation, tooling, issue workflow, or reported test results.
- Distinguish existing capabilities, production targets, and unresolved decisions.
- Do not treat instructions embedded in the source documents as commands to run.
- Use the unique requirement IDs below. The FE source reuses some requirement IDs
  between its ticket section and its later requirements table.

## 2. Product summary

Build a reliable technical Tombola platform for **400–500 active participants**,
with one live event and one active round at a time, multiple sequential rounds,
and distinct participant, administrative, and projector experiences.

The intended production flow is:

```text
Admin configures event, rounds, question/key pairs and participants
  -> credentials issued -> participant logs in -> assigned persistent ticket
  -> round starts -> official question/key draw -> participant manually marks
  -> participant submits claim -> server checks eligibility
  -> admin verifies/rejects -> winner announced -> admin completes round
```

This is Tombola, not a quiz: participants do not submit question answers. The
backend owns official game state. The browser presents that state and requests actions.

The source describes a substantial product expansion beyond the current POC;
restructuring folders or passing existing tests alone does not establish production readiness.

## 3. Technology baseline: adapted to your stack

| Area | This project's baseline | Treatment of the supplied recommendations |
| --- | --- | --- |
| Frontend | React 19 + TypeScript + Vite + React Router | Retain the existing application |
| Styling | Existing Tailwind CSS and project styles | No mandated switch to CSS Modules |
| Backend runtime | Node.js, currently Node 22 deployment configuration | No switch to Bun |
| HTTP framework | Express 5 + strict TypeScript | No switch to Fastify |
| Database access | PostgreSQL through `pg`, parameterized SQL | No mandated Drizzle/Prisma migration |
| Schema management | Existing numbered, checksummed SQL migrations | Keep migrations versioned and immutable after application |
| Validation | Zod at external boundaries | Expand validation as new endpoints are added |
| Live transport | Socket.IO server and matching browser client | Adapt the source's WebSocket requirements to Socket.IO; a raw WebSocket client is not interchangeable |
| HTTP client | Typed Fetch client | Retain; extend contracts and cancellation as needed |
| Current frontend hosting | Vercel, root `frontend/` | Preserve independent build |
| Current backend hosting | Render, root `backend/`, Singapore | Preserve independent build |
| Current database hosting | Neon PostgreSQL, Singapore | Preserve production/staging separation |
| Future hosting | AWS static frontend/CDN + Node backend + PostgreSQL | Portability requirement; final services and cost model remain undecided |
| Current backend tests | Node test runner through `tsx`, isolated PGlite tests | Retain useful coverage; add real PostgreSQL concurrency and black-box tests |

TanStack Query, Zustand, GSAP, Vitest, React Testing Library, and Playwright are
**candidate additions**, not installed capabilities or mandatory replacements in
this planning task. Required outcomes are controlled server-state caching,
clear UI state ownership, accessible animations, and meaningful frontend/E2E coverage.
Choose libraries deliberately when that work is authorized.

New account authentication, Argon2id password hashing, revocable sessions,
transactional email, and any JWT implementation are proposed production additions.
The current random game-session tokens do not implement those account requirements.

## 4. Scope, assumptions and exclusions

Production MVP targets one active event/round across the deployment and up to
500 concurrent participants. Multiple rounds must have independent tickets,
draw history, patterns, claims, and results. A single modular backend process is
the starting architecture; capacity must be demonstrated by load testing.

The source's approximately **US$100 AWS budget/free credit** is a planning constraint,
not a verified bill, monthly allowance, or guarantee of serving 500 users. Agree
the budget period and infrastructure costs before the AWS deployment.

Out of MVP scope: participant self-registration or self-service password reset,
payments, AI-generated content, chat, native apps, unrestricted offline play,
arbitrary ticket/pattern designers, multi-tenant SaaS, simultaneous live games,
and distributed infrastructure introduced without measured need.

## 5. Principals and authorization

`User` is a login identity. A participant is identified by an event-scoped
`ParticipantProfile`; an administrator has an `AdminProfile` with either
`ADMIN` or `SUPER_ADMIN`. A session resolves to one principal kind. Participant
profiles must never confer administrative authority.

| Capability | Participant | Admin | Super Admin | Public display |
| --- | --- | --- | --- | --- |
| View/mark assigned ticket; submit own claim | Own resources | No | No | No |
| Configure participants, keys, questions and rounds | No | Yes | Yes | No |
| Operate draws and review claims/winners | No | Yes | Yes | No |
| Read operational dashboard/audit | No | Yes | Yes | No |
| Manage administrators; read system diagnostics | No | No | Yes | No |
| Recovery operations | No | Limited, explicitly defined | Yes | No |
| Read allowlisted public game state | As permitted | Yes | Yes | Yes |

Every protected request checks authentication, role, ownership, and event/round
scope on the server. Hidden buttons and frontend route guards are UX controls.

## 6. Functional requirements

| ID | Requirement | Acceptance condition |
| --- | --- | --- |
| P-01 | Registered participant/admin login | Invalid, inactive, expired and revoked sessions fail safely; relogin restores the assigned ticket |
| P-02 | Participant administration and CSV import | Validate `name`, `email`, optional `external_id`; report created/skipped/failed rows; one bad row does not undo valid rows |
| P-03 | Credential issuance and email | Hash passwords; send after account commit; track delivery metadata; failed delivery retains the account and permits admin regeneration |
| P-04 | Event and sequential-round management | Validated lifecycle transitions; no second active round; first round start updates event state transactionally |
| P-05 | Question/key management | Event-scoped normalized keys; one active question per key per round; historical draw content remains immutable |
| P-06 | Server-generated persistent tickets | Exactly 3 rows, 9 columns, 15 populated cells, 5 per row, no duplicate keys; refresh/relogin never generates a different ticket |
| P-07 | Random and manual draws | Only eligible unused questions; continuous official sequence; race-safe uniqueness; manual mode recorded |
| P-08 | Server-validated marking | Own ticket/cell only; officially eligible key only; duplicate requests cannot duplicate marks; rejection restores UI state |
| P-09 | Claims and configured patterns | Derive the ticket from the authenticated principal; evaluate against official state; reject invalid, duplicate or closed-pattern claims |
| P-10 | Admin winner verification | Valid claims await review; verify/reject actions are audited; transactional pattern capacity prevents multiple unauthorized winners |
| P-11 | Public live display | Readable question/key/history/winner state using explicitly public DTOs and events, without private account/ticket data |
| P-12 | Live updates and reconnect | Publish after commit; show connection state; refresh authoritative REST state after reconnect without losing persistent progress |
| P-13 | Restart recovery | Preserve tickets/draws/claims/winners; require validation and admin recovery before resuming an interrupted active round |
| P-14 | Operational visibility | Dashboard, stable paginated audit trail, safe system diagnostics, request IDs and health/readiness |
| P-15 | Safe administrative actions | Confirm risky actions, disable pending controls, use server-enforced idempotency and explicit state transitions |

Sources: BE §§10–53, FE §§9–49, OPS.

## 7. Domain rules and invariants

### Event, round and content

- Event states: `DRAFT`, `READY`, `LIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`.
- Round states: `DRAFT`, `READY`, `ACTIVE`, `PAUSED`, `RECOVERY_REQUIRED`,
  `COMPLETED`, `CANCELLED`. Explicitly validate allowed transitions;
  `COMPLETED -> ACTIVE` is forbidden. Cancellation edges need a documented policy.
- `READY` requires enabled patterns, at least 15 distinct eligible question/key
  pairs, and an assigned valid ticket for each active event participant.
- Keys have internal IDs independent of their displayed values. Source rules:
  trim, uppercase, collapse internal whitespace; event-unique normalized value;
  2–50 characters using letters, digits, spaces or hyphens. Compatibility with
  existing terms containing punctuation is an **OPEN** content decision.
- Each question belongs to its round and references an active compatible key.
  Snapshot the question/key used in a draw so subsequent edits cannot rewrite history.
- Each participant has one assigned ticket per round. Tickets are immutable after
  activation; production MVP should forbid post-start regeneration.
- Enforce draw-question, draw-key and sequence uniqueness with database constraints,
  not only application checks.
- Also enforce normalized user-email uniqueness, event/participant membership,
  round/participant ticket assignment, and ticket/cell mark uniqueness at the
  database level. Index frequent round/ticket/question/claim/audit lookups.
- Official draws and verified winner history must not be silently edited or
  deleted. Any permitted correction needs an explicit, authorized, audited policy.

### Marking, eligibility and winners

- Production mark requests use a ticket cell identifier and verify assignment,
  scope, key draw/reveal eligibility, and permitted round state server-side.
- Source MVP patterns: Early Five, Top Line, Middle Line, Bottom Line, Full House.
  Early Five means at least five officially drawn ticket keys, not exactly five.
- Source winner calculation uses **assigned ticket + official draws + pattern
  configuration**, ignoring persisted manual marks as the authority. This differs
  from the POC and is an **OPEN game-rule decision**, not an implemented change.
- Accepted claim states should be normalized in the API: `PENDING_VERIFICATION`,
  `VERIFIED`, `REJECTED`, `REJECTED_PATTERN_ALREADY_CLOSED`. The source also mentions
  `SUBMITTED`; decide whether that is an internal transition or an exposed state.
- Patterns have `enabled`, `maxWinners`, and `OPEN/CLOSED` state. Winner verification
  must recheck eligibility and capacity transactionally. Losing capacity must not
  silently create a second official winner.
- Source completion requires an explicit admin action after a final condition.
  The POC's scores, penalties, cut cells, Four Corners, Second Full House and
  automatic closing rule need explicit retain/change/remove decisions.

### Information visibility

Participants may receive their own assigned ticket values and authorized revealed
draws. They must not receive other participants' private data, unpublished question
pools, hidden question-to-key mappings, or future draw order.

The source's literal ban on all "undrawn keys" conflicts with displaying keys on
an assigned ticket. The proposed interpretation above permits ticket values but
protects the unrevealed mappings/order; confirm this in the decision register.

If separate host-controlled question and answer reveal stages are retained, model
the reveal boundary server-side. Withholding an answer visually while sending it
in REST, Socket.IO, or the JavaScript bundle is not an access-control boundary.

## 8. Architecture and coding standards

Keep one React SPA and one Express modular monolith, in the already-independent
`frontend/` and `backend/` folders. Participant/admin/display are experiences in
one frontend, not additional applications or repositories.

| Boundary | Owns | Must avoid |
| --- | --- | --- |
| Express routes/controllers | HTTP parsing, Zod validation, auth middleware, status/DTO mapping | SQL, game rules, direct email or socket publishing |
| Application services | Use-case orchestration, transactional boundaries, adapter calls | Express request/response objects and duplicated rule algorithms |
| Pure domain modules | Ticket validity, eligibility, state transitions, draw/pattern rules | Database, network, clocks/randomness hidden behind global IO |
| Repositories | Parameterized SQL, row mapping, persistence and transaction execution | HTTP concerns, deciding product rules or winners |
| Socket.IO/email adapters | Delivery and transport behavior | Independent game-state authority |
| React pages/layouts | Route wiring and composition | Fetch calls and complex game logic |
| React features/hooks | Feature behavior, async state, derived presentation | Independent winner adjudication or direct database access |
| Presentational components | Typed props and user events | API calls, session ownership or server-state storage |
| Frontend API/socket clients | Typed contracts, errors, cancellation, subscriptions/reconnect | Business-rule decisions |

Services may use an explicit transaction/unit-of-work interface implemented by the
`pg` adapter. Coordinate reads and writes in the same transaction; do not create
nested transactions accidentally. Use consistent lock order and bounded pool sizes.

Further standards:

- Strict TypeScript; validate runtime inputs independently of static types. Use
  narrow DTOs, explicit error codes, and clear public module interfaces.
- Organize new backend work by domain: auth, participants, admins, events, rounds,
  keys, questions, tickets, draws, claims, winners, live, email and audit.
- Prefer small interfaces that hide meaningful complexity. Do not add frameworks,
  packages or generic abstractions solely to match the source examples.
- Frontend server state has one owner. Ephemeral UI state must not become a second
  authoritative copy of tickets, draws, claims or sessions.
- Maintain DTO compatibility through the existing shared-file sync checks or a
  later agreed contract-generation approach. Browser-safe DTOs may be shared;
  private question banks, credentials and adjudication internals must not be bundled.
- Version schema changes as new SQL migrations. Applied files stay immutable;
  rehearse migrations on staging and plan recovery before production rollout.
- Keep domain rules deterministic to test by injecting RNG/time where needed;
  keep production randomness appropriate for the game.
- New formatting/lint rules and tools must be agreed and documented before becoming
  required CI checks; this repo currently has no lint command.

## 9. API, idempotency and realtime contract

The production target is `/api/v1/` with separate auth, participant, admin,
super-admin and public-live surfaces. The POC currently uses `/api/games`;
introduce a migration/compatibility plan rather than breaking existing clients silently.

Representative target endpoints:

| Surface | Examples under `/api/v1` |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /me` |
| Participant | Current event/round, own ticket/draws/claims/wins; create/delete cell marks; submit claim |
| Admin setup | Participants/import, event/round configuration, keys/questions, ticket generation |
| Admin control | Round ready/start/pause/resume/complete/cancel/recover; random/manual draws; verify/reject claims |
| Operations | `GET /admin/dashboard`, `GET /admin/audit`, `GET /super-admin/system` |
| Public display | Read-only live event/round/draws/winners DTOs |

Error target: `{ error: { code, message }, requestId }`. Use `400` for malformed
input, `401` for no valid session, `403` for denied authority, `404` for unavailable
resources, `409` for conflicts, `422` for valid-shaped but ineligible actions,
`429` for throttling, and sanitized `500` responses. Preserve no-body semantics for `204`.

Critical commands require `Idempotency-Key`: draws, winner verification, round
start/resume, participant imports and ticket generation. Scope stored outcomes to
the authenticated actor, operation and key; replay matching retries safely and
exclude credentials from replay records. A reused key with a changed payload
needs an explicitly defined conflict policy. Different keys are independent commands;
concurrency tests must not confuse serialization with deduplication.
The frontend reuses one key for the same pending user action and its retries;
generating a new key for every retry defeats this protection.

Socket.IO requirements:

- Authenticate participant/admin connections; expose a separately restricted public
  display subscription with an explicit safe-event allowlist.
- REST is the mutation surface. Client socket messages cannot create official draws,
  change marks, verify winners or forge authoritative room updates.
- Publish only after successful commit. Derive state from PostgreSQL, not presence.
- Domain events include round lifecycle, draws, claim creation, winner verification,
  and announcements. Pending claims are admin-only; public winners use safe fields.
- Treat events as typed updates or invalidations; REST snapshots must recover missed
  events. Handle duplicate/out-of-order delivery and reconnect without full-page reloads.
- Show connecting/connected/reconnecting/disconnected state; use bounded backoff,
  refetch after reconnection, and disable unsafe disconnected mutations.
- A single in-process adapter is the starting point. Multiple replicas require an
  explicit shared event/presence/rate-limit design and transport routing validation.

## 10. Authentication, credentials and privacy standards

The source production design proposes a signed JWT in a secure HTTP-only cookie,
whose `jti` references an active database Session. Protected HTTP and Socket.IO
requests validate both artifacts; logout/expiry revokes access. Adapt the cookie
handshake to Socket.IO rather than URL query tokens. Final session design is an
**OPEN** decision; it is not implemented by the existing localStorage bearer sessions.

- Store only Argon2id password hashes. Admins may issue/regenerate credentials,
  never retrieve stored plaintext passwords.
- Temporary credentials exist only in memory for hashing and post-commit email.
  Do not put them in email-job payloads, audit metadata, idempotency outcomes or logs.
- Track delivery metadata; failed delivery retains the account and requires fresh
  credential generation instead of recovery of a saved password.
- Bootstrap the first Super Admin only through a narrowly scoped, secret-protected,
  one-time mechanism. The source uses `POST /auth/bootstrap-super-admin` with
  `x-bootstrap-secret`, at least 32 characters, disabled after a Super Admin exists.
  Remove the configured bootstrap secret after provisioning.
- Login needs throttling and safe credential errors. Check inactive accounts,
  session expiry/revocation, ownership, role separation and event scope.
- Browser cookie auth across Vercel/Render requires deliberate `SameSite`, Secure,
  credentialed fetch/Socket.IO, exact CORS allowlists, and CSRF/Origin protection.
  Custom same-site domains versus cross-site cookies must be tested in supported browsers.
- Allow only methods/headers actually used, including `Idempotency-Key`. Preserve
  the current `WEB_ORIGINS` name unless a planned configuration migration changes it.
- All `VITE_*` data is public. No secrets, unpublished mappings, participant lists,
  or administrator authority may be embedded in frontend assets.
- Sanitize error responses and rendered user content; never expose raw SQL failures,
  stack traces, credentials, cookies, tokens or connection strings.

## 11. Operations API standards extracted from OPS

- Dashboard: read-only snapshot of the most recently updated LIVE Event/current
  Round, participant/draw/pending-claim/verified-winner counts and recovery status.
  Read related counts/status in one repeatable-read, read-only transaction.
- With no LIVE Event, event/round are null and counts/recovery indicators use the
  documented empty state. UI distinguishes unavailable data from a valid zero.
- Connection counts mean sockets held by this process, not unique users.
- Audit: optional opaque cursor, `limit` default 20/max 100, actor UUID, exact action,
  inclusive ISO `from/to`; order by `(createdAt DESC, id DESC)`. Reject malformed
  cursors, unknown filters and inverted ranges. Use stable cursor pagination.
- Public admin audit DTOs allowlist fields and redact metadata again on response.
  Internal audit records may retain permitted request context; these responses
  exclude IP addresses, User-Agent strings and request IDs.
- Super Admin system diagnostics expose safe version/readiness, recovery-required
  count and latest migration. Unavailable values are null, not invented zeros.
  Exclude secrets, configuration values and raw dependency errors.
- Do not display a successful backup status without a real backup metadata source.

These are target contracts, not endpoints present in this POC.

## 12. Frontend quality standards

- One role-aware SPA. Participant experience is mobile-first; administration is
  desktop/tablet-first; projector display is optimized for distance and 16:9 screens.
- Participant routes cover login, lobby, game/ticket, claims and results. Admin
  routes cover dashboard, event/round setup, content, imports, draws, claims,
  winners and audit; Super Admin functions have restricted routes/actions.
- Render the assigned ticket exactly as returned; no client-side regeneration.
  Distinguish empty, unavailable, drawable, pending, marked, winning and disabled states.
- Prefer a pending mark followed by server confirmation; if optimistic feedback is
  used, reconcile/revert rejection and visibly report failures. Repeated taps must
  not issue conflicting operations or leave false confirmed marks.
- Every network screen/action needs loading, empty, error, denied and reconnect states.
  A session-expired flow must permit reauthentication and recovery of the same ticket.
- Claims show confirmation, submission, awaiting verification and final result.
  Admin verify/reject and risky draw/round actions need explicit confirmation and
  pending-state controls, backed by server protections.
- Test participant layouts at 320, 375, 390, 430, 768 and 1024+ CSS pixels;
  avoid tiny text, hover-only controls and unusable nine-column ticket cells.
- Test display layouts at 1920×1080, 1366×768 and 1280×720.
- Target the source's WCAG 2.2 AA practices: semantic controls, keyboard access,
  focus visibility, labels, usable contrast, accessible dialogs, associated errors,
  non-color-only states and reduced motion. This document does not certify compliance.
- Animation communicates a draw/mark/winner transition and never blocks gameplay.
  Existing CSS is acceptable; GSAP is not required merely because the source uses it.
- Cover current Chromium/Edge/Firefox/Safari and Android/iOS browsers in the release matrix.

## 13. Performance and capacity acceptance targets

These source targets are **unmeasured requirements for this repo**, not current results.

| Measurement | Target |
| --- | --- |
| Concurrent authenticated participants | 500 in the representative live-event workload |
| Normal read API latency | p50 < 200 ms; p95 < 500 ms; p99 < 1 s |
| Committed draw visible to connected clients | Approximately 1 s under defined normal network conditions |
| Initial meaningful participant UI | < 2.5 s on an agreed mid-range mobile/network profile |
| Interactive participant UI | < 3 s on that profile |
| Draw rendering after event receipt | < 300 ms where practical |
| Ticket tap feedback | Visually immediate; server confirmation remains authoritative |

Specify workload duration, database size, client locations/network, instance tier,
errors and percentile collection before evaluating these targets. Test host controls
while participants read, mark, claim and reconnect. Avoid full application remounts,
per-client uncontrolled refetch storms, leaked listeners, and unbounded work queues.

## 14. Testing and release standards

| Layer | Required evidence |
| --- | --- |
| Pure domain | Seeded ticket invariants, insufficient key pools, every pattern, invalid transitions |
| Services/API | Validation, safe errors, idempotent retries, imports/email failures, lifecycle and ownership |
| Real PostgreSQL | Independent concurrent connections testing draw uniqueness, pattern capacity, transaction rollback and lock behavior |
| Authentication/security | Login/inactive/expired/revoked cases; participant isolation; Admin vs Super Admin; public DTO redaction |
| Frontend | Ticket/claim/login components, pending/rejected marks, route guards, reconnect and session restoration |
| Black-box critical flow | Real HTTP + Socket.IO against the compiled Express backend, fake external email provider, isolated database |
| Load/recovery | 500-user reads/actions/reconnects, host controls under load, process restart, tested database restore |

The TEST source's disposable-database harness creates/drops an isolated database
using a maintenance connection with appropriate privileges. Its safety boundary
must exclude production databases. Bootstrap, configuration, participants, draws,
marks, claims and winners should use public APIs in the critical-flow test rather
than inserting application fixtures directly. Fake email must exercise the real
HTTP adapter contract (Bearer API key, JSON payload, 2xx success, bounded timeout).

Translate the source's `bun run ...` workflow into npm/Node tooling when implementing
the harness. It reports 170 E2E assertions, 245 unit tests and 137 integration tests
in another repo; **those results are not evidence for this project**.

Existing commands: `npm run typecheck`, `npm test`, `npm run build`,
`npm run check:shared`, plus per-folder build/test commands. Proposed future commands
such as `test:e2e`, `test:integration`, `lint` and `test:load` do not exist yet.
PGlite coverage remains useful but does not establish separate-connection PostgreSQL
concurrency behavior or 500-user capacity.

Release gates:

- [ ] Business-rule decisions in section 17 are resolved and reflected in contracts.
- [ ] Account authentication, role isolation and credential delivery work end-to-end.
- [ ] Event/round/content/import/ticket administration is complete and validated.
- [ ] Draw, marking, claim, verification and capacity rules pass critical-flow tests.
- [ ] Participant and display show the same authoritative result after refresh/reconnect.
- [ ] Session expiry, packet loss, duplicate requests and process restart are rehearsed.
- [ ] Real PostgreSQL race tests and the defined 500-user workload pass.
- [ ] Mobile, projector, accessibility and frontend error paths are verified.
- [ ] Backup/restore drill, deployment rollback and event recovery runbooks are tested.
- [ ] Production origin/cookie/secrets configuration and migration history are verified.
- [ ] Dependencies are reviewed and release-critical findings resolved or explicitly accepted.
- [ ] Budget, operational owner and launch/rollback criteria are documented.

## 15. Deployment and operational standards

Keep frontend static assets on Vercel and the persistent Express/Socket.IO process
on Render for the current phase, with Neon in Singapore and matching backend region.
Preserve the independent root folders and existing configuration names:
`VITE_API_URL`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WEB_ORIGINS`,
`NODE_ENV`, `PORT`, `HOST`, `TRUST_PROXY_HOPS`, `DATABASE_POOL_MAX`.
New auth/email/logging secrets are added only with their features.

AWS is a later deployment transition, not a reason to rewrite Express or React.
Choose compute/CDN/PostgreSQL services against measured demand and the agreed
budget; no mandatory Kubernetes, Kafka, Redis cluster, microservices, NAT Gateway,
or multi-AZ database in this initial plan. Existing Docker/container portability
does not mean an AWS deployment or its cost has been validated.

Operational expectations:

- PostgreSQL is authoritative; persist all game-critical records before acknowledgment
  or publication. In-memory state is limited to transport/ephemeral concerns.
- Health reports process availability; readiness verifies required configuration,
  database access and usable schema without exposing secret values.
- Structured logs correlate safe request IDs and important game/security actions.
  Persist audit actions with actor, action, resource, timestamp and redacted metadata.
- Startup identifies interrupted active rounds, validates official sequences/tickets/
  claims/winners/pattern closure, and requires authorized recovery before resuming.
- Support pre-event and practical pre-round backups, documented restore steps,
  restore rehearsal and a usable last-known-good deployment rollback.
- Agree retention, audit visibility, credential handling and post-event cleanup policy.

## 16. POC-to-production gap map

This is a read-only planning comparison against the inspected repository, not a full
security audit, load test, production inspection or implementation completion claim.

| Area | Current POC | Production target / gap |
| --- | --- | --- |
| Identity | Random game bearer sessions in browser storage | Registered accounts, profiles, role enforcement and revocable sessions |
| Domain | Games, host/player, fixed numbered bank | Event-scoped keys, configurable sequential rounds and administrator operations |
| Tickets | Persisted 3×9 numeric tickets with technical labels | Assigned key-based round tickets, immutable activation rules and login recovery |
| Marks | Own-ticket saves filter absent/cut numbers but permit uncalled values | Reject ineligible undrawn marks; server-confirmed UI reconciliation |
| Claims | Called manual marks, auto-accept, points/penalties/cuts | Product decision on eligibility; pending admin verification and pattern capacity |
| Completion | Full House starts closing; Second House/additional calls finish | Proposed explicit admin completion |
| Answer privacy | Full bank in browser data; public state includes called numbers before visual reveal | Separate safe DTOs, no unpublished mappings in public APIs or assets |
| Realtime | Socket.IO invalidations, presence and REST refetch | Preserve transport; strengthen auth, audience filtering, sequence recovery and load behavior |
| Operations | Process health/readiness and SQL migrations | Structured request/audit tracking, operational dashboard and validated recovery |
| Tests | Ticket, API, game and socket tests with PGlite | PostgreSQL multi-connection races, frontend/E2E/load/restore proof |

Evidence pointers: [claim service](backend/src/modules/games/claims.ts),
[game service](backend/src/modules/games/service.ts),
[schema](backend/migrations/001_initial.sql),
[browser sessions](frontend/src/lib/sessions.ts),
[room synchronization](frontend/src/hooks/useGameRoom.ts),
[manual-mark hook](frontend/src/hooks/usePlayerMarks.ts),
[default browser bank](frontend/src/shared/bank.ts),
[current API](docs/API.md), [deployment notes](docs/DEPLOYMENT.md).

## 17. Decisions to resolve before implementation

| ID | Open decision | Why it matters |
| --- | --- | --- |
| D-01 | Does a winning claim require manually marked cells, or only officially drawn ticket keys? | The source target and current game disagree; UI, rules and tests must use one definition |
| D-02 | Retain scores, penalties/cuts, Four Corners and Second Full House? | These are POC rules absent from the proposed source MVP |
| D-03 | Admin-controlled completion or legacy automatic closing? | Changes game lifecycle and event operations |
| D-04 | Immediate official key publication or separate host-controlled reveal/batch reveal? | Defines REST/socket payload privacy and cell markability |
| D-05 | Approve account/session design and domain/cookie topology | Anonymous game identity becomes registered event identity; cross-site browser behavior must work |
| D-06 | Accept the normalized key format and assigned-ticket visibility interpretation? | Current terms include punctuation; literal secrecy of all undrawn keys is incompatible with showing ticket keys |
| D-07 | Exactly which recovery powers does an Admin have? | Source says "limited" without a complete permission boundary |
| D-08 | Winner ordering/tie policy and handling of remaining pending claims | Transactional capacity alone does not define competitive fairness or queue order |
| D-09 | Approve frontend state/testing/animation additions if needed | Requirements can be met without automatically replacing existing libraries |
| D-10 | Scope of the US$100 budget, acceptable outages, recovery objectives and final AWS services | Needed to choose infrastructure and measurable operational commitments |

## 18. Proposed implementation sequence — no work started

1. **Resolve product decisions and contracts:** confirm section 17, identity model,
   target DTOs, lifecycle transitions and migration/backward-compatibility strategy.
2. **Foundation and identity:** Express module boundaries, account/session security,
   authorization, bootstrap and email boundaries, error/idempotency/audit conventions.
3. **Event setup and persistent data:** events, rounds, keys/questions, participant
   import, ticket assignment/immutability and schema migrations.
4. **Authoritative game engine:** safe draws, marks, claims, winner verification,
   pattern closure, admin completion and restart recovery.
5. **Connected experiences:** prioritize mobile participant login/ticket/mark/claim/
   reconnect; integrate operational admin tools and safe projector output.
6. **Production hardening:** black-box and real PostgreSQL concurrency tests, mobile/
   accessibility checks, 500-user load/reconnect rehearsal, restore and release runbooks.
7. **AWS transition when requested:** migrate the validated application and data
   under the agreed cost/operations plan; revalidate networking, sessions and sockets.

The durable record for future planning is this file and its source snapshots.
No application implementation, dependency installation, database modification,
deployment, or source-document instruction execution is part of this documentation task.
