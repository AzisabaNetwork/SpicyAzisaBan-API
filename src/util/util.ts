import crypto from 'crypto'
import * as sql from './sql'
import * as totp from './totp'
import express, { NextFunction } from 'express'
import { parse, stringify } from 'uuid'

const sessions: SessionTable = {}

export const generateSecureRandomString = (lengthDividedBy2: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(lengthDividedBy2, function(err, buffer) {
      if (err) {
        reject(err)
      } else {
        resolve(buffer.toString('hex'))
      }
    });
  })
}

export const sleep = async (time: number): Promise<void> => {
  await new Promise((res) => setTimeout(res, time));
}

// accepts:
// - spicyazisaban_session in cookies
// - spicyazisaban_session in request body
// - x-spicyazisaban-session in request headers
export const validateAndGetSession = async (req: express.Request): Promise<Session | null> => {
  const session = getSessionKey(req)
  if (!session) return null
  const token = await getSession(session)
  // reject if:
  // - no session
  // - expired session
  // - pending registration
  if (!session || !token || token.pending || token.expires_at <= Date.now()) return null
  if (token.ip !== getIPAddress(req)) return null // reject if ip address does not match
  return token
}

export const getSessionKey = (req: express.Request): string | null => {
  let session: string | null = null
  if (req.cookies) session = req.cookies['spicyazisaban_session']
  if (!session && req.body) session = req.body['spicyazisaban_session']
  if (!session && req.headers) session = req.headers['x-spicyazisaban-session']?.toString() || null
  return session
}

export const getIPAddress = (req: express.Request) => {
  const cloudflareHeader = req.headers['cf-connecting-ip']
  if (cloudflareHeader) return cloudflareHeader as string
  return req.ip
}

export const readableTime = (time: number): string => {
  if (time < 0) {
    time = -time
    if (time < 1000 * 60) return `${Math.floor(time / 1000)}秒前`
    if (time < 1000 * 60 * 60) return `${Math.floor(time / (1000 * 60))}分前`
    if (time < 1000 * 60 * 60 * 24) return `${Math.floor(time / (1000 * 60 * 60))}時間前`
    if (time < 1000 * 60 * 60 * 24 * 30) return `${Math.floor(time / (1000 * 60 * 60 * 24))}日前`
    return `${Math.floor(time / (1000 * 60 * 60 * 24 * 30))}か月前`
  } else {
    if (time < 1000 * 60) return 'soon&trade;'
    if (time < 1000 * 60 * 60) return `${Math.floor(time / (1000 * 60))}分後`
    if (time < 1000 * 60 * 60 * 24) return `${Math.floor(time / (1000 * 60 * 60))}時間後`
    if (time < 1000 * 60 * 60 * 24 * 30) return `${Math.floor(time / (1000 * 60 * 60 * 24))}日後`
    return `${Math.floor(time / (1000 * 60 * 60 * 24 * 30))}か月後`
  }
}

// nullable
export const getUser = async (user_id: number): Promise<User | null> => {
  return await sql.findOne("SELECT `id`, `username`, `email`, `group`, `last_update` FROM `users` WHERE `id` = ?", user_id)
}

// nullable
export const getPlayer = async (uuid: string): Promise<Player | null> => {
  return await sql.findOne("SELECT * FROM `players` WHERE `uuid` = ?", uuid)
}

/**
 * @returns {Promise<boolean>} true if valid, false otherwise
 */
export const validate2FAToken = async (userId: number, token: string, notFoundIsFalse = false): Promise<boolean> => {
  const mfa = await sql.findOne('SELECT `secret_key` FROM `users_2fa` WHERE `user_id` = ?', userId)
  if (!mfa) return !notFoundIsFalse
  const mfaToken = String(token)
  if (mfaToken.length < 6) return false
  let result: boolean
  try {
    result = totp.validate(mfa.secret_key, mfaToken)
  } catch (e) {
    result = false
  }
  if (!result) {
    const match = await sql.findOne('SELECT * FROM `users_2fa_recovery_codes` WHERE `user_id` = ? AND `used` = 0 AND `code` = ?', userId, mfaToken)
    if (!match) return false
    await sql.execute('UPDATE `users_2fa_recovery_codes` SET `used` = 1 WHERE `user_id` = ? AND `code` = ?', userId, match.code)
  }
  // no 2fa
  return true
}

export const isValidName = (name: string): boolean => {
  if (name.length < 4) return false
  if (name.length > 32) return false
  if (name.includes('SpicyAzisaBan')) return false
  return /^[a-zA-Z0-9_-]{4,32}$/.test(name)
}

export const rateLimits: { [id: string]: { [s: string]: number } } = {}

/**
 * @param id id of the rate limit thing
 * @param s thing
 * @param n max requests
 * @returns {boolean} true if rate limit should be applied
 */
export const rateLimit = (id: string, s: string, n: number): boolean => {
  if (!rateLimits[id]) rateLimits[id] = {}
  if (rateLimits[id][s] > n) return true
  rateLimits[id][s] = (rateLimits[id][s] || 0) + 1
  return false
}

