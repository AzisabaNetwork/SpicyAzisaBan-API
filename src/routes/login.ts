import express from 'express'
export const router = express.Router()
import { queueEmail } from '../util/backgroundTask'
import {
  generateSecureRandomString,
  sleep,
  validateAndGetSession,
  getIPAddress,
  validate2FAToken,
  w, getSessionKey, putSession, getSession, deleteSession,
} from '../util/util'
import * as sql from '../util/sql'
import * as crypt from '../util/crypt'
import { SESSION_LENGTH, UNCONFIRMED_USER_SESSION_LENGTH } from '../util/constants'
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
    return res.status(401).send({ error: 'invalid_email_or_password' })
  }
  const user = await sql.findOne('SELECT `id`, `password`, `username` FROM users WHERE email = ? LIMIT 1', req.body.email)
  if (!user) {
    return res.status(401).send({ error: 'invalid_email_or_password' })
  }
  //if (user.banned) return res.status(400).send({ error: 'banned', reason: user.banned_reason })
  if (user.username.includes('SpicyAzisaBan user')) {
    return res.status(401).send({ error: 'incomplete_user' })
  }
  if (!user.password) {
    return res.status(401).send({ error: 'no_password' })
  }
  if (!await crypt.compare(password, user.password)) {
    return res.status(401).send({ error: 'invalid_email_or_password' })
  }
  if (!await validate2FAToken(user.id, req.body.mfa_token)) {
    return res.status(401).send({ error: 'invalid_email_or_password' })
  }
  await Promise.race([sleep(10000), generateSecureRandomString(50)]).then(async state => {
    if (!state) return res.status(500).send({ error: 'timed_out' })
    await putSession({
      state,
      expires_at: Date.now() + SESSION_LENGTH, // a week
      user_id: user.id,
      ip: getIPAddress(req),
      pending: false
    })
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
    return res.status(401).send({ error: 'invalid_email_or_password' })
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
  await Promise.race([sleep(3000), generateSecureRandomString(50)]).then(async state => {
    if (!state) return res.status(500).send({ error: 'timed_out' })
    await putSession({
      state,
      expires_at: Date.now() + UNCONFIRMED_USER_SESSION_LENGTH,
      user_id: user_id,
      ip: getIPAddress(req),
      pending: true,
    })
    const url = `${process.env.APP_URL}/register?state=${state}`
    queueEmail(`SpicyAzisaBan <${process.env.MAIL_FROM}>`, email, 'アカウント認証', undefined, `Hello,<br />
<br />
SpicyAzisaBanのウェブサイトでアカウントデータを作成しました。<br />
下記のリンクをクリックして認証を完了してアカウントの作成を完了させてください。
<a href='${url}'>${url}</a><br />
<br />
アカウント作成をリクエストしていない場合は、このメールを無視してください。
`)
    debug(`Verification email queued for ${user_id} to ${email}: ${url}`)
    res.send({ message: 'ok' })
  })
}))

router.get('/register/:id', w(async (req, res) => {
  const session = await getSession(String(req.params.id))
  if (!session || !session.pending) return res.send403()
  if (session.ip !== getIPAddress(req)) return res.send403() // wrong guy
  res.send({
    id: String(req.params.id),
    user_id: session.user_id
  })
}))

router.all('/logout', w(async (req, res) => {
  const session = getSessionKey(req)
  if (session) await deleteSession(session)
  res.send({ message: 'ok' })
}))

router.get('/me', w(async (req, res) => {
  const session = await validateAndGetSession(req)
  if (!session) return res.send401()
  const user = await sql.findOne("SELECT `id`, `username`, `group`, `last_update` FROM `users` WHERE `id` = ?", session.user_id)
  if (!user) return res.send401()
  /*
  if (user && user.banned) {
    session.pending = true
    return res.send401()
  }
  */
  const linkedUUIDResponse = await sql.findOne('SELECT `linked_uuid` FROM `users_linked_accounts` WHERE `user_id` = ?', user.id)
  // find name of uuid only if linked_uuid is present, null if linked_uuid is not present
  const linkedNameResponse = linkedUUIDResponse?.linked_uuid
    ? await sql.findOne('SELECT `name` FROM `players` WHERE `uuid` = ?', linkedUUIDResponse?.linked_uuid)
    : null
  const mfa = await sql.findOne('SELECT `user_id` FROM `users_2fa` WHERE `user_id` = ?', user.id)
  const discordData = await sql.findOne('SELECT `discord_user_id`, `discord_user_tag` FROM `users_linked_discord_account` WHERE `user_id` = ?', user.id)
  user.linked_uuid = linkedUUIDResponse?.linked_uuid || null
  user.linked_name = linkedNameResponse?.name || null
  user.mfa_enabled = !!mfa
  if (discordData) {
    user.discord_user_id = discordData.discord_user_id
    user.discord_user_tag = discordData.discord_user_tag
  }
  res.send(user)
}))
