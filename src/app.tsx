import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModuleContext } from 'roadmap-module-protocol'
import { connect, type Connection } from 'roadmap-module-protocol/client'

import { ID } from '../manifest.ts'
import type { Kehikko, Row } from '../store.ts'
import { OFFER, scopeFrom, sift, type Scope } from './sift.ts'
import { Line } from './view/line.tsx'

/**
 * The page: this app's own store on one side, the wire on the other, and one
 * list between them.
 *
 * ## The order everything happens in
 *
 * 1. Read the store. The page draws fully from this alone, with no host
 *    anywhere, which is the test of whether this is an app or a panel.
 * 2. Connect. The mailbox replays whatever already arrived, so a greeting that
 *    landed before React mounted is not lost.
 * 3. Re-read the store whenever an event lands.
 *
 * ## The two bugs every module in this family has hit
 *
 * **The greeting race.** The host greets on the frame's `load` event, which
 * fires before an application is necessarily ready — and a React page installs
 * its listeners in an effect, which runs strictly AFTER `load`. So the greeting
 * is posted and thrown away, and the container reads "loaded its page and did not
 * answer the host's greeting" with no hint anywhere that the greeting arrived
 * first. `wire/mailbox.ts` installs one listener at module scope, records
 * everything, and replays the backlog to each subscriber. It is imported for
 * that side effect in `main.tsx`, before this component exists.
 *
 * That matters more here than it has anywhere this file has been copied from.
 * Everywhere else, what the mailbox saves is the greeting, and a lost greeting
 * is re-sent on the next frame load. This page also receives `roadmap.event`,
 * and an event is re-sent by nobody: the protocol is explicit that delivery is
 * best-effort and one sent to a module still loading is lost. Which is also why
 * there is a store behind this page and not merely a list in state.
 *
 * **Storing the connection after listening.** The mailbox replays
 * SYNCHRONOUSLY, and the client splits `connect` from `listen()` for exactly
 * that reason: the connection is stored first, and only then is it told to
 * hear the backlog. A handler firing before the assignment is a page that hangs
 * with no question sent and no timeout, which is what happened in References.
 *
 * ## The wire underneath, which is no longer written here
 *
 * `wire/host.ts` and `wire/mailbox.ts` — 507 lines, near-identical to the copy
 * in nine sibling modules — are `roadmap-module-protocol/client` now. Nothing
 * this page says on the wire changed. The `goto` backstop is passed explicitly
 * as 900ms because that was THIS module's number and the client's default is
 * 500; the option exists precisely so adoption keeps each module's own timing
 * rather than quietly unifying it.
 *
 * This is also the only module in the family that handles `roadmap.event`, and
 * `onEvent` is the client's name for the same thing, handed over whole — `from`,
 * `at` and `kehikko` are the host's envelope and are what makes an attribution
 * on this page worth printing.
 */

