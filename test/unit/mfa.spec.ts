import { expect } from 'expect'
import { generateSecret, generateSetupDetails, verifyToken, generateToken } from '../../lib/mfa/index.js'

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
})
