// Build-only credentials. This script is never loaded by the running API.
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (!process.env.POSTHOG_CLI_API_KEY?.trim()) {
  console.log('PostHog source-map upload skipped (POSTHOG_CLI_API_KEY is unset).')
} else {
  const cwd = fileURLToPath(new URL('../', import.meta.url))
  const cli = fileURLToPath(new URL('../node_modules/@posthog/cli/run-posthog-cli.js', import.meta.url))
  const env = { ...process.env,
    POSTHOG_CLI_PROJECT_ID: process.env.POSTHOG_CLI_PROJECT_ID || '687005',
    POSTHOG_CLI_HOST: process.env.POSTHOG_CLI_HOST || 'https://us.posthog.com',
  }
  const run = args => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('PostHog source-map command failed; build stopped before deployment.')
  }
  const version = process.env.POSTHOG_RELEASE_VERSION || process.env.HEROKU_SLUG_COMMIT || process.env.RENDER_GIT_COMMIT
  const release = ['--release-name', 'tambola-api', '--release-mode', 'symbol-set',
    ...(version ? ['--release-version', version] : [])]
  run(['sourcemap', 'inject', '--directory', 'dist', ...release])
  run(['sourcemap', 'upload', '--directory', 'dist', ...release, '--delete-after'])
}
