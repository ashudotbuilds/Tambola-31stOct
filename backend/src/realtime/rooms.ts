import type { Server } from 'socket.io'
import type { GameService } from '../modules/games/service'
import { z } from 'zod'

export const roomName = (gameId: string) => `game:${gameId}`

export function attachRooms(io: Server, games: GameService) {
  io.use(async (socket, next) => {
    const auth = z.object({ gameId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/).optional() }).safeParse(socket.handshake.auth)
    if (!auth.success) return next(new Error('Invalid game session'))
    try {
      await games.state(auth.data.gameId, auth.data.token)
      socket.data.gameId = auth.data.gameId
      next()
    } catch { next(new Error('Game not found or session expired')) }
  })

  io.on('connection', async socket => {
    const room = roomName(socket.data.gameId)
    await socket.join(room)
    const presence = () => io.to(room).emit('presence', io.sockets.adapter.rooms.get(room)?.size ?? 0)
    presence()
    socket.emit('room_ready')
    socket.on('disconnect', presence)
    // There are deliberately no client publish/mutation handlers.
  })
}
