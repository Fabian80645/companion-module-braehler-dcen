const groupOffNumbers = [1, 2, 3, 4]
const groupOffId = group => group === 1 ? 'group_off' : 'group_off_' + group
const groupOffField = (group, bound) => 'offSeat' + bound + (group === 1 ? '' : group)

const groupOffEnabledField = group => 'groupOffEnabled' + group

function groupOffEnabled(config, group) {
  return config[groupOffEnabledField(group)] ?? (group === 1 ||
    ['From', 'To'].some(bound => {
      const value = String(config[groupOffField(group, bound)] ?? '').trim()
      return value !== '' && value !== '0'
    }))
}

function groupOffVisibility(throughGroup) {
  return groupOffNumbers.slice(0, throughGroup)
    .map(group => '$(options:' + groupOffEnabledField(group) + ')').join(' && ')
}

function groupOffFields(group, config) {
  const checkbox = {
    type: 'checkbox', id: groupOffEnabledField(group), label: 'Enable Group Off ' + group,
    default: groupOffEnabled(config, group), width: 12,
  }
  if (group > 1) checkbox.isVisibleExpression = groupOffVisibility(group - 1)
  return [
    checkbox,
    ...['From', 'To'].map(bound => ({
      type: 'number', id: groupOffField(group, bound), label: 'Group Off ' + group + ' – ' + bound + ' seat',
      default: 0, min: 0, max: 100, step: 1, width: 6,
      isVisibleExpression: groupOffVisibility(group),
    })),
  ]
}

function groupOffSeats(config, seatIds, warn) {
  let previousEnabled = true
  return groupOffNumbers.map(group => {
    previousEnabled = previousEnabled && groupOffEnabled(config, group) === true
    if (!previousEnabled) return new Set()
    const from = String(config[groupOffField(group, 'From')] ?? '').trim()
    const to = String(config[groupOffField(group, 'To')] ?? '').trim()
    const first = from === '0' ? '' : from
    const last = to === '0' ? '' : to
    return seatsInRange(first, last, seatIds, message => warn('Group Off ' + group + ': ' + message))
  })
}

import { seatMicIcon, seatMicIconDark } from './seat-icon.js'
import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { McdFeedback, mcdActions, mcdVariableDefinitions } from './mcd.js'
import { Dcen, micCommand, modes } from './protocol.js'

const delegateLimits = [1, 2, 3, 4]
const automaticModeOrder = modes.slice(0, 4)
const nextValue = (order, current) => order[(order.indexOf(current) + 1) % order.length]
const rgb = (r, g, b) => (r << 16) + (g << 8) + b
function seatsInRange(fromValue, toValue, seatIds, warn) {
  const from = String(fromValue ?? '').trim()
  const to = String(toValue ?? '').trim()
  const first = from === '' ? 1 : Number(from)
  const last = to === '' ? 100 : Number(to)
  if ((from && !/^\d{1,3}$/.test(from)) || (to && !/^\d{1,3}$/.test(to)) ||
      first < 1 || last > 100 || first > last) {
    warn('Invalid seat range. Enter numbers from 1 to 100 in ascending order.')
    return new Set()
  }
  return new Set(seatIds.slice(first - 1, last))
}

const roles = {
  board1: 'ID field 1', board2: 'ID field 2', board3: 'ID field 3', moderator: 'ID field 4',
}
const allSeatIds = Array.from({ length: 100 }, (_, i) =>
  (i + 1).toString(16).toUpperCase().padStart(4, '0'))
const roleStates = {
  on: ['ON', 0xad1f30], off: ['OFF', 0x505050], request: ['REQUEST', 0x186b3e],
  muted: ['MUTED', 0x724794],
}
function seatHex(value) {
  const text = String(value ?? '').trim()
  const seat = Number(text)
  if (!/^\d{1,3}$/.test(text) || seat < 1 || seat > 100)
    throw new Error('Enter a seat number from 1 to 100.')
  return seat.toString(16).toUpperCase().padStart(4, '0')
}

function microphoneAddress(options) {
  if (options.seatNumber == null && options.identifier != null)
    return { by: options.by, identifier: options.identifier }
  return { by: 'seat', identifier: seatHex(options.seatNumber) }
}

