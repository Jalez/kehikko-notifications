import { useCallback, useEffect, useRef, useState } from 'react'
import { canonicalExtension } from 'kehikot-module-protocol'
import { ask } from 'kehikot-module-protocol/client'
import { Cover, coverFor, useHost, useServerStanding, type CoverState } from 'kehikot-module-protocol/client/react'

import { FORMAT, ID } from '../manifest.ts'
import type { Kehikko, Row } from '../store.ts'
import { OFFER, scopeFrom, sift, type Scope } from './sift.ts'
import { Line } from './view/line.tsx'

/**
 * The page: this app's own store on one side, the wire on the other, and one
 * list between them.
 *
 * ## The order everything happens in
 *
 * 1. Listen. The mailbox replays whatever already arrived, so a greeting that
 *    landed before React mounted is not lost.
 * 2. Read the store of the project the greeting names. The store lives inside
 *    that project (`.kehikot/notifications/`), so with no project — a page
 *    opened directly on this port, or a canvas with none — there is nothing to
 *    read, and the page says so rather than drawing an empty list.
 * 3. Re-read the store whenever an event lands, and whenever the project moves.
 *
 * ## The wire underneath, which is not written here
 *
 * The listener is the protocol's `useHost`: the greeting race (the mailbox,
 * imported for its side effect in `main.tsx`), the connection stored before it
 * listens, the theme put on `<html>`, and the context flattened are all its.
 * The `goto` backstop is passed explicitly as 900ms because that was THIS
 * module's number and the client's default is 500.
 *
 * This is the only module in the family that handles `kehikot.event`, and an
 * event is re-sent by nobody: the protocol is explicit that delivery is
 * best-effort and one sent to a module still loading is lost. Which is why
 * there is a store behind this page and not merely a list in state, and why
 * the project is tracked in the wire's own handlers (see `project` below)
 * rather than read back out of React state a render later.
 *
 * ## This app's own server, and what happens when it does not answer
 *
 * Every call is the protocol's `ask()`, which carries the write ticket and
 * turns each failure into one typed result. Nothing answered: the shared cover
 * says so, with Try again, and the list is kept underneath rather than emptied
 * — a fetch that failed is not evidence that the store is empty. The server
 * restarted under this page: the page reloads itself, once. The server said no
 * to a write: its own sentence is printed above the list, because an event
 * that was not written down is exactly the thing this panel must not be quiet
 * about.
 */

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
  nowhere?: unknown
  trouble?: unknown
}

