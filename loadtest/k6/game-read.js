import http from 'k6/http'
import { check, sleep } from 'k6'

const baseUrl = (__ENV.BASE_URL || '').replace(/\/+$/, '')
const frontendOrigin = (__ENV.FRONTEND_ORIGIN || '').replace(/\/+$/, '')
const adminLogin = __ENV.ADMIN_LOGIN
const adminPassword = __ENV.ADMIN_PASSWORD
const loadTestPassword = __ENV.LOAD_TEST_PASSWORD
const maxVus = Number(__ENV.MAX_VUS || 100)
const supportedTargets = [10, 15, 20, 50, 100]
if (!supportedTargets.includes(maxVus)) {
  throw new Error(`MAX_VUS must be one of: ${supportedTargets.join(', ')}`)
}

const rampTargets = [1, ...supportedTargets.filter(target => target <= maxVus)]

export const options = {
  setupTimeout: '15m',
  stages: [
    ...rampTargets.map((target, index) => ({
      duration: index === rampTargets.length - 1 ? '1m' : '20s',
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
  if (!ok) throw new Error(`${label} failed with HTTP ${response.status}.`)
}

function sessionFrom(response, label) {
  const session = response.cookies.tt_session?.[0]?.value
  if (!session) throw new Error(`${label} succeeded but the session cookie was missing.`)
  return session
}

function jsonParams(session, tag) {
  return {
    headers: { Cookie: `tt_session=${session}`, 'Content-Type': 'application/json', Origin: frontendOrigin },
    tags: { name: tag },
  }
}

function deleteTemporaryGame(host, gameId, code) {
  if (!gameId) return
  http.del(`${baseUrl}/api/games/${gameId}`, JSON.stringify({ code }), {
    ...jsonParams(host.session, 'delete_temporary_game'),
  })
}

export function setup() {
  if (!baseUrl.startsWith('https://')) throw new Error('Set BASE_URL to the HTTPS backend origin.')
  if (!frontendOrigin.startsWith('https://')) throw new Error('Set FRONTEND_ORIGIN to an allowed HTTPS frontend origin.')
  if (!adminLogin || !adminPassword || !loadTestPassword) {
    throw new Error('Set ADMIN_LOGIN, ADMIN_PASSWORD, and LOAD_TEST_PASSWORD in your shell environment.')
  }

  const loginAdmin = http.post(`${baseUrl}/api/v1/auth/login`,
    JSON.stringify({ email: adminLogin, password: adminPassword }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login_host_setup' } })
  requireOk(loginAdmin, 'host account login', 200)
  const host = { session: sessionFrom(loginAdmin, 'Host login') }

  // Login is rate-limited per IP, so space account logins below the 15/minute cap.
  const participants = []
  for (let index = 1; index < maxVus; index++) {
    sleep(4.2)
    const loginId = `tt-load-user${String(index).padStart(4, '0')}`
    const response = http.post(`${baseUrl}/api/v1/auth/login`,
      JSON.stringify({ email: loginId, password: loadTestPassword }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login_participant_setup' } })
    requireOk(response, 'participant account login', 200)
    participants.push({ session: sessionFrom(response, 'Participant login'), loginId })
  }

  const created = http.post(`${baseUrl}/api/games`, JSON.stringify({ hostName: 'k6 Load Test' }),
    jsonParams(host.session, 'create_temporary_game'))
  requireOk(created, 'temporary game creation', 201)
  const game = created.json()
  if (!game?.game_id || !game?.code || !game?.player_token) throw new Error('Game creation response omitted required setup data.')
  host.playerToken = game.player_token

  try {
    participants.forEach((participant, index) => {
      const name = `Load ${String(index + 1).padStart(4, '0')}`
      const joined = http.post(`${baseUrl}/api/games/join`, JSON.stringify({ code: game.code, name }),
        jsonParams(participant.session, 'join_temporary_game'))
      requireOk(joined, 'participant game join', 201)
      const result = joined.json()
      if (!result?.player_token) throw new Error('Participant join response omitted its game session.')
      participant.playerToken = result.player_token
    })

    const startParams = jsonParams(host.session, 'start_temporary_game')
    startParams.headers.Authorization = `Bearer ${host.playerToken}`
    const started = http.post(`${baseUrl}/api/games/${game.game_id}/start`, JSON.stringify({}), startParams)
    requireOk(started, 'temporary game start', 200)
  } catch (error) {
    deleteTemporaryGame(host, game.game_id, game.code)
    throw error
  }

  console.log(`Prepared ${participants.length} participant sessions for temporary game ${game.game_id}.`)
  return { host, participants, gameId: game.game_id, code: game.code }
}

export default function (data) {
  // One VU is the host and each remaining VU is a distinct participant.
  const client = data.participants[__VU - 1] || data.host
  const response = http.get(
    `${baseUrl}/api/games/${data.gameId}/updates?after=0`,
    {
      headers: {
        Cookie: `tt_session=${client.session}`,
        ...(client.playerToken ? { Authorization: `Bearer ${client.playerToken}` } : {}),
      },
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
    jsonParams(data.host.session, 'delete_temporary_game'),
  )
  requireOk(response, 'temporary game cleanup', 200)
  console.log('Deleted the temporary load-test game.')
}
