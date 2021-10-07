import express from 'express'
import {
  getPlayersByIP, getPunishmentHistoryByTarget,
  getPunishmentsByPunishId,
  sanitizeSQLABit,
  validateAndGetSession,
  w,
} from '../util/util'
import * as sql from '../util/sql'
export const router = express.Router()

router.get('/get/:uuid', w(async (req, res) => {
  const session = validateAndGetSession(req)
  if (!session) return res.send401()
  const uuid = String(req.params.uuid)
  if (!uuid) return res.send404()
  const player = await sql.findOne('SELECT * FROM `players` WHERE `uuid` = ?', sanitizeSQLABit(uuid))
  if (!player) return res.send404()
  const punishments = await sql.findAll(
    'SELECT * FROM `punishmentHistory` WHERE `target` = ? OR `target` = ? ORDER BY `start` DESC',
    player.uuid,
    player.ip,
  ) as Punishment[]
  const activePunishments = (await getPunishmentsByPunishId(...punishments.map(p => p.id))).map(u => u.id)
  punishments.forEach(p => p.active = activePunishments.includes(p.id))
  player.punishments = punishments
  player.ipAddressHistory = await sql.findAll('SELECT `ip`, `last_seen` FROM `ipAddressHistory` WHERE `uuid` = ? ORDER BY `last_seen` DESC', player.uuid)
  player.usernameHistory = await sql.findAll('SELECT `name`, `last_seen` FROM `usernameHistory` WHERE `uuid` = ? ORDER BY `last_seen` DESC', player.uuid)
  res.send(player)
}))

router.get('/find_accounts/:uuid', w(async (req, res) => {
  const session = validateAndGetSession(req)
  if (!session) return res.send401()
  const uuid = String(req.params.uuid)
  if (!uuid) return res.send404()
  const ipsResponse = await sql.findAll('SELECT `ip` FROM `ipAddressHistory` WHERE `uuid` = ?', uuid)
  if (!ipsResponse || ipsResponse.length === 0) return res.send404()
  const ips = ipsResponse.map(it => it.ip).filter((value, index, self) => self.indexOf(value) === index)
  const players = (await getPlayersByIP(...ips)).filter(it => it.uuid !== uuid)
  const punishments = await getPunishmentHistoryByTarget(...ips, ...players.map(it => it.uuid))
  const activePunishments = await getPunishmentsByPunishId(...punishments.map(it => it.id))
  punishments.forEach(it => it.active = !!activePunishments.find(p => p.id === it.id))
  res.send({
    players,
    punishments,
  })
}))
