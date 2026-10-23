# PRD implementation decisions

The product owner authorized implementation of `PRD.md` in this task. These
defaults resolve open decisions where the repository instructions already give a
direction. They are implementation assumptions, not evidence that every release
gate has passed.

| PRD decision | Working choice | Basis |
| --- | --- | --- |
| D-01 claim eligibility | Keep POC eligibility: saved manual marks intersected with official calls. | Preserve existing game behavior. |
| D-02 patterns, scores and penalties | Keep Early Five, Four Corners, lines, Full House, Second Full House, points, penalties and cuts. | Preserve existing game behavior. |
| D-03 completion | Keep the existing Full House closing and additional-call completion flow. | Preserve existing game behavior pending event-operator review. |
| D-04 answer reveal | Keep host-controlled question/reveal behavior. New APIs must enforce reveal eligibility server-side. | Existing gameplay and no client-side secrecy boundary. |
| D-05 sessions | Use random opaque sessions stored as hashes and issued only in HttpOnly cookies for account login. Use exact Origin checks for cookie-authenticated mutations. | Supports revocation directly and avoids exposing credentials to frontend JavaScript. |
| D-06 keys and ticket values | Preserve existing technical terms, including punctuation. Assigned players may see their own ticket values; unpublished mappings and future draw order stay private. | Compatibility with the existing bank and proposed visibility interpretation. |
| D-07 recovery | Keep recovery restricted to Super Admin until an explicit Admin recovery policy exists. | Least privilege; recovery endpoint is exposed under the Super Admin API and validates state before recovery. |
| D-08 winner ties | Preserve transaction lock order and first accepted claim behavior until product specifies a queue or simultaneous tie policy. | Existing serialized claim path. |
| D-09 frontend/testing libraries | Keep React/Vite, existing styles and current Node test tooling. Add no state or UI framework without a demonstrated need. | Adapt to the project's existing stack. |
| D-10 AWS budget and recovery objectives | Defer AWS migration and cost commitments. Current deployment remains Vercel, Render and Neon until the user requests the AWS transition and confirms operating constraints. | `AGENTS.md` and PRD §18. |

## Implementation status (October 22, 2026)

The following implementation foundations are present in the working tree:

- Account authentication, cookie sessions, role checks, Admin management,
  participant/event administration, credential delivery adapter, and delivery
  status tracking.
- Sequential event rounds, keys/questions, patterns, persistent tickets,
  draws/reveals, server-side marks and claims, verification/capacity, scoring,
  penalties/cuts, public state, and recovery controls.
- Operations dashboard, audit API, safe system diagnostics, request IDs,
  idempotency records, and Socket.IO invalidations.

Presence in source is not acceptance evidence. The following PRD gates remain
unverified or incomplete: separate-connection PostgreSQL concurrency tests,
frontend reconnect/accessibility and mobile verification, 500-user load, actual
process restart and database restore drills, release configuration validation,
and operational owner/budget/rollback decisions. `backend/test/account-flow.test.ts`
now covers the primary account-to-winner path over HTTP and Socket.IO with an
isolated PGlite database and a fake HTTP email provider. It also checks event
ownership, public DTO redaction, idempotent mark/claim retries, and recovery
validation. It imports the bundled Express application built by the backend
production build. Its database is isolated PGlite, so it does not replace the
PRD's disposable real-PostgreSQL harness or separate-connection concurrency tests.
Migrations 003-010 have not been applied to the configured Neon branch in this work.
The explicit local demo starts a separate isolated database with all migrations.
See [local testing workflow](LOCAL-DEMO.md) for the ten accounts and entry flow.
The cloud migrations have not been
applied as part of this implementation work. Consequently the account API cannot
start against that database until those migrations are deliberately rolled out.
