# Tambola frontend

React + Vite + TypeScript. This folder is self-contained and deploys to Vercel.

## Local development

Run inside `frontend/`:

```sh
npm ci
```

Copy `.env.example` to `.env.local` and set `VITE_API_URL=http://localhost:3001`.
Start the backend separately, then run:

```sh
npm run dev
```

Open http://localhost:5173. The routes are `/`, `/host`, `/play`, and
`/board?code=ABC123`.

## Deploy to Vercel

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment | `VITE_API_URL=https://YOUR-BACKEND.onrender.com` |

The API URL is the backend origin without `/api`. Redeploy after changing it.
Set the exact Vercel origin in the backend's `WEB_ORIGINS` environment variable.
`vercel.json` includes the SPA rewrite for direct route loads.

## Commands

- `npm run dev`: development server.
- `npm run build`: typecheck and production build.
- `npm run preview`: serve the production build locally.
- `npm run typecheck`: TypeScript validation.

No root install or sibling folder is required to build this app. Files in
`src/shared` mirror `backend/src/shared`; edit the backend originals and run
`npm run sync:shared` from the repository root when updating those contracts.
