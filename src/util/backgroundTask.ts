import * as sql from './sql'

const debug = require('debug')('spicyazisaban:background-task-executor')

import LogDriver from '../mailDrivers/log'
import SMTPDriver from '../mailDrivers/smtp'
import DiscordDriver from '../mailDrivers/discord'
import { rateLimits } from './util'
import { SESSION_LENGTH, UNCONFIRMED_USER_SESSION_LENGTH } from './constants'

export const tasks: Array<Task> = []
export const randomTasks: Array<Task> = []

export type Task = () => void | Promise<void>

const handler = async () => {
  const task = tasks.shift()
  if (!task) {
    setTimeout(handler, 1000)
    return
  }
  try {
    const t = task()
    // noinspection SuspiciousTypeOfGuard
    if (t instanceof Promise) {
      await t.catch(e => {
        debug('Error executing async task')
        debug(e.stack || e)
      })
    }
  } catch (e) {
    debug('Error executing task')
    debug(e.stack || e)
  } finally {
    setTimeout(handler, 1000)
  }
}

const randomHandler = async () => {
  const task = randomTasks.shift()
  if (!task) {
    setTimeout(randomHandler, Math.round(Math.random() * 1000))
    return
  }
  try {
    const t = task()
    // noinspection SuspiciousTypeOfGuard // false positive?
    if (t instanceof Promise) {
      await t.catch(e => {
        debug('Error executing async task')
        debug(e.stack || e)
      })
    }
  } catch (e) {
    debug('Error executing task')
    debug(e.stack || e)
  } finally {
    setTimeout(randomHandler, Math.round(Math.random() * 1000))
  }
}

const awaitTask = (task: Task, queue: Array<Task>) =>
  new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const t = task()
        if (t instanceof Promise) {
          resolve(await t.catch(e => {
            debug('Error executing async task')
            debug(e.stack || e)
          }))
        } else {
          resolve(t)
        }
      } catch (e) {
        reject(e)
      }
    })
  })

export const queue = (task: Task) => {
  return awaitTask(task, tasks)
}

/**
 * schedules a task that will happen in some time (random) in the future.
 */
export const queueRandom = (task: Task) => {
  return awaitTask(task, randomTasks)
}

export const getMailDriver = (driverName: string = process.env.MAIL_DRIVER!) => {
  if (driverName === 'log') {
    return new LogDriver()
  } else if (driverName === 'smtp') {
    const driver = new SMTPDriver();
    (driver as SMTPDriver).init()
    return driver
  } else if (driverName === 'discord') {
    return new DiscordDriver()
  } else {
    debug(`Warning: Invalid mail driver: ${driverName}, valid types are: log, smtp`)
    debug('Warning: Defaulting to log driver')
    return new LogDriver()
  }
}

export const queueEmail = (from: string, to: string, subject: string, text?: string, html?: string) => {
  if (!text && !html) throw new Error('Either text or html should be filled')
  queue(() => getMailDriver().send(from, to, subject, text, html)).catch(err => {
    debug('Failed to send email', err)
  })
}

handler()
randomHandler()

setInterval(() => {
  // remove users that's unverified (their email) for over an hour
  sql.findAll('SELECT `id`, `last_update` FROM `users` WHERE `username` LIKE "SpicyAzisaBan user%"').then(res => {
    const toRemove: number[] = []
    res.forEach(user => {
      if (user.last_update.getTime() - (Date.now() - UNCONFIRMED_USER_SESSION_LENGTH) < 0) toRemove.push(user.id)
    })
    if (toRemove.length > 0) sql.execute(`DELETE FROM \`users\` WHERE \`id\` = ${toRemove.join(' OR `id` = ')}`)
  })
  sql.execute('DELETE FROM `web_sessions` WHERE `expires_at` < ?', (Date.now() - SESSION_LENGTH))
}, 1000 * 60 * 5)

setInterval(() => {
  Object.keys(rateLimits).forEach((s) => (rateLimits[s] = {}))
}, 1000 * 60 * 60)

debug('Initialized background task executor')
