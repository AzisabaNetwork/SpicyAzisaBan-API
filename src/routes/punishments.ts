import express from 'express'

export const router = express.Router()
import {
  checkServerPermission,
  getProofsByBanId,
  getPunishmentsByPunishId,
  getUnpunishesByPunishId,
  getUser,
  isPunishableIP,
  isValidIPAddress,
  resolveToIPByTarget,
  resolveToPlayerByTarget,
  uuidToUsername,
  validateAndGetSession,
  w,
} from '../util/util'
import * as sql from '../util/sql'

const debug = require('debug')('spicyazisaban:route:punishments')

const validPunishmentTypes = [
  'BAN',
  'TEMP_BAN',
  'IP_BAN',
  'TEMP_IP_BAN',
  'MUTE',
  'TEMP_MUTE',
  'IP_MUTE',
  'TEMP_IP_MUTE',
  'WARNING',
  'CAUTION',
  'KICK',
  'NOTE',
]

router.get('/list', w(async (req, res) => {
  // request:
  // - page: number - page number, each page contains 25 entries
  const session = await validateAndGetSession(req)
  if (!session) return res.send403()
  let page = parseInt(req.query?.page) || 0
  if (isNaN(page)) page = 0
  page = Math.max(0, page)
  const punishments = await sql.findAll('SELECT * FROM `punishmentHistory` ORDER BY `start` DESC LIMIT ?, 25', page * 25) as Punishment[]
  const activePunishments = (await getPunishmentsByPunishId(...punishments.map(p => p.id))).map(u => u.id)
  const unpunishes = (await getUnpunishesByPunishId(...punishments.map(p => p.id))).map(u => u.punish_id)
  punishments.forEach(p => p.unpunished = unpunishes.includes(p.id))
  punishments.forEach(p => p.active = activePunishments.includes(p.id))
  res.send({
    data: punishments,
    hasNext: punishments.length == 25, // returns true even if size of punishmentHistory % 25 == 0? i don't care for now.
  })
}))

router.get('/punishments_by/:uuid', w(async (req, res) => {
  // request:
  // - uuid: string - player's uuid
  const session = await validateAndGetSession(req)
  if (!session) return res.send403()
  const uuid = String(req.params.uuid)
  if (uuid.length != 36) return res.send400()
  const punishments = await sql.findAll('SELECT * FROM `punishmentHistory` WHERE `operator` = ? ORDER BY `start`', uuid) as Punishment[]
  const activePunishments = (await getPunishmentsByPunishId(...punishments.map(p => p.id))).map(u => u.id)
  const unpunishes = (await getUnpunishesByPunishId(...punishments.map(p => p.id))).map(u => u.punish_id)
  punishments.forEach(p => p.unpunished = unpunishes.includes(p.id))
  punishments.forEach(p => p.active = activePunishments.includes(p.id))
  res.send({
    data: punishments,
  })
}))

