import * as sql from './sql'

const debug = require('debug')('spicyazisaban:background-task-executor')

import mailDriver from '../mailDrivers/mailDriver'
import LogDriver from '../mailDrivers/log'
import SMTPDriver from '../mailDrivers/smtp'
import { rateLimits} from './util'

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

export const queueEmail = (from: string, to: string, subject: string, text?: string, html?: string) => {
  let driver: mailDriver
  if (process.env.MAIL_DRIVER === 'log') {
    driver = new LogDriver()
  } else if (process.env.MAIL_DRIVER === 'smtp') {
    driver = new SMTPDriver();
    (driver as SMTPDriver).init()
  } else {
    debug(`Warning: Invalid mail driver: ${process.env.MAIL_DRIVER}, valid types are: log, smtp`)
    debug('Warning: Defaulting to log driver')
    driver = new LogDriver()
  }
  if (!text && !html) throw new Error('Either text or html should be filled')
  queue(() => driver.send(from, to, subject, text, html)).catch(err => {
    debug('Failed to send email', err)
  })
}

handler()
randomHandler()

setInterval(() => {
  const a_hour = 3600000
  // remove users that's unverified (their email) for over a hour
  sql.findAll('SELECT `id`, `last_update` FROM `users` WHERE `username` LIKE "SpicyAzisaBan user%"').then(res => {
    const toRemove: number[] = []
    res.forEach(user => {
      if (user.last_update.getTime() - (Date.now() - a_hour) < 0) toRemove.push(user.id)
    })
    if (toRemove.length > 0) sql.execute(`DELETE FROM \`users\` WHERE \`id\` = ${toRemove.join(' OR `id` = ')}`)
  })
}, 1000 * 60 * 5)

setInterval(() => {
  Object.keys(rateLimits).forEach((s) => (rateLimits[s] = {}))
}, 1000 * 60)

debug('Initialized background task executor')
