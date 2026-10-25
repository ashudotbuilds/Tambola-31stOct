import { Router, type Request } from 'express'
import rateLimit from 'express-rate-limit'
import type { GameService } from './service'
import type { ClaimService } from './claims'
import { ensure } from '../../errors'
import * as validate from './validation'
import { requireRole } from '../auth/middleware'

function bearer(req: Request, required = true): string | undefined {
  const authorization = req.header('authorization')
  if (!authorization) {
    ensure(!required, 401, 'A game session is required')
    return undefined
  }
  const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization)
  ensure(match, 401, 'Invalid game session')
  return match[1]
}

export function gameRoutes(games: GameService, claims: ClaimService, changed: (gameId: string, deleted?: boolean) => void) {
  const router = Router()
  const entryLimit = rateLimit({ windowMs: 60_000, limit: 150, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please wait a minute.' } })

  router.post('/', entryLimit, requireRole(['ADMIN']), async (req, res) => {
    const { hostName, bank } = validate.createBody.parse(req.body)
    const result = await games.create(req.auth!.user.name.slice(0,24), bank, req.auth!.user.id)
    changed(result.game_id)
    res.status(201).json(result)
  })
  router.post('/join', entryLimit, requireRole(['PARTICIPANT']), async (req, res) => {
    const { code, name } = validate.joinBody.parse(req.body)
    const result = await games.join(code, req.auth!.user.name.slice(0,24), req.auth!.user.id)
    changed(result.game_id)
    res.status(201).json(result)
  })
  router.get('/code/:code', async (req, res) => {
    res.json(await games.stateByCode(validate.code.parse(req.params.code)))
  })
  router.get('/', requireRole(['ADMIN']), async(req,res)=>{
    res.setHeader('Cache-Control', 'no-store')
    const {rows}=await games.db.query(`SELECT g.id,g.code,g.status,g.created_at,
      COALESCE(u.name,'Administrator') AS host_name,
      (g.account_user_id=$1 OR $2) AS can_manage
      FROM games g LEFT JOIN users u ON u.id=g.account_user_id
      WHERE g.deleted_at IS NULL
      ORDER BY g.created_at DESC,g.id DESC LIMIT 100`,[req.auth!.user.id,req.auth!.principal.type==='SUPER_ADMIN'])
    res.json({ok:true,games:rows})
  })
  router.post('/:id/session',requireRole(['ADMIN']),async(req,res)=>{
    res.json(await games.resumeAccount(validate.uuid.parse(req.params.id),req.auth!.user.id,req.auth!.principal.type==='SUPER_ADMIN'))
  })
  router.param('id', (req, _res, next, value) => {
    try { validate.uuid.parse(value); next() } catch (error) { next(error) }
  })
  router.use('/:id', async (req, _res, next) => {
    try {
      const id = String(req.params.id)
      const actor = req.auth!
      const token = bearer(req, false)
      if (actor.principal.type === 'PARTICIPANT') {
        const { rows } = await games.db.query('SELECT id FROM game_players WHERE game_id=$1 AND account_user_id=$2 AND NOT is_host', [id, actor.user.id])
        ensure(rows.length, 403, 'Join this game with your account first')
      }
      if (req.method !== 'GET') {
        const playerAction = /\/(marks|claims)$/.test(req.path)
        ensure(playerAction ? actor.principal.type === 'PARTICIPANT' : actor.principal.type !== 'PARTICIPANT', 403, 'This action is not available for your role')
        if (!playerAction) {
          const { rows } = await games.db.query('SELECT id FROM games WHERE id=$1 AND account_user_id=$2', [id, actor.user.id])
          ensure(rows.length || actor.principal.type === 'SUPER_ADMIN', 403, 'Only the game administrator can manage this game')
        }
      }
      if (token && actor.principal.type === 'PARTICIPANT') {
        const state = await games.state(id, token)
        const { rows } = await games.db.query('SELECT id FROM game_players WHERE id=$1 AND account_user_id=$2', [state.me?.player_id, actor.user.id])
        ensure(rows.length, 403, 'Game session belongs to another account')
      }
      next()
    } catch (error) { next(error) }
  })
  router.delete('/:id', async (req, res) => {
    const { code } = validate.deleteBody.parse(req.body)
    const result = await games.remove(String(req.params.id), req.auth!.user.id, req.auth!.principal.type === 'SUPER_ADMIN', code)
    changed(String(req.params.id), true); res.json(result)
  })
  router.get('/:id', async (req, res) => {
    res.json(await games.state(String(req.params.id), bearer(req, false)))
  })
  router.post('/:id/start', async (req, res) => {
    const result = await games.start(String(req.params.id), bearer(req)!, req.auth!.user.id)
    changed(String(req.params.id)); res.json(result)
  })
  router.post('/:id/calls', async (req, res) => {
    const result = await games.draw(String(req.params.id), bearer(req)!, req.auth!.user.id)
    changed(String(req.params.id)); res.json(result)
  })
  router.patch('/:id/status', async (req, res) => {
    const { status } = validate.statusBody.parse(req.body)
    const result = await games.status(String(req.params.id), bearer(req)!, status, req.auth!.user.id)
    changed(String(req.params.id)); res.json(result)
  })
  router.put('/:id/display', async (req, res) => {
    const { seq } = validate.displayBody.parse(req.body)
    const result = await games.display(String(req.params.id), bearer(req)!, seq, req.auth!.user.id)
    changed(String(req.params.id)); res.json(result)
  })
  router.put('/:id/reveals', async (req, res) => {
    const { seqs } = validate.revealBody.parse(req.body)
    const result = await games.reveal(String(req.params.id), bearer(req)!, seqs, req.auth!.user.id)
    changed(String(req.params.id)); res.json(result)
  })
  router.put('/:id/bank', async (req, res) => {
    const { bank } = validate.bankBody.parse(req.body)
    const result = await games.bank(String(req.params.id), bearer(req)!, bank, req.auth!.user.id)
    changed(String(req.params.id)); res.json(result)
  })
  router.put('/:id/marks', async (req, res) => {
    const { marked } = validate.marksBody.parse(req.body)
    const result = await games.marks(String(req.params.id), bearer(req)!, marked)
    // Marks stay private; other devices recover the saved ticket on refresh.
    res.json(result)
  })
  router.post('/:id/claims', async (req, res) => {
    const { claim } = validate.claimBody.parse(req.body)
    const result = await claims.submit(String(req.params.id), bearer(req)!, claim)
    changed(String(req.params.id)); res.json(result)
  })
  return router
}
