import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig } from '../src/config'

const base = { DATABASE_URL: 'postgresql://user:password@localhost:5432/tambola' }

test('deployment config accepts exact origins and complete email settings', () => {
  const config = readConfig({
    ...base,
    WEB_ORIGINS: 'https://tambola.example,https://preview.example',
    EMAIL_API_URL: 'https://mail.example/send',
    EMAIL_API_KEY: 'private-test-value',
    EMAIL_FROM: 'events@tambola.example',
  })
  assert.deepEqual(config.origins, ['https://tambola.example', 'https://preview.example'])
  assert.equal(config.EMAIL_API_KEY, 'private-test-value')
})

test('deployment config rejects non-origin URLs and partial email credentials', () => {
  assert.throws(() => readConfig({ ...base, WEB_ORIGINS: 'https://tambola.example/' }), /exact URL origins/)
  assert.throws(() => readConfig({ ...base, WEB_ORIGINS: 'https://tambola.example/path' }), /exact URL origins/)
  assert.throws(() => readConfig({ ...base, EMAIL_API_URL: 'https://mail.example/send' }), /must be set together/)
})

test('deployment config errors name invalid fields without echoing secret values', () => {
  const secret = 'postgresql://private-user:private-password@database.example/app'
  assert.throws(() => readConfig({ DATABASE_URL: secret, DATABASE_POOL_MAX: 'not-a-number' }), error => {
    assert.match((error as Error).message, /DATABASE_POOL_MAX/)
    assert.doesNotMatch((error as Error).message, /private-user|private-password|database\.example/)
    return true
  })
})
