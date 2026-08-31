import type { Kehikko, Row } from '../store.ts'

/**
 * The filter: two states, and one comparison.
 *
 * ## Why this is a comparison and not a subscription
 *
 * The obvious build for "show me only this canvas" is for the host to deliver
 * only what happened here. The protocol deliberately does not do that, and the
 * essay on `eventSchema` says why: an event carries the kehikko it happened on,
 * `context.kehikko` says the one the receiver is standing on, and near-or-far
 * is left as a comparison the module makes rather than a rule the host imposes
 * — so a module can present it however it likes. This file is this module's
 * presentation of it, and it is the whole of the mechanism.
 *
 * The practical gain is visible the moment somebody switches canvases: the
 * store already holds everything, so flipping the filter is instant and
 * switching kehikko re-answers the question against rows that were recorded
 * long before anybody opened this canvas. A host-side subscription would have
 * meant a panel that only knows about the canvas it was watching at the time.
 *
 * ## Two states and not three
 *
 * There is no "everything except here". It is not a thing anybody asked for,
 * and a third state on a control in a 220-pixel container is a third state nobody
 * reads. Two is what the user asked for, in their own words: all, or this
 * kehikko.
 */

export type Scope = 'all' | 'here'

/**
 * The offer this module hands the host, so the host can draw the control.
 *
 * ## Why the two presses left this page
 *
 * They were two `Button`s in the bar at the top of this container, in a column
 * that is routinely 220 pixels wide — and five other modules in this family had
 * each built the same thing in their own words, each taking a row of chrome
 * from the thing somebody opened the module to look at. None of them could put
 * it anywhere else, because the strip around a module belongs to the host.
 *
 * `roadmap.filters` is the host learning to take it. This module says what it
 * can be narrowed by; the host draws one button in the container header and
 * sends the press back in `context.filters`. The host is never told what any of
 * it MEANS — `all` and `here` are this file's words and stay this file's words,
 * which is why the six other filters in this family can be six different ideas
 * without the host changing.
 *
 * ## Why the ids and the labels are not the same strings
 *
 * `id` is what travels, gets written down, and has to keep meaning the same
 * thing across versions of this module. `label` is what a person reads and may
 * be rewritten whenever it reads better. Spelling them the same would make the
 * first rewording of a button into a filter that silently stops matching what
 * is stored — which the host degrades to the fallback rather than getting
 * wrong, but degrading is still somebody's chosen filter quietly reset.
 *
 * ## `fallback` is `all`, and that is the honest resting state
 *
 * It is what a container nobody has pressed this on shows, what the host
 * returns to when a stored value names an option this module no longer has, and
 * what its own "show everything" press goes to. `all` is the only candidate:
 * `here` is a claim that this container knows which kehikko it is standing on,
 * and it does not until a host has said so.
 */
export const OFFER = [
  {
    id: 'scope',
    label: 'which kehikko',
    fallback: 'all',
    options: [
      { id: 'all', label: 'All' },
      { id: 'here', label: 'This kehikko' },
    ],
  },
] as const

/**
 * Which scope a context is asking for.
 *
 * Anything this module does not recognise is `all`, and the leniency is
 * required rather than defensive. The host reconciles a stored choice against
 * what this module is offering — but it cannot do that before this module has
 * offered anything, and the greeting goes out first. So the first choice this
 * page ever receives may name an option from a version of itself that no longer
 * exists, and a page that trusted it would narrow by a value nobody can see,
 * choose, or clear.
 *
 * Two programs each assuming the other got it right is how a stale value
 * survives. Both defend, and this is our half.
 */
export function scopeFrom(filters: Record<string, string> | undefined): Scope {
  return filters?.scope === 'here' ? 'here' : 'all'
}

export interface Sifted {
  /** What to draw, newest first, already filtered. */
  rows: Row[]
  /**
   * Why the filter could not be honoured, or null.
   *
   * A sentence rather than a boolean, because the page prints it. There is
   * exactly one cause — the host told us no kehikko — and it is a state a
   * module is required to be able to move into: a host need not have canvases
   * at all, and this page is also perfectly usable opened directly in a browser
   * with no host anywhere.
   *
   * When it is set, `rows` is EVERYTHING rather than nothing. That is the
   * decision worth defending: an empty list is a claim, and the claim would be
   * false — it would say "nothing happened on this canvas" when the truth is
   * "this container does not know which canvas it is on". Showing everything and
   * saying so is the only honest pair. The alternative was tried in prose and
   * discarded in a sentence: a person looking at an empty notification panel
   * does not go looking for a filter, they conclude the machine is quiet.
   */
  cannot: string | null
  /**
   * How many rows the near/far question cannot be asked about at all.
   *
   * Rows whose own `kehikko` is null: the host had no canvas open when they
   * were emitted, so they did not happen anywhere this page can name. They are
   * not "here" and they are not "elsewhere" — they are unplaceable, and hiding
   * them silently under "this kehikko" would mean a count that never adds up.
   * The page says how many, so the missing ones are accounted for rather than
   * merely absent.
   *
   * Zero when the scope is `all`, where the question is not asked.
   */
  unplaceable: number
}

/**
 * Which rows a person should be looking at.
 *
 * Pure, and takes the rows rather than reading them, because everything
 * interesting here is a decision and a decision that needs a browser to test is
 * a decision that stops being tested.
 *
 * @param here Where this container is standing, from `context.kehikko`. Null when
 *             the host said null, and null before any host has said anything —
 *             which are the same situation as far as this function is
 *             concerned and are told apart by the page, which knows whether it
 *             has been greeted.
 */
export function sift(rows: readonly Row[], scope: Scope, here: Kehikko | null): Sifted {
  if (scope === 'all') return { rows: [...rows], cannot: null, unplaceable: 0 }

  if (!here) {
    return {
      rows: [...rows],
      cannot:
        'This container has not been told which kehikko it is on, so it cannot tell near from far. ' +
        'Everything it holds is shown below, which is the only honest answer — an empty list here would ' +
        'have said the canvas was quiet.',
      unplaceable: 0,
    }
  }

  /* Compared by `id` and not by `name`. A name is what somebody typed and two
     canvases may share one; the id is the host's own key. Names are still
     stored and shown, because "workbench" is what a person recognises and a
     number is not. */
  const mine = rows.filter((row) => row.kehikko?.id === here.id)
  const unplaceable = rows.filter((row) => row.kehikko === null).length
  return { rows: mine, cannot: null, unplaceable }
}
