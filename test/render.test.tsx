import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { Line } from '../src/view/line.tsx'
import { ago } from '../src/view/ago.ts'
import type { Row } from '../store.ts'

/**
 * The two components that carry an argument, rendered for real.
 *
 * Not a screenshot test and not a substitute for one — the container widths are
 * measured in a browser, because a container query has no meaning in
 * happy-dom. What these assert is the WORDS, and the words are where this
 * module's honesty lives: whether a claim is drawn as a claim, whether the
 * filter says it cannot be answered, whether a far row is marked as far.
 */

afterEach(cleanup)

const HERE = { id: 3, name: 'workbench' }

const row = (over: Partial<Row> = {}): Row => ({
  seq: 1,
  from: 'kehikot.checklist',
  at: new Date().toISOString(),
  kehikko: HERE,
  payload: { epic: 'modes-are-modules', message: 'the tests passed', level: 'done', refs: ['gh#41'] },
  ...over,
})

describe('a row is drawn as testimony', () => {
  test('the sender is named and the message is attributed with a verb', () => {
    render(
      <ul>
        <Line row={row()} here={HERE} />
      </ul>,
    )
    expect(screen.getByText('kehikot.checklist')).toBeTruthy()
    /* The verb is the whole point. `from` is the host's word and may be
       trusted; the sentence is one module's claim, and a panel that printed it
       alone would be asserting things nobody asserted. */
    expect(screen.getByText('says')).toBeTruthy()
    expect(screen.getByText('the tests passed')).toBeTruthy()
  })

  test('the epic and the refs are drawn as badges', () => {
    render(
      <ul>
        <Line row={row()} here={HERE} />
      </ul>,
    )
    expect(screen.getByText('modes-are-modules')).toBeTruthy()
    expect(screen.getByText('gh#41')).toBeTruthy()
  })

  test('a row from this kehikko is NOT marked, because marking every row says nothing', () => {
    render(
      <ul>
        <Line row={row()} here={HERE} />
      </ul>,
    )
    expect(screen.queryByText(/^on /)).toBeNull()
  })

  test('a row from another kehikko is marked with where it came from', () => {
    render(
      <ul>
        <Line row={row({ kehikko: { id: 9, name: 'reading' } })} here={HERE} />
      </ul>,
    )
    expect(screen.getByText('on reading')).toBeTruthy()
  })

  test('a row that happened nowhere says so rather than being silently unmarked', () => {
    render(
      <ul>
        <Line row={row({ kehikko: null })} here={HERE} />
      </ul>,
    )
    expect(screen.getByText('no kehikko')).toBeTruthy()
  })

  test('the level is a word as well as a colour, so it is readable without colour', () => {
    const { container } = render(
      <ul>
        <Line row={row({ payload: { epic: '', message: 'stuck', level: 'blocked', refs: [] } })} here={HERE} />
      </ul>,
    )
    expect(container.querySelector('[title="level: blocked"]')).toBeTruthy()
  })
})

/**
 * The bar is gone, and this is what stands where its tests did.
 *
 * It held a filter, then — once the filter moved to the container header over
 * `kehikot.filters` — a `Forget` button and an `N held` count, in a fixed strip
 * of chrome at the top of a container that is routinely 220 pixels wide and
 * under 300 tall. Both of those have now moved to the header too, over
 * `kehikot.clearable`, and there was nothing else in the row.
 *
 * The component and its tests are deleted rather than kept as a "renders
 * nothing" case, because there is no longer a component for anybody to bring
 * back by accident — a stray import would not compile. What survived the move
 * is tested where it now lives: which rows a press discards is `store.test.ts`
 * and `doors.test.ts`, and what the control is called is the host's
 * `test/clearing.test.ts`, since the host is what draws it.
 */


