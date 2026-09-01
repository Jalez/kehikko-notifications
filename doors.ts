import { ID, MANIFEST, VERSION } from './manifest.ts'
import { KEEP, forget, list, record, standing, type Kehikko } from './store.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * A file of functions rather than a server, for the reason every module here
 * has one: a module is ONE ORIGIN or it is nothing. The protocol refuses a
 * manifest whose `entry` points anywhere but the origin that served the
 * manifest — a program that could name somebody else's page would be a program
 * that could have the host frame somebody else. The page is Vite's, because a
 * `dist/` served off disk has cost this codebase whole afternoons of a stale
 * page answering 200 with every symptom of a working app and none of the
 * changes. So the manifest, the health check and this app's own store have to
 * be Vite's too, however much tidier a second process on a second port would
 * look.
 *
 * `answer()` therefore takes a method, a path and a body and returns a status
 * and a document. `vite.config.ts` adapts a node request to it in a dozen
 * lines, and everything decided here can be called without a socket — which is
 * what makes `test/doors.test.ts` a test of the decisions rather than of HTTP.
 *
 * ## Nothing here trusts its caller
 *
 * The page is one caller. Whatever else on this machine found the port is
 * another: this listens on loopback, and loopback is a fence around the machine
 * rather than around the programs on it. A string has a length before it has a
 * meaning, and everything below is bounded before it is looked at.
 */

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

/**
 * The bounds, which are the format's own.
 *
 * `roadmap.notifications@1` bounds `message` at 2000 characters and `refs` at
 * 32 of 64, and the host validated against exactly that before it delivered
 * anything. These are the same numbers written out rather than imported,
 * because the caller of `/api/record` is the page and the page is relaying what
 * a host sent — but this door has no way to know it is, and a door that
 * accepted whatever it was told on the grounds that its usual caller is honest
 * is a door with no bound at all.
 *
 * Slightly generous rather than exact: this app is not the authority on the
 * format and a bound tighter than the host's would mean silently refusing rows
 * the host considers valid, which would show up as notifications that vanish.
 * The point of the bound is to stop something unbounded, not to re-adjudicate.
 */
const MAX_ID = 128
const MAX_MESSAGE = 4000
const MAX_EPIC = 200
const MAX_REF = 200
const MAX_REFS = 64
const MAX_AT = 40
const MAX_NAME = 200

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, max)
}

function refs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_REFS)
    .map((v) => str(v, MAX_REF))
    .filter(Boolean)
}

/**
 * The write ticket.
 *
 * Minted once per process and printed into the page this server serves. It is
 * not much of a secret and does not pretend to be one: anything that can read
 * the page can read it. What it separates is "this app's own page recorded
 * something the host delivered to it" from "something else on this machine
 * guessed the port and posted", and on a loopback server that separation is not
 * otherwise available.
 *
 * ## Here it is worth more than it is in journeys, because of CORS
 *
 * The identical comment in `kehikko-journeys/doors.ts` goes on to say the
 * ticket separates less than it looks like it does, because a permissive
 * `Access-Control-Allow-Origin` lets any tab read `/app` and take it. That is
 * true of a module framed opaque, and it is exactly why this module declares
 * `storage: true` and sets no `server.cors` — see the essays in `manifest.ts`
 * and `vite.config.ts`. With a real origin, `/app` is unreadable from any other
 * origin, so the ticket is unreadable too, and it goes back to separating what
 * it says it separates.
 *
 * Reads are not gated on it. What is here is a copy of things other modules
 * already said out loud on a canvas; gating reads would mean an agent's `curl`
 * needing a ticket to see a page it can already open, and would buy nothing.
 */
export const TICKET = crypto.randomUUID()

/* ------------------------------------------------------------------ *
 * Answers
 * ------------------------------------------------------------------ */

export interface Reply {
  status: number
  body: unknown
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

/**
 * One canvas out of a body, or null.
 *
 * Null is a legitimate value and not a parse failure: the host sends null when
 * it has no canvas open, and a door that turned that into a refusal would make
 * a hostless canvas undeliverable. What is refused is a kehikko that is present
 * and malformed, because that is somebody sending nonsense rather than sending
 * nothing.
 */
function kehikkoOf(value: unknown): Kehikko | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { id?: unknown; name?: unknown }
  if (typeof raw.id !== 'number' || !Number.isFinite(raw.id)) return null
  return { id: raw.id, name: str(raw.name, MAX_NAME) }
}