function unitForSeat(mcd, value) {
  const seat = seatHex(value)
  const units = [...mcd.unitSeats].filter(([, assignedSeat]) => assignedSeat === seat)
  if (units.length !== 1) throw new Error('Switch that microphone on briefly so the DCen can report its seat assignment.')
  return units[0][0]
}

const addressFields = [{ type: 'textinput', id: 'seatNumber', label: 'Seat number (1–100)', default: '1' }]

export default class BraehlerDcen extends InstanceBase {
  constructor(context) {
    super(context)
    this.instanceOptions.disableNewConfigLayout = true
  }

  async init(config) {
    this.mcd = new McdFeedback()
    this.setActionDefinitions({
      ...mcdActions(command => this.send(command), message => this.log('warn', message), seat => unitForSeat(this.mcd, seat)),
      cycle_mode: {
        name: 'Cycle discussion mode', options: [],
        callback: () => {
          const current = this.dcen?.mode
          if (!this.dcen?.ready || current == null) return
          this.send(`MICMODE;${nextValue(automaticModeOrder, current)}`)
        },
      },
      cycle_max_delegates: {
        name: 'Cycle delegate limit', options: [],
        callback: () => {
          const current = this.dcen?.maxDelegates
          if (!this.dcen?.ready || current == null) return
          const hex = nextValue(delegateLimits, current).toString(16).toUpperCase().padStart(4, '0')
          this.send(`MAXDEL;${hex}`)
        },
      },
      role_toggle: {
        name: 'Toggle microphone',
        options: addressFields,
        callback: ({ options }) => {
          try {
            const { by, identifier } = this.roleAddress(options)
            const state = this.dcen?.micState(by, identifier)
            if (state && state !== 'unknown')
              this.send(micCommand(state === 'on' || state === 'muted' ? 'off' : 'on', by, identifier))
          } catch (error) {
            this.log('warn', error.message)
          }
        },
      },
      all_on: {
        name: 'Turn on all eligible CMics',
        options: [],
        callback: () => {
          if (!this.allOnCommands?.length) {
            this.log('warn', 'All On has no detected seats within the configured range.')
            return
          }
          for (const command of this.allOnCommands) this.send(command)
        },
      },
      all_off: {
        name: 'Turn off all CMics',
        options: [],
        callback: () => this.send('MIC-OFF;FFFF;;'),
      },
      ...Object.fromEntries(groupOffNumbers.map(group => [groupOffId(group), {
        name: 'Group Off ' + group,
        options: [],
        callback: () => {
          for (const id of this.offSeats[group - 1]) this.send(micCommand('off', 'seat', id))
        },
      }])),
      microphone: {
        name: 'Control a CMic',
        options: [
          ...addressFields,
          { type: 'dropdown', id: 'operation', label: 'Action', default: 'off',
            choices: [{ id: 'off', label: 'Turn off' }, { id: 'on', label: 'Turn on' },
              { id: 'toggle', label: 'Toggle on/off' },
              { id: 'request_on', label: 'Request to speak (REQ-ON)' },
              { id: 'request_off', label: 'Clear speaking request (REQ-OFF)' },
              { id: 'request', label: 'Request to speak (MIC-REQ)' }] },
        ],
        callback: ({ options }) => {
          try {
            const { by, identifier } = microphoneAddress(options)
            let operation = options.operation
            if (operation === 'toggle') {
              const state = this.dcen?.micState(by, identifier)
              if (!state || state === 'unknown') return
              operation = state === 'on' || state === 'muted' ? 'off' : 'on'
            }
            this.send(micCommand(operation, by, identifier))
          } catch (error) {
            this.log('warn', error.message)
          }
        },
      },
    })
    const style = color => ({ bgcolor: color, color: 0xffffff })
    this.setFeedbackDefinitions({
      role_state: {
        name: 'Microphone state', type: 'boolean',
        options: [...addressFields, { type: 'dropdown', id: 'state', label: 'State', default: 'on',
          choices: Object.entries(roleStates).map(([id, [label]]) => ({ id, label })) }],
        defaultStyle: style(0xad1f30),
        callback: ({ options }) => {
          try {
            const { by, identifier } = this.roleAddress(options)
            return this.dcen?.micState(by, identifier) === options.state
          } catch {
            return false
          }
        },
      },
      any_on: { name: 'At least one CMic is on', type: 'boolean', options: [],
        defaultStyle: style(rgb(173, 31, 48)),
        callback: () => Boolean(this.dcen?.ready && this.dcen.activeCount > 0) },
      all_off: { name: 'All CMics are off', type: 'boolean', options: [],
        defaultStyle: style(rgb(24, 107, 62)),
        callback: () => Boolean(this.dcen?.ready && this.dcen.known && this.dcen.activeCount === 0) },
      mcd_state: { name: 'Priority or mute active', type: 'boolean',
        options: [{ type: 'dropdown', id: 'field', label: 'Reported state', default: 'priority_local',
          choices: [{ id: 'priority_local', label: 'Local priority' },
            { id: 'mute_local', label: 'Local mute' },
            { id: 'priority_mode', label: 'Priority mode' }] }],
        defaultStyle: style(0xad1f30),
        callback: ({ options }) => Boolean(this.dcen?.ready && this.mcd.values[options.field] === 'ON'),
      },
      online: { name: 'DCen ready', type: 'boolean', options: [],
        defaultStyle: style(rgb(24, 107, 62)), callback: () => this.dcen?.ready === true },
      microphone: { name: 'CMic status', type: 'boolean',
        options: [...addressFields, { type: 'dropdown', id: 'state', label: 'State', default: 'on',
          choices: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }, { id: 'request', label: 'Speaking request' }, { id: 'muted', label: 'Temporarily muted' }] }],
        defaultStyle: style(rgb(173, 31, 48)),
        callback: ({ options }) => {
          try {
            const { by, identifier } = microphoneAddress(options)
            if (by === 'seat' && !this.observedSeats.has(String(identifier).trim().toUpperCase())) return false
            return this.dcen?.micState(by, identifier) === options.state
          } catch {
            return false
          }
        } },
    })
    await this.configUpdated(config)
  }

  seatVariableId(id) {
    return `seat_${Number.parseInt(id, 16)}_state`
  }

  registerVariables(ids, by) {
    this.setVariableDefinitions({
      ...Object.fromEntries(ids.map(id => [`${by === 'seat' ? 'seat' : 'mic'}_${id}_state`, { name: `Seat ${Number.parseInt(id, 16)}: Microphone state (legacy)` }])),
      ...(by === 'seat' ? Object.fromEntries(ids.map(id => [this.seatVariableId(id), { name: `Seat ${Number.parseInt(id, 16)}: Microphone state` }])) : {}),
      ...mcdVariableDefinitions,
      mic_mode: { name: 'Reported discussion mode' },
      max_delegates: { name: 'Reported delegate limit' },
      active_count: { name: 'Number of active CMics' },
      link: { name: 'MCD connection' },
    })
  }

  registerPresets(ids, by) {
    const style = color => ({ bgcolor: color, color: 0xffffff })
    const microphonePresets = Object.fromEntries(ids.map(identifier => {
      const address = { seatNumber: String(Number.parseInt(identifier, 16)) }
      const label = by === 'seat' ? String(Number.parseInt(identifier, 16)).padStart(4, '0') : identifier
      return [`${by === 'seat' ? 'seat' : 'mic'}_${identifier}`, {
        type: 'simple', name: label,
        style: { ...style(0xe6e6e6), color: 0x292f36, text: label, size: '18', alignment: 'center:bottom',
          png64: seatMicIconDark, pngalignment: 'center:top' },
        steps: [{ down: [{ actionId: 'microphone', options: { ...address, operation: 'toggle' } }], up: [] }],
        feedbacks: Object.entries(roleStates).map(([state, [, color]]) => ({
          feedbackId: 'microphone', options: { ...address, state }, style: { ...style(color), png64: seatMicIcon },
        })),
      }]
    }))
    this.setPresetDefinitions([{
      id: 'microphones', name: 'Conference system',
      definitions: [{ id: 'cmics', type: 'simple', name: 'CMics', presets: [...Object.keys(microphonePresets), 'all_off', ...groupOffNumbers.map(groupOffId), 'all_on', 'status'] },
        { id: 'discussion', type: 'simple', name: 'Discussion', presets: ['cycle_mode', 'cycle_max_delegates'] }],
    }], {
      ...microphonePresets,
      cycle_mode: { type: 'simple', name: 'Next mode',
        style: { ...style(0x344b71), text: 'Mode\n$(dcen:mic_mode)', size: 'auto' },
        steps: [{ down: [{ actionId: 'cycle_mode', options: {} }], up: [] }], feedbacks: [] },
      cycle_max_delegates: { type: 'simple', name: 'Next delegate limit',
        style: { ...style(0x344b71), text: 'Delegate limit\n$(dcen:max_delegates)', size: 'auto' },
        steps: [{ down: [{ actionId: 'cycle_max_delegates', options: {} }], up: [] }], feedbacks: [] },
      all_on: { type: 'simple', name: 'All CMics on (hold)',
        style: { ...style(0x344b71), text: 'All CMics ON\nHALTEN', size: 'auto' },
        steps: [{ down: [], up: [], '1000': { options: { runWhileHeld: true },
          actions: [{ actionId: 'all_on', options: {} }] } }], feedbacks: [] },
      all_off: { type: 'simple', category: 'CMics', name: 'All CMics off (hold)',
        style: { text: 'CMics OFF\nHALTEN', size: 'auto', color: 0xffffff, bgcolor: 0x823214 },
        steps: [{ down: [], up: [], '1000': { options: { runWhileHeld: true }, actions: [{ actionId: 'all_off', options: {} }] } }], feedbacks: [] },
      ...Object.fromEntries(groupOffNumbers.map(group => [groupOffId(group), {
        type: 'simple', category: 'CMics', name: 'Group Off ' + group + ' (hold)',
        style: { text: 'GROUP OFF ' + group + '\nHOLD', size: 'auto', color: 0xffffff, bgcolor: 0x823214 },
        steps: [{ down: [], up: [], '1000': { options: { runWhileHeld: true }, actions: [{ actionId: groupOffId(group), options: {} }] } }],
        feedbacks: [],
      }])),
      status: { type: 'simple', category: 'CMics', name: 'DCen status',
        style: { text: 'DCen\n$(dcen:link)\n$(dcen:active_count) active', size: 'auto', color: 0xffffff, bgcolor: 0x303840 },
        steps: [{ down: [], up: [] }], feedbacks: [{ feedbackId: 'online', options: {}, style: style(0x186b3e) }] },
    })
  }

  getConfigFields() {
    return [
      { type: 'textinput', id: 'host', label: 'DCen IP address / hostname', width: 8 },
      { type: 'number', id: 'port', label: 'MCD TCP port (default: 3225)', default: 3225, min: 1, max: 65535, width: 4 },
      { type: 'number', id: 'seatFrom', label: 'All On – From seat', default: 1, min: 1, max: 100, step: 1, width: 6 },
      { type: 'number', id: 'seatTo', label: 'All On – To seat', default: 100, min: 1, max: 100, step: 1, width: 6 },
      { type: 'static-text', id: 'seatRangeHelp', label: 'All On seat range', width: 12,
        value: 'Leave blank or use the defaults (1 to 100) for all detected seats.' },
      ...groupOffNumbers.flatMap(group => groupOffFields(group, this.groupOffConfig ?? {})),
      { type: 'static-text', id: 'offSeatRangeHelp', label: 'Group Off seat range', width: 12,
        value: 'Enable groups in order from 1 to 4. Disabling a group also disables all higher groups. For an enabled group, blank or 0 uses seat 1 for From and seat 100 for To.' },
    ]
  }

  async configUpdated(config) {
    this.dcen?.removeAllListeners()
    this.dcen?.stop()
    this.dcen = undefined
    this.addressBy = 'seat'
    this.observedSeats = new Set()
    this.seatFilter = seatsInRange(config.seatFrom, config.seatTo, allSeatIds, message => this.log('warn', 'All On: ' + message))
    this.groupOffConfig = config
    this.offSeats = groupOffSeats(config, allSeatIds, message => this.log('warn', message))
    this.mcd.reset()
    this.roleIds = Object.fromEntries(Object.keys(roles).map(role => [
      role, String(config[role] ?? '').trim().toUpperCase(),
    ]))
    this.updateAddresses(allSeatIds)
    this.updateSeatAllOn()
    const host = String(config.host ?? '').trim()
    const port = Number(config.port ?? 3225)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      this.updateStatus(InstanceStatus.BadConfig, 'Enter an IP address or hostname and a TCP port')
      this.refresh('Setup')
      return
    }
    this.dcen = new Dcen(host, port)
    this.dcen.on('warning', message => this.log('warn', message))
    this.dcen.on('link', state => {
      const statuses = {
        connecting: [InstanceStatus.Connecting, 'Waiting for DCen PING', 'Connecting'],
        ready: [InstanceStatus.Ok, undefined, 'Ready'],
        retry: [InstanceStatus.ConnectionFailure, 'Connection lost. Reconnecting.', 'Offline'],
      }
      if (state === 'retry') {
        this.mcd.reset()
        this.clearObservedSeats()
      }
      const [status, detail, label] = statuses[state]
      this.updateStatus(status, detail)
      this.refresh(label)
    })
    this.dcen.on('telegram', telegram => {
      if (telegram[0] === 'BOOT') {
        this.mcd.reset()
        this.clearObservedSeats()
      }
      this.discoverSeat(telegram)
      this.mcd.accept(telegram)
      this.setVariableValues(this.mcd.variables())
      if (['PRIOMODE', 'PRIOSTATE', 'MUTESTATE'].includes(telegram[0])) this.checkFeedbacks('mcd_state')
    })
    this.dcen.on('state', () => this.refresh())
    this.dcen.start()
  }

  updateAddresses(ids) {
    this.configuredIds = ids
    this.allOnCommands = ids.map(id => micCommand('on', this.addressBy, id))
    this.registerVariables(ids, this.addressBy)
    this.registerPresets(ids, this.addressBy)
  }

  discoverSeat([type, unit, rawSeat]) {
    if (this.addressBy !== 'seat' || !['MIC-ON','MIC-OFF','REQ-ON','MICMUTE'].includes(type)) return
    if (!/^[0-3][0-9A-F]{3}$/i.test(unit ?? '')) return
    const seat = String(rawSeat ?? '').trim().toUpperCase()
    if (!/^[0-9A-F]{4}$/.test(seat) || seat === 'FFFF') return
    const number = Number.parseInt(seat, 16)
    if (number < 1 || number > 100 || this.observedSeats.has(seat)) return
    this.observedSeats.add(seat)
    this.updateSeatAllOn()
  }

  clearObservedSeats() {
    if (!this.observedSeats.size) return
    this.observedSeats.clear()
    this.updateSeatAllOn()
  }

  updateSeatAllOn() {
    this.allOnCommands = [...this.observedSeats].sort()
      .filter(id => this.seatFilter.has(id))
      .map(id => micCommand('on', 'seat', id))
  }

  async destroy() {
    this.dcen?.removeAllListeners()
    this.dcen?.stop()
  }

  refresh(label) {
    const values = { active_count: this.dcen?.ready && this.dcen.known ? this.dcen.activeCount : '–' }
    values.mic_mode = this.dcen?.ready ? this.dcen.mode ?? '–' : '–'
    values.max_delegates = this.dcen?.ready ? this.dcen.maxDelegates ?? '–' : '–'
    const prefix = this.addressBy === 'seat' ? 'seat' : 'mic'
    for (const id of this.configuredIds) {
      const known = this.addressBy !== 'seat' || this.observedSeats.has(id)
      const state = known ? this.dcen?.micState(this.addressBy, id) ?? 'unknown' : 'unknown'
      values[`${prefix}_${id}_state`] = state
      if (this.addressBy === 'seat') values[this.seatVariableId(id)] = state
    }
    if (label) {
      values.link = label
      Object.assign(values, this.mcd.variables())
    }
    this.setVariableValues(values)
    this.checkFeedbacks('online', 'microphone', 'any_on', 'all_off', 'role_state', 'mcd_state')
  }

  roleAddress(options) {
    if (options.seatNumber == null && options.role != null)
      return { by: 'unit', identifier: this.roleIds?.[options.role] }
    return microphoneAddress(options)
  }

  send(command) {
    try {
      if (!this.dcen) throw new Error('No DCen configured')
      this.dcen.send(command)
    } catch (error) {
      this.log('warn', error.message)
    }
  }
}

