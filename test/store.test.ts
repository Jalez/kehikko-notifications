import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The store, in a directory of its own per test.
 *
 * `NOTIFICATIONS_DATA` is read at call time rather than at import — see
 * `dataDir` — which is what makes this possible without a module registry
 * reset. A suite that shared one store would be a suite whose tests depend on
 * their own order, and the cap is exactly the behaviour that would hide in
 * that.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notifications-'))
  process.env.NOTIFICATIONS_DATA = dir
})

afterEach(() => {
  delete process.env.NOTIFICATIONS_DATA
  rmSync(dir, { recursive: true, force: true })
})

const store = () => import('../store.ts')

const event = (message: string, kehikko: { id: number; name: string } | null = { id: 1, name: 'workbench' }) => ({
  from: 'roadmap.checklist',
  at: '2026-08-28T09:00:00.000Z',
  kehikko,
  payload: { epic: 'modes-are-modules', message, level: 'info', refs: [] },
})

describe('what is kept', () => {
  test('an empty store is empty rather than an error', async () => {
    const { list, standing } = await store()
    expect(list()).toEqual([])
    expect(standing().held).toBe(0)
  })

  test('a row survives being written and read back, envelope and payload apart', async () => {
    const { record, list } = await store()
    record(event('the tests passed'))
    const [row] = list()
    expect(row!.from).toBe('roadmap.checklist')
    expect(row!.at).toBe('2026-08-28T09:00:00.000Z')
    expect(row!.kehikko).toEqual({ id: 1, name: 'workbench' })
    expect(row!.payload.message).toBe('the tests passed')
  })

  test('rows come back newest first, which is what this app is', async () => {
    const { record, list } = await store()
    record(event('first'))
    record(event('second'))
    record(event('third'))
    expect(list().map((r) => r.payload.message)).toEqual(['third', 'second', 'first'])
  })

  test('a null kehikko is stored as null rather than dropped or guessed', async () => {
    const { record, list } = await store()
    record(event('nowhere', null))
    expect(list()[0]!.kehikko).toBeNull()
  })

  test('seq is unique and increasing, so a page can key by it across a reload', async () => {
    const { record } = await store()
    const a = record(event('a'))
    const b = record(event('b'))
    /* Two events accepted in the same millisecond share an `at`, so `at` cannot
       be the identity — which is the whole reason `seq` exists beside it. */
    expect(b.seq).toBeGreaterThan(a.seq)
  })
})

describe('the cap, and what falls off', () => {
  test('the store stops at KEEP and it is the OLDEST that go', async () => {
    const { record, list, standing, KEEP } = await store()
    for (let i = 0; i < KEEP + 5; i += 1) record(event(`line ${i}`))

    expect(standing().held).toBe(KEEP)
    const messages = list().map((r) => r.payload.message)
    /* Newest kept: the panel is read newest-first, and a cap that dropped the
       newest would make it go deaf under exactly the load it reports on. */
    expect(messages[0]).toBe(`line ${KEEP + 4}`)
    expect(messages).not.toContain('line 0')
    expect(messages).not.toContain('line 4')
    expect(messages).toContain('line 5')
  })

  test('seq keeps rising past a trim, so ids never repeat', async () => {
    const { record, KEEP } = await store()
    for (let i = 0; i < KEEP; i += 1) record(event(`line ${i}`))
    const after = record(event('one more'))
    /* A `seq` that restarted after a trim would collide with ids the page still
       has on screen. */
    expect(after.seq).toBe(KEEP + 1)
  })
})

describe('forgetting', () => {
  test('forget empties the store and says how many went', async () => {
    const { record, forget, list } = await store()
    record(event('a'))
    record(event('b'))
    expect(forget()).toBe(2)
    expect(list()).toEqual([])
  })

  test('forget does not reset seq, so ids still cannot collide', async () => {
    const { record, forget } = await store()
    record(event('a'))
    forget()
    expect(record(event('b')).seq).toBe(2)
  })
})

describe('a store that will not parse', () => {
  test('answers empty rather than throwing, because a crashed panel reads as a quiet machine', async () => {
    writeFileSync(join(dir, 'notifications.json'), 'this is not json {{{')
    const { list } = await store()
    /* The opposite of what `kehikko-journeys` does with a broken journey, and
       deliberately: a journey is somebody's writing and hiding a broken one
       would hide work. Nothing here is anybody's writing. */
    expect(list()).toEqual([])
  })

  test('the next write replaces it, so the panel recovers on its own', async () => {
    writeFileSync(join(dir, 'notifications.json'), '{"rows": "not an array"}')
    const { record, list } = await store()
    record(event('after the corruption'))
    expect(list()).toHaveLength(1)
  })
})
