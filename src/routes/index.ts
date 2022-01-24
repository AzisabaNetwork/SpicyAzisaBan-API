import express from 'express'
import { w } from '../util/util'
import { router as usersRouter } from './users'
import { router as loginRouter } from './login'
import { router as punishmentsRouter } from './punishments'
import { router as miscRouter } from './misc'
import { router as playersRouter } from './players'
import { router as apiRouter } from './api'
const cors = require('cors')
export const router = express.Router()

const c = cors({
  origin: (origin: string, callback: (err: Error | null, result?: boolean) => void) => {
    if (!origin) return callback(new Error('Not allowed by CORS'))
    if (origin === process.env.APP_URL) return callback(null, true)
    if (process.env.ADDITIONAL_CORS?.split(',')?.indexOf(origin) !== -1) return callback(null, true)
    callback(new Error('Not allowed by CORS'))
  },
})

router.use('/i_users', c, usersRouter)
router.use('/i_users', c, loginRouter)
router.use('/punishments', c, punishmentsRouter)
router.use('/misc', c, miscRouter)
router.use('/players', c, playersRouter)
router.use('/api', apiRouter)

router.get('/', w((req, res) => {
  res.send("Hello World?")
}))
