import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Everything this app has been shown, on disk, beside the program.
 *
 * ## Why a store at all, when the wire already delivers
 *
 * Because events are not history, and the protocol says so in as many words:
 * delivery is best-effort, there is no acknowledgement, and an event sent to a
 * module that is still loading is lost. A receiver that needs history keeps its
 * own.
 *
 * This is a notification panel. History is the entire product. A panel that
 * held its lines in memory would lose all of them on every reload — and a frame
 * reloads whenever the host restarts, whenever somebody edits this app, and
 * whenever Vite hot-reloads the page. What a person would see is a panel that
 * is empty every time they come back to it and that they therefore stop
 * looking at.
 *
 * So: written down, on arrival, before it is drawn.
 *
 * ## What is stored is what the HOST said, not what the sender said
 *
 * Each row keeps the envelope fields — `from`, `at`, `kehikko` — separately
 * from `payload`, because they are separately trustworthy. `from` was taken by
 * the host from its own registry and cannot be forged by a module claiming to
 * be another; `payload` is the sender's claim and nothing more. Flattening them
 * into one object would be this store forgetting the one distinction the page
 * has to draw.
 *
 * ## The cap, and what falls off
 *
 * A notification list that grows forever is a memory leak with a UI, and this
 * one has a second edge on it: the page draws the whole list, so an unbounded
 * store eventually becomes an unbounded DOM in a 280-pixel container.
 *
 * `KEEP` rows, and the OLDEST fall off. That direction is not arbitrary. This
 * panel is read newest-first and the interesting question is always "what just
 * happened"; a cap that dropped the newest would make the panel go deaf under
 * exactly the load it exists to report on. Dropping the oldest means the thing
 * lost is the thing furthest from anybody's attention, and the page says how
 * many are held so that a person can tell a quiet machine from a full store.
 *
 * It is a cap on ROWS rather than on bytes because a row is bounded already:
 * the format bounds `message` and `refs`, and the host validated the payload
 * against that format before it sent it. Two thousand rows is a few hundred
 * kilobytes, which is a file, not a problem.
 *
 * Nothing expires by age. A cap by time would mean a panel that empties itself
 * overnight and a person coming back in the morning to a screen that says
 * nothing happened, which is a lie about a machine that was busy.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))

/**
 * How many are kept.
 *
 * Exported because the page prints it in the sentence that explains why the
 * count stopped going up, and a second copy of the number over there is a
 * sentence that eventually disagrees with the store.
 */
export const KEEP = 2000

/**
 * Where the store lives.
 *
 * `NOTIFICATIONS_DATA` moves it, and it is deliberately not `ROADMAP_DATA`.
 * That variable belongs to a different program, and honouring it would make
 * this app's store follow a roadmap that may not be running and certainly never
 * agreed to hold anything of ours. One store, one owner, one name.
 *
 * Resolved at call time rather than at import, so a test setting the variable
 * does not depend on which module happened to load first.
 */
