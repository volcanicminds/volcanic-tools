import nodemailer, { Transporter, SendMailOptions } from 'nodemailer'

export interface MailerConfig {
  host: string
  port: number
  secure?: boolean // true for 465, false for other ports
  auth?: {
    user: string
    pass: string
  }
  defaultFrom?: string
  defaultReplyTo?: string
  tls?: {
    rejectUnauthorized?: boolean
    ciphers?: string
  }
}

export interface MailAttachment {
  filename: string
  content?: string | Buffer
  path?: string
  contentType?: string
  cid?: string
}

export interface MailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string // If not provided, it will be generated from html
  from?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  attachments?: MailAttachment[]
}

/**
 * Mailer class wrapper around nodemailer.
 * Designed to be tree-shakeable and configuration-driven without relying on process.env directly.
 */
export class Mailer {
  private transporter: Transporter
  private defaultFrom?: string
  private defaultReplyTo?: string

  constructor(config: MailerConfig) {
    this.defaultFrom = config.defaultFrom
    this.defaultReplyTo = config.defaultReplyTo

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465, // Default secure if port is 465
      auth: config.auth
        ? {
            user: config.auth.user,
            pass: config.auth.pass
          }
        : undefined,
      tls: config.tls
    })
  }

  /**
   * Helper to strip HTML tags for plain text fallback
   */
  private stripHtml(html: string): string {
    if (!html) return ''
    return html
      .replace(/<br\s*\/?>/gi, '\n') // Replace <br> with newlines
      .replace(/<\/p>/gi, '\n\n') // Replace </p> with double newlines
      .replace(/<[^>]*>?/gm, '') // Remove all other tags
      .trim()
  }

  /**
   * Sends an email.
   * @param options Mail options including to, subject, html, etc.
   * @returns The info object from nodemailer.
   */
  public async send(options: MailOptions): Promise<unknown> {
    const from = options.from || this.defaultFrom
    const replyTo = options.replyTo || this.defaultReplyTo

    if (!from) {
      throw new Error('Email "from" address is required (either in options or config.defaultFrom)')
    }

    const mailPayload: SendMailOptions = {
      from,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || this.stripHtml(options.html),
      attachments: options.attachments
    }

    if (options.cc) {
      mailPayload.cc = Array.isArray(options.cc) ? options.cc.join(', ') : options.cc
    }

    if (options.bcc) {
      mailPayload.bcc = Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc
    }

    if (replyTo) {
      mailPayload.replyTo = replyTo
    }

    try {
      const info = await this.transporter.sendMail(mailPayload)
      return info
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to send email to ${mailPayload.to}: ${msg}`)
    }
  }

  /**
   * Verifies the connection configuration.
   */
  public async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify()
      return true
    } catch (error) {
      console.error('Mailer connection verification failed:', error)
      return false
    }
  }
}
