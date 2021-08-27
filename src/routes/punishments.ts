import express from 'express'
export const router = express.Router()
import {
  getUnpunishesByPunishId,
  validateAndGetSession,
  w,
} from '../util/util'
import * as sql from '../util/sql'
const debug = require('debug')('spicyazisaban:route:punishments')

router.get('/list', w(async (req, res) => {
  const session = validateAndGetSession(req)
  if (!session) return res.send403()
  let page = parseInt(req.query?.page) || 0
  if (isNaN(page)) page = 0
  page = Math.max(0, page)
  const punishments = await sql.findAll('SELECT * FROM `punishmentHistory` ORDER BY `start` DESC LIMIT ?, 25', page) as Punishment[]
  const unpunishes = (await getUnpunishesByPunishId(...punishments.map(p => p.id))).map(u => u.punish_id)
  punishments.forEach(p => p.unpunished = unpunishes.includes(p.id))
  res.send({
    data: punishments,
    hasNext: punishments.length == 25,
  })
}))
