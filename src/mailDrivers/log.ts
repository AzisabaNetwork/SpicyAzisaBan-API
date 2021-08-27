import mailDriver from './mailDriver'
const debug = require('debug')('spicyazisaban:mail:log')

export default class extends mailDriver {
  public send(from: string, to: string, subject: string, text?: string, html?: string): void {
    debug(`From: ${from}`)
    debug(`To: ${to}`)
    debug(`Subject: ${subject}`)
    if (text) debug(`Text: ${text}`)
    if (html) debug(`HTML: ${html}`)
  }
}
