import mailDriver from './mailDriver'
import nodemailer, { Transporter } from 'nodemailer'
const debug = require('debug')('spicyazisaban:mail:smtp')

export default class extends mailDriver {
  private transporter: Transporter

  public init() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST!,
      port: parseInt(process.env.MAIL_PORT!),
      secure: parseInt(process.env.MAIL_PORT!) === 465,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD,
      },
    })
  }

  public send(from: string, to: string, subject: string, text?: string, html?: string): void {
    this.transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    }).catch(() => {
      debug(`Failed to send email to: ${to}`)
      debug(`From: ${from}`)
      debug(`To: ${to}`)
      debug(`Subject: ${subject}`)
      if (text) debug(`Text: ${text}`)
      if (html) debug(`HTML: ${html}`)
    })
  }
}
