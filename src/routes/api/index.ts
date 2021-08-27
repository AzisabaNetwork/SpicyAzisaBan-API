import express from 'express'
import { w } from '../../util/util'
export const router = express.Router()

router.get('/', w((req, res) => {
    res.send({ super_secret_message: 'hello?' })
}))
