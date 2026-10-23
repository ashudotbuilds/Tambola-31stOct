import type { Server } from 'socket.io'
import type { GameService } from '../modules/games/service'
import type { AuthService } from '../modules/auth/service'
import { parse as parseCookies } from 'cookie'
import { z } from 'zod'

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
        if (account.principal.type === 'PARTICIPANT') {
          const { rows } = await games.db.query('SELECT id FROM game_players WHERE game_id=$1 AND account_user_id=$2', [gameRequest.data.gameId, account.user.id])
          if (!rows.length) return next(new Error('Join this game first'))
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
    socket.emit('room_ready')
    socket.on('disconnect', presence)
    // There are deliberately no client publish/mutation handlers.
  })
}
