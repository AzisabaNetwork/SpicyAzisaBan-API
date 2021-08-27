import express from 'express'
import { w } from '../util/util'
import { router as usersRouter } from './users'
import { router as loginRouter } from './login'
import { router as punishmentsRouter } from './punishments'
import { router as apiRouter } from './api'
export const router = express.Router()

router.use('/i_users', usersRouter)
router.use('/i_users', loginRouter)
router.use('/punishments', punishmentsRouter)
router.use('/api', apiRouter)

router.get('/', w((req, res) => {
  res.send("Hello World?")
}))
