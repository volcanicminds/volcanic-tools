/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import nodemailer from 'nodemailer'
import { Mailer } from '../../lib/mailer/index.js'

// We swap the internal transporter for nodemailer's built-in `jsonTransport`,
// which runs the real send pipeline but emits the message as JSON instead of
// hitting an SMTP server. This exercises Mailer's payload mapping & html->text
// fallback without any network.
function makeMailer(overrides: Partial<any> = {}): Mailer {
  const mailer = new Mailer({ host: 'smtp.test', port: 587, defaultFrom: 'from@test.io', ...overrides } as any)
  ;(mailer as any).transporter = nodemailer.createTransport({ jsonTransport: true })
  return mailer
}

async function sent(mailer: Mailer, options: any): Promise<any> {
  const info: any = await mailer.send(options)
  return JSON.parse(info.message) // { from, to, subject, html, text, ... }
}

describe('Mailer', () => {
  it('maps fields and uses defaultFrom', async () => {
    const msg = await sent(makeMailer(), { to: 'a@test.io', subject: 'Hi', html: '<p>Hello</p>' })
    expect(msg.from.address).toBe('from@test.io')
    expect(msg.to[0].address).toBe('a@test.io')
    expect(msg.subject).toBe('Hi')
    expect(msg.html).toBe('<p>Hello</p>')
  })

  it('generates a plain-text fallback from html (stripHtml)', async () => {
    const msg = await sent(makeMailer(), {
      to: 'a@test.io',
      subject: 'S',
      html: '<p>Line one</p><p>Line two</p><br>End'
    })
    expect(msg.text).toContain('Line one')
    expect(msg.text).toContain('Line two')
    expect(msg.text).not.toContain('<p>')
  })

  it('keeps an explicit text body when provided', async () => {
    const msg = await sent(makeMailer(), { to: 'a@test.io', subject: 'S', html: '<p>x</p>', text: 'custom' })
    expect(msg.text).toBe('custom')
  })

  it('joins array recipients for to / cc / bcc', async () => {
    const msg = await sent(makeMailer(), {
      to: ['a@test.io', 'b@test.io'],
      cc: ['c@test.io'],
      bcc: ['d@test.io', 'e@test.io'],
      subject: 'S',
      html: '<p>x</p>'
    })
    expect(msg.to.map((x: any) => x.address)).toEqual(['a@test.io', 'b@test.io'])
    expect(msg.cc.map((x: any) => x.address)).toEqual(['c@test.io'])
    expect(msg.bcc.map((x: any) => x.address)).toEqual(['d@test.io', 'e@test.io'])
  })

  it('applies defaultReplyTo and lets options.from override the default', async () => {
    const msg = await sent(makeMailer({ defaultReplyTo: 'reply@test.io' }), {
      to: 'a@test.io',
      from: 'override@test.io',
      subject: 'S',
      html: '<p>x</p>'
    })
    expect(msg.from.address).toBe('override@test.io')
    expect(msg.replyTo[0].address).toBe('reply@test.io')
  })

  it('throws when no from address is available', async () => {
    const mailer = makeMailer({ defaultFrom: undefined })
    await expect(mailer.send({ to: 'a@test.io', subject: 'S', html: '<p>x</p>' })).rejects.toThrow(/"from" address/)
  })

  it('wraps transport errors with the recipient', async () => {
    const mailer = makeMailer()
    ;(mailer as any).transporter = { sendMail: async () => Promise.reject(new Error('smtp down')) }
    await expect(mailer.send({ to: 'a@test.io', subject: 'S', html: '<p>x</p>' })).rejects.toThrow(
      /Failed to send email to a@test.io: smtp down/
    )
  })

  it('verifyConnection returns true/false based on the transport', async () => {
    const ok = makeMailer()
    ;(ok as any).transporter = { verify: async () => true }
    expect(await ok.verifyConnection()).toBe(true)

    const ko = makeMailer()
    ;(ko as any).transporter = { verify: async () => Promise.reject(new Error('nope')) }
    expect(await ko.verifyConnection()).toBe(false)
  })
})
