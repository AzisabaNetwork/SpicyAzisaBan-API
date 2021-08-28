import express from 'express'
export const router = express.Router()
import {
  getProofsByBanId,
  getUnpunishesByPunishId, uuidToUsername,
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
  const punishments = await sql.findAll('SELECT * FROM `punishmentHistory` ORDER BY `start` DESC LIMIT ?, 25', page * 25) as Punishment[]
  const unpunishes = (await getUnpunishesByPunishId(...punishments.map(p => p.id))).map(u => u.punish_id)
  punishments.forEach(p => p.unpunished = unpunishes.includes(p.id))
  res.send({
    data: punishments,
    hasNext: punishments.length == 25,
  })
}))

router.get('/get/:id', w(async (req, res) => {
  const session = validateAndGetSession(req)
  if (!session) return res.send403()
  const id = parseInt(req.params.id) || 0
  if (isNaN(id)) return res.send400()
  const punishment = await sql.findOne('SELECT * FROM `punishmentHistory` WHERE `id` = ? LIMIT 1', id) as Punishment
  const unpunish = await sql.findOne('SELECT * FROM `unpunish` WHERE `punish_id` = ? LIMIT 1', id) as Unpunish | null
  if (unpunish) unpunish.operator_name = await uuidToUsername(unpunish.operator)
  punishment.unpunished = !!unpunish
  punishment.unpunish = unpunish
  punishment.operator_name = await uuidToUsername(punishment.operator)
  punishment.proofs = await getProofsByBanId(punishment.id)
  res.send({
    data: punishment,
  })
}))
