import mailDriver from './mailDriver'
import fetch from 'node-fetch'
const debug = require('debug')('spicyazisaban:mail:discord')

export default class extends mailDriver {
  public send(from: string, to: string, subject: string, text?: string, html?: string): void {
    const url = process.env.MAIL_DISCORD_WEBHOOK as string | undefined
    if (!url || url.length === 0) {
      debug('Warning: MAIL_DISCORD_WEBHOOK is not set, the message will not be sent')
    } else {
      fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': `SpicyAzisaBan-API - https://github.com/AzisabaNetwork/SpicyAzisaBan-API`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          content: null,
          embeds: [
            {
              color: 6077183,
              fields: [
                { name: "From", value: from, },
                { name: "To", value: to, },
                { name: "Subject", value: subject, },
                { name: "Content (HTML)", value: html || '(empty)', },
                { name: "Content (Text)", value: text || '(empty)', },
              ]
            }
          ],
        })
      }).catch(e => {
        debug('Failed to execute webhook', e)
      })
    }
    debug(`From: ${from}`)
    debug(`To: ${to}`)
    debug(`Subject: ${subject}`)
    if (text) debug(`Text: ${text}`)
    if (html) debug(`HTML: ${html}`)
  }
}
