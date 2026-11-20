# Braehler DCen module for Bitfocus Companion

This module controls a Braehler DIGIMIC wired DCen over the MCD TCP protocol. It uses reported microphone states to update buttons and variables.

## Requirements

- Bitfocus Companion 5.1
- A network-accessible DCen with MCD over TCP enabled
- The DCen IP address or hostname and MCD TCP port (default **3225**)
- Seat numbers assigned on the DCen

## Configuration

1. In Companion, open **Modules → Import module package** and select the module archive.
2. Add or open **Braehler DCen** under **Connections**. The examples below use the connection name `dcen`.
3. Enter the DCen address and MCD TCP port, then save and enable the connection.
4. To limit **All On**, enter decimal seat numbers under **From seat** and **To seat**. Use the stepper controls or type the numbers directly. Leave both fields blank or use the defaults (1 to 100) for all detected seats. A blank start means 1 and a blank end means 100. Enter any previous seat filter again using the new fields.
5. Enable **Group Off 1–4** in order and set a seat range for each group. Disabling a group makes that group and all higher groups inactive. Saved ranges are retained. For an enabled group, blank or 0 uses seat 1 for From and seat 100 for To. The previous Group Off range and button are retained as Group 1. **All Off** uses the DCen global off command.
6. The connection shows **Ready** after the MCD handshake. If it shows **Offline**, check the address, port and Companion logs.

## Presets

| Preset | Function |
|---|---|
| **0001–0100** | Toggle seats 1–100. Each button displays its seat number and reported microphone state. |
| **All CMics on (hold)** | Hold for one second to turn on detected seats within the configured range. |
| **All CMics off (hold)** | Hold for one second to send the DCen global off command. |
| **Group Off 1–4 (hold)** | Hold for one second to switch off the seats in the range configured for that group. |
| **DCen status** | Show the connection status and active microphone count. |
| **Next mode** | Cycle through AUT, AUT-NEXT, AUT-FLOAT and AUT-UNLIMITED. |
| **Next delegate limit** | Cycle through limits 1, 2, 3 and 4. |

Seat buttons use light gray for unknown, red for on, gray for off, green for a speaking request and purple for mute. If a seat remains light gray, switch its microphone on briefly so the DCen reports the assignment.

## Actions

- **Control a CMic** — enter a decimal seat number (1–100) to turn its microphone on or off, toggle it, or set or clear a speaking request.
- **Turn on all eligible CMics** / **Turn off all CMics** — control microphones as a group. The DCen applies its discussion mode and delegate limits.
- **Cycle discussion mode** / **Set discussion mode** — cycle the automatic modes or select a documented mode directly. Cycling waits for the DCen to report its current mode.
- **Cycle delegate limit**, **Set delegate limit**, **Set VIP limit**, and **Set DCen volume**.
- **Set priority mode**, **Set mute mode**, **Set or clear external priority**, and **Set or clear external mute**.
- **Assign a language to a channel** and **Request language list**.
- **Bind MCD connection to a seat**, **Set headphone channel and volume**, **Cast a vote in an active ballot**, and **Acknowledge text message**. Enter a decimal seat number. The module resolves the associated unit ID from DCen feedback. If the assignment is missing, switch the microphone on briefly so the DCen reports it. Ballot IDs are entered in decimal.

Some headphone, voting, message and RFID functions require DCen release 3.4MM and a UNIT binding. Reapply the binding after reconnecting. The raw MCD diagnostic variables preserve the original protocol values.

## Feedback

- **CMic status** — on, off, speaking request or temporarily muted for a decimal seat number.
- **At least one CMic is on** / **All CMics are off** — microphone group status.
- **DCen ready** — the MCD connection is ready.
- **Priority or mute active** — local status reported by the DCen.

## Variables

Use the decimal seat number without leading zeros. Previously configured legacy seat variables are still supported.

| Variable | Value |
|---|---|
| `$(dcen:seat_1_state)` | Microphone state for seat 1 |
| `$(dcen:seat_10_state)` | Microphone state for seat 10 |
| `$(dcen:seat_100_state)` | Microphone state for seat 100 |
| `$(dcen:link)` | Connection status |
| `$(dcen:heartbeat_count)` | Received heartbeat count |
| `$(dcen:active_count)` | Active microphone count |
| `$(dcen:mic_mode)` | Reported discussion mode |
| `$(dcen:max_delegates)` / `$(dcen:max_vip)` | Delegate and VIP limits |
| `$(dcen:volume)` | DCen volume (0–65535) |
| `$(dcen:priority_mode)` / `$(dcen:mute_mode)` | Configured modes |
| `$(dcen:priority_local)` / `$(dcen:mute_local)` | Reported local states |

Additional variables provide JSON snapshots for microphones, languages, interpreters, headphones, votes, text messages and RFID events. The `last_telegram`, `last_telegram_fields_json`, `event_count` and per-event variables such as `telegram_int_setup_json` provide protocol diagnostics.