export function dataDir(): string {
  const dir = process.env.NOTIFICATIONS_DATA ?? join(HERE, 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

function storePath(): string {
  return join(dataDir(), 'notifications.json')
}

/**
 * A canvas, as the wire spells it.
 *
 * Nullable everywhere it appears, and the null is load-bearing rather than
 * defensive: a host need not have canvases, and a row whose kehikko is unknown
 * is a row the near/far filter genuinely cannot place. Storing it as null and
 * saying so on screen is the honest handling; guessing "this one" would put a
 * stranger's line under the reader's own canvas.
 */
export const kehikkoSchema = z.object({ id: z.number(), name: z.string() })
export type Kehikko = z.infer<typeof kehikkoSchema>

/**
 * The notification payload, as `roadmap.notifications@1` defines it.
 *
 * Held LOOSELY here, and that is a departure worth stating. The protocol
 * package's own `notificationPayload` is the authority and the host already ran
 * it — the protocol's essay on `eventSchema` says a receiver is entitled to
 * assume the shape, because the host knew the format and validated against it
 * before sending. So this schema exists to make the store readable back, not to
 * re-adjudicate what the host already decided.
 *
 * Why that matters: this store is also read after an UPGRADE. A row written
 * when the format had four fields must still parse when the app has been
 * updated and the format has five, and a strict re-check would turn every old
 * row into a parse error and empty somebody's panel to make a point about
 * versions. `passthrough` keeps fields this version has never heard of, so a
 * downgrade does not silently destroy them either.
 */
export const payloadSchema = z
  .object({
    epic: z.string().default(''),
    message: z.string().default(''),
    level: z.string().default('info'),
    refs: z.array(z.string()).default([]),
    step: z.number().optional(),
  })
  .passthrough()

/**
 * One row.
 *
 * `seq` is this app's own, and it is not a substitute for `at`. `at` is when
 * the HOST accepted the event and is what a person is shown; `seq` is the order
 * this app was shown things, and it is what the page sorts and keys by. They
 * differ, and the difference is the reason for both: two events accepted in the
 * same millisecond have the same `at` and sorting by it alone would let them
 * swap places between renders. A row also has to be identifiable across a
 * reload for the page to know what it has already drawn, and `at` is not unique
 * enough to be an identity.
 */
export const rowSchema = z.object({
  seq: z.number(),
  /** The module that emitted it, named by the HOST from its own registry. */
  from: z.string(),
  /** When the host accepted it, ISO 8601. The host's clock, not the sender's. */
  at: z.string(),
  /** The canvas it happened on, or null when the host had none. */
  kehikko: kehikkoSchema.nullable().default(null),
  /** The sender's claim. Validated by the host against the format; not vouched for. */
  payload: payloadSchema,
})

export type Row = z.infer<typeof rowSchema>

const fileSchema = z.object({
  /** The last `seq` handed out. Kept so ids do not repeat after a trim. */
  next: z.number().default(1),
  rows: z.array(rowSchema).default([]),
})

type Held = z.infer<typeof fileSchema>

const EMPTY: Held = { next: 1, rows: [] }

/**
 * Read the store, or start an empty one.
 *
 * A file that is missing is the ordinary first run and answers empty. A file
 * that will not parse ALSO answers empty rather than throwing, and that is the
 * opposite of what this codebase's other stores do — journeys throws on an
 * unreadable journey, deliberately, because a journey is somebody's writing and
 * presenting a broken one as absent would hide work.
 *
 * Nothing here is anybody's writing. Every row is a copy of something another
 * program said, already delivered, already gone from the wire. Throwing would
 * mean a panel that will not open — and a notification panel that has crashed
 * is strictly worse than one that has forgotten, because a person cannot tell
 * the first from a quiet machine either. So a corrupt file is dropped, and the
 * next write replaces it.
 */
function read(): Held {
  let raw: string
  try {
    raw = readFileSync(storePath(), 'utf8')
  } catch {
    return { ...EMPTY, rows: [] }
  }
  const parsed = fileSchema.safeParse(json(raw))
  return parsed.success ? parsed.data : { ...EMPTY, rows: [] }
}

/* `JSON.parse` that answers null rather than throwing. Its own function so the
   `catch` above stays about a MISSING file — two failures that want the same
   answer are still two failures, and folding them into one `try` is how a
   permissions error on the data directory ends up reported as an empty store. */
function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function write(held: Held): void {
  writeFileSync(storePath(), `${JSON.stringify(held, null, 2)}\n`)
}

/**
 * Everything held, newest first.
 *
 * Sorted here rather than at every caller, because "newest first" is what this
 * app IS and a caller that got it backwards would be showing a person last
 * week's line at the top of a panel about now.
 */
export function list(): Row[] {
  return [...read().rows].sort((a, b) => b.seq - a.seq)
}

/** How many are held, and the cap, so a page can say why the count stopped. */
export function standing(): { held: number; keep: number } {
  return { held: read().rows.length, keep: KEEP }
}

/**
 * Record one event.
 *
 * Takes the envelope and the payload separately, because that is how they
 * arrive and how they must be kept — see the essay above on what is vouched
 * for. There is no path in this app that lets a caller supply `from`: the door
 * takes it off the event the host delivered, and the host took it off its own
 * registry.
 */
export function record(event: {
  from: string
  at: string
  kehikko: Kehikko | null
  payload: unknown
}): Row {
  const held = read()
  const row = rowSchema.parse({
    seq: held.next,
    from: event.from,
    at: event.at,
    kehikko: event.kehikko,
    payload: event.payload,
  })
  held.rows.push(row)
  held.next += 1
  /* The trim, and it is by `seq` rather than by array position because the
     array is written in arrival order and nothing else here promises to keep it
     that way. Oldest go; see the essay. */
  if (held.rows.length > KEEP) {
    held.rows.sort((a, b) => a.seq - b.seq)
    held.rows = held.rows.slice(held.rows.length - KEEP)
  }
  write(held)
  return row
}

/**
 * Forget everything, or forget exactly the rows named.
 *
 * Offered because a person has to be able to clear a panel they have read, and
 * a panel that can only be cleared by deleting a file is a panel with a
 * maintenance procedure. It does NOT reset `next` in either case: a `seq` that
 * started again from 1 would collide with ids a page still had on screen, and
 * the page keys its rows by them.
 *
 * ## Why it can now be told WHICH, and why the old call still means everything
 *
 * The button this served used to be in this app's own bar and meant one thing:
 * discard the lot. The control has moved to the container header, where the
 * host draws it out of `roadmap.clearable` — and the host's rule for that
 * control is that it clears what is SHOWN, under whatever narrowing is in
 * force. This module narrows by kehikko, so "shown" and "everything" are the
 * same list on `all` and different lists on `here`.
 *
 * Only this module can tell those apart. The host cannot: it sees rows it does
 * not render, in a document it cannot read, in a frame on another origin, and
 * the protocol's `roadmap.clear` deliberately carries no ids for exactly that
 * reason. So the page works out what it is showing and says so here.
 *
 * `seqs` omitted still means everything, and that is not laziness about an old
 * signature. It is what the MCP door and any other caller have always meant by
 * `/api/forget`, and a version that silently required a list would have turned
 * "clear this panel" into "clear nothing" for every caller that had not been
 * updated — which is the kind of change that produces a bug report reading "the
 * button stopped working" six weeks later.
 *
 * Ids that name nothing are ignored rather than refused. A page's idea of what
 * is on screen and the store's idea of what exists are two observations of the
 * same thing at two moments, and a row trimmed by `KEEP` between the render and
 * the press is not an error — it is a row that is already gone, which is what
 * was being asked for.
 */
export function forget(seqs?: readonly number[]): number {
  const held = read()
  const had = held.rows.length
  if (seqs === undefined) {
    held.rows = []
    write(held)
    return had
  }
  /* A `Set`, because this is a list from a page against a list from a file and
     the naive version is quadratic in the number of rows on screen. */
  const going = new Set(seqs)
  held.rows = held.rows.filter((row) => !going.has(row.seq))
  write(held)
  return had - held.rows.length
}
