import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'

export interface MfaSetupDetails {
  secret: string
  uri: string
  qrCode: string
}

/**
 * Generates a new random base32 secret.
 * @param size The size of the secret in bytes (default 20).
 * @returns The base32 string representation of the secret.
 */
export function generateSecret(size: number = 20): string {
  const secret = new OTPAuth.Secret({ size })
  return secret.base32
}

/**
 * Generates setup details for the client, including the secret, the otpauth URI, and a QR code Data URL.
 * @param appName The name of the application (Issuer).
 * @param username The username (Label).
 * @param secret The base32 secret (optional, will be generated if not provided).
 */
export async function generateSetupDetails(
  appName: string,
  username: string,
  secret?: string
): Promise<MfaSetupDetails> {
  const mfaSecret = secret ? OTPAuth.Secret.fromBase32(secret) : new OTPAuth.Secret({ size: 20 })
  const base32Secret = mfaSecret.base32

  const totp = new OTPAuth.TOTP({
    issuer: appName,
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: mfaSecret
  })

  const uri = totp.toString()
  const qrCode = await QRCode.toDataURL(uri)

  return {
    secret: base32Secret,
    uri,
    qrCode
  }
}

/**
 * Validates a TOTP token against a secret.
 * @param token The token to verify.
 * @param secret The base32 secret.
 * @param window The acceptable time window (default 1, meaning +/- 30 seconds).
 * @returns True if valid, false otherwise.
 */
export function verifyToken(token: string, secret: string, window: number = 1): boolean {
  if (!token || !secret) return false

  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })

  // validate returns null if invalid, or the delta (integer) if valid
  const delta = totp.validate({ token, window })
  return delta !== null
}

/**
 * Generates the current TOTP token for a given secret.
 * Useful for testing or recovery scenarios.
 * @param secret The base32 secret.
 */
export function generateToken(secret: string): string {
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })

  return totp.generate()
}
