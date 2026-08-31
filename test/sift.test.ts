import { describe, expect, test } from 'bun:test'

import { sift, OFFER, scopeFrom } from '../src/sift.ts'
import type { Row } from '../store.ts'

/**
 * The filter, which is the whole of what this module decides.
 *
 * Everything else here is plumbing — receive, write down, draw. This is the one
 * question the page answers on its own, and the protocol left it to the module
 * on purpose: near-or-far is a comparison a module makes rather than a rule the
 * host imposes.
 */

const HERE = { id: 3, name: 'workbench' }
const THERE = { id: 9, name: 'reading' }

let seq = 0
function row(kehikko: { id: number; name: string } | null, message = 'something happened'): Row {
  seq += 1
  return {
    seq,
    from: 'roadmap.checklist',
    at: '2026-08-28T09:00:00.000Z',
    kehikko,
    payload: { epic: 'modes-are-modules', message, level: 'info', refs: [] },
  }
}

describe('all', () => {
  test('shows everything, wherever it happened', () => {
    const rows = [row(HERE), row(THERE), row(null)]
    const out = sift(rows, 'all', HERE)
    expect(out.rows).toHaveLength(3)
    expect(out.cannot).toBeNull()
    /* Not counted under `all`, because the near/far question is not asked. A
       count offered where the question was not asked is a number a reader has
       to work out the meaning of. */
    expect(out.unplaceable).toBe(0)
  })

  test('is unaffected by not knowing where this container is', () => {
    const out = sift([row(HERE), row(THERE)], 'all', null)
    expect(out.rows).toHaveLength(2)
    expect(out.cannot).toBeNull()
  })
})

describe('this kehikko', () => {
  test('keeps only what happened on the canvas this container is standing on', () => {
    const mine = row(HERE, 'mine')
    const out = sift([mine, row(THERE), row(THERE)], 'here', HERE)
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]!.payload.message).toBe('mine')
  })

  test('compares by id and not by name, because two canvases may share a name', () => {
    const sameName = row({ id: 12, name: 'workbench' })
    const out = sift([sameName], 'here', HERE)
    /* The name is what a person recognises; the id is the host's own key. A
       filter on the name would fold two canvases into one silently. */
    expect(out.rows).toHaveLength(0)
  })

  test('a row that happened nowhere is neither here nor elsewhere, and is counted', () => {
    const out = sift([row(HERE), row(null), row(null)], 'here', HERE)
    expect(out.rows).toHaveLength(1)
    /* Counted rather than merely hidden, so the page can account for them. A
       filter whose numbers do not add up teaches a person to distrust it. */
    expect(out.unplaceable).toBe(2)
  })

  test('an honest empty is empty: nothing here really does mean nothing here', () => {
    const out = sift([row(THERE), row(THERE)], 'here', HERE)
    expect(out.rows).toHaveLength(0)
    expect(out.cannot).toBeNull()
  })
})

describe('when the filter cannot be honest', () => {
  test('a null kehikko shows EVERYTHING and says why, rather than showing nothing', () => {
    const rows = [row(HERE), row(THERE), row(null)]
    const out = sift(rows, 'here', null)

    /* The decision this module is here to get right. An empty list is a claim,
       and the claim would be false: it would say the canvas was quiet when the
       truth is that this container does not know which canvas it is on. */
    expect(out.rows).toHaveLength(3)
    expect(out.cannot).toContain('cannot tell near from far')
  })

  test('the sentence says what is being shown instead, not merely that something is wrong', () => {
    const out = sift([row(HERE)], 'here', null)
    expect(out.cannot).toContain('Everything it holds is shown')
  })

  test('nothing is counted as unplaceable, because nothing was placed', () => {
    const out = sift([row(null), row(HERE)], 'here', null)
    /* Every row is unplaceable when the container has no bearings, so a count would
       be the length of the list said twice. */
    expect(out.unplaceable).toBe(0)
  })
})

describe('sift does not hand back the caller\'s array', () => {
  test('the result can be sorted without disturbing the store', () => {
    const rows = [row(HERE), row(HERE)]
    const out = sift(rows, 'all', HERE)
    out.rows.reverse()
    /* The page redraws from `rows` on every change, and a sift that returned
       the same array would let one draw reorder the next one's input. */
    expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq)
  })
})

/**
 * The offer this module hands the host, and what it does with the answer.
 *
 * The two presses that used to be in this page's own bar are now one button in
 * the container header, drawn by the host out of this. What is tested here is
 * the half that stayed: this module still says what the options are, what they
 * are called and what they mean, and still defends itself against an answer it
 * does not recognise.
 */
describe('the filter is offered rather than drawn', () => {
  test('the offer is the same two states the bar used to draw', () => {
    expect(OFFER).toHaveLength(1)
    expect(OFFER[0]!.options.map((o) => o.id)).toEqual(['all', 'here'])
  })

  /*
   * `all` and not `here`. It is what a container nobody has pressed this on
   * shows, what the host returns to when a stored value names an option this
   * module no longer has, and what its "show everything" press goes to. `here`
   * is a claim that this container knows which kehikko it is standing on, and
   * it does not until a host has said so.
   */
  test('the resting state is everything', () => {
    expect(OFFER[0]!.fallback).toBe('all')
  })

  test('a chosen option is read straight off the context', () => {
    expect(scopeFrom({ scope: 'here' })).toBe('here')
    expect(scopeFrom({ scope: 'all' })).toBe('all')
  })

  /*
   * The host reconciles a stored choice against what this module is offering —
   * but it cannot before this module has offered anything, and the greeting
   * goes out first. So the first choice this page ever receives may name an
   * option from a version of itself that no longer exists. A page that trusted
   * it would narrow by a value nobody can see, choose or clear.
   */
  test('an option this version does not know is the resting state, not a filter', () => {
    expect(scopeFrom({ scope: 'this-kehikko-old-spelling' })).toBe('all')
  })

  test('and so are no filters at all, which is what a host without them sends', () => {
    expect(scopeFrom({})).toBe('all')
    expect(scopeFrom(undefined)).toBe('all')
  })

  /*
   * A key that is not really a key. Read off a plain object, `constructor`
   * finds something inherited that nobody ever chose.
   */
  test('a prototype lookup cannot become a filter', () => {
    expect(scopeFrom(JSON.parse('{"constructor":"here"}') as Record<string, string>)).toBe('all')
  })
})
