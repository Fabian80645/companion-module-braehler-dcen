# Braehler DCen module for Bitfocus Companion

A Bitfocus Companion connection module for Braehler DCen conference systems. It controls delegate microphones over MCD TCP and uses the device's reports for button feedback.

## Features

- 100 microphone presets with decimal seat numbers and feedback for on, off, request, mute and unknown.
- Global All Off, configurable All On and up to four independently configured Group Off ranges.
- Discussion mode and delegate limit controls, plus MCD actions and status variables.

## Install and configure

Import the `braehler-dcen-1.0.0.tgz` module package in Companion under **Modules → Import module package**. Add a **Braehler DCen** connection and enter the address of your DCen and its MCD TCP port (default **3225**). See the [module help](companion/HELP.md) for actions, feedback and presets.

## Develop

Requires Node.js 22 or later and npm.

```sh
npm ci
npm test
```

The tests exercise TCP framing and the handshake with a local mock DCen, the MCD command formatting and Companion preset registration.

## Build an importable package

From the repository root, run the following in Bash (for example, Git Bash on Windows) with `tar` available:

```sh
mkdir -p dist/braehler-dcen/companion
npm exec --yes --package=esbuild@0.25.12 -- esbuild main.js --bundle \
  --platform=node --format=esm --target=node22 --minify \
  --outfile=dist/braehler-dcen/main.js
cp LICENSE dist/braehler-dcen/
cp companion/{manifest.json,HELP.md} dist/braehler-dcen/companion/
node --input-type=module -e 'import fs from "node:fs"; const {version,license} = JSON.parse(fs.readFileSync("package.json")); fs.writeFileSync("dist/braehler-dcen/package.json",JSON.stringify({name:"braehler-dcen",version,license,type:"module",dependencies:{}}));'
tar -czf braehler-dcen-1.0.0.tgz -C dist braehler-dcen
```

## License

[MIT](LICENSE)