describe('how long ago', () => {
  const at = '2026-08-28T09:00:00.000Z'
  const now = Date.parse(at)

  test('a fresh line reads as fresh rather than as 0m', () => {
    expect(ago(at, now + 5_000)).toBe('just now')
  })

  test('minutes, hours, days and weeks each get their own unit', () => {
    expect(ago(at, now + 5 * 60_000)).toBe('5m ago')
    expect(ago(at, now + 3 * 3_600_000)).toBe('3h ago')
    expect(ago(at, now + 3 * 86_400_000)).toBe('3d ago')
    expect(ago(at, now + 30 * 86_400_000)).toBe('4w ago')
  })

  test('clock skew reads as "just now" rather than as a negative age', () => {
    /* Two machines' clocks, or a host and a browser disagreeing. A negative age
       reads as a bug in this page rather than as skew. */
    expect(ago(at, now - 10_000)).toBe('just now')
  })

  test('a time this cannot parse is shown raw rather than invented', () => {
    /* Should not arise — the host stamps `at` itself. If it does, showing the
       nonsense is how somebody finds out; a confident "just now" would be this
       page inventing a fact about somebody else's program. */
    expect(ago('not a time', now)).toBe('not a time')
  })
})

/**
 * The page itself, against a host that is a `postMessage` and a server that is a `fetch`.
 *
 * Every not-ready moment is the protocol's one cover, and what these assert is WHICH one, in which
 * order — this page used to say "No project is open" for the first second of every load and to
 * anybody who opened it directly — and that this app's own server failing is said rather than
 * swallowed, which it used to be (`catch {}` and a `console.warn`).
 */
