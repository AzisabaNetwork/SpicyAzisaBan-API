import express from 'express'
import { w } from '../../util/util'
import { router as oauth2Router } from './oauth2'
export const router = express.Router()

router.get('/', w((req, res) => {
  res.send({ super_secret_message: 'hello?' })
}))

router.use('/oauth2', oauth2Router)
