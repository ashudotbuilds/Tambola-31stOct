import http from 'k6/http'
import { check, sleep } from 'k6'

const baseUrl = (__ENV.BASE_URL || '').replace(/\/+$/, '')
const loginId = __ENV.ADMIN_LOGIN
const password = __ENV.ADMIN_PASSWORD
const maxVus = Math.max(1, Number(__ENV.MAX_VUS || 100))

const rampTargets = [...new Set([
  1,
  Math.ceil(maxVus / 10),
  Math.ceil(maxVus / 4),
  Math.ceil(maxVus / 2),
  maxVus,
])]

export const options = {
  stages: [
    ...rampTargets.map((target, index) => ({
      duration: maxVus <= 10 ? '10s' : index === rampTargets.length - 1 ? '1m' : '20s',
      target,
    })),
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
}

function requireOk(response, label, status) {
  const ok = check(response, { [label]: r => r.status === status })
  if (!ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${response.body.slice(0, 300)}`)
  }
}

export function setup() {
  if (!baseUrl.startsWith('https://')) throw new Error('Set BASE_URL to the HTTPS backend origin.')
  if (!loginId || !password) throw new Error('Set ADMIN_LOGIN and ADMIN_PASSWORD in your shell environment.')

  const login = http.post(`${baseUrl}/api/v1/auth/login`,
    JSON.stringify({ email: loginId, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login_setup' } })
  requireOk(login, 'test admin login', 200)

  const session = login.cookies.tt_session?.[0]?.value
  if (!session) throw new Error('Login succeeded but the session cookie was missing.')

  const params = {
    headers: { Cookie: `tt_session=${session}`, 'Content-Type': 'application/json' },
    tags: { name: 'create_temporary_game' },
  }
  const created = http.post(`${baseUrl}/api/games`, JSON.stringify({ hostName: 'k6 Load Test' }), params)
  requireOk(created, 'temporary game creation', 201)
  const result = created.json()
  if (!result?.game_id || !result?.code) throw new Error('Game creation response omitted its id or code.')

  console.log(`Created temporary load-test game ${result.game_id}.`)
  return { session, gameId: result.game_id, code: result.code }
}

export default function (data) {
  const response = http.get(
    `${baseUrl}/api/games/${data.gameId}/updates?after=0`,
    {
      headers: { Cookie: `tt_session=${data.session}` },
      tags: { name: 'game_updates' },
    },
  )
  check(response, {
    'game updates return 200': r => r.status === 200,
    'game updates contain state': r => r.json('game_id') === data.gameId,
  })
  sleep(1)
}

export function teardown(data) {
  const response = http.del(
    `${baseUrl}/api/games/${data.gameId}`,
    JSON.stringify({ code: data.code }),
    {
      headers: {
        Cookie: `tt_session=${data.session}`,
        'Content-Type': 'application/json',
      },
      tags: { name: 'delete_temporary_game' },
    },
  )
  requireOk(response, 'temporary game cleanup', 200)
  console.log('Deleted the temporary load-test game.')
}
