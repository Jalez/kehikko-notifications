#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ID } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7910 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision
 * on their behalf every time they pressed start.
 *
 * ## The filename is the module id
 *
 * Not a field inside the file — the NAME. A host sweeps the directory and takes
 * the id from the filename, so `roadmap.notifications.json` is what makes this
 * `roadmap.notifications`. Two files naming the same port under different names
 * are two modules as far as a host is concerned.
 *
 * ## `dir` is written as well as `url`
 *
 * So a host that offers to START this app knows where `run.sh` lives. The url
 * alone says where to look; the directory says what to run, and a host with
 * only the first can report the app as silent and offer nothing to do about it.
 *
 * ## Where a host looks
 *
 * This line must say exactly what the host's own registry sweep says, and it is
 * copied rather than imported because this directory is meant to stand alone.
 * Writing to the wrong directory is the worst failure a module can have: the
 * host finds nothing, and finds it silently.
 */
const registryDir = process.env.ROADMAP_MODULES_DIR ?? join(homedir(), '.roadmap', 'modules')

const port = Number(process.env.PORT ?? 7910)
const origin = `http://127.0.0.1:${port}`
const dir = dirname(fileURLToPath(import.meta.url))

mkdirSync(registryDir, { recursive: true })
const file = join(registryDir, `${ID}.json`)
writeFileSync(file, `${JSON.stringify({ url: origin, dir }, null, 2)}\n`)
console.log(`registered: ${file} -> ${origin} (${dir})`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
