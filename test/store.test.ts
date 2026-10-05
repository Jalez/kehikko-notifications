import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The store, in a project of its own per test.
 *
 * Every read and write names a project now, because the store lives inside it
 * at `.kehikot/notifications/notifications.json`. `NOTIFICATIONS_DATA` is set
 * to a temporary directory too, and that matters more than it looks: it is
 * where the OLD single store is looked for, and a test that left it unset would
 * go looking in this repository's real `data/` — and adopt somebody's live
 * notifications into a temporary project it then deletes.
 *
 * `store()` hands back the old shape — `list()`, `record(event)` — bound to the
 * test's project, so the tests about what is kept, the cap and forgetting read
 * exactly as they did before the move. The tests about WHERE call the module
 * directly.
 */

let dir: string
let legacy: string
let project: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'notifications-')))
  legacy = join(dir, 'legacy')
  project = join(dir, 'project')
  mkdirSync(project)
  process.env.NOTIFICATIONS_DATA = legacy
})

afterEach(() => {
  delete process.env.NOTIFICATIONS_DATA
  rmSync(dir, { recursive: true, force: true })
})

const raw = () => import('../store.ts')

const store = async () => {
  const m = await raw()
  return {
    KEEP: m.KEEP,
    list: () => m.list(project),
    standing: () => m.standing(project),
    record: (e: Parameters<typeof m.record>[1]) => {
      const done = m.record(project, e)
      if (!done.ok) throw new Error(done.error)
      return done.value
    },
    forget: (seqs?: readonly number[]) => {
      const done = m.forget(project, seqs)
      if (!done.ok) throw new Error(done.error)
      return done.value
    },
  }
}

const file = () => join(project, '.kehikot', 'notifications', 'notifications.json')

const event = (message: string, kehikko: { id: number; name: string } | null = { id: 1, name: 'workbench' }) => ({
  from: 'kehikot.checklist',
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
    expect(row!.from).toBe('kehikot.checklist')
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

  /*
   * Forgetting only what is SHOWN, which is what the host's clear control means
   * and the reason this can now be told which rows to drop.
   *
   * That control is drawn in the container header beside the filter, and the
   * two compose: "shown" is whatever the filter left. Only this module can
   * answer what that is — the host sees rows it does not render, in a document
   * it cannot read — so the page works the list out and names it here.
   */
  test('a list of seqs forgets exactly those and keeps the rest', async () => {
    const { record, forget, list } = await store()
    const a = record(event('a'))
    const b = record(event('b'))
    const c = record(event('c'))
    expect(forget([a.seq, c.seq])).toBe(2)
    expect(list().map((row) => row.seq)).toEqual([b.seq])
  })

  /* No list still means everything, which is what this has always meant and
     what any caller that has not been updated still means by it. A version that
     silently required a list would have turned "clear this panel" into "clear
     nothing" for every one of them, with nothing erroring. */
  test('and no list at all still means everything', async () => {
    const { record, forget, list } = await store()
    record(event('a'))
    record(event('b'))
    expect(forget()).toBe(2)
    expect(list()).toEqual([])
  })

  /*
   * Ids that name nothing are ignored rather than refused. A page's idea of
   * what is on screen and the store's idea of what exists are two observations
   * of one thing at two moments, and a row trimmed by `KEEP` between the render
   * and the press is not an error — it is a row that is already gone, which is
   * what was being asked for.
   */
  test('an id that matches nothing is not an error', async () => {
    const { record, forget, list } = await store()
    const a = record(event('a'))
    expect(forget([a.seq, 9999])).toBe(1)
    expect(list()).toEqual([])
  })

  test('and an empty list forgets nothing at all', async () => {
    const { record, forget, list } = await store()
    record(event('a'))
    expect(forget([])).toBe(0)
    expect(list()).toHaveLength(1)
  })
})

describe('a store that will not parse', () => {
  test('answers empty rather than throwing, because a crashed panel reads as a quiet machine', async () => {
    mkdirSync(join(project, '.kehikot', 'notifications'), { recursive: true })
    writeFileSync(file(), 'this is not json {{{')
    const { list } = await store()
    /* The opposite of what `kehikko-journeys` does with a broken journey, and
       deliberately: a journey is somebody's writing and hiding a broken one
       would hide work. Nothing here is anybody's writing. */
    expect(list()).toEqual([])
  })

  test('the next write replaces it, so the panel recovers on its own', async () => {
    mkdirSync(join(project, '.kehikot', 'notifications'), { recursive: true })
    writeFileSync(file(), '{"rows": "not an array"}')
    const { record, list } = await store()
    record(event('after the corruption'))
    expect(list()).toHaveLength(1)
  })
})

