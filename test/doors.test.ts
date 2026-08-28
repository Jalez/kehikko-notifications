import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { answer, TICKET } from '../doors.ts'
import { MANIFEST, FORMAT } from '../manifest.ts'

/**
 * The doors, called without a socket.
 *
 * That is the whole reason `doors.ts` is a function rather than a server: every
 * decision it makes can be made here, and the dozen lines in `vite.config.ts`
 * that adapt a node request to it hold no decisions at all.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notifications-doors-'))
  process.env.NOTIFICATIONS_DATA = dir
})

afterEach(() => {
  delete process.env.NOTIFICATIONS_DATA
  rmSync(dir, { recursive: true, force: true })
})

const body = (over: Record<string, unknown> = {}) => ({
  from: 'roadmap.checklist',
  at: '2026-08-28T09:00:00.000Z',
  kehikko: { id: 1, name: 'workbench' },
  payload: { epic: 'modes-are-modules', message: 'the tests passed', level: 'done', refs: ['gh#41'] },
  ...over,
})

describe('the manifest', () => {
  test('declares the one format this app consumes, and emits nothing', () => {
    expect(MANIFEST.extensions.consumes).toEqual([FORMAT])
    /* A shower that also sent would be announcing its own arrival on the screen
       it draws — and the host refuses to echo an event to its sender anyway. */
    expect(MANIFEST.extensions.emits).toEqual([])
  })

  test('declares storage, which is what closes the CORS hole', () => {
    /* Without it the host frames this opaque, its own `/api` calls become
       cross-origin, the server has to answer permissive CORS, and any tab can
       read `/app` and the write ticket in it. See the essay in `manifest.ts`. */
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('asks for no capabilities at all, and notably not events:emit', () => {
    /* A notification panel that could write to itself is a panel whose contents
       are not evidence of anything. */
    expect(MANIFEST.declares.uses).toEqual([])
  })
})

describe('reading', () => {
  test('healthz says what is held and what the cap is', () => {
    const reply = answer('GET', '/healthz', null, null)
    expect(reply?.status).toBe(200)
    expect(reply?.body).toMatchObject({ ok: true, id: 'roadmap.notifications', held: 0 })
  })

  test('the list is readable without a ticket', () => {
    /* What is here is a copy of things other modules already said out loud on a
       canvas. Gating reads would mean an agent's curl needing a ticket to see a
       page it can already open. */
    const reply = answer('GET', '/api/notifications', null, null)
    expect(reply?.status).toBe(200)
    expect(reply?.body).toMatchObject({ ok: true, rows: [] })
  })

  test('a path this app does not own is handed back to Vite rather than refused', () => {
    /* `null`, not a 404. The page, the client module and Vite's own hot-reload
       socket all live on paths this file has never heard of. */
    expect(answer('GET', '/page/main.ts', null, null)).toBeNull()
  })
})

describe('writing', () => {
  test('a write without the ticket is refused', () => {
    const reply = answer('POST', '/api/notifications', body(), null)
    expect(reply?.status).toBe(403)
  })

  test('a write with the wrong ticket is refused', () => {
    const reply = answer('POST', '/api/notifications', body(), 'not-the-ticket')
    expect(reply?.status).toBe(403)
  })

  test('a write with the ticket is recorded and comes back on the list', () => {
    expect(answer('POST', '/api/notifications', body(), TICKET)?.status).toBe(200)
    const reply = answer('GET', '/api/notifications', null, null)
    const rows = (reply?.body as { rows: { from: string; payload: { message: string } }[] }).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]!.from).toBe('roadmap.checklist')
    expect(rows[0]!.payload.message).toBe('the tests passed')
  })

  test('a notification with nobody to attribute it to is refused, not stored as unknown', () => {
    /* This panel's whole job is attribution. A line it cannot attribute is not
       a notification, it is a rumour. */
    const reply = answer('POST', '/api/notifications', body({ from: '  ' }), TICKET)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('attribute')
  })

  test('a null kehikko is accepted, because a host need not have canvases', () => {
    expect(answer('POST', '/api/notifications', body({ kehikko: null }), TICKET)?.status).toBe(200)
    const rows = (answer('GET', '/api/notifications', null, null)?.body as { rows: { kehikko: unknown }[] }).rows
    expect(rows[0]!.kehikko).toBeNull()
  })

  test('a malformed kehikko becomes null rather than a refusal or a guess', () => {
    answer('POST', '/api/notifications', body({ kehikko: { id: 'three', name: 'workbench' } }), TICKET)
    const rows = (answer('GET', '/api/notifications', null, null)?.body as { rows: { kehikko: unknown }[] }).rows
    /* Guessing "this one" would put a stranger's line under the reader's own
       canvas, which is the one thing the filter must never do. */
    expect(rows[0]!.kehikko).toBeNull()
  })
})

describe('nothing arriving is unbounded', () => {
  test('an enormous message is cut rather than stored whole', () => {
    answer('POST', '/api/notifications', body({ payload: { message: 'x'.repeat(1_000_000), epic: '' } }), TICKET)
    const rows = (answer('GET', '/api/notifications', null, null)?.body as {
      rows: { payload: { message: string } }[]
    }).rows
    expect(rows[0]!.payload.message.length).toBeLessThanOrEqual(4000)
  })

  test('ten thousand refs become at most a readable handful', () => {
    answer(
      'POST',
      '/api/notifications',
      body({ payload: { message: 'many', epic: '', refs: Array.from({ length: 10_000 }, (_, i) => `gh#${i}`) } }),
      TICKET,
    )
    const rows = (answer('GET', '/api/notifications', null, null)?.body as {
      rows: { payload: { refs: string[] } }[]
    }).rows
    /* The per-item bound stops one enormous string; the list bound stops ten
       thousand small ones, which is the same thing with the arithmetic moved. */
    expect(rows[0]!.payload.refs.length).toBeLessThanOrEqual(64)
  })

  test('an enormous sender id is cut rather than stored whole', () => {
    answer('POST', '/api/notifications', body({ from: 'm'.repeat(50_000) }), TICKET)
    const rows = (answer('GET', '/api/notifications', null, null)?.body as { rows: { from: string }[] }).rows
    expect(rows[0]!.from.length).toBeLessThanOrEqual(128)
  })
})

describe('forgetting', () => {
  test('forget needs the ticket too', () => {
    answer('POST', '/api/notifications', body(), TICKET)
    expect(answer('POST', '/api/forget', {}, null)?.status).toBe(403)
  })

  test('forget empties it and says how many went', () => {
    answer('POST', '/api/notifications', body(), TICKET)
    answer('POST', '/api/notifications', body(), TICKET)
    const reply = answer('POST', '/api/forget', {}, TICKET)
    expect(reply?.body).toMatchObject({ ok: true, forgotten: 2, held: 0 })
  })
})
