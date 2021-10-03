import express from 'express'
import { getPunishmentsByPunishId, sanitizeSQLABit, validateAndGetSession, w } from '../util/util'
import * as sql from '../util/sql'
export const router = express.Router()

router.post('/search', w(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.send400()
  const query = String(req.body.query).toLowerCase()
  if (!query || !req.body.query) return res.send400()
  const type = String(req.body.type).toLowerCase().split(',')
  if (!req.body.type || !type) return res.send({ players: [], punishments: [] })
  const session = validateAndGetSession(req)
  if (!session) return res.send401()
  const data: {
    players: Array<any>,
    punishments: Array<any>,
  } = {
    players: new Array<any>(),
    punishments: new Array<any>(),
  }
  if (type.includes('players')) {
    data.players = await sql.findAll(
      'SELECT `name`, `uuid`, `last_seen` FROM `players` WHERE lower(`name`) LIKE lower(?) OR lower(`uuid`) = lower(?) OR `ip` = ?',
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