export function App() {
  const [rows, setRows] = useState<Row[]>([])
  const [held, setHeld] = useState(0)
  const [keep, setKeep] = useState(0)
  /** Which project the rows on screen were read for. Not the open one: the read is still on its way. */
  const [readFor, setReadFor] = useState<string | null>(null)
  /** The store's own word on why there is nothing to read: no project, or a refused one. */
  const [nowhere, setNowhere] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  /** What this app's own server said when it refused a write. Printed, because a lost event must not be silent. */
  const [refusal, setRefusal] = useState<string | null>(null)

  /**
   * The `seq` of every row currently on screen, as of the last render.
   *
   * A ref rather than state, and it exists for one reason: a press on the host's
   * clear control has to act on what is showing NOW, and it can arrive between
   * a render and its effects.
   *
   * This is the whole of what makes the host's clear control compose with the
   * host's filter control. What arrives from the host is a press with nothing
   * in it; WHICH rows go is decided here, out of the list this page actually
   * drew, under whatever scope the filter had it on. A page that answered
   * `onClear` by emptying its store would delete everything while somebody
   * could see three lines.
   */
  const showing = useRef<number[]>([])

  /**
   * A write. `ask` carries the ticket and never throws. A refusal is printed in
   * the server's own words; nothing answering, or this page being older than
   * its server, is said by the shared cover (and the second reloads the page).
   */
  const post = useCallback(async (path: string, body: Record<string, unknown>, failing: string): Promise<void> => {
    /* The project that is open NOW, which is the host's standing ahead of the render: the mailbox
       replays a greeting and the events behind it before React has drawn the greeting. */
    const asked = await ask(path, { body: { ...body, project: host.read().projectPath } })
    if (asked.ok) setRefusal(null)
    else if (asked.kind === 'refused') setRefusal(`${failing}: ${asked.error}`)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const asked = host.read().projectPath
    /* No project, nothing to read: the store lives inside one. The cover says which kind of nothing. */
    if (asked === null) return
    const read = await ask<Standing>('/api/notifications', { query: { project: asked } })
    /* A context that moved us on while this was in flight has made this
       answer about a project nobody is standing in. */
    if (host.read().projectPath !== asked) return
    if (!read.ok) {
      /* Rows left as they were rather than emptied. A read that failed is not
         evidence that the store is empty, and drawing an empty panel over a
         network blip would be this page inventing a quiet machine. Nothing
         answering is the cover's to say; a refusal is said here. */
      if (read.kind === 'refused') {
        setTrouble(read.error)
        setReadFor(asked)
      }
      return
    }
    const body = read.body ?? {}
    setRows(Array.isArray(body.rows) ? (body.rows as Row[]) : [])
    if (typeof body.held === 'number') setHeld(body.held)
    if (typeof body.keep === 'number') setKeep(body.keep)
    setNowhere(body.nowhere === true)
    setTrouble(typeof body.trouble === 'string' ? body.trouble : null)
    setReadFor(asked)
  }, [])

  /**
   * The wire, which is the protocol's `useHost`: connected once, handlers read
   * through a ref (so nothing below needs memoising), the theme put on `<html>`.
   *
   * `kept` is unused: this page asks the host to keep nothing — it has its own
   * store on its own origin, which is where every row it draws comes from, and
   * the filter is the host's, stored against the container.
   */
  const host = useHost(
    ID,
    {
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
        /* A sender that has not updated names the extension `roadmap.notifications@1`;
           one that has says `kehikot.notifications@1`. Both are this format. Anything
           else is not a notification, whatever route it took here. */
        if (event.extension && canonicalExtension(event.extension) !== FORMAT) return
        /* No project, nowhere to keep it — and the page already says so. The
           event is not held in memory to be written "later": later is a
           different project, or none. */
        if (host.read().projectPath === null) return
        void post(
          '/api/notifications',
          { from: event.from, at: event.at, kehikko: event.kehikko, payload: event.payload },
          'A notification arrived and was not recorded',
        ).then(refresh)
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
        void post('/api/forget', { seqs: showing.current }, 'Nothing was forgotten').then(refresh)
      },
    },
    /* 900ms, which is this module's own number and not the client's 500. The
       option exists so adoption keeps each module's timing rather than
       unifying it by accident; changing it should be somebody deciding to,
       not a refactor's side effect. */
    { gotoBackstop: 900 },
  )

  /**
   * Which scope this container is on, as the HOST last said, and which kehikko.
   *
   * Not remembered here, and not remembered anywhere in this program. The
   * choice belongs to the container — the host stores it beside where that
   * container sits and whether it is folded, and hands it back in the greeting
   * before this page has drawn anything. Read on every context, so a press in
   * the header and a switch between two containers of this module both land the
   * same way. `scopeFrom` falls back for an id this version does not know.
   */
  const scope: Scope = scopeFrom(host.chosen)
  const here: Kehikko | null = host.kehikko
  /* Which project's store this page reads: the store lives inside the project
     (`.kehikot/notifications/`), so this is the one field that changes WHICH store is on screen. */
  const current = host.projectPath

  /* It re-reads everything when it moves: a new project is a different file. What was on screen
     goes first, and until the read lands the cover below says loading, so the previous project's
     lines are never drawn under the new one. */
  useEffect(() => {
    setRows([])
    setHeld(0)
    setReadFor(null)
    setNowhere(false)
    setTrouble(null)
    setRefusal(null)
    void refresh()
  }, [current, refresh])

  const { filters, clearable } = host
  useEffect(() => {
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
     * In an effect declared after `useHost`, so the connection is already
     * listening and a host which greeted before this page mounted — the
     * ordinary case, which is why the mailbox exists — has already been
     * answered. Sent unconditionally: a page with no host posts into nothing,
     * which costs nothing.
     */
    filters(OFFER.map((group) => ({ ...group, options: [...group.options] })))

    /* The old per-browser key, taken out. See `RETIRED_SCOPE_KEY`. */
    try {
      localStorage.removeItem(RETIRED_SCOPE_KEY)
    } catch {
      /* A page framed without `allow-same-origin` cannot reach localStorage and
         THROWS rather than answering null. Nothing here needs it to work. */
    }
  }, [filters])

  /*
   * Every not-ready moment is the protocol's one cover, and the order is what
   * makes it true: a page that has not been greeted is `waiting`, never "no
   * project", and a page nothing is framing says that rather than asking for a
   * project nobody could open. `stale` first, because that page is about to
   * reload whatever else is so.
   */
  const server = useServerStanding()
  const cover: CoverState | null =
    coverFor({ where: host.where, projectPath: current, server })
    ?? (readFor !== current ? 'loading' : nowhere || trouble ? 'no-project' : null)

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
  /* Under a cover nothing is shown, so a press acts on nothing and nothing is offered to clear. */
  showing.current = cover ? [] : sifted.rows.map((row) => row.seq)

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
  const count = showing.current.length
  useEffect(() => {
    clearable(count === 0 ? null : `forget ${count} shown`)
  }, [count, clearable])

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      {/*
        A write this app's own server refused, in its own words. Above the
        cover as well as above the list: an event that was not written down is
        gone, and that is not something to hide behind "loading".
      */}
      {refusal ? (
        <p
          role="alert"
          className="m-0 min-w-0 border-b px-2.5 py-2 text-[0.72rem] text-muted-foreground [overflow-wrap:anywhere] @[340px]/container:px-3"
        >
          {refusal}
        </p>
      ) : null}

      {/*
        No project, or a refused one — said instead of the list, because neither
        is "nothing has happened". The store lives inside the project, and a
        panel with no project open has nowhere to read from or record into. The
        shared sentence, and this module's own reason under it.
      */}
      {cover ? (
        <Cover
          state={cover}
          name="Notifications"
          onRetry={() => void refresh()}
          detail={
            cover !== 'no-project'
              ? null
              : trouble
                ? /* The store's sentence starts mid-clause; here it is a line of its own. */
                  trouble.charAt(0).toUpperCase() + trouble.slice(1)
                : 'Notifications are kept inside the project they happened in, at .kehikot/notifications/.'
          }
        >
          {cover === 'no-project' && trouble ? 'Nothing can be shown or recorded here.' : undefined}
        </Cover>
      ) : null}

      {/* Kept mounted under a cover: the list is this page's last true reading, and it comes back as it was. */}
      <div hidden={cover !== null} className="min-w-0">
        {sifted.cannot ? (
          <p className="m-0 min-w-0 border-b px-2.5 py-2 text-[0.72rem] text-muted-foreground @[340px]/container:px-3">
            <strong className="font-semibold text-foreground">Showing everything. </strong>
            {sifted.cannot}
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
    </div>
  )
}
