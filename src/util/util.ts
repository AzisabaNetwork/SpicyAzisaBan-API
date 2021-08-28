import crypto from 'crypto'
import * as sql from './sql'
import * as totp from './totp'
import express, { NextFunction } from 'express'
import { parse, stringify } from 'uuid'
import {StringReader} from './stringReader'

export const sessions: SessionTable = {}

export const generateSecureRandomString = (length: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(length, function(err, buffer) {
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
export const validateAndGetSession = (req: express.Request): Session | null => {
  const session = getSessionKey(req)
  if (!session) return null
  const token = sessions[session]
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
  const where = uuids.length > 0 ? ' WHERE uuid=' + uuids.join(' AND uuid=') : ''
  return await sql.findAll('SELECT * FROM `players`' + where)
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

export const processTime = (s: string): number => {
  let time = 0
  let rawNumber = ""
  const reader = new StringReader(s)
  while (!reader.isEOF()) {
    const c = reader.peek()
    reader.skip()
    if (c >= '0' && c <= '9') {
      rawNumber += c
    } else {
      if (rawNumber.length === 0) throw Error("Unexpected non-digit character: '$c' at index ${reader.index}")
      // mo
      if (c == 'm' && !reader.isEOF() && reader.peek() == 'o') {
        reader.skip()
        time += (1000 * 60 * 60 * 24 * 30) * parseInt(rawNumber)
        rawNumber = ""
        continue
      }
      // y(ear), d(ay), h(our), m(inute), s(econd)
      if (c === 'y') {
        time += (1000 * 60 * 60 * 24 * 365) * parseInt(rawNumber)
      } else if (c === 'd') {
        time += (1000 * 60 * 60 * 24) * parseInt(rawNumber)
      } else if (c === 'h') {
        time += (1000 * 60 * 60) * parseInt(rawNumber)
      } else if (c === 'm') {
        time += (1000 * 60) * parseInt(rawNumber)
      } else if (c === 's') {
        time += 1000 * parseInt(rawNumber)
      } else {
        throw Error(`Unexpected character: '${c}' at index ${reader.index}`)
      }
      rawNumber = ""
    }
  }
  return time
}
