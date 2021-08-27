import express from 'express'
import * as sql from '../util/sql'
import * as crypt from '../util/crypt'
import qrcode from 'qrcode'
import {
    validateAndGetSession,
    sessions,
    isValidName,
    validate2FAToken,
    generateSecureRandomString,
    w, getSessionKey,
} from '../util/util'
import { createNew } from '../util/totp'
export const router = express.Router()

router.post('/check_email', w(async (req, res) => {
    if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
    const user_id = parseInt(req.body.user_id)
    const email = String(req.body.email)
    if (!user_id || user_id !== user_id || user_id < 0 || !email || !email.includes('@')) return res.send({ valid: false })
    res.send({ valid: !!await sql.findOne('SELECT `id` FROM `users` WHERE `user_id` = ? AND `email` = ?', user_id, email) })
}))

router.post('/changename', w(async (req, res) => {
    // request:
    // - user_id: number
    // - username: string
    // - state: string (optional)
    // response:
    // - message: 'ok'
    if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
    let state = String(req.body.state)
    let session = validateAndGetSession(req)
    if (session) state = getSessionKey(req) || ''
    if (!session && !state) return res.status(400).send({ error: 'invalid_params' })
    if (!session) session = sessions[state]
    if (!session) return res.status(400).send({ error: 'invalid_params' })
    const user_id = parseInt(req.body.user_id)
    if (user_id <= 0 || user_id !== user_id || session.user_id !== user_id) return res.status(400).send({ error: 'invalid_params' })
    const username = String(req.body.username)
    if (!isValidName(username)) return res.status(400).send({ error: 'invalid' })
    await sql.execute('UPDATE `users` SET `last_update` = now() WHERE `id` = ?', user_id)
    const oldUser = await sql.findOne('SELECT `username` FROM `users` WHERE `id` = ?', user_id)
    if (!oldUser) return res.status(400).send({ error: 'invalid_user' })
    await sql.execute('UPDATE `users` SET `username` = ? WHERE `id` = ?', username, user_id)
    // if the session is pending, invalidate session now
    if (session.pending) {
        delete sessions[state]
    }
    res.send({ message: 'ok' })
}))

router.post('/changepassword', w(async (req, res) => {
    // request:
    // - user_id: number
    // - password: string
    // response:
    // - message: 'ok'
    const session = validateAndGetSession(req)
    if (!session) return res.send401()
    if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
    const user_id = parseInt(req.body.user_id)
    if (user_id <= 0 || user_id !== user_id || session.user_id !== user_id) return res.status(400).send({ error: 'invalid_params' })
    const currentPassword = String(req.body.currentPassword)
    const newPassword = String(req.body.newPassword)
    if (!currentPassword || !newPassword) return res.status(400)
    const user = await sql.findOne('SELECT `password` FROM `users` WHERE `id` = ?', user_id)
    if (!await crypt.compare(currentPassword, user.password)) return res.status(400).send({ error: 'incorrect_password' })
    if (newPassword.length < 7) return res.status(400).send({ error: 'invalid' })
    await sql.execute('UPDATE `users` SET `password` = ? WHERE `id` = ?', await crypt.hash(newPassword), user_id)
    res.send({ message: 'ok' })
}))

router.post('/enable_2fa', w(async (req, res) => {
    // request:
    // - password: string - current password
    // response:
    // - secret_key: string - secret key for totp authentication
    // - recovery_codes: string[] - 8 recovery codes
    // - qrcode: string - a long string (data url format)
    // user won't be able to see the both secret key and recovery codes after this request (they must reset if they forgot it)
    const session = validateAndGetSession(req)
    if (!session) return res.send401()
    if (await sql.findOne('SELECT `user_id` FROM `users_2fa` WHERE `user_id` = ?', session.user_id)) {
        return res.status(400).send({ error: 'already_enabled' })
    }
    if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
    const password = String(req.body.password)
    const user = await sql.findOne('SELECT `password`, `email` FROM `users` WHERE `id` = ?', session.user_id)
    if (!await crypt.compare(password, user.password)) return res.status(400).send({ error: 'incorrect_password' })
    const secretKey = await generateSecureRandomString(16)
    const recoveryCodes = await Promise.all([
        generateSecureRandomString(5), // 1
        generateSecureRandomString(5), // 2
        generateSecureRandomString(5), // 3
        generateSecureRandomString(5), // 4
        generateSecureRandomString(5), // 5
        generateSecureRandomString(5), // 6
        generateSecureRandomString(5), // 7
        generateSecureRandomString(5), // 8
    ])
    await sql.execute('INSERT INTO `users_2fa` (`user_id`, `secret_key`) VALUES (?, ?)', session.user_id, secretKey)
    await sql.execute(
        'INSERT INTO `users_2fa_recovery_codes` (`user_id`, `code`) VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)',
        session.user_id,
        recoveryCodes[0],
        session.user_id,
        recoveryCodes[1],
        session.user_id,
        recoveryCodes[2],
        session.user_id,
        recoveryCodes[3],
        session.user_id,
        recoveryCodes[4],
        session.user_id,
        recoveryCodes[5],
        session.user_id,
        recoveryCodes[6],
        session.user_id,
        recoveryCodes[7],
    )
    res.send({
        secret_key: secretKey,
        recovery_codes: recoveryCodes,
        qrcode: await qrcode.toDataURL(createNew(user.email, secretKey).toString()),
    })
}))

router.post('/disable_2fa', w(async (req, res) => {
    // request:
    // - token: string - current 2fa token or recovery code
    // response:
    // - message: 'ok'
    const session = validateAndGetSession(req)
    if (!session) return res.send401()
    if (!req.body || typeof req.body !== 'object') return res.status(400).send({ error: 'invalid_params' })
    if (!await validate2FAToken(session.user_id, req.body.token, true)) return res.status(400).send({ error: 'incorrect_mfa_token' })
    await sql.execute('DELETE FROM `users_2fa` WHERE `user_id` = ?', session.user_id)
    await sql.execute('DELETE FROM `users_2fa_recovery_codes` WHERE `user_id` = ?', session.user_id)
    res.send({ message: 'ok' })
}))