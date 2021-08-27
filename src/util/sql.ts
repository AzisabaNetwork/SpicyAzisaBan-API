const debug = require('debug')('spicyazisaban:mysql')
import mysql, { Connection, FieldInfo } from 'mysql'
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

export const getConnection = /* async */ (): Promise<Connection> => {
  return new Promise((resolve, reject) =>
    pool.getConnection((err, connection) => {
        if (err) {
          debug(err)
          return reject(err)
        }
        resolve(connection)
      }
    )
  )
}

export const query = (sql: string, ...values: Array<any>): Promise<{ results: Array<any>, fields: FieldInfo[] | undefined }> => {
  return new Promise((resolve, reject) => {
    debug(sql, values)
    pool.query(sql, values, (error, results, fields) => {
      if (error) {
        debug(error)
        return reject(error)
      }
      resolve({ results, fields })
    })
  })
}

export const queryWithConnection = (connection: Connection, sql: string, ...values: Array<any>): Promise<{ results: Array<any>, fields: FieldInfo[] | undefined }> => {
  return new Promise((resolve, reject) => {
    debug(sql, values)
    connection.query(sql, values, (error, results, fields) => {
      if (error) {
        debug(error)
        return reject(error)
      }
      resolve({ results, fields })
    })
  })
}

export const execute = (sql: string, ...values: Array<any>): Promise<void> => {
  return new Promise((resolve, reject) => {
    debug(sql, values)
    pool.query(sql, values, (error) => {
      if (error) {
        debug(error)
        return reject(error)
      }
      resolve()
    })
  })
}

export const findOne = async (sql: string, ...values: Array<any>): Promise<any> => {
  if (!sql.toLowerCase().startsWith('insert')) return await query(sql, ...values).then(value => value.results[0] || null)
  const connection = await getConnection()
  await queryWithConnection(connection, sql, ...values)
  return await queryWithConnection(connection, "SELECT LAST_INSERT_ID() AS why").then(value => value.results[0] ? value.results[0]['why'] : null)
}

export const findOneWithConnection = async (connection: Connection, sql: string, ...values: Array<any>): Promise<any> => {
  const val = await queryWithConnection(connection, sql, ...values).then(value => value.results[0] || null)
  if (!sql.toLowerCase().startsWith('insert')) return val
  return await queryWithConnection(connection, "SELECT LAST_INSERT_ID() AS why").then(value => value.results[0] ? value.results[0]['why'] : null)
}

export const findAll = (sql: string, ...values: Array<any>): Promise<Array<any>> => query(sql, ...values).then(value => value.results)

export const init = async () =>
  query('SELECT 1').then(async () => {
    debug('Confirmed MySQL connection')
    await findOne('SHOW TABLES LIKE "users"').then(async res => {
      if (!res) {
        debug('Creating users table')
        await execute(`CREATE TABLE users (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`username\` varchar(128) NOT NULL,
  \`email\` varchar(255) NOT NULL,
  \`password\` varchar(255) DEFAULT NULL,
  \`group\` varchar(255) NOT NULL DEFAULT "user",
  \`ip\` varchar(255) DEFAULT NULL,
  \`last_update\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
)`)
        // if banned is 1, user will be unable to do following action(s):
        // - ban someone
        // - vote
        // if password is empty (null), the user will not be able to login. (login disabled)
        debug('Created users table')
      }
    })
    await findOne('SHOW TABLES LIKE "users_2fa"').then(async res => {
      if (!res) {
        debug('Creating users_2fa table')
        await execute(`CREATE TABLE users_2fa (
  \`user_id\` int unsigned NOT NULL UNIQUE,
  \`secret_key\` varchar(128) NOT NULL,
  PRIMARY KEY (\`user_id\`)
)`)
        // if the user disables 2fa, entries in users_2fa_recovery_codes should also be deleted
        debug('Created users_2fa table')
      }
    })
    await findOne('SHOW TABLES LIKE "users_2fa_recovery_codes"').then(async res => {
      if (!res) {
        debug('Creating users_2fa_recovery_codes table')
        await execute(`CREATE TABLE users_2fa_recovery_codes (
  \`user_id\` int unsigned NOT NULL,
  \`code\` varchar(10) NOT NULL,
  \`used\` tinyint(1) NOT NULL DEFAULT 0
)`)
        debug('Created users_2fa_recovery_codes table')
      }
    })
  }).catch(e => {
    console.error('Your mysql configuration is foobar, pls fix')
    console.error(e.stack || e)
    process.kill(process.pid, 'SIGINT')
  })
