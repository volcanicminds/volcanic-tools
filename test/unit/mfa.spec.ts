import { expect } from 'expect'
import {
  generateSecret,
  generateSetupDetails,
  verifyToken,
  verifyTokenDelta,
  generateToken
} from '../../lib/mfa/index.js'

const isBase32 = (s: string) => /^[A-Z2-7]+$/.test(s)

describe('MFA (TOTP)', () => {
  it('generates a base32 secret', () => {
    const secret = generateSecret()
    expect(typeof secret).toBe('string')
    expect(secret.length).toBeGreaterThan(0)
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true) // base32 alphabet
  })

  it('produces setup details with an otpauth URI and a QR data URL', async () => {
    const details = await generateSetupDetails('VolcanicApp', 'user@example.com')
    expect(details.secret).toBeTruthy()
    expect(details.uri.startsWith('otpauth://totp/')).toBe(true)
    expect(details.qrCode.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('verifies a freshly generated token', () => {
    const secret = generateSecret()
    const token = generateToken(secret)
    expect(verifyToken(token, secret)).toBe(true)
  })

  it('rejects an invalid token', () => {
    const secret = generateSecret()
    expect(verifyToken('000000', secret)).toBe(false)
  })

  it('rejects empty inputs', () => {
    expect(verifyToken('', 'JBSWY3DPEHPK3PXP')).toBe(false)
    expect(verifyToken('123456', '')).toBe(false)
  })

  it('honors a custom secret size', () => {
    const small = generateSecret(10)
    const large = generateSecret(32)
    expect(isBase32(small)).toBe(true)
    expect(isBase32(large)).toBe(true)
    expect(large.length).toBeGreaterThan(small.length)
  })

  it('reuses a provided secret in the setup details (round-trip)', async () => {
    const secret = generateSecret()
    const details = await generateSetupDetails('VolcanicApp', 'user@example.com', secret)
    expect(details.secret).toBe(secret)
    expect(details.uri).toContain('VolcanicApp')
  })

  it('verifies a token within the allowed time window', () => {
    const secret = generateSecret()
    const token = generateToken(secret)
    expect(verifyToken(token, secret, 2)).toBe(true)
  })

  it('returns the delta for a valid token (anti-replay support)', () => {
    const secret = generateSecret()
    const token = generateToken(secret)
    const delta = verifyTokenDelta(token, secret)
    expect(typeof delta).toBe('number')
    expect(delta).toBe(0) // freshly generated token matches the current time step
  })

  it('returns null delta for an invalid or empty token', () => {
    const secret = generateSecret()
    expect(verifyTokenDelta('000000', secret)).toBeNull()
    expect(verifyTokenDelta('', secret)).toBeNull()
    expect(verifyTokenDelta('123456', '')).toBeNull()
  })
})
