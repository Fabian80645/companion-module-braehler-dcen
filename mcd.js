export const modes = ['AUT', 'AUT-NEXT', 'AUT-FLOAT', 'AUT-UNLIMITED', 'VAL', 'VAU', 'VALC', 'VAUC']

const upper = value => String(value ?? '').trim().toUpperCase()
const hexId = (length, value, label) => {
  const result = upper(value)
  if (!new RegExp(`^[0-9A-F]{${length}}$`).test(result)) throw new Error(`${label}: ${length} hex characters expected`)
  return result
}
const integer = (value, min, max) => {
  const number = Number(value)
  if (value === '' || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Expected an integer from ${min} to ${max}`)
  }
  return number
}
const hex16 = value => integer(value, 0, 65535).toString(16).toUpperCase().padStart(4, '0')
const dropdown = (id, label, values) => ({ type: 'dropdown', id, label, default: values[0],
  choices: values.map(id => ({ id, label: id })) })
const number = (id, label, min, max, value = min) => ({ type: 'number', id, label, min, max, default: value })
const input = (id, label, value = '') => ({ type: 'textinput', id, label, default: value })
const unit = input('seatNumber', 'Seat number (1–100)', '1')
const address = value => {
  const id = hexId(4, value, 'Unit ID')
  if (!/^[0-3]/.test(id)) throw new Error('Unit ID must begin with 0, 1, 2 or 3')
  return id
}
const channel = number('channel', 'Audio channel', 0, 7)
const terminal = (command, ...fields) => [command, ...fields, ''].join(';')
const setting = (command, value) => `${command};${value}`

export function mcdActions(send, warn, resolveUnit) {
  const unitAddress = options => options.seatNumber == null ? address(options.unit) : resolveUnit(options.seatNumber)
  const ballot = options => options.ballotNumber == null ? hexId(8, options.vote, 'Ballot ID') : integer(options.ballotNumber, 0, 0xffffffff).toString(16).toUpperCase().padStart(8, '0')
  const action = (name, options, format) => ({
    name, options,
    callback: ({ options }) => {
      try { send(format(options)) } catch (error) { warn(error.message) }
    },
  })
  const choice = (name, command, values) => action(name, [dropdown('value', 'Value', values)], ({ value }) => {
    if (!values.includes(value)) throw new Error('Unknown value')
    return setting(command, value)
  })
  const level = (name, command, defaultValue) => action(name,
    [number('value', 'Value (decimal)', 0, 65535, defaultValue)], ({ value }) => setting(command, hex16(value)))

  return {
    set_mic_mode: choice('Set discussion mode', 'MICMODE', modes),
    set_max_delegate: level('Set delegate limit', 'MAXDEL', 4),
    set_max_vip: level('Set VIP limit', 'MAXVIP', 1),
    set_volume: level('Set DCen volume', 'VOLUME', 32768),
    set_priority_mode: choice('Set priority mode', 'PRIOMODE', ['ON', 'OFF']),
    set_mute_mode: choice('Set mute mode', 'MUTEMODE', ['PERM', 'TEMP']),
    set_priority_state: choice('Set or clear external priority', 'PRIOSTATE', ['ON', 'OFF']),
    set_mute_state: choice('Set or clear external mute', 'MUTESTATE', ['ON', 'OFF']),
    set_language: action('Assign a language to a channel',
      [{ ...channel, min: 1, default: 1 }, input('code', 'ISO 639-2 code, ___ or @@@', 'DEU')], options => {
        const code = upper(options.code)
        if (!/^(?:[A-Z]{3}|___|@@@)?$/.test(code)) throw new Error('Invalid language code')
        return terminal('LANG', integer(options.channel, 1, 7), code)
      }),
    list_languages: action('Request language list', [], () => 'LANG;?;;'),
    bind_unit: action('Bind MCD connection to a seat', [unit], options => terminal('UNIT', unitAddress(options))),
    set_headphones: action('Set headphone channel and volume',
      [unit, channel, number('level', 'Volume', 0, 16, 8)], options =>
        terminal('CSEL', unitAddress(options), integer(options.channel, 0, 7), integer(options.level, 0, 16))),
    send_vote: action('Cast a vote in an active ballot',
      [unit, number('ballotNumber', 'Ballot ID (decimal)', 0, 0xffffffff), number('mask', 'Key mask (decimal)', 0, 63),
        input('timestamp', 'Elapsed time (ticks of 1/48000 s)', '0')], options =>
        terminal('VOTE', ballot(options), unitAddress(options),
          integer(options.mask, 0, 63).toString(16).toUpperCase(),
          integer(options.timestamp, 0, Number.MAX_SAFE_INTEGER))),
    acknowledge_message: action('Acknowledge text message', [unit], options => terminal('MSG', unitAddress(options), '')),
  }
}

const scalarFields = {
  MAXVIP: ['max_vip', 'Maximum open VIP microphones', 'hex'],
  VOLUME: ['volume', 'DCen volume (0–65535)', 'hex'],
  PRIOMODE: ['priority_mode', 'Priority mode'],
  MUTEMODE: ['mute_mode', 'Mute mode'],
  PRIOSTATE: ['priority_local', 'Local DCen priority state'],
  MUTESTATE: ['mute_local', 'Local DCen mute state'],
}
const telegrams = [
  'BOOT', 'MIC-ON', 'MIC-OFF', 'REQ-ON', 'MICMUTE', 'MICMODE', 'MAXDEL', ...Object.keys(scalarFields),
  'LANG', 'INT-SETUP', 'INT-ON', 'INT-OFF', 'BOOTH', 'TMODE', 'CSEL',
  'STARTVOTE', 'VOTE', 'STOPVOTE', 'MSG', 'CARD',
]
const listVariables = {
  channel_languages_json: 'Language code by audio channel (JSON)',
  languages_json: 'Reported language list (JSON)',
  interpreters_json: 'Interpreters by unit ID (JSON)',
  headphones_json: 'Headphones by unit ID (JSON)',
  microphones_json: 'Microphone states and seat IDs (JSON)',
  active_votes_json: 'Active ballots (JSON)',
  last_vote_start_json: 'Last STARTVOTE (JSON)',
  last_vote_json: 'Last reported vote (JSON)',
  last_vote_stop_id: 'Last closed ballot ID',
  messages_json: 'Text messages by unit ID (JSON)',
  cards_json: 'RFID by unit ID (JSON)',
  last_telegram: 'Last event type excluding PING',
  last_telegram_fields_json: 'Last event fields (JSON)',
  heartbeat_count: 'Heartbeats received by this connection',
  event_count: 'Event count excluding PING',
}

export const mcdVariableDefinitions = {
  ...Object.fromEntries(Object.values(scalarFields).map(([id, name]) => [id, { name }])),
  ...Object.fromEntries(Object.entries(listVariables).map(([id, name]) => [id, { name }])),
  ...Object.fromEntries(telegrams.map(type => [
    eventVar(type), { name: `Last values for ${type} (JSON)` },
  ])),
}
function eventVar(type) {
  return `telegram_${type.toLowerCase().replaceAll('-', '_')}_json`
}

export class McdFeedback {
  heartbeat = 0
  events = 0
  reset() {
    this.values = {}
    this.channels = {}
    this.languages = {}
    this.interpreters = {}
    this.headphones = {}
    this.microphones = {}
    this.unitSeats = new Map()
    this.votes = {}
    this.messages = {}
    this.cards = {}
  }

  accept([type, ...fields]) {
    if (type === 'PING') {
      this.heartbeat++
      return
    }
    if (!telegrams.includes(type)) return
    const [id, a, b, c, ...rest] = fields
    const scalar = scalarFields[type]
    const key = upper(id)
    if (scalar) this.values[scalar[0]] = scalar[2] === 'hex' && /^[0-9A-F]{4}$/.test(key)
      ? Number.parseInt(key, 16) : key

    if (type === 'LANG') {
      if (key) this.channels[key] = upper(a)
      else if (a) this.languages[upper(a)] = b ?? ''
    }
    if (['INT-SETUP', 'INT-ON', 'INT-OFF', 'BOOTH', 'TMODE'].includes(type) && key) {
      const interpreter = this.interpreters[key] ??= {}
      if (type === 'INT-SETUP') {
        const numbers = [a, b, c, ...rest].slice(0, 10).map(Number)
        Object.assign(interpreter, { inputPreselect: numbers[0], inputs: numbers.slice(1, 6),
          outputPreselect: numbers[6], outputs: numbers.slice(7, 10) })
      } else if (type === 'INT-ON' || type === 'INT-OFF') {
        interpreter.active = type === 'INT-ON'
        interpreter.channel = interpreter.active ? Number(a) : null
      } else if (type === 'BOOTH') interpreter.booth = a ?? ''
      else interpreter.takeoverMode = upper(a)
    }
    if (type === 'CSEL' && key) this.headphones[key] = { channel: Number(a), volume: Number(b) }
    if (['MIC-ON', 'MIC-OFF', 'REQ-ON', 'MICMUTE'].includes(type)) {
      if (type === 'MIC-OFF' && (key === 'FFFF' || upper(a) === 'FFFF')) this.microphones = {}
      else if (/^[0-3][0-9A-F]{3}$/.test(key)) {
        if (upper(a)) this.unitSeats.set(key, upper(a))
        this.microphones[key] = { state: { 'MIC-ON': 'on', 'MIC-OFF': 'off', 'REQ-ON': 'request',
          MICMUTE: 'muted' }[type], seat: upper(a) || this.microphones[key]?.seat || '' }
      }
    }
    if (type === 'STARTVOTE' && key) {
      const vote = { id: key, secret: upper(a) === 'S', editable: upper(b) === 'E',
        maxKeys: Number(c), keys: rest.slice(0, 5) }
      this.votes[key] = vote
      this.values.last_vote_start_json = JSON.stringify(vote)
    }
    if (type === 'VOTE') {
      this.values.last_vote_json = JSON.stringify({
        voteId: key, unitId: upper(a), keyMaskHex: upper(b), timestamp: Number(c),
      })
    }
    if (type === 'STOPVOTE') {
      delete this.votes[key]
      this.values.last_vote_stop_id = key
    }
    if (type === 'MSG' && key) this.messages[key] = fields.slice(1).join(';')
    if (type === 'CARD' && key) this.cards[key] = { type: a ?? '', id: upper(b), present: Number(a) > 0 }

    const json = JSON.stringify(fields)
    this.events++
    this.values.last_telegram = type
    this.values.last_telegram_fields_json = json
    this.values[eventVar(type)] = json
  }

  variables() {
    const values = Object.fromEntries(Object.keys(mcdVariableDefinitions).map(id => [id, '']))
    return {
      ...values, ...this.values,
      channel_languages_json: JSON.stringify(this.channels), languages_json: JSON.stringify(this.languages),
      interpreters_json: JSON.stringify(this.interpreters), headphones_json: JSON.stringify(this.headphones),
      microphones_json: JSON.stringify(this.microphones), active_votes_json: JSON.stringify(this.votes),
      messages_json: JSON.stringify(this.messages), cards_json: JSON.stringify(this.cards),
      heartbeat_count: this.heartbeat, event_count: this.events,
    }
  }
}
