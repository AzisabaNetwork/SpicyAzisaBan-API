import express from 'express'
export const router = express.Router()
import {
  generateSecureRandomString,
  sleep,
  sessions,
  validateAndGetSession,
  getIPAddress,
  validate2FAToken,
  w, getSessionKey,
} from '../util/util'
import * as sql from '../util/sql'
import * as crypt from '../util/crypt'
const debug = require('debug')('spicyazisaban:route:punishments')

router.get('/list', w(async (req, res) => {
  const session = validateAndGetSession(req)
  if (!session) return res.send403()
  const page = req.query?.page || 0
  res.send({ what: 'what' })
}))
