# Gameplay and phone UI update — 25 October 2026

- Dark mode only, including devices that saved a light-mode preference.
- Lobby simulation uses a separate sample ticket, simulated clues, answer reveal, manual marking, and reset. Practice marks never reach the live ticket or API.
- Phones show nine rows and three columns. Top, Middle, and Bottom labels identify the original claim lines; canonical ticket data and claim rules remain unchanged. Desktop keeps nine columns and three rows.
- Player standings and rank are removed. Game status is prominent; connection status and “Built by MU-ACM Chapter” appear in the game footer.
- Claims have no eligibility highlights, automatic readiness banners, or progress counts. Players choose when to submit.
- Invalid claims preserve scores, marks, and cells, even in games with the old penalty setting. They create a rejected claim with zero points, increment the warning count, and notify the host through the committed game update and claim feed.
- Player question lists show the current batch, including answers once revealed. Drawing after all pending questions are revealed starts a fresh batch. The batch boundary persists in game settings across reconnects. Historical calls remain available to the host and for claim validation.
- Host Previous Question and Next Question review already-called questions locally. Reviewing does not undo calls or change the live player/projector question. Back to live returns to the latest call.

## Verification

- 22 isolated backend tests pass, including warning-only rejection with a nonzero score, unchanged marks, host visibility, and partial/full batch reveal transitions.
- Both application typechecks and production builds pass.
- Browser audit completes 90 calls with three independently authenticated players and all seven prizes, with no JavaScript errors.
- Login, administration, question bank, lobby, active player, and host screens have no horizontal overflow at 320, 360, 390, 768, and 1280 pixels.
- Screenshots and results: `artifacts/gameplay-update/` (local, ignored).
- Existing project card/button typography and colors were reused. 21st catalog Retro Button and 8bit Main Menu metadata informed consistency; no component dependencies were added.

No cloud database changes or deployments were performed. Run `npm run dev:demo` and `node scripts/audit-browser.mjs` for the browser audit. Optional `DEMO_PORT`, `AUDIT_WEB_URL`, `AUDIT_API_URL`, `AUDIT_OUTPUT`, and `PLAYWRIGHT_MODULE` settings support isolated local verification alongside an existing dev session.


## Click to show historical questions

Each host history row now has a clickable question and Show/Showing indicator. Selecting it displays that question on every player screen and the projector, persists across reconnects, and retains its original reveal state. Back to live clears the shared selection; the next new draw also clears it. This does not add another call, move the batch boundary, or change tickets/marks. The API validates that the question was called and restricts selection to the host.


## Readable game audits and deletion

- The global audit and each game’s Game audit link show actor names, email addresses, readable activity descriptions, and local timestamps with seconds. Search by name/email/game code, activity, dates, or review signals; pagination retains all filters.
- New audit entries snapshot the actor’s name/email. Migration 011 backfills older records from currently available accounts. Missing historical connection events cannot be reconstructed retroactively.
- Login/logout identity, game joins, connections, reconnects, disconnects, host actions, question calls, accepted claims (points and score), rejected claims (warning count), and deleted games are recorded. Actual requesting administrators are identified when another administrator’s game is managed.
- Review signals include failed logins, blocked authenticated actions, multiple game connections, and the third/subsequent incorrect claim. These are signals for human review, not cheating determinations. IP and browser information appear under Connection details when available. No tokens/hashes/passwords are returned in audit metadata.
- Game audits include game-specific records and associated users’ login/logout activity from game creation through deletion. The audit remains readable after deletion.
- Owners and Super Admins can delete games by typing the matching code. This soft deletion removes the game from listings and blocks state, joining, marks, claims and host-session restoration. Audit and supporting history remain in the database. Connected screens are notified after commit.
- Migration `011_audit_identity_and_game_deletion.sql` is applied to the production database. Existing applied migrations are unchanged. No production games were deleted during implementation.

Verification: 25 isolated backend tests pass, including identity snapshots, login/logout/reconnection visibility, review filters, pagination isolation, deletion authorization, active-room notification, and retained history. Browser checks cover readable game audit/filter/search pages and cancellation, typed confirmation, deletion, and retained audit. The 90-call game and all seven prizes remain covered.


## Local login recovery

The API on port 3001 was running against the Singapore production branch while migration 011 was pending. On 25 October 2026, migration 011 was verified with production data in a rolled-back transaction on recovery branch `recovery-before-audit-011-20261025` (`br-mute-salad-az318gh4`), preserving its original contents. The migration was then applied with the checksummed runner through the direct production endpoint. HTTP login, audit listing, game listing, and logout each returned 200. Startup and readiness now check the new columns so stale schemas cannot report ready.


## Compact phone ticket

Phone ticket cells are now 44px high, with all 27 cells visible together in a 504px card, including stable-height selected-term inspection. Terms use two lines in the grid with full accessible names and tap inspection. Phone claims use three compact columns, while game status and surrounding spacing are smaller. Question batches are collapsed below claims on phones and retain their original desktop placement. Desktop keeps nine columns and the established cell sizing.

Verified the full ticket at 320×568, 360×640, 390×844, and 430×932 without horizontal overflow; checked marking, batch expand/collapse, desktop nine-column layout, and zero browser errors. Screenshots/results are under `artifacts/audit/mobile-ticket/`. Run `scripts/audit-mobile-ticket.mjs` against the disposable demo API/frontend on ports 3011/5175. No database or scoring changes are part of this layout update.