router.get('/get/:id', w(async (req, res) => {
  const session = await validateAndGetSession(req)
  if (!session) return res.send401()
  const id = parseInt(req.params.id) || 0
  if (isNaN(id)) return res.send400()
  const punishment = await sql.findOne('SELECT * FROM `punishmentHistory` WHERE `id` = ? LIMIT 1', id) as Punishment
  const activePunishment = await sql.findOne('SELECT `id` FROM `punishments` WHERE `id` = ? LIMIT 1', id) as { id: number }
  const unpunish = await sql.findOne('SELECT * FROM `unpunish` WHERE `punish_id` = ? LIMIT 1', id) as Unpunish | null
  if (unpunish) unpunish.operator_name = await uuidToUsername(unpunish.operator)
  punishment.unpunished = !!unpunish
  punishment.unpunish = unpunish
  punishment.operator_name = await uuidToUsername(punishment.operator)
  punishment.proofs = await getProofsByBanId(punishment.id)
  punishment.active = !!activePunishment
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
  // - proofs: Array<{ id: number, value: string | null }>
  if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
  const id = parseInt(req.body.id)
  if (isNaN(id) || id <= 0) return res.send400()
  const reason = String(req.body.reason)
  if (!reason || !req.body.reason) return res.send400()
  let end = parseInt(req.body.end)
  if (isNaN(end)) return res.send400()
  if (end <= 0) end = -1
  const unpunishReason = req.body.unpunish_reason ? String(req.body.unpunish_reason) : null
  const proofs = (req.body.proofs || []) as Array<{ id: number, value: string }>
  const session = await validateAndGetSession(req)
  if (!session) return res.send403()
  const user = await getUser(session.user_id)
  if (!user) return res.send403()
  const punishment = await sql.findOne('SELECT `server` FROM `punishmentHistory` WHERE `id` = ?', id)
  if (!punishment) return res.status(404).send({ error: 'not_found' })
  if (!checkServerPermission(user.group, punishment.server)) {
    return res.status(403).send({ error: 'missing_permissions' })
  }
  if (user.group === 'manager' || user.group === 'admin') {
    const server = String(req.body.server).toLowerCase()
    if (!server || !req.body.server) return res.send400()
    await sql.execute('UPDATE `punishmentHistory` SET `reason` = ?, `server` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, server, end, id)
    await sql.execute('UPDATE `punishments` SET `reason` = ?, `server` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, server, end, id)
  } else {
    await sql.execute('UPDATE `punishmentHistory` SET `reason` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, end, id)
    await sql.execute('UPDATE `punishments` SET `reason` = ?, `end` = ? WHERE `id` = ? LIMIT 1', reason, end, id)
  }
  const newProofs = new Array<{ id: number, value: string }>()
  const currentProofs = await getProofsByBanId(id)
  for (const proof of currentProofs) {
    if (!proofs.find(p => p.id === proof.id)) {
      await sql.execute('DELETE FROM `proofs` WHERE `id` = ? AND `punish_id` = ? LIMIT 1', proof.id, id)
    }
  }
  for (const proof of proofs) {
    if (proof.value && proof.id > 0) {
      await sql.execute('UPDATE `proofs` SET `text` = ? WHERE `id` = ? AND `punish_id` = ? LIMIT 1', proof.value.toString().substring(0, Math.min(proof.value.toString().length, 255)), proof.id, id)
      newProofs.push({ id: proof.id, value: proof.value.toString() })
    }
    if (proof.value && proof.id === -1) {
      const proofId = await sql.findOne('INSERT INTO `proofs` (`id`, `punish_id`, `text`) VALUES (NULL, ?, ?)', id, proof.value.toString())
      newProofs.push({ id: proofId, value: proof.value.toString() })
    }
  }
  if (unpunishReason) await sql.execute('UPDATE `unpunish` SET `reason` = ? WHERE `punish_id` = ? LIMIT 1', unpunishReason, id)
  await sql.execute('INSERT INTO `events` (`event_id`, `data`, `seen`) VALUES ("updated_punishment", ?, "")', JSON.stringify({ id }))
  debug(`Punishment #${id} successfully updated by ${user.id}`)
  res.send({ message: 'ok', proofs: newProofs })
}))

router.post('/create', w(async (req, res) => {
  // request:
  // - target: string - player name, uuid, or an ip address
  // - type: string
  // - reason: string
  // - start: number
  // - end: number
  // - server: string
  // - all?: boolean - unsupported yet
  // response (200):
  // - ids: number[] - created punishment ids (may contain more than 1 element if all is true)
  // errors:
  // - not_linked - the actor hasn't linked a minecraft account yet
  // - player_not_resolved - ip or player couldn't be resolved
  // - not_punishable_ip - provided ip address cannot be banned (reserved or private)
  // - invalid_end - invalid "end" value (NaN or end < start)
  // - server_not_enough_permission - not enough permission to modify server to anything other than "global"
  if (!req.body || typeof req.body !== 'object') return res.send400()
  const target = String(req.body.target)
  if (!target || !req.body.target) return res.send400()
  const reason = String(req.body.reason)
  if (!reason || !req.body.reason) return res.send400()
  let server = String(req.body.server).toLowerCase()
  if (!server || !req.body.server) return res.send400()
  const start = parseInt(req.body.start)
  if (isNaN(start)) return res.status(400).send({ error: 'invalid_start' })
  if (start <= 0) return res.status(400).send({ error: 'invalid_start' })
  let end = parseInt(req.body.end)
  if (isNaN(end)) return res.status(400).send({ error: 'invalid_end' })
  if (end <= 0) end = -1
  if (end !== -1 && end < start) return res.status(400).send({ error: 'invalid_end' })
  const type = String(req.body.type)
  if (!validPunishmentTypes.includes(type)) return res.send400()
  let name: string
  let finalTarget: string
  const session = await validateAndGetSession(req)
  if (!session) return res.send401()
  if (type.includes('IP_')) {
    if (isValidIPAddress(target) && !isPunishableIP(target)) {
      return res.status(400).send({ error: 'not_punishable_ip' })
    }
    const tempTarget = await resolveToIPByTarget(target)
    if (!tempTarget) {
      return res.status(404).send({ error: 'player_not_resolved' })
    }
    name = finalTarget = tempTarget
  } else {
    if (isValidIPAddress(target)) {
      return res.status(404).send({ error: 'player_not_resolved' })
    }
    const player = await resolveToPlayerByTarget(target)
    if (!player) {
      return res.status(404).send({ error: 'player_not_resolved' })
    }
    name = player.name
    finalTarget = player.uuid
  }
  const user = await sql.findOne('SELECT `group` FROM `users` WHERE `id` = ?', session.user_id)
  if (server !== 'global' && user?.group !== 'manager' && user?.group !== 'admin') {
    return res.status(400).send({ error: 'server_not_enough_permission' })
  }
  const linkedUUIDResponse = await sql.findOne('SELECT `linked_uuid` FROM `users_linked_accounts` WHERE `user_id` = ?', session.user_id)
  const operator = linkedUUIDResponse ? linkedUUIDResponse['linked_uuid'] : null
  if (!operator) return res.status(403).send({ error: 'not_linked' })
  const id = await sql.findOne(
    'INSERT INTO `punishmentHistory` (`name`, `target`, `reason`, `operator`, `type`, `start`, `end`, `server`, `extra`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    name,
    finalTarget,
    reason,
    operator,
    type,
    start,
    end,
    server,
    '',
  )
  await sql.execute(
    'INSERT INTO `punishments` (`id`, `name`, `target`, `reason`, `operator`, `type`, `start`, `end`, `server`, `extra`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    name,
    finalTarget,
    reason,
    operator,
    type,
    start,
    end,
    server,
    '',
  )
  await sql.execute('INSERT INTO `events` (`event_id`, `data`, `seen`) VALUES ("add_punishment", ?, "")', JSON.stringify({ id }))
  debug(`Punishment #${id} successfully created by ${session.user_id}`)
  res.send({ ids: [ id ] })
}))

router.post('/unpunish', w(async (req, res) => {
  // request:
  // - id: number - punishment id
  // - reason: string - unpunish reason
  if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
  const id = parseInt(req.body.id)
  if (isNaN(id) || id <= 0) return res.send400()
  const reason = String(req.body.reason)
  if (!reason || !req.body.reason) return res.send400()
  const session = await validateAndGetSession(req)
  if (!session) return res.send403()
  const linkedUUIDResponse = await sql.findOne('SELECT `linked_uuid` FROM `users_linked_accounts` WHERE `user_id` = ?', session.user_id)
  const operator = linkedUUIDResponse ? linkedUUIDResponse['linked_uuid'] : null
  if (!operator) return res.status(403).send({ error: 'not_linked' })
  const user = await getUser(session.user_id)
  if (!user) return res.send403()
  const punishment = await sql.findOne('SELECT `server` FROM `punishmentHistory` WHERE `id` = ?', id)
  if (!punishment) return res.status(404).send({ error: 'not_found' })
  if (!checkServerPermission(user.group, punishment.server)) {
    return res.status(403).send({ error: 'missing_permissions' })
  }
  await sql.execute('DELETE FROM `punishments` WHERE `id` = ?', id)
  await sql.execute('INSERT INTO `unpunish` (`punish_id`, `reason`, `timestamp`, `operator`) VALUES (?, ?, ?, ?)', id, reason, Date.now(), operator)
  await sql.execute('INSERT INTO `events` (`event_id`, `data`, `seen`) VALUES ("removed_punishment", ?, "")', JSON.stringify({ punish_id: id }))
  debug(`Punishment #${id} successfully unpunished by ${user.id}`)
  res.send({ message: 'ok' })
}))