/** The write ticket, printed into this document by the server that minted it. */
function ticket(): string {
  const node = document.getElementById('ticket')
  if (!node?.textContent) return ''
  try {
    const value: unknown = JSON.parse(node.textContent)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/**
 * The key this page used to remember its filter in, kept only to be deleted.
 *
 * ## Why it is abandoned rather than migrated
 *
 * `localStorage` is per BROWSER. This page is loaded once and shown on whichever
 * kehikko asks for it, so one key was one value shared by every container of
 * this module on every canvas — two of them side by side, one meant to show
 * this kehikko and one meant to show everything, would overwrite each other and
 * the last press would win. That is not a limitation of the old code; it is the
 * bug that moving the filter to the host fixes, because the host stores a
 * choice against the CONTAINER.
 *
 * Migrating the value would push that one browser-wide answer into every
 * container's store on every canvas — which is the bug being fixed, written
 * once into a database that outlives it. So it is not read.
 *
 * And it could not be, even if it should be. There is no message for a module
 * to SET its own filter, deliberately: the host owns the choice, the module
 * owns the offer, and a module that could write the choice would be a module
 * that can override a press. What is lost is one preference, once, on the day
 * this module is updated; what a person does about it is press the control
 * again, in the header, where it now lives.
 *
 * Removed rather than left lying, so that the next person reading this file
 * does not find a live-looking key that nothing writes.
 */
const RETIRED_SCOPE_KEY = 'kehikko-notifications:scope'

interface Standing {
  rows?: unknown
  held?: unknown
  keep?: unknown
}

export function App() {
  const [rows, setRows] = useState<Row[]>([])
  const [held, setHeld] = useState(0)
  const [keep, setKeep] = useState(0)
  /**
   * Which scope this container is on, as the HOST last said.
   *
   * Not remembered here, and not remembered anywhere in this program. The
   * choice belongs to the container — the host stores it beside where that
   * container sits and whether it is folded, and hands it back in the greeting
   * before this page has drawn anything, which is the whole reason it arrives
   * as context rather than as a message of its own.
   *
   * `all` before any host has spoken, which is also the standalone answer: a
   * page opened directly on this port is not on a kehikko, so "this kehikko" is
   * not a question it could answer honestly anyway. The control being absent
   * there costs nothing, because the filter would have been meaningless.
   */
  const [scope, setScope] = useState<Scope>('all')
  const [here, setHere] = useState<Kehikko | null>(null)
  const [greeted, setGreeted] = useState(false)

  const host = useRef<Connection | null>(null)
  /**
   * The `seq` of every row currently on screen, as of the last render.
   *
   * A ref rather than state, and it exists for one reason: `onClear` is
   * registered once, in the connection effect, and a press has to act on what
   * is showing NOW rather than on what was showing when that effect ran.
   * Reading it through a ref is the same trick `host` uses on the line above,
   * for the same reason — the connection must not be rebuilt every time a row
   * arrives.
   *
   * This is the whole of what makes the host's clear control compose with the
   * host's filter control. What arrives from the host is a press with nothing
   * in it; WHICH rows go is decided here, out of the list this page actually
   * drew, under whatever scope the filter had it on. A page that answered
   * `onClear` by emptying its store would delete everything while somebody
   * could see three lines.
   */
  const showing = useRef<number[]>([])
  const TICKET = useRef<string>('')
  if (!TICKET.current) TICKET.current = ticket()

  const post = useCallback(async (path: string, body: unknown): Promise<void> => {
    if (!TICKET.current) {
      console.warn('kehikko-notifications: no write ticket in this document; nothing will be recorded.')
      return
    }
    try {
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-notifications-ticket': TICKET.current },
        body: JSON.stringify(body),
      })
    } catch (error) {
      /* Loopback, to our own origin. A failure here is this app's own server
         being gone, which nobody can act on from inside a container, so it is
         reported where whoever CAN act is looking. */
      console.warn('kehikko-notifications: could not reach this app’s own store.', error)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      const body = (await response.json()) as Standing
      setRows(Array.isArray(body.rows) ? (body.rows as Row[]) : [])
      if (typeof body.held === 'number') setHeld(body.held)
      if (typeof body.keep === 'number') setKeep(body.keep)
    } catch {
      /* Left as they were rather than emptied. A fetch that failed is not
         evidence that the store is empty, and drawing an empty panel over a
         network blip would be this page inventing a quiet machine. */
    }
  }, [])

  /**
   * The wire, connected once.
   *
   * `[]`, deliberately, and every handler below reaches only for things that do
   * not change identity — `useState` setters and the two `useCallback`s, which
   * have empty dependency lists of their own. A connection rebuilt on a
   * re-render would tear down the listener and re-announce this module to the
   * host on every keystroke somewhere else on the canvas.
   */
  useEffect(() => {
    /* One function for both, because a greeting and a context change carry the
       same object and the page has no reason to tell them apart — see the
       client's `connect.ts` on why the message is passed through whole rather
       than rebuilt from a list of named fields. That list is what lost `prompt`,
       `pinned` and `selection` in four files in one day, and the failure has no
       symptom: a field left out quietly becomes the page's belief that the host
       said nothing about it. */
    const arrived = (context: ModuleContext) => {
      setGreeted(true)
      setHere(context.kehikko ?? null)
      /* Read on every context and never remembered, so a press in the header
         and a switch between two containers of this module both land the same
         way. `scopeFrom` falls back for an id this version does not know — see
         the essay there for why both halves have to defend that. */
      setScope(scopeFrom(context.filters))
      const root = document.documentElement
      /* `light` set explicitly as well as `dark`, so a host asking for light
         over a machine set to dark actually gets it — see `index.css`. */
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')
    }

    const live = connect(ID, {
      /**
       * The greeting, and the second thing it carries.
       *
       * `state` is whatever the host is keeping for this module, and this page
       * asks it to keep nothing — it has its own store on its own origin, which
       * is where every row it draws comes from, and a filter is remembered in
       * `localStorage` because it is this browser's business rather than the
       * roadmap's. So the parameter is named, ignored, and PRESENT: the copy of
       * the wire that used to stand here dropped it at the signature, which
       * meant a page that decided to read it later would have had to rediscover
       * that the host had been sending it all along.
       */
      onHello: (context, _kept) => arrived(context),
      onContext: arrived,

      /**
       * One notification another module emitted.
       *
       * Written down BEFORE it is drawn, and then drawn from what the store
       * answers rather than from what arrived. That round trip could be skipped
       * — the event is right here — and skipping it is how a panel ends up
       * showing a row that is not in the store, so a reload silently loses it
       * and nobody can tell which of the two was wrong. One source of truth,
       * and it is the store.
       *
       * `from`, `at` and `kehikko` are copied off the envelope the HOST
       * composed and never out of the payload. The payload is the sender's
       * claim; the envelope is the host's, and that difference is the only
       * thing that makes an attribution on this page worth printing.
       */
      onEvent: (event) => {
        void post('/api/notifications', {
          from: event.from,
          at: event.at,
          kehikko: event.kehikko,
          payload: event.payload,
        }).then(refresh)
      },

      /**
       * A walk, declined — immediately, rather than left to the host's timeout.
       *
       * This container is a stream of what modules have said. It has no anchors and
       * nothing to scroll to, and the honest answer is available at once. A
       * module that let the backstop answer would turn a hundred milliseconds
       * into a container visibly doing nothing while a person waits for a press to
       * land somewhere.
       */
      onGoto: (_goto, answer) => {
        answer(false, 'This container is a stream of what modules have said. There is nothing in it to walk to.')
      },

      /**
       * The host's delete control, pressed twice.
       *
       * ## What goes is exactly what is on screen
       *
       * `showing` holds the `seq` of every row this page last drew, under
       * whatever scope the header's filter has it on. That is the whole of the
       * design: the host sends a press with no ids in it, because it sees rows
       * it does not render in a document it cannot read, and only this module
       * can answer what "shown" means.
       *
       * So a person on `this kehikko` who presses clear discards this kehikko's
       * lines and keeps the rest, and the same person on `all` discards
       * everything. Both are what the control says it will do, because the
       * label counts the same list this sends.
       *
       * ## What this changes about `Forget`, said out loud
       *
       * The button this replaces sat in this app's own bar and always meant
       * everything, whatever the filter was on. That was not a considered
       * position so much as the state of things before the filter moved to the
       * header: the bar could not see the filter and the filter could not see
       * the bar.
       *
       * The behaviour on `all` is identical. On `this kehikko` it is now
       * narrower, and narrower is the correct reading of a control that sits
       * beside the filter and counts what the filter left. Somebody who wants
       * the lot presses `Show everything` in the filter first, which is one
       * press and is visible on screen; the reverse — a button that quietly
       * deletes more than it says — has no such recovery.
       *
       * ## No guard here, deliberately
       *
       * The two presses happen on the host's side of the frame, where they can
       * be drawn. A `confirm()` here would return `false` silently under the
       * host's sandbox and this would simply never run — the failure that cost
       * the checklist module an afternoon, and the reason the arm is the host's.
       */
      onClear: () => {
        void post('/api/forget', { seqs: showing.current }).then(refresh)
      },
    },
    /* 900ms, which is this module's own number and not the client's 500. The
       option exists so adoption keeps each module's timing rather than
       unifying it by accident; changing it should be somebody deciding to,
       not a refactor's side effect. */
    { gotoBackstop: 900 })

    /* Stored BEFORE it is told to listen. The mailbox replays synchronously
       inside `listen()`, so the greeting almost always arrives on that line —
       see the essay above and `listen` in the client. */
    host.current = live
    live.listen()

    /*
     * What this container can be narrowed by, said once.
     *
     * Once is enough, and only because the client replays the last offer after
     * every `ready` — a frame that reloads is greeted again, and a page whose
     * offer has not changed would otherwise have no reason to send anything and
     * would silently lose its control. A module whose LABELS carry a count has
     * to send again whenever the count changes; these two words never change,
     * so this is the whole of it.
     *
     * After `listen()`, so that a host which greeted before this page mounted —
     * the ordinary case, which is why the mailbox exists — has already been
     * answered and the offer goes out rather than into a connection with
     * nobody on the other end. Sent unconditionally: a page with no host posts
     * into nothing, which costs nothing.
     */
    live.filters(OFFER.map((group) => ({ ...group, options: [...group.options] })))

    /* The old per-browser key, taken out. See `RETIRED_SCOPE_KEY`. */
    try {
      localStorage.removeItem(RETIRED_SCOPE_KEY)
    } catch {
      /* A page framed without `allow-same-origin` cannot reach localStorage and
         THROWS rather than answering null. Nothing here needs it to work. */
    }

    void refresh()

    return () => {
      live.stop()
      /* Cleared only if it is still ours: under StrictMode the second mount has
         already assigned its own connection by the time some cleanups run. */
      if (host.current === live) host.current = null
    }
  }, [post, refresh])

  const sifted = sift(rows, scope, here)

  /*
   * What is on screen, kept where the wire can read it, and announced.
   *
   * Written during render rather than in an effect, so that a press arriving
   * between a render and its effects acts on the list that was drawn rather
   * than on the one before it. There is nothing to clean up and nothing anybody
   * else reads, so the usual objection to writing a ref in render does not
   * apply — and a delete acting on a stale list is not a stale list, it is the
   * wrong rows.
   */
  showing.current = sifted.rows.map((row) => row.seq)

  /*
   * The offer, re-announced whenever the count changes.
   *
   * Unlike the filter offer — announced once, because its two words never move
   * — this label carries a NUMBER, and the number is the whole reason a person
   * reads the control before pressing it. It is how they discover that their
   * filter has narrowed things to three rather than thirty, which is the
   * difference between the press they meant and the press they did not.
   *
   * `null` when there is nothing on screen, which withdraws the control. A
   * delete button that deletes nothing teaches a person that the button does
   * not work, and they will remember that on the day it would have.
   *
   * The word is this module's own. The host quotes it and does not paraphrase
   * it — it has no idea what is being counted — so `forget` stays the verb this
   * app has always used for this, and it now appears in a tooltip in the
   * container header instead of on a button in a bar.
   */
  const count = sifted.rows.length
  useEffect(() => {
    host.current?.clearable(count === 0 ? null : `forget ${count} shown`)
  }, [count])

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      {sifted.cannot ? (
        <p className="m-0 min-w-0 border-b px-2.5 py-2 text-[0.72rem] text-muted-foreground @[340px]/container:px-3">
          <strong className="font-semibold text-foreground">Showing everything. </strong>
          {greeted
            ? sifted.cannot
            : 'Nothing has greeted this page, so it is not on a canvas and cannot tell near from far. ' +
              'Everything it holds is shown below — an empty list here would have said the machine was quiet.'}
        </p>
      ) : (
        scope === 'here' &&
        sifted.unplaceable > 0 && (
          <p className="m-0 min-w-0 border-b px-2.5 py-2 text-[0.72rem] text-muted-foreground @[340px]/container:px-3">
            {sifted.unplaceable} more {sifted.unplaceable === 1 ? 'line' : 'lines'} happened while no kehikko was
            open, so they are neither here nor elsewhere. Switch to All to read them.
          </p>
        )
      )}

      {/*
        The empty state, and the one place `held` and `keep` still appear.

        The bar above this used to show "N held" beside a Forget button, and
        both are gone — the count went into the label of the host's delete
        control, which counts what is SHOWN and is a better number for a person
        about to press something. But `held` counts what is in the STORE, which
        is a different fact and is load-bearing exactly here: a container
        narrowed to a quiet kehikko is empty for two entirely different reasons,
        and "nothing has happened" and "nothing has happened HERE, and eleven
        things happened elsewhere" must not read the same.

        `keep` was the bar's tooltip — how many this container holds before the
        oldest fall off — and it moves onto the same line rather than being
        dropped with the component it happened to live in. Nothing else on this
        page says it, and a person who has just been told eleven lines are held
        elsewhere is the person most likely to wonder how many can be.
      */}
      {sifted.rows.length === 0 ? (
        <div
          className="px-3 py-5 text-center text-muted-foreground [overflow-wrap:anywhere]"
          title={
            `This container keeps the last ${keep} it has been shown. ` +
            'Events are not history: one sent while this page was still loading was lost, and nothing resends it.'
          }
        >
          {held === 0
            ? 'Nothing yet. Modules that emit notifications appear here as they do — and only while this container is open, because events are not resent.'
            : `Nothing on ${here?.name || 'this kehikko'}. ${held} held from elsewhere.`}
        </div>
      ) : (
        <ul className="m-0 min-w-0 list-none p-0">
          {sifted.rows.map((row) => (
            <Line key={row.seq} row={row} here={here} />
          ))}
        </ul>
      )}
    </div>
  )
}
