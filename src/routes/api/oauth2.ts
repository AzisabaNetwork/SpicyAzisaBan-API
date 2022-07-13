import express from 'express'
import {
  generateSecureRandomString, getIPAddress, putSession, rateLimit, sleep, validateAndGetSession,
  w,
} from '../../util/util'
import * as sql from '../../util/sql'
import fetch from 'node-fetch'
import { SESSION_LENGTH } from '../../util/constants'
export const router = express.Router()

const states: {
  [state: string]: {
    type: 'link' | 'login'
    user_id: number | null // only present if type is 'link'
    redir: string,
  }
} = {}

router.get('/discord/get_url', w(async (req, res) => {
  if (rateLimit('route:api:oauth2:discord/get_url', 'ip:' + getIPAddress(req), 30)) {
    return res.status(429).send({ error: 'rate_limited' })
  }
  const session = await validateAndGetSession(req)
  const forWhat = String(req.query?.['for'])
  if (forWhat !== 'link' && forWhat !== 'login') return res.send400()
  const clientId = String(process.env.DISCORD_CLIENT_ID)
  const state = await generateSecureRandomString(25)
  const redir = encodeURIComponent(decodeURIComponent(req.query?.apiRoot) + '/api/oauth2/discord/callback')
  const url = `https://discord.com/api/oauth2/authorize?response_type=code&client_id=${clientId}&scope=identify&state=${state}&redirect_uri=${redir}&prompt=consent`
  states[state] = {
    type: forWhat,
    user_id: session?.user_id || null,
    redir,
  }
  res.send({ url })
  setTimeout(() => {
    delete states[state]
  }, 1000 * 60 * 5)
}))

router.get('/discord/callback', w(async (req, res) => {
  if (rateLimit('route:login:login', 'ip:' + getIPAddress(req), 15)) {
    return res.status(429).send({ error: 'rate_limited' })
  }
  const state = String(req.query?.state)
  const code = String(req.query?.code)
  if (!(req.query?.state) || !(req.query?.code) || !state || !code) return res.send400()
  const data = states[state]
  if (!data) return res.send400()
  const clientId = String(process.env.DISCORD_CLIENT_ID)
  const clientSecret = String(process.env.DISCORD_CLIENT_SECRET)
  const redir = String(data.redir)
  const token = await fetch(`https://discord.com/api/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=authorization_code&code=${code}&redirect_uri=${redir}`,
  }).then(res => res.json())
  const accessToken = token['access_token']
  const tokenType = token['token_type']
  if (!accessToken || !tokenType) return res.send401()
  const me = await fetch(`https://discord.com/api/oauth2/@me`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `${tokenType} ${accessToken}`,
    },
  }).then(res => res.json())
  const userId = me.user.id
  const username = me.user.username
  const discriminator = me.user.discriminator
  const tag = `${username}#${discriminator}`
  if (data.type === 'login') {
    const record = await sql.findOne('SELECT `user_id` FROM `users_linked_discord_account` WHERE `discord_user_id` = ?', userId)
    if (!record) return res.redirect(`${process.env.APP_URL}/?error=discord_not_linked`)
    await Promise.race([sleep(3000), generateSecureRandomString(50)]).then(async state => {
      if (!state) return res.status(500).send({ error: 'timed_out' })
      await putSession({
        state,
        expires_at: Date.now() + SESSION_LENGTH, // a week
        user_id: record.user_id,
        ip: getIPAddress(req),
        pending: false
      })
      res.cookie('spicyazisaban_session', state)
      res.redirect(`${process.env.APP_URL}/me?state=${state}`)
    })
  } else if (data.type === 'link') {
    const existingRecord = await sql.findOne('SELECT `user_id` FROM `users_linked_discord_account` WHERE `user_id` = ?', data.user_id)
    if (existingRecord) {
      await sql.execute('UPDATE `users_linked_discord_account` SET `discord_user_id` = ?, `discord_user_tag` = ?', userId, tag)
    } else {
      await sql.execute('INSERT INTO `users_linked_discord_account` (`user_id`, `discord_user_id`, `discord_user_tag`) VALUES (?, ?, ?)', data.user_id, userId, tag)
    }
  }
  res.redirect(`${process.env.APP_URL}/me`)
}))
