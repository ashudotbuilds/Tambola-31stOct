import type { Server } from 'socket.io'
import type { GameService } from '../modules/games/service'
import type { AuthService } from '../modules/auth/service'
import { parse as parseCookies } from 'cookie'
import { z } from 'zod'
import { recordAudit } from '../modules/auth/repository'

export const roomName = (gameId: string) => `game:${gameId}`
export const adminRoomName = 'admin:dashboard'

export function attachRooms(io: Server, games: GameService, auth?: AuthService) {
  io.use(async (socket, next) => {
    if (socket.handshake.auth?.channel === 'admin-dashboard') {
      try {
        const token = parseCookies(socket.request.headers.cookie ?? '').tt_session
        if (!auth || !token) return next(new Error('Account session is required'))
        const account = await auth.authenticate(token)
        if (account.principal.type === 'PARTICIPANT') return next(new Error('Administrator access is required'))
        socket.data.channel = 'admin-dashboard'
        return next()
      } catch { return next(new Error('Account session expired')) }
    }
    const gameRequest = z.object({ gameId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/).optional() }).safeParse(socket.handshake.auth)
    if (gameRequest.success) {
      try {
        const accountToken = parseCookies(socket.request.headers.cookie ?? '').tt_session
        if (!auth || !accountToken) return next(new Error('Account session is required'))
        const account = await auth.authenticate(accountToken)
        socket.data.actorId = account.user.id
        if (account.principal.type === 'PARTICIPANT') {
          const { rows } = await games.db.query('SELECT id FROM game_players WHERE game_id=$1 AND account_user_id=$2', [gameRequest.data.gameId, account.user.id])
          if (!rows.length) {
            await recordAudit(games.db, { actorId: account.user.id, action: 'GAME_CONNECTION_DENIED', resourceType: 'game', resourceId: gameRequest.data.gameId, metadata: { reason: 'Account has not joined this game' } })
            return next(new Error('Join this game first'))
          }
        }
        await games.state(gameRequest.data.gameId, gameRequest.data.token)
        socket.data.channel = 'game'
        socket.data.gameId = gameRequest.data.gameId
        return next()
      } catch { return next(new Error('Game not found or session expired')) }
    }

    return next(new Error('Invalid room request'))
  })

  io.on('connection', async socket => {
    if (socket.data.channel === 'admin-dashboard') {
      await socket.join(adminRoomName)
      socket.emit('room_ready')
      return
    }
    const room = roomName(socket.data.gameId)
    await socket.join(room)
    const presence = () => io.to(room).emit('presence', io.sockets.adapter.rooms.get(room)?.size ?? 0)
    presence()
    const actorId = socket.data.actorId as string
    const log = async (action: string, metadata: Record<string, unknown> = {}) => {
      try { await recordAudit(games.db, { actorId, action, resourceType: 'game', resourceId: socket.data.gameId,
        metadata, ipAddress: socket.handshake.address, userAgent: socket.handshake.headers['user-agent'] }) }
      catch { console.error('Could not record game connection audit') }
    }
    socket.on('disconnect', reason => { presence(); void log('GAME_DISCONNECTED', { reason }) })
    try {
      const { rows } = await games.db.query(`SELECT id FROM audit_logs WHERE resource_type='game' AND resource_id=$1 AND actor_id=$2 AND action IN ('GAME_CONNECTED','GAME_RECONNECTED','GAME_ADDITIONAL_CONNECTION') LIMIT 1`, [socket.data.gameId, actorId])
      const connections = [...io.sockets.sockets.values()].filter(s => s.data.gameId === socket.data.gameId && s.data.actorId === actorId).length
      await log(connections > 1 ? 'GAME_ADDITIONAL_CONNECTION' : rows.length ? 'GAME_RECONNECTED' : 'GAME_CONNECTED', { connections })
    } catch { console.error('Could not inspect game connection history') }
    if (socket.connected) socket.emit('room_ready')
    // There are deliberately no client publish/mutation handlers.
  })
}
