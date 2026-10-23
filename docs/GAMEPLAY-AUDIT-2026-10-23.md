# Gameplay and mobile audit — 23 October 2026

## Result

The local application passed a simulated full game with **one Super Admin, one
Admin, and three members**, each using an isolated Chromium browser context.
The existing account, event, and game implementation was preserved. This audit
does not certify the deployed Vercel/Render environment or physical phones.

## Research and rules

Traditional Tambola uses 15 entries in a 3×9 ticket, five per row, with unique
calls from 1–90. Common prizes are Early Five, the three lines, Four Corners,
and Full House. Prize selection, penalties, simultaneous claims, and additional
houses are event rules that should be explained before play.

- [Traditional Tambola rules and patterns](https://www.tambolagames.com/how-to-play.html)
- [IEEE's Tech in Tambola event](https://events.vtools.ieee.org/m/455885)
  describes technical answers replacing numbers and row-based wins.
- [PES Modern College's Tech Tambola](https://www.mpulsepesmcoe.com/events/ENTC-03)
  uses word tickets and riddles, with a different 4×4 layout.
- [Rajagiri's Circuit Tambola](https://www.rajagiritech.ac.in/home/newsevents/Event.asp?EID=616351615C)
  uses technical terms, components, formulas, and symbols.

Technical Tambola has event-specific variants rather than one universal ruleset.
The project's existing 90-item, clue-to-term version is consistent with that
format. No unrelated prize systems or ticket-swapping mechanics were added.

## Added

- Player question-and-answer history, including code snippets, so **every**
  revealed answer remains available after a batch reveal. Hidden answers show a
  waiting message until their own call is revealed.
- Transactional audit entries for game answer reveals, question-bank updates,
  accepted claims, and penalized rejected claims. Entries contain account IDs
  and safe action metadata, excluding game tokens and private tickets.
- Regression coverage for concurrent/stale reveal requests, all three players'
  reveal state, no automatic marking, invalid reveal sequences, and audit privacy.
- A repeatable browser audit in `scripts/audit-browser.mjs`, with screenshots,
  viewport checks, separate account contexts, and both game workflows.
- Keyboard focus indicators for ticket cells and reduced-motion support.

## Fixed

- **Previously revealed answers could become hidden again.** Reveal requests
  replaced the whole sequence list. They now merge with committed reveals under
  the game lock, preventing stale host tabs from undoing another reveal.
- **Projector answer exposure.** Its called-items panel displayed terms before
  the host revealed them. The panel and highlighted number grid now use revealed
  calls. This is presentation hiding; the existing game API still includes the
  bank and call numbers, as documented in README.
- **Host mobile overflow and blocked taps.** A grid child's intrinsic width
  expanded the console beyond narrow screens. Constraining the column fixes the
  page width and permits normal Pause/Resume taps.
- **Tiny event-round ticket cells.** Nine columns no longer compress into a
  phone's width. The ticket scrolls horizontally with readable text and larger
  cells, matching the existing game ticket approach.
- **Light-theme contrast.** Event ticket cells now have explicit light colors,
  and pale section headings use readable muted text.
- Ticket column-jump and fit-view controls now have 44px minimum touch heights.

## Removed

No screens, routes, themes, scoring rules, or gameplay features were removed.
Premature projector answer display and destructive replacement of reveal state
were removed as defective behaviors.

## Verified

| Check | Result |
| --- | --- |
| Existing tests plus regression | 18 passed |
| TypeScript, frontend and backend | Passed |
| Independent production builds and shared-contract check | Passed |
| Browser JavaScript errors during audited flows | None |
| 90-call game | 90 unique calls; all seven claim categories accepted; finished |
| Incorrect claim | Penalty applied; existing tests also verify ticket cuts |
| Previously won prize | Further requests do not penalize the losing player |
| Four-question batch reveal | All four remain revealed for each of three players; no automatic marks |
| Player reload, manual cell tapping, Pause/Resume | Passed |
| Super Admin diagnostics, audit filtering, paginated audit reads | Passed |
| Event-round workflow | Six assigned tickets; three member sessions; 20 revealed questions; verified claim; completed |
| Viewports | 320, 360, 390, 768, 1280 CSS pixels; no document overflow on the six measured screens |
| 21st static UI review | Zero errors; 20 warnings and 13 suggestions remain |

The six measured screens were Super Admin, Admin, player lobby, active player,
active host, and event-round ticket. The retained static-review warnings are
principally broad transitions and design recommendations; they are not a clean
accessibility certification.

## Reproduce

Start a fresh `npm run dev:demo` (restart it before each run). With Playwright
available to Node, run:

```sh
node scripts/audit-browser.mjs
```

If Playwright is bundled outside the project, set `PLAYWRIGHT_MODULE` to its
absolute package directory. This avoids adding a browser dependency to either
application. Screenshots and the machine-readable report are saved under
`artifacts/audit/` (ignored by Git). The script uses only local demo accounts and
does not send email or connect to Neon. Each run adds disposable demo games and
completes the demo event; restarting the demo resets them.

## Remaining release checks

- Test actual Android Chrome and iOS Safari, including the on-screen keyboard,
  portrait/landscape, slow networks, and putting the browser in the background.
- Validate the deployed frontend/API cookie and CORS configuration, Socket.IO,
  and email delivery after the user's manual deployment.
- Run a separate realistic load test before promising 100 simultaneous players.
- Demo state is in-memory PGlite. Production migrations, cloud database changes,
  external emails, and deployment were not performed in this audit.
