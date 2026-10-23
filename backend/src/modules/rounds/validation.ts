import { z } from 'zod'

export const uuid = z.string().uuid()
export const createRoundBody = z.object({ name: z.string().trim().min(1).max(150) })
export const createKeyBody = z.object({ value: z.string().trim().min(2).max(50) })
export const createQuestionBody = z.object({
  keyId: z.string().uuid(),
  question: z.string().trim().min(1).max(4000),
})
export const patternBody = z.object({ enabled: z.boolean(), maxWinners: z.number().int().min(1).max(500) })
export const pattern = z.enum(['early_five','four_corners','top_line','middle_line','bottom_line','full_house','second_full_house'])
export const drawBody = z.object({ keyId: z.string().uuid().optional() }).default({})
export const revealBody = z.object({ seq: z.number().int().positive().max(90) })
export const claimBody = z.object({ pattern })
export const reviewBody = z.object({ decision: z.enum(['verify','reject']), reason: z.string().trim().max(500).optional() })
export const markBody = z.object({ keyId: z.string().uuid() })
