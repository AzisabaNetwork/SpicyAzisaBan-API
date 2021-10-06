import express from 'express'
import { getPunishmentsByPunishId, sanitizeSQLABit, validateAndGetSession, w } from '../util/util'
import * as sql from '../util/sql'
export const router = express.Router()

router.post('/search', w(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.send400()
  const query = String(req.body.query).toLowerCase()
  if (!query || !req.body.query) return res.send400()
  const type = String(req.body.type).toLowerCase().split(',')
  if (!req.body.type || !type) return res.send({ users: [], players: [], punishments: [] })
  const session = validateAndGetSession(req)
  if (!session) return res.send401()
  const user = await sql.findOne('SELECT `group` FROM `users` WHERE `id` = ?', session.user_id)
  if (!user) throw new Error('Could not find an user ' + session.user_id)
  const data = {
    users: new Array<any>(),
    players: new Array<any>(),
    punishments: new Array<any>(),
  }
  if (user.group === 'admin' && type.includes('users')) {
    data.users = await sql.findAll(
      'SELECT `id`, `username`, `email`, `group` FROM `users` WHERE lower(`username`) LIKE lower(?) OR lower(`email`) LIKE lower(?)',
      `%${sanitizeSQLABit(query)}%`,
      `%${sanitizeSQLABit(query)}%`,
    )
  }
  if (type.includes('players')) {
    data.players = await sql.findAll(
      'SELECT `name`, `uuid`, `last_login`, `ip` FROM `players` WHERE lower(`name`) LIKE lower(?) OR lower(`uuid`) = lower(?) OR `ip` = ?',
      `%${sanitizeSQLABit(query)}%`,
      query,
      query,
    )
  }
  if (type.includes('punishments')) {
    data.punishments = await sql.findAll(
      'SELECT * FROM `punishmentHistory` WHERE lower(`name`) LIKE lower(?) OR `target` = ? OR lower(`reason`) LIKE lower(?)',
      `%${sanitizeSQLABit(query)}%`,
      query,
      `%${sanitizeSQLABit(query)}%`,
    )
    data.punishments.reverse()
    const activePunishments = (await getPunishmentsByPunishId(...data.punishments.map(p => p.id))).map(u => u.id)
    data.punishments.forEach(p => p.active = activePunishments.includes(p.id))
  }
  res.send(data)
}))
