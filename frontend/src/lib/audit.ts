import type { AuditEntry } from './api'
import { claimLabel } from './claims'
import type { ClaimType } from './types'

export const auditLabels: Record<string, string> = {
  PROFILE_UPDATED: 'Updated profile', ADMIN_CREATED: 'Created admin account', ADMIN_DELETED: 'Removed admin account',
  PARTICIPANT_CREDENTIAL_ISSUED: 'Issued participant credentials', PARTICIPANT_CREDENTIAL_DELIVERY_SENT: 'Sent participant credentials',
  LOGIN_SUCCESS: 'Logged in', LOGIN_FAILED: 'Failed login', LOGOUT: 'Logged out',
  GAME_CREATED: 'Created game', GAME_JOINED: 'Joined game', GAME_STARTED: 'Started game',
  GAME_SESSION_RESTORED: 'Opened host controls', GAME_STATUS_CHANGED: 'Changed game status',
  GAME_DRAW: 'Called a question', GAME_QUESTION_DISPLAYED: 'Changed the displayed question',
  GAME_ANSWERS_REVEALED: 'Revealed answers', GAME_BANK_UPDATED: 'Updated question bank',
  GAME_CLAIM_ACCEPTED: 'Won a claim', GAME_CLAIM_REJECTED: 'Incorrect claim warning',
  GAME_CONNECTED: 'Connected to game', GAME_RECONNECTED: 'Reconnected to game',
  GAME_DISCONNECTED: 'Disconnected from game', GAME_ADDITIONAL_CONNECTION: 'Opened another connection',
  GAME_CONNECTION_DENIED: 'Game connection blocked', ACCESS_DENIED: 'Action blocked', GAME_DELETED: 'Deleted game',
}
export function auditLabel(action: string) {
  return auditLabels[action] ?? action.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
}
export function auditDescription(entry: AuditEntry) {
  const m = entry.metadata
  const parts: string[] = []
  if (typeof m.pattern === 'string') parts.push(claimLabel(m.pattern as ClaimType))
  if (entry.action === 'GAME_QUESTION_DISPLAYED' && m.seq == null) parts.push('Returned everyone to the latest question')
  else if (typeof m.seq === 'number') parts.push(`Question #${m.seq}`)
  if (typeof m.question === 'string') parts.push(m.question)
  if (typeof m.status === 'string') parts.push(`Status: ${m.status.replaceAll('_', ' ')}`)
  if (typeof m.points === 'number') parts.push(`${m.points >= 0 ? '+' : ''}${m.points} points`)
  if (typeof m.score === 'number') parts.push(`Score: ${m.score}`)
  if (typeof m.warningCount === 'number') parts.push(`Warning #${m.warningCount}`)
  if (typeof m.total === 'number') parts.push(`${m.total} items`)
  if (typeof m.connections === 'number') parts.push(`${m.connections} active connection${m.connections === 1 ? '' : 's'}`)
  if (typeof m.reason === 'string') parts.push(m.reason.replaceAll('_', ' '))
  if (typeof m.errorCode === 'string') parts.push(m.errorCode.replaceAll('_', ' '))
  if (typeof m.role === 'string') parts.push(m.role.replaceAll('_', ' '))
  if (entry.targetName || entry.targetEmail) parts.push(`Account: ${[entry.targetName, entry.targetEmail].filter(Boolean).join(' · ')}`)
  return parts.join(' · ')
}