describe('the not-ready moments, each as the one shared cover', () => {
  const realFetch = globalThis.fetch
  const HELD = {
    ok: true,
    rows: [
      { seq: 2, from: 'kehikot.checklist', at: new Date().toISOString(), kehikko: HERE, payload: { epic: '', message: 'the tests passed', level: 'done', refs: [] } },
    ],
    held: 1,
    keep: 200,
    nowhere: false,
    trouble: null,
  }
  let down = false
  let reads: string[] = []
  let writes: { path: string; ticket: string | null; body: Record<string, unknown> }[] = []
  let refuse: { status: number; body: unknown } | null = null
  let standing: Record<string, unknown> = HELD

  const post = async (message: Record<string, unknown>) => {
    await act(async () => {
      window.postMessage({ protocol: 2, ...message }, '*')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const greet = (context: Record<string, unknown>) =>
    post({ type: 'kehikot.hello', session: 's', state: null, context: { epic: null, theme: 'dark', kehikko: HERE, ...context } })
  const cover = () => document.querySelector('[data-cover]')
  const settle = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))

  beforeEach(() => {
    down = false
    reads = []
    writes = []
    refuse = null
    standing = HELD
    resetServerStanding()
    /* The mailbox replays what it has heard to every new listener; one test's greeting is not the next one's. */
    mailbox.forget?.()
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (down) throw new TypeError('Load failed')
      const url = String(input)
      if ((init?.method ?? 'GET') === 'GET') {
        reads.push(url)
        return new Response(JSON.stringify(standing), { status: 200 })
      }
      const headers = (init?.headers ?? {}) as Record<string, string>
      writes.push({ path: url, ticket: headers['x-module-ticket'] ?? null, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      if (refuse) return new Response(JSON.stringify(refuse.body), { status: refuse.status })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    document.documentElement.className = ''
  })

  test('before anything has greeted the page it is waiting — never "no project" — and then unhosted', async () => {
    render(<App />)
    await settle(30)
    expect(cover()?.getAttribute('data-cover')).toBe('waiting')
    expect(document.body.textContent).not.toContain('No project')
    await settle(800)
    expect(cover()?.getAttribute('data-cover')).toBe('unhosted')
    expect(document.body.textContent).toContain('Nothing is framing this page — open Notifications in Kehikot.')
    expect(within(cover() as HTMLElement).queryAllByRole('button')).toHaveLength(0)
    /* Nothing was read: the store lives inside a project and nobody named one. */
    expect(reads).toHaveLength(0)
  })

  test('hosted with no project: the shared sentence, and where notifications live under it', async () => {
    render(<App />)
    await greet({ project: 'thesis', projectPath: null })
    expect(cover()?.getAttribute('data-cover')).toBe('no-project')
    expect(document.body.textContent).toContain('No project is open — open one in Kehikot.')
    expect(document.body.textContent).toContain('.kehikot/notifications/')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  test('hosted with a project: the rows of that project, and the theme the host said', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', theme: 'light' })
    expect(cover()).toBeNull()
    expect(reads).toEqual(['/api/notifications?project=%2Ftmp%2Fp'])
    expect(screen.getByText('the tests passed')).toBeTruthy()
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('a project this app will not read under: its own sentence, on the same cover', async () => {
    standing = { ok: true, rows: [], held: 0, keep: 200, nowhere: false, trouble: '/etc is not a folder this app keeps things in.' }
    render(<App />)
    await greet({ project: 'etc', projectPath: '/etc' })
    expect(cover()?.getAttribute('data-cover')).toBe('no-project')
    expect(document.body.textContent).toContain('Nothing can be shown or recorded here.')
    expect(document.body.textContent).toContain('/etc is not a folder this app keeps things in.')
    expect(document.body.textContent).not.toContain('No project is open')
  })

  test('a failed read: its own server not answering says so, and Try again reads again', async () => {
    down = true
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p' })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    expect(document.body.textContent).toContain('Notifications’ own server is not answering.')
    down = false
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()).toBeNull()
    expect(screen.getByText('the tests passed')).toBeTruthy()
  })

  test('the server going away under a list covers it, and the list is back as it was', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p' })
    expect(cover()).toBeNull()
    down = true
    await post({ type: 'kehikot.event', extension: 'kehikot.notifications@1', from: 'kehikot.tests', at: '2026-10-09T10:00:00.000Z', kehikko: HERE, payload: { epic: '', message: 'm', level: 'info', refs: [] } })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    /* Still in the document, hidden — not thrown away on the strength of one failed fetch. */
    expect(screen.getByText('the tests passed').closest('[hidden]')).toBeTruthy()
    down = false
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()).toBeNull()
    expect(screen.getByText('the tests passed').closest('[hidden]')).toBeNull()
  })

  test('an event is written down with the shared ticket header, for the project that is open', async () => {
    const island = document.createElement('script')
    island.id = 'ticket'
    island.type = 'application/json'
    island.textContent = JSON.stringify('the-ticket')
    document.body.appendChild(island)
    try {
      render(<App />)
      await greet({ project: 'p', projectPath: '/tmp/p' })
      await post({ type: 'kehikot.event', extension: 'kehikot.notifications@1', from: 'kehikot.tests', at: '2026-10-09T10:00:00.000Z', kehikko: HERE, payload: { epic: '', message: 'm', level: 'info', refs: [] } })
      expect(writes).toHaveLength(1)
      expect(writes[0]!.path).toBe('/api/notifications')
      expect(writes[0]!.ticket).toBe('the-ticket')
      expect(writes[0]!.body.project).toBe('/tmp/p')
      expect(writes[0]!.body.from).toBe('kehikot.tests')
      /* And the list is read again, from the store, rather than drawn from what arrived. */
      expect(reads).toHaveLength(2)
    } finally {
      island.remove()
    }
  })

  test('a write the server refused is said, in the server’s own words', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p' })
    refuse = { status: 409, body: { ok: false, error: 'nothing was written. That folder is not a project.' } }
    await post({ type: 'kehikot.event', extension: 'kehikot.notifications@1', from: 'kehikot.tests', at: '2026-10-09T10:00:00.000Z', kehikko: HERE, payload: { epic: '', message: 'm', level: 'info', refs: [] } })
    expect(screen.getByRole('alert').textContent).toBe(
      'A notification arrived and was not recorded: nothing was written. That folder is not a project.',
    )
    /* Not a reason to cover the list: the server answered. */
    expect(cover()).toBeNull()
  })

  test('the host’s clear control forgets exactly what is on screen', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p' })
    await post({ type: 'kehikot.clear' })
    expect(writes).toEqual([{ path: '/api/forget', ticket: '', body: { seqs: [2], project: '/tmp/p' } }])
  })
})
