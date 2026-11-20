import assert from 'node:assert/strict'
import test from 'node:test'
import { McdFeedback, mcdActions, mcdVariableDefinitions } from './mcd.js'
import { TelegramReader, micCommand } from './protocol.js'

test('formats every additional command in the DCen command table', () => {
  const output = []
  const errors = []
  const actions = mcdActions(value => output.push(value), value => errors.push(value))
  const examples = {
    set_mic_mode: [{ value: 'VALC' }, 'MICMODE;VALC'],
    set_max_delegate: [{ value: 4 }, 'MAXDEL;0004'],
    set_max_vip: [{ value: 10 }, 'MAXVIP;000A'],
    set_volume: [{ value: 65535 }, 'VOLUME;FFFF'],
    set_priority_mode: [{ value: 'ON' }, 'PRIOMODE;ON'],
    set_mute_mode: [{ value: 'TEMP' }, 'MUTEMODE;TEMP'],
    set_priority_state: [{ value: 'OFF' }, 'PRIOSTATE;OFF'],
    set_mute_state: [{ value: 'ON' }, 'MUTESTATE;ON'],
    set_language: [{ channel: 3, code: 'deu' }, 'LANG;3;DEU;'],
    list_languages: [{}, 'LANG;?;;'],
    bind_unit: [{ unit: '1001' }, 'UNIT;1001;'],
    set_headphones: [{ unit: '1001', channel: 0, level: 16 }, 'CSEL;1001;0;16;'],
    send_vote: [{ unit: '1001', vote: '000000AB', mask: 32, timestamp: '48000' }, 'VOTE;000000AB;1001;20;48000;'],
    acknowledge_message: [{ unit: '1001' }, 'MSG;1001;;'],
  }
  assert.deepEqual(Object.keys(actions), Object.keys(examples))
  for (const [id, [options, expected]] of Object.entries(examples)) {
    actions[id].callback({ options })
    assert.equal(output.at(-1), expected)
  }
  assert.equal(errors.length, 0)
  actions.set_language.callback({ options: { channel: 2, code: 'DEU\r\n' + 'MUTESTATE;ON' } })
  actions.set_max_vip.callback({ options: { value: 65536 } })
  assert.equal(errors.length, 2)
  assert.equal(output.length, 14)
  assert.equal(micCommand('request_on', 'unit', '1001'), 'REQ-ON;1001;;')
  assert.equal(micCommand('request_off', 'seat', '0004'), 'REQ-OFF;;0004;')
  assert.equal(micCommand('request', 'unit', '1001'), 'MIC-REQ;1001;;')
})

test('parses every documented DCen event, including Latin-1 and 64-bit card IDs', () => {
  const model = new McdFeedback()
  model.reset()
  const reader = new TelegramReader()
  const messages = [
    'BOOT;', 'PING;', 'MIC-ON ;1001;0004;', 'MIC-OFF;1001;0004;', 'REQ-ON ;1001;0004;',
    'MICMUTE;1001;0004;', 'MICMODE;AUT', 'MAXDEL;0004', 'MAXVIP;000A', 'VOLUME;8000',
    'PRIOMODE;ON', 'MUTEMODE;TEMP', 'PRIOSTATE;OFF', 'MUTESTATE;ON', 'LANG;2;DEU;',
    'LANG;;DEU;German;', 'INT-SETUP;1001;1;2;3;4;5;6;2;1;2;3;', 'INT-ON;1001;2;', 'INT-OFF;1001;',
    'BOOTH;1001;2;', 'TMODE;1001;ACG;', 'CSEL;1001;2;16;',
    'STARTVOTE;00000001;O;E;1;Y;N;?;;;', 'VOTE;00000001;1001;20;48000;',
    'MSG;1001; Grüße an alle; bitte lesen;', 'CARD;1001;1;FEDCBA9876543210;',
  ]
  const frame = telegram => reader.feed(Buffer.from(`\n${telegram}\r`, 'latin1'), m => model.accept(m), true)
  for (const message of messages) frame(message)
  let vars = model.variables()
  assert.deepEqual(Object.keys(vars).sort(), Object.keys(mcdVariableDefinitions).sort())
  assert.equal(vars.heartbeat_count, 1)
  assert.equal(vars.event_count, messages.length - 1)
  assert.equal(vars.max_vip, 10)
  assert.equal(vars.volume, 32768)
  assert.equal(JSON.parse(vars.messages_json)['1001'], ' Grüße an alle; bitte lesen')
  assert.equal(JSON.parse(vars.cards_json)['1001'].id, 'FEDCBA9876543210')
  assert.deepEqual(JSON.parse(vars.interpreters_json)['1001'].inputs, [2, 3, 4, 5, 6])
  assert.equal(JSON.parse(vars.interpreters_json)['1001'].active, false)
  assert.deepEqual(JSON.parse(vars.active_votes_json)['00000001'].keys, ['Y', 'N', '?', '', ''])
  frame('STOPVOTE;00000001;')
  vars = model.variables()
  assert.equal(vars.active_votes_json, '{}')
  for (const [key, value] of Object.entries(vars)) if (key.startsWith('telegram_')) assert.ok(value, key)
  model.reset()
  assert.equal(model.variables().last_telegram, '')
  assert.equal(model.variables().cards_json, '{}')
})
