import { hash, verify } from '@node-rs/argon2'

/**
 * Hashes a plaintext password using Argon2id.
 * Plaintext passwords must never be logged or persisted.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  })
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 */
export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    return await verify(hashString, password)
  } catch {
    return false
  }
}
