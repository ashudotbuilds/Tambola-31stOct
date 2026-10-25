import { z } from 'zod'
import { claimTypes } from './models'

export const uuid = z.string().uuid()
export const name = z.string().trim().min(1, 'Name is required').max(24, 'Name must be 1–24 characters')
export const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Game code must be 6 characters')
export const joinBody = z.object({ code, name })
export const statusBody = z.object({ status: z.enum(['paused', 'playing', 'finished']) })
export const revealBody = z.object({ seqs: z.array(z.number().int().min(1).max(90)).max(90) })
export const marksBody = z.object({ marked: z.array(z.number().int().min(1).max(90)).max(15) })
export const claimBody = z.object({ claim: z.enum(claimTypes) })
export const bankBody = z.object({ bank: z.array(z.object({
  id: z.number().int().min(1).max(90), term: z.string().trim().min(1).max(500),
  clue: z.string().trim().min(1).max(4000), category: z.string().max(100),
  codeSnippet: z.string().max(10_000).optional(),
})).length(90).refine(items => new Set(items.map(item => item.id)).size === 90, 'Bank must have each ID from 1 to 90 exactly once') })
export const createBody = z.object({ hostName: name, bank: bankBody.shape.bank.optional() })

export const displayBody = z.object({ seq: z.number().int().min(1).max(90).nullable() })

export const deleteBody = z.object({ code })
