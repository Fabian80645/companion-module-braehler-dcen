import { EventEmitter } from 'node:events'
import { createConnection } from 'node:net'

const unitId = /^[0-3][0-9A-F]{3}$/
import { modes } from './mcd.js'
export { modes }
const seatId = /^[0-9A-F]{4}$/

export class TelegramReader {
  #frame = null

  feed(chunk, handle, preserve = false) {
    for (const byte of chunk) {
      if (byte === 10) {
        this.#frame = ''
      } else if (this.#frame !== null && byte === 13) {
        const message = this.#frame
        this.#frame = null
        if (message) {
          const fields = message.split(';')
          if (preserve) {
            const command = fields.shift().trim().toUpperCase()
            if (fields.at(-1) === '') fields.pop()
            handle([command, ...fields])
          } else handle(fields.map(field => field.trim().toUpperCase()))
        }
      } else if (this.#frame !== null) {
        this.#frame = byte >= 32 && byte <= 255 && this.#frame.length < 4096
          ? this.#frame + String.fromCharCode(byte) : null
      }
    }
  }
}

export function micCommand(operation, by, identifier) {
  const id = String(identifier ?? '').trim().toUpperCase()
  const command = { on: 'MIC-ON', off: 'MIC-OFF', request: 'MIC-REQ', request_on: 'REQ-ON', request_off: 'REQ-OFF' }[operation]
  if (!command) throw new Error('Unknown microphone action')
  if (by === 'unit' && unitId.test(id)) return `${command};${id};;`
  if (by === 'seat' && seatId.test(id) && id !== 'FFFF') return `${command};;${id};`
  throw new Error('Enter a four-digit hex ID. Use the separate action for all CMics.')
}

export class Dcen extends EventEmitter {
  #socket
  #retry
  #watchdog
  #running = false
  #ready = false
  #known = false
  #units = new Map()
  #seatUnits = new Map()
  mode = null
  maxDelegates = null

  constructor(host, port) {
    super()
    this.host = host
    this.port = port
  }

  start() {
    if (this.#running) return
    this.#running = true
    this.#connect()
  }

  stop() {
    this.#running = false
    clearTimeout(this.#retry)
    clearTimeout(this.#watchdog)
    const socket = this.#socket
    this.#socket = undefined
    socket?.destroy()
    this.#reset()
  }

  get ready() { return this.#ready }
  get known() { return this.#known }
  get activeCount() { return [...this.#units.values()].filter(unit => unit.state === 'on').length }

  micState(by, identifier) {
    if (!this.#ready) return 'unknown'
    const id = String(identifier ?? '').trim().toUpperCase()
    if (by === 'unit' && !unitId.test(id)) return 'unknown'
    if (by === 'seat' && (!seatId.test(id) || id === 'FFFF')) return 'unknown'
    const unit = by === 'unit' ? this.#units.get(id) : this.#units.get(this.#seatUnits.get(id))
    return unit?.state ?? (this.#known ? 'off' : 'unknown')
  }

  send(command) {
    if (!this.#ready || !this.#socket?.writable) throw new Error('DCen has not completed the MCD handshake')
    this.#socket.write(`\n${command}\r`, 'ascii')
  }

  #reset() {
    this.#ready = false
    this.#known = false
    this.#units.clear()
    this.#seatUnits.clear()
    this.mode = null
    this.maxDelegates = null
    this.emit('state')
  }

  #connect() {
    this.emit('link', 'connecting')
    const socket = createConnection({ host: this.host, port: this.port })
    this.#socket = socket
    const reader = new TelegramReader()
    socket.setNoDelay(true)
    const armWatchdog = () => {
      clearTimeout(this.#watchdog)
      this.#watchdog = setTimeout(() => socket.destroy(new Error('Kein DCen-PING empfangen')), 4000)
    }
    armWatchdog()
    socket.on('data', data => {
      if (socket !== this.#socket) return
      reader.feed(data, telegram => {
        const [name, id, seat] = telegram.map(field => field.trim().toUpperCase())
        if (name === 'BOOT') {
          this.#reset()
          this.emit('link', 'connecting')
        }
        this.emit('telegram', telegram)
        if (name === 'PING') {
          socket.write('\nPONG;\r', 'ascii')
          armWatchdog()
          if (!this.#ready) {
            this.#ready = true
            this.emit('link', 'ready')
            this.emit('state')
          }
        } else if (name === 'MICMODE' && modes.includes(id)) {
          this.mode = id
          this.emit('state')
        } else if (name === 'MAXDEL' && /^[0-9A-F]{4}$/.test(id ?? '')) {
          this.maxDelegates = Number.parseInt(id, 16)
          this.emit('state')
        } else if (name === 'MIC-OFF' && (id === 'FFFF' || seat === 'FFFF')) {
          this.#units.clear()
          this.#seatUnits.clear()
          this.#known = true
          this.emit('state')
        } else if (unitId.test(id ?? '') && ['MIC-ON', 'MIC-OFF', 'REQ-ON', 'MICMUTE'].includes(name)) {
          const previousSeat = this.#units.get(id)?.seat
          const assignedSeat = seatId.test(seat ?? '') ? seat : previousSeat
          if (previousSeat && previousSeat !== assignedSeat && this.#seatUnits.get(previousSeat) === id) {
            this.#seatUnits.delete(previousSeat)
          }
          if (assignedSeat) this.#seatUnits.set(assignedSeat, id)
          this.#units.set(id, { state: { 'MIC-ON': 'on', 'MIC-OFF': 'off', 'REQ-ON': 'request', 'MICMUTE': 'muted' }[name],
            seat: assignedSeat })
          this.emit('state')
        }
      }, true)
    })
    socket.on('error', error => {
      if (socket === this.#socket) this.emit('warning', error.message)
    })
    socket.on('close', () => {
      if (socket !== this.#socket) return
      this.#socket = undefined
      clearTimeout(this.#watchdog)
      this.#reset()
      if (this.#running) {
        this.emit('link', 'retry')
        this.#retry = setTimeout(() => this.#connect(), 2000)
      }
    })
  }
}