/**
 * Every door but the page.
 *
 * `null` means "this path is not ours", and the caller passes it on to Vite —
 * which is how the page, the client module and Vite's own hot-reload socket
 * keep working without being enumerated here.
 */
export function answer(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Reply | null {
  if (path === '/healthz') {
    const held = standing()
    return ok({ ok: true, id: ID, version: VERSION, held: held.held, keep: held.keep })
  }

  if (path === '/api/notifications' && method === 'GET') {
    return ok({ ok: true, rows: list(), ...standing() })
  }

  if (method === 'POST' && path.startsWith('/api/')) {
    /* The gate on every write, one line, because the whole argument for it is
       in `TICKET` above. */
    if (ticket !== TICKET) return bad('that write did not come from this app’s own page', 403)
    if (!body) return bad('that was not a request')

    /*
     * One event, as this app's own page relays it out of a `roadmap.event`.
     *
     * `from` is taken from the body and that is not a hole, because of where
     * the body comes from: the page copies it off the message the HOST posted
     * into the frame, and the host took it off its own registry rather than
     * from anything the sender said. This door cannot re-derive it — it has no
     * registry and no wire — so what it can do is bound it and never invent it.
     * A row with no `from` is refused rather than stored as "unknown", because
     * a notification panel whose whole job is attribution must not hold a line
     * it cannot attribute.
     */
    if (path === '/api/notifications') {
      const from = str(body.from, MAX_ID).trim()
      if (!from) return bad('a notification with nobody to attribute it to is not one')
      const payload = (body.payload ?? {}) as Record<string, unknown>
      const at = str(body.at, MAX_AT).trim()
      const row = record({
        from,
        /* The host's `at` when there is one, and this app's clock only as a
           last resort. A row stamped by the receiver would be ordered by this
           app's own scheduler, which the protocol is explicit is the wrong
           clock — but a row with no time at all cannot be drawn, so the
           fallback exists and the two are never mixed silently: `at` from the
           host is always present on a real event. */
        at: at || new Date().toISOString(),
        kehikko: kehikkoOf(body.kehikko),
        payload: {
          epic: str(payload.epic, MAX_EPIC),
          message: str(payload.message, MAX_MESSAGE),
          level: str(payload.level, 32) || 'info',
          refs: refs(payload.refs),
          ...(typeof payload.step === 'number' && Number.isFinite(payload.step)
            ? { step: payload.step }
            : {}),
        },
      })
      return ok({ ok: true, row, ...standing() })
    }

    /*
     * Discard rows: the ones named, or all of them.
     *
     * `seqs` arrives when the page is honouring the host's clear control, which
     * clears what is SHOWN — and what "shown" means is a question only this
     * module can answer, since it is the one that narrowed the list. See
     * `forget` in `store.ts`, and the protocol's `roadmap.clear` on why the
     * message that starts all this carries no ids at all.
     *
     * No `seqs` still means everything, which is what this door has always
     * meant and what any caller that has not been updated still means.
     *
     * The list is bounded at `KEEP` before it reaches the store: nothing beyond
     * that many rows can exist, so a longer one is either a mistake or somebody
     * making this door do work proportional to whatever they can type.
     * Non-numbers are dropped rather than refusing the whole request, because a
     * clear that half-worked is worse than one that skipped an id nothing
     * matched — and an id matching nothing is already the ordinary case, for a
     * row trimmed between the render and the press.
     */
    if (path === '/api/forget') {
      const asked = body.seqs
      if (asked === undefined || asked === null) {
        return ok({ ok: true, forgotten: forget(), ...standing() })
      }
      if (!Array.isArray(asked)) return bad('seqs has to be a list of row numbers')
      const seqs = asked
        .filter((one): one is number => typeof one === 'number' && Number.isFinite(one))
        .slice(0, KEEP)
      return ok({ ok: true, forgotten: forget(seqs), ...standing() })
    }

    return bad('no such door here', 404)
  }

  if (path === '/api/notifications' || path === '/api/forget') {
    return bad('that door takes a different method', 405)
  }

  return null
}

export { MANIFEST }