describe('where it lives', () => {
  test('inside the project, at .kehikot/notifications/notifications.json', async () => {
    const { record } = await store()
    record(event('placed'))
    expect(existsSync(file())).toBe(true)
    expect(JSON.parse(readFileSync(file(), 'utf8')).rows[0].payload.message).toBe('placed')
  })

  test('two projects are two stores', async () => {
    const m = await raw()
    const other = join(dir, 'other')
    mkdirSync(other)
    m.record(project, event('here'))
    m.record(other, event('there'))
    expect(m.list(project).map((r) => r.payload.message)).toEqual(['here'])
    expect(m.list(other).map((r) => r.payload.message)).toEqual(['there'])
  })

  test('reading creates nothing, so looking at a project never changes it', async () => {
    const { list } = await store()
    expect(list()).toEqual([])
    expect(existsSync(join(project, '.kehikot'))).toBe(false)
  })

  test('no project is "nowhere", and a write there is refused rather than guessed', async () => {
    const m = await raw()
    expect(m.standing(null)).toMatchObject({ nowhere: true, rows: [] })
    expect(m.standing('  ')).toMatchObject({ nowhere: true })
    const done = m.record(null, event('lost'))
    expect(done.ok).toBe(false)
    expect(m.forget(undefined).ok).toBe(false)
  })

  test('a relative project path is refused, never resolved against this program', async () => {
    const m = await raw()
    expect(m.standing('some/project').trouble).toContain('absolute')
    expect(m.record('some/project', event('x')).ok).toBe(false)
  })

  test('a project that does not exist is refused', async () => {
    const m = await raw()
    expect(m.standing(join(dir, 'missing')).trouble).toContain('no folder')
  })

  test('a .kehikot that points out of the project is refused, not followed', async () => {
    const m = await raw()
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(project, '.kehikot'))
    const done = m.record(project, event('escaped'))
    expect(done.ok).toBe(false)
    expect(existsSync(join(elsewhere, 'notifications'))).toBe(false)
  })
})

describe('the old store beside the program', () => {
  const old = (rows: number) => ({
    next: rows + 1,
    rows: Array.from({ length: rows }, (_, i) => ({
      seq: i + 1,
      from: 'kehikot.checklist',
      at: '2026-08-01T00:00:00.000Z',
      kehikko: { id: 10, name: 'writing' },
      payload: { epic: '', message: `old ${i + 1}`, level: 'info', refs: [] },
    })),
  })

  test('moves whole into the first project that opens, and its folder goes when empty', async () => {
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'notifications.json'), JSON.stringify(old(3)))
    const { list, record } = await store()
    expect(list().map((r) => r.payload.message)).toEqual(['old 3', 'old 2', 'old 1'])
    expect(existsSync(join(legacy, 'notifications.json'))).toBe(false)
    expect(existsSync(legacy)).toBe(false)
    /* The canvas each row happened on came with it, and so did `next`. */
    expect(list()[0]!.kehikko).toEqual({ id: 10, name: 'writing' })
    expect(record(event('new')).seq).toBe(4)
  })

  test('only once: a second project gets nothing', async () => {
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'notifications.json'), JSON.stringify(old(2)))
    const m = await raw()
    const other = join(dir, 'other')
    mkdirSync(other)
    expect(m.list(project)).toHaveLength(2)
    expect(m.list(other)).toHaveLength(0)
  })

  test('never over a store the project already has', async () => {
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'notifications.json'), JSON.stringify(old(5)))
    const { record, list } = await raw().then((m) => ({
      record: (e: Parameters<typeof m.record>[1]) => m.record(project, e),
      list: () => m.list(project),
    }))
    /* Give the project a store of its own first, with the legacy file hidden. */
    process.env.NOTIFICATIONS_DATA = join(dir, 'not-there')
    record(event('mine'))
    process.env.NOTIFICATIONS_DATA = legacy

    expect(list().map((r) => r.payload.message)).toEqual(['mine'])
    /* Left where it was, for a project that has none. */
    expect(existsSync(join(legacy, 'notifications.json'))).toBe(true)

    const other = join(dir, 'other')
    mkdirSync(other)
    expect((await raw()).list(other)).toHaveLength(5)
  })
})
