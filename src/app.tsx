import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModuleContext } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'
import type { Kehikko, Row } from '../store.ts'
import { sift, type Scope } from './sift.ts'
import { Bar } from './view/bar.tsx'
import { Line } from './view/line.tsx'
import { connect, type Host } from './wire/host.ts'

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
 * is posted and thrown away, and the pane reads "loaded its page and did not
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
 * SYNCHRONOUSLY, inside `connect()`. A handler can therefore fire before
 * `connect` has returned, so anything a handler reaches for must already exist:
 * in References, a handler that referenced the connection hung the page forever
 * with no question sent and no timeout. Everything the handlers below touch is
 * a `useRef` or a `useState` setter, both of which are stable and both of which
 * exist before `connect` is called. The connection itself is stored in a ref
 * that nothing reads during the greeting.
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

const SCOPE_KEY = 'kehikko-notifications:scope'

function rememberedScope(): Scope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'here' ? 'here' : 'all'
  } catch {
    /* A page framed WITHOUT `allow-same-origin` cannot reach localStorage and
       THROWS rather than answering null. This module declares storage so it
       should have one — but a declaration is not a request, a host is free to
       refuse, and a page that white-screened because it was framed more tightly
       than it asked would be a page making its own convenience a requirement. */
    return 'all'
  }
}

interface Standing {
  rows?: unknown
  held?: unknown
  keep?: unknown
}

export function App() {
  const [rows, setRows] = useState<Row[]>([])
  const [held, setHeld] = useState(0)
  const [keep, setKeep] = useState(0)
  const [scope, setScope] = useState<Scope>(rememberedScope)
  const [here, setHere] = useState<Kehikko | null>(null)
  const [greeted, setGreeted] = useState(false)
  const [armed, setArmed] = useState(false)

  const host = useRef<Host | null>(null)
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
         being gone, which nobody can act on from inside a pane, so it is
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
       same object and the page has no reason to tell them apart — see
       `wire/host.ts` on why the message is passed through whole rather than
       rebuilt from a list of named fields. That list is what lost `prompt`,
       `pinned` and `selection` in four files in one day, and the failure has no
       symptom: a field left out quietly becomes the page's belief that the host
       said nothing about it. */
    const arrived = (context: ModuleContext) => {
      setGreeted(true)
      setHere(context.kehikko ?? null)
      const root = document.documentElement
      /* `light` set explicitly as well as `dark`, so a host asking for light
         over a machine set to dark actually gets it — see `index.css`. */
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')
    }

    host.current = connect(ID, {
      onHello: arrived,
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
       * This pane is a stream of what modules have said. It has no anchors and
       * nothing to scroll to, and the honest answer is available at once. A
       * module that let the backstop answer would turn a hundred milliseconds
       * into a pane visibly doing nothing while a person waits for a press to
       * land somewhere.
       */
      onGoto: (_goto, answer) => {
        answer(false, 'This pane is a stream of what modules have said. There is nothing in it to walk to.')
      },
    })

    void refresh()

    return () => {
      host.current?.stop()
      host.current = null
    }
  }, [post, refresh])

  const chooseScope = useCallback((next: Scope) => {
    setScope(next)
    try {
      localStorage.setItem(SCOPE_KEY, next)
    } catch {
      /* See `rememberedScope`. The filter still works; it is simply forgotten. */
    }
  }, [])

  const forget = useCallback(() => {
    setArmed((was) => {
      if (was) {
        void post('/api/forget', {}).then(refresh)
        return false
      }
      return true
    })
  }, [post, refresh])

  /* Disarmed on a timer, so a button left reading "Sure?" does not sit there
     until somebody presses it by accident half an hour later. */
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  const sifted = sift(rows, scope, here)

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <Bar
        scope={scope}
        here={here}
        held={held}
        keep={keep}
        armed={armed}
        onScope={chooseScope}
        onForget={forget}
      />

      {sifted.cannot ? (
        <p className="m-0 min-w-0 border-b px-2.5 py-2 text-[0.72rem] text-muted-foreground @[340px]/pane:px-3">
          <strong className="font-semibold text-foreground">Showing everything. </strong>
          {greeted
            ? sifted.cannot
            : 'Nothing has greeted this page, so it is not on a canvas and cannot tell near from far. ' +
              'Everything it holds is shown below — an empty list here would have said the machine was quiet.'}
        </p>
      ) : (
        scope === 'here' &&
        sifted.unplaceable > 0 && (
          <p className="m-0 min-w-0 border-b px-2.5 py-2 text-[0.72rem] text-muted-foreground @[340px]/pane:px-3">
            {sifted.unplaceable} more {sifted.unplaceable === 1 ? 'line' : 'lines'} happened while no kehikko was
            open, so they are neither here nor elsewhere. Switch to All to read them.
          </p>
        )
      )}

      {sifted.rows.length === 0 ? (
        <div className="px-3 py-5 text-center text-muted-foreground [overflow-wrap:anywhere]">
          {held === 0
            ? 'Nothing yet. Modules that emit notifications appear here as they do — and only while this pane is open, because events are not resent.'
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
