// a lot of @ts-ignore looks very bad :(

require('dotenv-safe').config()
import express from 'express'
import cookieParser from 'cookie-parser'
import logger from 'morgan'
import * as sql from './util/sql'
import { validateAndGetSession, getUser, getIPAddress, w } from './util/util'
import * as crypt from './util/crypt'
const debugEnabled = process.env.NODE_ENV === 'development'
const debug = require('debug')('spicyazisaban:app')
const cors = require('cors')

sql.init()
  .then(async () => {
    debug('Preparing bcrypt')
    const rounds = await crypt.getGoodSaltRounds()
    debug(`Found good salt rounds: ${rounds}`)
  })
  // @ts-ignore
  .then(() => process.emit('ready'))

import { router as indexRouter } from './routes'

export const app = express()

// @ts-ignore
app.use((req: Request, res: Response, next) => {
  res.send400 = () => res.status(400).send({ error: 'bad_request' })
  res.send401 = () => res.status(401).send({ error: 'unauthorized' })
  res.send403 = () => res.status(403).send({ error: 'forbidden' })
  res.send404 = () => res.status(404).send({ error: 'not_found' })
  res.send429 = () => res.status(429).send({ error: 'too_many_requests' })
  res.send500 = async (err: any) => {
    if (debugEnabled) {
      debug('an error occurred:', err.stack || err)
    }
    res.status(err.status || 500).send({ error: 'unknown' })
  }
  next()
})

app.use(logger('dev', {
  stream: {
    write: s => {
      debug(s.substring(0, s.length - 1))
    }
  }
}))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
const c = cors({
  origin: (origin: string, callback: (err: Error | null, result?: boolean) => void) => {
    if (!origin) return callback(new Error('Not allowed by CORS'))
    if (origin === process.env.APP_URL) return callback(null, true)
    if (process.env.ADDITIONAL_CORS?.split(',')?.indexOf(origin) !== -1) return callback(null, true)
    callback(new Error('Not allowed by CORS'))
  },
})
app.use(cors({
  origin: '*',
}))

app.all('*', function (req, res, next) {
    res.setHeader('Vary', 'Origin')
    next()
})

// restrict access for /admin routes
// @ts-ignore
app.use('/admin', c, async (req: Request, res: Response, next) => {
  const session = req.session = await validateAndGetSession(req)
  if (!session) return res.send401()
  const user = req.user = await getUser(session.user_id)
  if (user?.group !== 'admin') {
    return res.send403()
  }
  next()
})

let apiRequests: { [ip: string]: number } = {}

app.use('/api', (req, res, next) => {
  const limit = 1000
  const ip = getIPAddress(req)
  if (apiRequests[ip] >= limit) return res.status(429).send({ error: 'too_many_requests' })
  apiRequests[ip] = (apiRequests[ip] || 0) + 1
  next()
})

// reset rate limit every 1m
setInterval(() => apiRequests = {}, 1000 * 60)

app.use('/', indexRouter)

app.get('/500', w(async () => {
  throw new Error('something broke')
}))

// no route handler
// @ts-ignore
app.use((req, res: Response) => {
  res.send404()
})

// error page handler
// @ts-ignore
app.use(async (err, req, res, _) => {
  if (err.message === 'Not allowed by CORS') return res.status(403).send({ error: 'forbidden' })
  if (debugEnabled) {
    debug('an error occurred:', err.stack || err)
  }
  res.status(err.status || 500).send({ error: 'unknown' })
})

process.on('unhandledRejection', reason => {
  debug('Unhandled promise rejection', reason)
})
