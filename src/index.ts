require('dotenv-safe').config()
if (!process.env.DEBUG) {
    process.env.DEBUG = 'spicyazisaban:*'
}
import { app } from './app'
import http from 'http'
const debug = require('debug')('project-banned:server')

const port = parseInt(process.env.PORT || '3000', 10)
app.set('port', port)
const server = http.createServer(app)

// @ts-ignore
process.once('ready', () => server.listen(port))
server.on('error', onError)
server.on('listening', onListening)

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error: Error | any) {
    if (error.syscall !== 'listen') {
        throw error
    }

    const bind = 'Port ' + port

    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(bind + ' requires elevated privileges')
            process.exit(1)
            break;
        case 'EADDRINUSE':
            console.error(bind + ' is already in use')
            process.exit(1)
            break;
        default:
            throw error
    }
}

function onListening() {
    const addr = server.address()
    const bind = typeof addr === 'string'
        ? 'pipe ' + addr
        : 'port ' + addr?.port
    debug('Listening on ' + bind)
}
