import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'

import { Bar } from '../src/view/bar.tsx'
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
  from: 'roadmap.checklist',
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
    expect(screen.getByText('roadmap.checklist')).toBeTruthy()
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

describe('the bar', () => {
  const bar = (over: Partial<Parameters<typeof Bar>[0]> = {}) =>
    render(<Bar held={4} keep={2000} armed={false} onForget={() => {}} {...over} />)

  /*
   * The filter is not drawn here any more. It is offered to the host over
   * `roadmap.filters` and drawn as one button in the container header, which is
   * the whole point of the change: this row was a fixed strip of chrome at the
   * top of a container that is routinely 220 pixels wide.
   *
   * The test is here rather than deleted, because "the module stopped drawing
   * it" is exactly what somebody would undo by accident while adding a control
   * to this bar.
   */
  test('the filter is not on this page: it is offered to the host', () => {
    bar()
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'This kehikko' })).toBeNull()
  })

  test('forget takes two presses, and the second one says what it will do', () => {
    bar({ armed: true })
    const forget = screen.getByRole('button', { name: 'Sure?' })
    /* Not a `confirm()`: the sandbox has no `allow-modals`, so `confirm()`
       returns false silently and the button would never work at all. */
    expect(forget.getAttribute('title')).toContain('Press again')
  })

  /*
   * And with the filter gone there is nothing else in the row, so the row goes
   * too. It could not before — a filter is a thing you may want to press before
   * there is anything to filter — and an empty container was spending
   * thirty-one pixels on a bordered strip with nothing in it.
   */
  test('nothing held means no bar at all, not an empty one', () => {
    const { container } = bar({ held: 0 })
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull()
    expect(container.querySelector('.sticky')).toBeNull()
  })

  test('nothing on this page announces the module’s own name', () => {
    /* The host draws the container header out of the manifest `summary`. A module
       that drew its own name inside the frame would put two headings two inches
       apart saying the same thing in different words. */
    const { container } = bar()
    expect(container.textContent).not.toContain('Notifications')
  })
})

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
