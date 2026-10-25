import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import posthog from '@posthog/rollup-plugin'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const uploadKey = env.POSTHOG_CLI_API_KEY?.trim()
  return {
    plugins: [react(), ...(uploadKey ? [posthog({
      personalApiKey: uploadKey,
      projectId: env.POSTHOG_CLI_PROJECT_ID || '687005',
      host: env.POSTHOG_CLI_HOST || 'https://us.posthog.com',
      sourcemaps: {
        enabled: true, deleteAfterUpload: true, releaseName: 'tambola-web',
        releaseVersion: env.POSTHOG_RELEASE_VERSION || env.VERCEL_GIT_COMMIT_SHA,
      },
    })] : [])],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5173 },
  }
})
