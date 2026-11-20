import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import test from 'node:test'
import { Dcen, TelegramReader, micCommand } from './protocol.js'

test('accepts split and batched telegrams, including legacy whitespace', () => {
  const reader = new TelegramReader()
  const received = []
  const feed = string => reader.feed(Buffer.from(string), msg => received.push(msg))
  feed('ignored\nPI')
  feed('NG;\r\nMIC-ON ;1001;000')
  feed('4;\r\nREQ-ON ;1002;;\r')
  assert.deepEqual(received, [['PING', ''], ['MIC-ON', '1001', '0004', ''], ['REQ-ON', '1002', '', '']])
})

test('formats individual IDs and rejects wildcard and malformed addresses', () => {
  assert.equal(micCommand('off', 'unit', ' 100a '), 'MIC-OFF;100A;;')
  assert.equal(micCommand('on', 'seat', '0004'), 'MIC-ON;;0004;')
  assert.throws(() => micCommand('off', 'seat', 'FFFF'))
  assert.throws(() => micCommand('off', 'unit', '0001;FFFF'))
})

test('exchanges handshake, microphone events and global off with a TCP mock', { timeout: 3000 }, async t => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  t.after(() => server.close())
  await once(server, 'listening')
  const dcen = new Dcen('127.0.0.1', server.address().port)
  t.after(() => dcen.stop())
  const accepted = once(server, 'connection')
  dcen.start()
  const [socket] = await accepted
  t.after(() => socket.destroy())
  assert.throws(() => dcen.send('MIC-OFF;FFFF;;'))
  const pong = once(socket, 'data')
  socket.write('\nPING;\r')
  assert.equal((await pong)[0].toString(), '\nPONG;\r')
  assert.equal(dcen.ready, true)
  assert.equal(dcen.known, false)
  const discussion = new Promise(resolve => dcen.on('state', () => {
    if (dcen.mode === 'AUT-NEXT' && dcen.maxDelegates === 4) resolve()
  }))
  socket.write('\nMICMODE;AUT-NEXT\r\nMAXDEL;0004\r')
  await discussion
  const state = new Promise(resolve => {
    dcen.on('state', () => { if (dcen.activeCount === 1) resolve() })
  })
  socket.write('\nMIC-OFF;FFFF;;\r\nMIC-ON ;1001;0004;\r')
  await state
  assert.equal(dcen.micState('seat', '0004'), 'on')
  assert.equal(dcen.micState('unit', '1001'), 'on')
  const muted = once(dcen, 'state')
  socket.write('\nMICMUTE;1001;0004;\r')
  await muted
  assert.equal(dcen.micState('unit', '1001'), 'muted')
  const reassigned = once(dcen, 'state')
  socket.write('\nMIC-ON ;2002;0004;\r')
  await reassigned
  assert.equal(dcen.micState('seat', '0004'), 'on')
  assert.equal(dcen.micState('unit', '1001'), 'muted')
  const command = once(socket, 'data')
  dcen.send('MIC-OFF;FFFF;;')
  assert.equal((await command)[0].toString(), '\nMIC-OFF;FFFF;;\r')
  const disconnected = once(dcen, 'state')
  socket.destroy()
  await disconnected
  assert.equal(dcen.micState('unit', '1001'), 'unknown')
})