// @ts-ignore
export const w = (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res, next)
  } catch (e) {
    next(e)
  }
}

export const uuidToUsername = async (uuid: string): Promise<string> => {
  if (uuid === '00000000-0000-0000-0000-000000000000') return 'CONSOLE'
  uuid = stringify(parse(uuid)) // normalize uuid
  return (await sql.findOne('SELECT `name` FROM `players` WHERE `uuid` = ?', uuid) as { name: string }).name
}

export const dateToSQL = (date: Date): string => {
  const YYYY = date.getFullYear()
  const MM = date.getMonth() + 1
  const DD = date.getDate()
  const hh = date.getHours()
  const mm = date.getMinutes()
  const ss = date.getSeconds()
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`
}

// it makes easier... doing this
// const serverIds: any[] = []
// result.forEach(r => {
//   serverIds.includes(r.server_id) || serverIds.push(r.server_id)
// })
export const collect = (array: Array<any>, ...keys: string[]): unknown[] => {
  const arr = new Array<unknown>()
  array.forEach(e => {
    keys.forEach(key => {
      const v = e[key]
      if (!arr.includes(v)) arr.push(v)
    })
  })
  return arr
}

export const getUsers = async (...uuids: string[]): Promise<Array<Player>> => {
  const where = uuids.length > 0 ? ' WHERE uuid=' + uuids.map(() => '?').join(' AND uuid=') : ''
  return await sql.findAll('SELECT * FROM `players`' + where, ...uuids)
}
/*
export const getServers = async (...servers: number[]): Promise<Array<Server>> => {
    const where = servers.length > 0 ? ' WHERE id=' + servers.join(' AND id=') : ''
    return await sql.findAll('SELECT * FROM `servers`' + where)
}
*/

export const getUnpunishesByPunishId = async (...banIds: number[]): Promise<Array<Unpunish>> => {
  const where = banIds.length > 0 ? ' WHERE punish_id=' + banIds.join(' OR punish_id=') : ''
  return await sql.findAll('SELECT * FROM `unpunish`' + where)
}

export const getPunishmentsByPunishId = async (...banIds: number[]): Promise<Array<Punishment>> => {
  const where = banIds.length > 0 ? ' WHERE id=' + banIds.join(' OR id=') : ''
  return await sql.findAll('SELECT * FROM `punishments`' + where)
}

export const getPunishmentsByTarget = async (...targets: number[]): Promise<Array<Punishment>> => {
  const where = targets.length > 0 ? ' WHERE target=' + targets.join(' OR target=') : ''
  return await sql.findAll('SELECT * FROM `punishments`' + where)
}

export const getPunishmentHistoryByTarget = async (...targets: string[]): Promise<Array<Punishment>> => {
  const where = targets.length > 0 ? ' WHERE target=' + targets.map(() => '?').join(' OR target=') : ''
  return await sql.findAll('SELECT * FROM `punishmentHistory`' + where, ...targets)
}

export const getProofsByBanId = async (...banIds: number[]): Promise<Array<Proof>> => {
  const where = banIds.length > 0 ? ' WHERE punish_id=' + banIds.join(' OR punish_id=') : ''
  return await sql.findAll('SELECT * FROM `proofs`' + where)
}

export const getProofsById = async (...ids: number[]): Promise<Array<Proof>> => {
  const where = ids.length > 0 ? ' WHERE id=' + ids.join(' OR id=') : ''
  return await sql.findAll('SELECT * FROM `proofs`' + where)
}

export const getPlayersByUUID = async (...uuids: string[]): Promise<Array<Player>> => {
  const where = uuids.length > 0 ? ' WHERE uuid=' + uuids.map(() => '?').join(' OR uuid=') : ''
  return await sql.findAll('SELECT * FROM `players`' + where, ...uuids)
}

export const getPlayersByName = async (...names: string[]): Promise<Array<Player>> => {
  const where = names.length > 0 ? ' WHERE name=' + names.map(() => '?').join(' OR name=') : ''
  return await sql.findAll('SELECT * FROM `players`' + where, ...names)
}

export const getPlayersByIP = async (...ips: string[]): Promise<Array<Player>> => {
  const where = ips.length > 0 ? ' WHERE ip=' + ips.map(() => '?').join(' OR ip=') : ''
  return await sql.findAll('SELECT * FROM `players`' + where, ...ips)
}

export const getUUIDsByIPHistory = async (...ips: string[]): Promise<Array<string>> => {
  const where = ips.length > 0 ? ' WHERE ip=' + ips.map(() => '?').join(' OR ip=') : ''
  return (await sql.findAll('SELECT `uuid` FROM `ipAddressHistory`' + where, ...ips)).map(it => it.uuid)
}

export const getSession = async (state: string, cache: boolean = true): Promise<Session | null> => {
  const cached = sessions[state]
  if (!cache || !cached || cached.expires_at < Date.now()) {
    if (cached?.expires_at > Date.now() && cached?.ip === '' && cached?.pending && cached?.user_id === 0) return null
    const session = await sql.findOne('SELECT * FROM `web_sessions` WHERE `state` = ?', state)
    if (!session) {
      sessions[state] = {
        state,
        expires_at: Date.now() + 1000 * 60 * 60,
        ip: '',
        pending: true,
        user_id: 0,
      }
    } else {
      sessions[state] = {
        ...session,
        expires_at: Math.min(session.expires_at, Date.now() + 1000 * 60 * 60 * 12),
      }
    }
  }
  return sessions[state]
}

export const deleteSession = async (state: string): Promise<void> => {
  await sql.execute('DELETE FROM `web_sessions` WHERE `state` = ?', state)
  delete sessions[state]
}

// throws error on duplicate 'state'
export const putSession = async (session: Session): Promise<Session> => {
  await sql.execute(
    'INSERT INTO `web_sessions` (`state`, `expires_at`, `user_id`, `ip`, `pending`) VALUES (?, ?, ?, ?, ?)',
    session.state,
    session.expires_at,
    session.user_id,
    session.ip,
    session.pending,
  )
  sessions[session.state] = {
    ...session,
    expires_at: Math.min(session.expires_at, Date.now() + 1000 * 60 * 60 * 12),
  }
  return session
}

export const resolveToIPByTarget = async (target: string): Promise<string | null> => {
  if (isValidIPAddress(target)) return target
  // player name or uuid
  const data = await sql.findOne('SELECT `ip` FROM `players` WHERE `name` = ? OR `uuid` = ?', target, target)
  if (!data) return null
  return data.ip
}

export const resolveToPlayerByTarget = async (target: string): Promise<Player | null> => {
  if (isValidIPAddress(target)) return null
  // player name or uuid
  return (await sql.findOne('SELECT * FROM `players` WHERE `name` = ? OR `uuid` = ?', target, target)) || null
}

//<editor-fold desc="1200+ characters long IP Address Regex" defaultstate="collapsed">
export const IP_ADDRESS_REGEX = /((^\s*((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))\s*$)|(^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$))/
//</editor-fold>

export const isValidIPAddress = (ip: string) => IP_ADDRESS_REGEX.test(ip)

export const isValidIPv4Address = (ip: string) => {
  const numbers = ip.split(".").map(it => parseInt(it))
  if (numbers.length != 4) return false
  return numbers.filter(it => it >= 0 && it <= 255)
}

export const isPunishableIP = (ip: string): boolean => {
  if (!isValidIPAddress(ip)) throw new Error("Invalid IP address: " + ip)
  if (!isValidIPv4Address(ip)) return true // skip IPv6 checks
  const numbers = ip.split('.').map(it => parseInt(it, 10))
  // Reserved IP addresses
  // 0.0.0.0/8 (0.0.0.0 - 0.255.255.255)
  if (numbers[0] == 0) return false
  // 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
  if (numbers[0] == 10) return false
  // 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
  if (numbers[0] == 100 && numbers[1] >= 64 && numbers[1] <= 127) return false
  // 127.0.0.0/8 (127.0.0.0 - 127.255.255.255)
  if (numbers[0] == 127) return false
  // 169.254.0.0/16 (169.254.0.0 - 169.254.255.255)
  if (numbers[0] == 169 && numbers[1] == 254) return false
  // 192.0.0.0/24 (192.0.0.0 - 192.0.0.255)
  if (numbers[0] == 192 && numbers[1] == 0 && numbers[2] == 0) return false
  // 192.0.2.0/24 (192.0.2.0 - 192.0.2.255)
  if (numbers[0] == 192 && numbers[1] == 0 && numbers[2] == 2) return false
  // 192.88.99.0/24 (192.88.99.0 - 192.88.99.255)
  if (numbers[0] == 192 && numbers[1] == 88 && numbers[2] == 99) return false
  // 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
  if (numbers[0] == 192 && numbers[1] == 168) return false
  // 198.18.0.0/15 (192.18.0.0 - 192.19.255.255)
  if (numbers[0] == 198 && (numbers[1] == 18 || numbers[1] == 19)) return false
  // 203.0.133.0/24 (203.0.133.0 - 203.0.133.255)
  if (numbers[0] == 203 && numbers[1] == 0 && numbers[2] == 133) return false
  // 224.0.0.0/4 (224.0.0.0 - 239.255.255.255)
  if (numbers[0] >= 224 && numbers[0] <= 239) return false
  // 233.252.0.0/24
  if (numbers[0] == 233 && numbers[1] == 252 && numbers[2] == 0) return false
  // 240.0.0.0/4 (240.0.0.0 - 255.255.255.254)
  // 255.255.255.255/32 (255.255.255.255)
  return numbers[0] < 240;
}

export const sanitizeSQLABit = (sql: string) =>
  sql.replace('%', '')

export const checkServerPermission = (group: string, server: string) => {
  if (server === 'global') return true
  if (group === 'manager' || group === 'admin') return true
  // check server/group permission here
  return false
}
