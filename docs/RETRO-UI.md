# Retro interface — 23 October 2026

The functional application was committed and pushed to `main` as `6285776`
before starting the redesign.

## References collected before implementation

- [21st Retro Button](https://preview.21st.dev/@serafimcloud/components/button-retro):
  physical keycap feedback and restrained button variants. The 21st MCP catalog
  returned errors; its public page was used as inspiration, not copied source.
- [Indie Bytes retro UI kit](https://www.indiebytes.dev/ui-kit): crisp panel
  borders, technical labels, and monospace controls. No commercial assets used.
- [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch),
  [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk), and
  [Space Mono](https://fonts.google.com/specimen/Space+Mono): technical display,
  readable body text, and compact metadata. Font files and licenses are supplied
  by Fontsource packages and served locally.

## Implemented direction

Warm charcoal surfaces, orange primary actions, off-white text, olive success
states, compact borders, and small corner radii. Dark is the new-device default;
existing saved light/dark preferences remain respected. There is no logo and no
additional product name.

- Rebuilt sign-in composition with a technical ticket illustration on larger
  screens, focused mobile form, password visibility, and three brief play steps.
- Added shared `GameHeader`, `PlaySteps`, and `TicketPreview` components and Lucide
  interface icons. Reused existing ticket, claim, status, question, and result
  components rather than importing a second component system.
- Reworked member home around the join-code action and gave administrators
  compact section navigation. Host, player, event tickets, projector, question
  editor, and results inherit the same tokens.
- Buttons depress by 2px on activation. Focus rings, ticket selection, reveal
  entrance, and call progress provide immediate feedback. Motion respects the
  operating system's reduced-motion preference.
- Preserved routes, login and role checks, tutorial, claims, scoring, live
  updates, question editing, and light mode.

## Mobile and delivery

- Inputs retain 16px text to avoid iOS form zoom. Main controls have 44px minimum
  touch heights. Tickets keep horizontal navigation rather than shrinking nine
  columns into unreadable text; fit view remains optional.
- Login, member home, Super Admin, Admin, player lobby, live player, host, and
  event-round tickets are measured at 320, 360, 390, 768, and 1280 CSS pixels.
- Fonts are WOFF2 files bundled with the frontend. No runtime Google Fonts or
  other third-party font request is required.
- Host, player, admin, projector, and event pages load as separate route chunks.
  The initial production JavaScript entry is about 307KB (98KB gzip), versus
  the previous roughly 483KB monolithic entry (147KB gzip); authenticated game
  screens load additional chunks when opened.

Run `npm run dev:demo` on a fresh demo database, then
`node scripts/audit-browser.mjs` with Playwright available (or `PLAYWRIGHT_MODULE`
set to its package path). Artifacts are saved in ignored `artifacts/audit/`.
The browser check exercises a Super Admin, an Admin, three members, all 90 calls,
seven prize categories, event-round verification, audit logs, and mobile widths.
It also checks password visibility, saved theme preference, reduced motion, and
question-bank dialog focus/escape behavior. Loading fallbacks are excluded from
the account-screen measurements.

Verification: 18 backend/integration tests, both TypeScript checks, and both
production builds passed. The static 21st review reports zero errors, with 17
transition warnings and 30 styling suggestions retained for review. Browser
screenshots and results are local artifacts rather than tracked repository data.

## Environment variables

The visual redesign adds **no environment variables**. Frontend configuration
remains `VITE_API_URL`.

The preceding account implementation added optional backend email configuration:
`EMAIL_API_URL`, `EMAIL_API_KEY`, and `EMAIL_FROM`. Supply all three for credential
emails; otherwise omit them. The adapter expects an HTTP endpoint accepting a
Bearer token and JSON `{from,to,subject,text}`. Use a compatible endpoint or an
adapter for your provider's request format.

`SUPER_ADMIN_BOOTSTRAP_SECRET` is an optional unique random secret of at least 32
characters for initial Super Admin creation. Keep it only on the backend and
omit it when bootstrap access is no longer needed. Optional `RELEASE_VERSION`
labels diagnostics. Secrets never belong in `VITE_` variables.

The optional email examples are commented out so copying `.env.example` does
not enable incomplete email configuration. The earlier numbered account
migrations must be applied through the normal deployment migration command;
this redesign adds no schema migration.

Physical iPhone/Android, production deployment configuration, and realistic
100-player load remain separate release checks. This is a local Chromium audit.
