import express from 'express'
export const router = express.Router()
import {
  getProofsByBanId,
  getUnpunishesByPunishId, getUser, processTime, uuidToUsername,
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

router.post('/update', w(async (req, res) => {
  // request:
  // - id: number - punishment id
  // - reason: string
  // - end: number
  // - server?: string - ignored in normal user
  // - unpunish_reason?: string
  // - proofs: Array<{ id: number, value: string }>
  if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
  const id = parseInt(req.body.id)
  if (isNaN(id) || id <= 0) return res.send400()
  const reason = String(req.body.reason)
  if (!reason || !req.body.reason) return res.send400()
  let end = /^\d+$/.test(String(req.body.end)) ? parseInt(req.body.end) : NaN
  if (end <= 0) end = -1
  if (isNaN(end)) {
    try {
      end = processTime(String(req.body.end))
    } catch (e) {
      return res.send400()
    }
  }
  const start = (await sql.findOne('SELECT `start` FROM `punishmentHistory` WHERE `id` = ?', id) as Punishment).start
  end += start
  const unpunishReason = req.body.unpunish_reason ? String(req.body.unpunish_reason) : null
  const proofs = (req.body.proofs || []) as Array<{ id: number, value: string }>
  const session = validateAndGetSession(req)
  if (!session) return res.send403()
  const user = await getUser(session.user_id)
  if (!user) return res.send403()
  if (user.group === 'manager' || user.group === 'admin') {
    const server = String(req.body.server)
    if (!server || !req.body.server) return res.send400()
    await sql.execute('UPDATE `punishmentHistory` SET `reason` = ?, `server` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, server, end, id)
    await sql.execute('UPDATE `punishments` SET `reason` = ?, `server` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, server, end, id)
  } else {
    await sql.execute('UPDATE `punishmentHistory` SET `reason` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, end, id)
    await sql.execute('UPDATE `punishments` SET `reason` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, end, id)
  }
  for (let proof of proofs) {
    await sql.execute('UPDATE `proofs` SET `text` = ? WHERE `id` = ? AND `punish_id` = ? LIMIT 1', proof.value.substring(0, Math.min(proof.value.length, 255)), proof.id, id)
  }
  if (unpunishReason) await sql.execute('UPDATE `unpunish` SET `reason` = ? WHERE `punish_id` = ? LIMIT 1', unpunishReason, id)
  res.send({ message: 'ok' })
}))
