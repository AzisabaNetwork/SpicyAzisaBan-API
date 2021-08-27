import express from 'express'
export const router = express.Router()
import { queueEmail } from '../util/backgroundTask'
import {
  generateSecureRandomString,
  sleep,
  sessions,
  validateAndGetSession,
  getIPAddress,
  validate2FAToken,
  w, getSessionKey,
} from '../util/util'
import * as sql from '../util/sql'
import * as crypt from '../util/crypt'
const debug = require('debug')('spicyazisaban:route:login')

router.post('/login', w(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
  const email = String(req.body['email'])
  const password = String(req.body['password'])
  // no password || password less than 7 length || no email || does not contain @
  if (
      !password
      || password.length < 7
      || !email
      || !email.includes('@')
  ) {
    return res.status(400).send({ error: 'invalid_email_or_password' })
  }
  const user = await sql.findOne('SELECT `id`, `password`, `username` FROM users WHERE email = ? LIMIT 1', req.body.email)
  if (!user) return res.status(400).send({ error: 'invalid_email_or_password' })
  //if (user.banned) return res.status(400).send({ error: 'banned', reason: user.banned_reason })
  if (user.username.includes('SpicyAzisaBan user')) return res.status(400).send({ error: 'incomplete_user' })
  if (!user.password) return res.status(400).send({ error: 'no_password' })
  if (!await crypt.compare(password, user.password)) return res.status(400).send({ error: 'invalid_email_or_password' })
  if (!await validate2FAToken(user.id, req.body.mfa_token)) return res.status(400).send({ error: 'incorrect_mfa_token' })
  Promise.race([sleep(3000), generateSecureRandomString(50)]).then(state => {
    if (!state) return res.status(500).send({ error: 'timed_out' })
    sessions[state] = {
      expires_at: Date.now() + 172800000, // 2 days
      user_id: user.id,
      ip: getIPAddress(req),
      pending: false
    }
    res.cookie('spicyazisaban_session', state)
    res.send({
      state,
      message: 'logged_in',
    })
  })
}))

router.post('/register', w(async (req, res) => {
  // request:
  // - email: string
  // - password: string
  if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
  const email = req.body['email']
  const password = req.body['password']
  // no password || password less than 7 length || no email || does not contain @
  if (
    !password
    || password.length < 7
    || !email
    || !email.includes('@')
  ) {
    return res.status(400).send({ error: 'invalid_email_or_password' })
  }
  if (await sql.findOne('SELECT `id` FROM users WHERE `email` = ? OR `ip` = ?', email, getIPAddress(req))) {
    return res.status(400).send({ error: 'dupe_user' })
  }
  const user_id = await sql.findOne(
    'INSERT INTO users (`username`, `email`, `password`, `ip`) VALUES (?, ?, ?, ?)',
    `SpicyAzisaBan user #${Date.now()}`,
    email,
    await crypt.hash(password),
    getIPAddress(req),
  ) as number
  Promise.race([sleep(3000), generateSecureRandomString(50)]).then(state => {
    if (!state) return res.status(500).send({ error: 'timed_out' })
    sessions[state] = {
      expires_at: Date.now() + 1000 * 60 * 60,
      user_id: user_id,
      ip: getIPAddress(req),
      pending: true,
    }
    const url = `${process.env.APP_URL}/register/${state}`
    // TODO: don't use english
    queueEmail(`SpicyAzisaBan <${process.env.MAIL_FROM}>`, email, 'Account Verification', undefined, `Hello,<br />
<br />
You have requested to create the account on SpicyAzisaBan, and waiting for your confirmation.<br />
Please click the link below to complete the verification and proceed to account creation.<br />
<a href='${url}'>${url}</a><br />
<br />
If you did not request this, please ignore this mail.
`)
    debug(`Verification email queued for ${user_id} to ${email}: ${url}`)
    res.send({ message: 'ok' })
  })
}))

router.get('/register/:id', w(async (req, res) => {
  const session = sessions[String(req.params.id)]
  if (!session || !session.pending) return res.send403()
  if (session.ip !== getIPAddress(req)) return res.send403() // wrong guy
  res.send({
    id: String(req.params.id),
    user_id: session.user_id
  })
}))

router.all('/logout', w((req, res) => {
  const session = getSessionKey(req)
  if (session) delete sessions[session]
  res.send({ message: 'ok' })
}))

router.get('/me', w(async (req, res) => {
  const session = validateAndGetSession(req)
  if (!session) return res.send401()
  const user = await sql.findOne("SELECT `id`, `username`, `email`, `group`, `last_update` FROM `users` WHERE `id` = ?", session.user_id)
  /*
  if (user && user.banned) {
    session.pending = true
    return res.send401()
  }
  */
  const mfa = await sql.findOne('SELECT `user_id` FROM `users_2fa` WHERE `user_id` = ?', user.id)
  user.mfa_enabled = !!mfa
  res.send(user)
}))
