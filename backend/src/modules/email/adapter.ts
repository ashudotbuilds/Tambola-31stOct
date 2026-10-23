import { AppError } from '../../errors'

export interface EmailOptions { url?: string; apiKey?: string; from?: string }

export class EmailAdapter {
  constructor(private readonly options: EmailOptions = {}, private readonly timeoutMs = 8_000) {}

  get configured() { return !!(this.options.url && this.options.apiKey && this.options.from) }

  async sendCredential(to: string, name: string, password: string, accountType = 'participant') {
    if (!this.configured) throw new AppError(503, 'Credential email is not configured')
    const url = new URL(this.options.url!)
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new AppError(503, 'Credential email endpoint must use HTTPS')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.options.from,
          to,
          subject: `Your Technical Tambola ${accountType} account`,
          text: `Hello ${name},\n\nYour Technical Tambola ${accountType} account is ready.\n\nEmail: ${to}\nTemporary password: ${password}\n\nSign in at the event website. Keep this message private.`,
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new AppError(502, 'Credential email delivery failed')
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(502, 'Credential email delivery failed')
    } finally { clearTimeout(timeout) }
  }
}
