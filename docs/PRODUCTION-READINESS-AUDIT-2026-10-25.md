# Full-game production-readiness audit

**Date:** 25 October 2026
**Environment:** isolated local demo API (ephemeral test database) + Vite, not production
**Game:** X4BS2P
**Participants:** one super-admin, two admins (one host, one observer), four members

## Result

Completed one full game through the browser UI: 90/90 distinct questions, lobby/start, pause/resume, per-question reveal, batch reveal, showing an earlier question and returning live, wrong claim, accepted Early Five, full house, second house, reconnect, and game end. All four member screens reached the final state. No browser JavaScript errors or console errors were observed.

Wrong claim displayed a warning to the player and notified the host; score and ticket cells were not deducted. A second member saw Early Five become unavailable after it was won. A member whose browser went offline during a draw caught up after reconnect.

The extended browser checks also passed the practice-ticket simulator (marks stayed out of the real ticket), question-bank modal, super-admin/admin navigation and role restrictions, audit filters, participant CSV import, deletion confirmation with retained history, and direct page reloads. Across player/admin/audit pages, no horizontal overflow was found at 320, 360, 390, 768, or 1280 px. The phone ticket showed all 27 cells in its 3-column layout: 504 px total card height at 320–430 px widths; desktop used nine columns. Repository tests passed: 25/25.

## Measured interaction timings

Times are local browser click to visible UI change. They include the demo API, Socket.IO invalidation, a private game-state fetch, and browser render. They are not production-network measurements.

| Interaction | Sample | Median | 95th percentile | Slowest |
|---|---:|---:|---:|---:|
| Draw click → member sees question | 90 | 149 ms | 270 ms | 361 ms |
| Start/pause/resume click → member sees status | 3 | 199 ms | — | 267 ms |
| Wrong claim click → player warning and host notification | 1 | 279 ms | — | 279 ms |
| Valid claim click → confirmation | 1 | 182 ms | — | 182 ms |

The slowest draw took about 2.4× the median, but remained below 0.4 seconds locally. Four member sessions plus the host were connected; this is a functional check, not a capacity benchmark.

## Findings to address before calling it production-ready

1. **Ticket-mark saves are asynchronous and can lag behind rapid taps.** The ticket reflected 15 quick taps immediately, but the first server snapshot contained 10 saved marks. After retrying the five absent marks, all 15 were saved and the full-house claim succeeded. All observed mark requests returned HTTP 200 (median 13 ms, maximum 35 ms); the first snapshot likely raced queued writes. The save queue sends a whole marked-cell snapshot for every tap. A player who taps quickly and loses connectivity or leaves before the queue drains could be uncertain which marks persisted. The UI has no saved/pending indicator.
2. **Each live update refetches the full game for every connected screen.** `game_changed` causes each room client to fetch the complete game state; the hook also polls every 15 seconds. A state read performs several database queries, including the complete calls/claims lists and that member's ticket. As players and games grow, this multiplies database reads and payload size. Consider versioned/delta events or smaller state endpoints, and avoid redundant polling while the socket is healthy.
3. **Production latency is unverified.** The measured 149 ms median is on localhost with an ephemeral database. It excludes Singapore-to-user internet latency, Render/Neon wake-up, TLS/proxy behavior, production contention, and real phones. Do not use these numbers as a production SLA.
4. **Load and failure coverage is limited.** Four members do not establish behavior with a large room or many concurrent games. The browser offline toggle tested a short disconnect and catch-up, not extended packet loss, rapidly flapping connectivity, a Render restart, Neon unavailability, or concurrent claims at scale.
5. **Audit growth still needs an operating policy.** Actions and connection events are written to PostgreSQL. The game-specific audit lookup is indexed and paginated, but this run did not measure write/read behavior at long retention or high event volume. Define retention/archival and watch database storage, query latency, and connection/pool saturation.

## Suggested next improvements

- Batch/debounce mark persistence or use a compact idempotent mark mutation, expose pending/saved/offline state, and retry unsaved marks on reconnect. Keep claim submission waiting for the last confirmed save.
- Send small public game-version/call/status invalidations and fetch only data that changed; retain private ticket reads behind authenticated player requests. Poll less frequently (or only during a degraded socket connection).
- Add production-like load tests for 25/100/500 connected members and multiple simultaneous games; record p50/p95/p99 for draw-to-screen, claim-to-result, API/database time, socket recovery, and error rate.
- Run a real-phone/network profile with 150–500 ms RTT, packet loss, a 10–30 second outage, and reconnect during a draw/claim. Verify the visible connection and mark-save state.
- Add an audit retention/archive policy and alerting for Neon compute/storage, slow queries, pool waits, and Render restarts.

## Scope limits

This confirms games and admin flows in the isolated demo only. It does not certify production deployment, large-room performance, external payment/credential email delivery, extended outages, data recovery, or production monitoring/alerting. No product code was changed during this audit; `scripts/audit-full-game.mjs` runs the full browser match and measures click-to-screen latency.
