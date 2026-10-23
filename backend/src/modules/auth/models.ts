export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
export type AdminRole = 'ADMIN' | 'SUPER_ADMIN'
export type PrincipalType = 'PARTICIPANT' | 'ADMIN' | 'SUPER_ADMIN'

export interface UserRecord {
  id: string
  email: string
  password_hash: string
  name: string
  status: UserStatus
  created_at: Date
  updated_at: Date
}

export interface AdminProfileRecord {
  id: string
  user_id: string
  role: AdminRole
  created_at: Date
  updated_at: Date
}

export interface ParticipantProfileRecord {
  id: string
  user_id: string
  event_id: string
  external_id: string | null
  created_at: Date
  updated_at: Date
}

export interface SessionRecord {
  id: string
  user_id: string
  principal_type: PrincipalType
  profile_id: string
  token_hash: string
  ip_address: string | null
  user_agent: string | null
  expires_at: Date
  revoked_at: Date | null
  created_at: Date
}

export interface AuditLogRecord {
  id: string
  actor_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: Date
}

export interface Principal {
  type: PrincipalType
  profileId: string
  role?: AdminRole
  eventId?: string
}

export interface SafeUser {
  id: string
  email: string
  name: string
  status: UserStatus
}

export interface AuthContext {
  user: SafeUser
  principal: Principal
  session: SessionRecord
}
