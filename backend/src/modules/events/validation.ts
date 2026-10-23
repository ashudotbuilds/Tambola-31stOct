import { z } from 'zod'

export const eventId = z.string().uuid('Invalid event ID')
export const createEventBody = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional(),
})
export const participantRow = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  external_id: z.string().trim().max(100).optional().or(z.literal('')),
})
