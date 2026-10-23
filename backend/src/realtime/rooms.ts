import type { Server } from 'socket.io'
import type { GameService } from '../modules/games/service'
import type { AuthService } from '../modules/auth/service'
import type { RoundService } from '../modules/rounds/service'
import { parse as parseCookies } from 'cookie'
import { z } from 'zod'

export const roomName = (gameId: string) => `game:${gameId}`
export const roundRoomName = (roundId: string) => `round:${roundId}`

export function attachRooms(io: Server, games: GameService, auth?: AuthService, rounds?: RoundService) {
  io.use(async (socket, next) => {
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

    const roundRequest = z.object({ roundId: z.string().uuid().optional(), publicRoundId: z.string().uuid().optional() }).safeParse(socket.handshake.auth)
    if (!roundRequest.success || (!roundRequest.data.roundId && !roundRequest.data.publicRoundId) || !rounds) {
      return next(new Error('Invalid room request'))
    }
    const roundId = roundRequest.data.roundId ?? roundRequest.data.publicRoundId!
    try {
      const accountToken = parseCookies(socket.request.headers.cookie ?? '').tt_session
      if (!auth || !accountToken) return next(new Error('Account session is required'))
      await auth.authenticate(accountToken)
      const snapshot = await rounds.publicState(roundId)
      if (roundRequest.data.roundId) {
        if (!auth) return next(new Error('Account authentication is unavailable'))
        const cookieHeader = socket.request.headers.cookie ?? ''
        const token = parseCookies(cookieHeader).tt_session
        if (!token) return next(new Error('Account session is required'))
        const context = await auth.authenticate(token)
        if (context.principal.type !== 'PARTICIPANT' || context.principal.eventId !== snapshot.event.id) {
          return next(new Error('Round is outside the participant event'))
        }
        socket.data.channel = 'round'
      } else socket.data.channel = 'public-round'
      socket.data.roundId = roundId
      next()
    } catch { next(new Error('Round not found or session expired')) }
  })

  io.on('connection', async socket => {
    if (socket.data.channel === 'round' || socket.data.channel === 'public-round') {
      await socket.join(roundRoomName(socket.data.roundId))
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