test('loads as a Companion 2.x module and registers its actions and presets', async () => {
  const { readFile } = await import('node:fs/promises')
  const { validateManifest } = await import('@companion-module/base/manifest')
  const { default: Module } = await import('./main.js')
  validateManifest(JSON.parse(await readFile(new URL('./companion/manifest.json', import.meta.url), 'utf8')), true)
  const captured = {}
  const module = new Module({
    id: 'mock-dcen',
    _isInstanceContext: true,
    setVariableDefinitions: variables => { captured.variables = variables },
    setActionDefinitions: actions => { captured.actions = actions },
    setFeedbackDefinitions: feedbacks => { captured.feedbacks = feedbacks },
    setPresetDefinitions: (groups, presets) => { captured.groups = groups; captured.presets = presets },
    updateStatus: status => { captured.status = status },
    setVariableValues: () => {},
    checkFeedbacks: () => {},
  })
  await module.init({ unitIds: '1001, 1002, 1001', modeOrder: 'VAL, VAU', micRules: 'seat:0001 on -> 2/0/3' })
  const fields = module.getConfigFields()
  assert.match(fields.find(field => field.id === 'port').label, /\(default: 3225\)/)
  assert.ok(!fields.some(field => ['modeOrder', 'micRules', 'rulesPort', 'unitIds', 'seatIds'].includes(field.id)))
  assert.ok(!captured.variables.last_rule)
  assert.ok(captured.variables.active_count)
  assert.ok(captured.actions.all_off)
  assert.ok(captured.feedbacks.microphone)
  assert.equal(captured.groups[0].definitions[0].presets.filter(id => id.startsWith('seat_')).length, 100)
  assert.equal(captured.presets.all_off.steps[0][1000].options.runWhileHeld, true)
  const sent = []
  module.send = command => sent.push(command)
  const toggle = captured.presets.seat_0001.steps[0].down[0]
  const press = () => captured.actions[toggle.actionId].callback({ options: toggle.options })
  press()
  assert.deepEqual(sent, [])
  assert.equal(captured.presets.seat_0001.style.text, '0001')
  let state = 'off'
  module.dcen = { micState: (by, id) => by === 'seat' && id === '0001' ? state : 'unknown',
    removeAllListeners() {}, stop() {} }
  module.discoverSeat(['MIC-OFF', '1001', '0001'])
  press()
  state = 'on'
  const red = captured.presets.seat_0001.feedbacks.find(f => f.options.state === 'on')
  assert.equal(captured.feedbacks[red.feedbackId].callback({ options: red.options }), true)
  press()
  assert.deepEqual(sent, ['MIC-ON;;0001;', 'MIC-OFF;;0001;'])
  Object.assign(module.dcen, { ready: true, mode: 'AUT-UNLIMITED', maxDelegates: 4 })
  for (const key of ['cycle_mode', 'cycle_max_delegates']) {
    const action = captured.presets[key].steps[0].down[0]
    captured.actions[action.actionId].callback()
  }
  assert.deepEqual(sent.slice(2), ['MICMODE;AUT', 'MAXDEL;0001'])
  module.dcen.mode = 'AUT-NEXT'
  captured.actions.cycle_mode.callback()
  assert.equal(sent.at(-1), 'MICMODE;AUT-FLOAT')
  module.dcen.mode = null
  captured.actions.cycle_mode.callback()
  assert.equal(sent.at(-1), 'MICMODE;AUT-FLOAT')
  assert.equal(captured.status, 'bad_config')
  await module.configUpdated({ seatFrom: '4', seatTo: '5' })
  assert.equal(captured.groups[0].definitions[0].presets.filter(id => id.startsWith('seat_')).length, 100)
  module.discoverSeat(['MIC-ON', '1001', '0004'])
  module.discoverSeat(['MIC-OFF', '2001', '0005'])
  module.discoverSeat(['MIC-ON', '1002', '0009'])
  assert.equal(captured.groups[0].definitions[0].presets.filter(id => id.startsWith('seat_')).length, 100)
  assert.ok(captured.variables.seat_0004_state)
  assert.deepEqual(captured.presets.seat_0004.steps[0].down[0].options, { seatNumber: '4', operation: 'toggle' })
  assert.ok(captured.presets.seat_0004.feedbacks.every(f => f.options.seatNumber === '4'))
  captured.actions.all_on.callback()
  assert.deepEqual(sent.slice(-2), ['MIC-ON;;0004;', 'MIC-ON;;0005;'])
  await module.configUpdated({})
  module.discoverSeat(['MIC-ON', '1001', '000A'])
  module.discoverSeat(['MIC-OFF', '2001', '0064'])
  module.discoverSeat(['MIC-ON', '1002', '0065'])
  assert.equal(captured.presets.seat_000A.style.text, '0010')
  assert.equal(captured.presets.seat_0064.style.text, '0100')
  assert.equal(captured.presets.seat_0064.style.alignment, 'center:bottom')
  assert.equal(Buffer.from(captured.presets.seat_0064.style.png64, 'base64').subarray(1, 4).toString(), 'PNG')
  assert.equal(captured.presets.seat_0065, undefined)
  const f = captured.presets.seat_000A.feedbacks.find(f => f.options.state === 'on')
  module.dcen = { micState: (by,id) => by === 'seat' && id === '000A' ? 'on' : 'off',
    removeAllListeners() {}, stop() {} }
  assert.equal(captured.feedbacks[f.feedbackId].callback({ options: f.options }), true)
  module.clearObservedSeats()
  assert.equal(captured.feedbacks[f.feedbackId].callback({ options: f.options }), false)
  assert.equal(captured.groups[0].definitions[0].presets.filter(id => id.startsWith('seat_')).length, 100)
  await module.destroy()
})
