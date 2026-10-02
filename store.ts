import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEHIKOT_DIR, moduleDir, moduleFile, within } from 'roadmap-module-protocol'
import { z } from 'zod'

import { ID } from './manifest.ts'

/**
 * Everything this app has been shown in one project, on disk, inside that project.
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

/* ------------------------------------------------------------------ *
 * Where: inside the project, never beside the program
 * ------------------------------------------------------------------ */

/**
 * This app's own file, inside its own folder. A constant, never an argument.
 *
 * ## What moved, and why
 *
 * This store used to be ONE `data/notifications.json` beside the program,
 * holding every line from every project at once. The convention every module
 * on a kehikot host now follows is that a module keeps its data in the project
 * itself — `<project>/.kehikot/<module>/` — so that what a project's canvases
 * said travels with the project and can be read, copied or deleted on its own
 * (`rm -r .kehikot/notifications` is a sentence somebody can say). The folder
 * name and the joins belong to `roadmap-module-protocol`, not to this file; see
 * `project.ts` there for why four modules answering "where does my data live"
 * separately would be four answers.
 *
 * So: `<project>/.kehikot/notifications/notifications.json`. The path IS the
 * partition — nothing in a row says which project it belongs to, because the
 * file it is in already does.
 *
 * ## The project comes from the host, and there is no fallback
 *
 * The page learns its project from `roadmap.context.projectPath` and sends it
 * with every read and write. When there is none — no project open, or a host
 * too old to say — this store answers "nowhere" and the doors refuse to write.
 * It does NOT fall back to this program's folder, to `process.cwd()`, or to
 * the last project that spoke: a silently wrong location is worse than a loud
 * absent one, and a notification recorded into a folder nobody will open, under
 * a panel that says it was recorded, is exactly the failure this layout exists
 * to prevent. The reasoning is the one in `kehikko-journeys/store.ts` and
 * `kehikko-checklist/store.ts`, and this file follows them rather than
 * reaching its own conclusion.
 *
 * ## The fence
 *
 * `projectPath` arrives over the wire into functions that create directories
 * and write files. It is resolved with `realpathSync`, and `.kehikot` and this
 * module's folder inside it are each checked to really be under the project
 * AFTER resolution — a `.kehikot` that is a symlink to somewhere else is the
 * case a string comparison misses. `within()` is the comparison; `escapes()`
 * below is the check.
 *
 * ## The `.gitignore` is not this module's business
 *
 * Whether a project's `.kehikot/` is committed is a per-project checkbox in the
 * host (`shareKehikot` in its `server/projects.ts`). Modules used to append the
 * rule themselves and could never take it back; this one never started.
 */
export const FILE = 'notifications'

/** As long as a path may be, matching the protocol's own `LIMITS.PATH`. */
const MAX_PROJECT = 4096

/**
 * Where a project's store is, or why there is not one.
 *
 * - `{ path }` — here it is (it may not exist yet).
 * - `{ nowhere: true }` — no project is open. An ordinary state, not a fault.
 * - `{ trouble }` — a project was named and this app will not work under it.
 *
 * Creates nothing. `makeDir` creates, and only on the way to a write.
 */
export type Place = { path: string; root: string } | { nowhere: true } | { trouble: string }

export function place(projectPath: string | null | undefined): Place {
  const root = projectRoot(projectPath)
  if (root === null) return { nowhere: true }
  if ('trouble' in root) return { trouble: root.trouble }

  /* Both levels, outermost first, so a `.kehikot` pointing out of the project
     is refused by its own name. Only what exists can be resolved, and only what
     exists can escape — which is why `makeDir` asks again after creating. */
  for (const dir of [join(root.path, KEHIKOT_DIR), ours(root.path)]) {
    if (existsSync(dir)) {
      const escaped = escapes(root.path, dir)
      if (escaped) return { trouble: escaped }
    }
  }
  const path = moduleFile(root.path, ID, FILE) as string
  if (existsSync(path)) {
    const escaped = escapes(root.path, path)
    if (escaped) return { trouble: escaped }
  }
  return { path, root: root.path }
}

/** Make this module's folder under an already-resolved project, and fence it again. */
function makeDir(root: string): string | null {
  const dir = ours(root)
  mkdirSync(dir, { recursive: true })
  for (const made of [join(root, KEHIKOT_DIR), dir]) {
    const escaped = escapes(root, made)
    if (escaped) return escaped
  }
  return null
}

/** This module's own folder under a resolved project. `moduleDir` throws on a bad id, never on a constant. */
function ours(root: string): string {
  return moduleDir(root, ID) as string
}

/** The project, resolved — or null for "no project", or a sentence for a refusal. */
function projectRoot(projectPath: string | null | undefined): { path: string } | { trouble: string } | null {
  if (typeof projectPath !== 'string') return null
  const raw = projectPath.trim()
  if (!raw) return null
  if (raw.length > MAX_PROJECT) return { trouble: 'that project path is longer than any path on this machine can be.' }
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return { trouble: 'that project path has a control character in it, and no real path does.' }
    }
  }
  if (!isAbsolute(raw)) {
    return {
      trouble:
        `"${raw}" is not an absolute path. A project is somewhere on this machine, and a relative path would be `
        + 'resolved against whatever directory this app happens to have been started in.',
    }
  }
  try {
    const resolved = realpathSync(raw)
    if (!statSync(resolved).isDirectory()) {
      return { trouble: `"${raw}" is not a folder, so there is nowhere under it to keep anything.` }
    }
    return { path: resolved }
  } catch {
    return { trouble: `there is no folder at "${raw}" on this machine, so nothing can be read or written under it.` }
  }
}

/** The fence: a sentence if `child` is not really under `root`, null if it is. */
function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so this app will not read or write through it.`
  }
  if (within(root, real)) return null
  return (
    `${child} resolves to ${real}, which is outside the project it claims to be inside. Nothing has been read or `
    + 'written: a folder that points somewhere else is how one project’s notifications end up in another’s, and it '
    + 'is refused rather than followed.'
  )
}

/**
 * The sentence for "no project is open", written once, because every write
 * door says it and the page draws it.
 */
export const NOWHERE =
  'no project is open, so there is nowhere to keep notifications. They live in the project they happened in, at '
  + '.kehikot/notifications/notifications.json inside it, and this app will not guess which project was meant. '
  + 'Open a project on this canvas.'

/* ------------------------------------------------------------------ *
 * The old store, beside the program, adopted once
 * ------------------------------------------------------------------ */

/**
 * Where the OLD store was: `data/` beside this program.
 *
 * `NOTIFICATIONS_DATA` used to move the live store and now moves only this —
 * where the legacy file is looked for. It is kept as a seam for the tests,
 * which must never go looking in this repository's real `data/`: a test that
 * opened a temporary project with the real legacy file in reach would adopt
 * somebody's notifications into a directory it then deletes.
 */
export function legacyDir(): string {
  return process.env.NOTIFICATIONS_DATA ?? join(HERE, 'data')
}

/**
 * Move the old single store into this project, whole, if it is still there and
 * this project has no store of its own yet.
 *
 * ## Why whole, and not split by canvas
 *
 * Every old row carries the canvas it happened on, so splitting it between
 * projects looked possible. It is not, honestly: a row names a canvas by the
 * host's runtime id and its display name, and what a project records about its
 * canvases (`.kehikot/kehikko/kehikot.json`) is a different key and a name that
 * is not unique — two projects on this machine each have a canvas called
 * `kehikko`. Matching on that would be a guess, and a guess here puts one
 * project's lines into another project's repository. So the whole file goes to
 * the first project that opens without a store of its own, and the rows keep
 * their canvas, so the panel's near/far filter still tells them apart.
 *
 * ## Never over anything
 *
 * A project that already has a `notifications.json` is not a destination: its
 * file is left exactly as it is and the legacy file stays where it was, for the
 * next project that has none. The copy is `COPYFILE_EXCL`, so even a store that
 * appeared between the check and the copy is not overwritten. Only once the
 * copy has landed is the old file removed, and then its folder if that left it
 * empty.
 *
 * Returns the path adopted into, or null when there was nothing to do.
 */
function adopt(at: { path: string; root: string }): string | null {
  const old = join(legacyDir(), 'notifications.json')
  if (!existsSync(old) || existsSync(at.path)) return null
  if (makeDir(at.root)) return null
  try {
    copyFileSync(old, at.path, constants.COPYFILE_EXCL)
  } catch {
    return null
  }
  try {
    unlinkSync(old)
    if (readdirSync(legacyDir()).length === 0) rmdirSync(legacyDir())
  } catch {
    /* The copy landed; a legacy file that could not be removed will simply be
       skipped next time, because this project now has a store. */
  }
  return at.path
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
 * Read one project's store, or start an empty one.
 *
 * A file that is missing is the ordinary first run and answers empty. A file
 * that will not parse ALSO answers empty rather than throwing, and that is the
 * opposite of what this codebase's other stores do — journeys refuses to show
 * an unreadable journey, deliberately, because a journey is somebody's writing
 * and presenting a broken one as absent would hide work.
 *
 * Nothing here is anybody's writing. Every row is a copy of something another
 * program said, already delivered, already gone from the wire. Throwing would
 * mean a panel that will not open — and a notification panel that has crashed
 * is strictly worse than one that has forgotten, because a person cannot tell
 * the first from a quiet machine either. So a corrupt file is dropped, and the
 * next write replaces it.
 *
 * "No project" and "refused project" are NOT folded into empty: those come back
 * as the `Place` they are, so the doors can say which.
 */
function read(at: { path: string; root: string }): Held {
  adopt(at)
  let raw: string
  try {
    raw = readFileSync(at.path, 'utf8')
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

/** Write, creating the folder first — the only place that does. A sentence back if the fence refused. */
function write(at: { path: string; root: string }, held: Held): string | null {
  const trouble = makeDir(at.root)
  if (trouble) return trouble
  writeFileSync(at.path, `${JSON.stringify(held, null, 2)}\n`)
  return null
}

/**
 * What a project holds, or why nothing can be said about it.
 *
 * `nowhere` and `trouble` are separate from an empty list on purpose: "nothing
 * has happened here" and "no project is open" must not read the same on screen.
 */
export interface Standing {
  /** Every row, newest first. Empty when there is nowhere to read. */
  rows: Row[]
  held: number
  keep: number
  /** No project is open. Not a fault. */
  nowhere: boolean
  /** A project was named and this app will not read or write under it. */
  trouble: string | null
}

/**
 * Everything held in this project, newest first, and the counts beside it.
 *
 * Sorted here rather than at every caller, because "newest first" is what this
 * app IS and a caller that got it backwards would be showing a person last
 * week's line at the top of a panel about now.
 */
export function standing(projectPath: string | null | undefined): Standing {
  const at = place(projectPath)
  if ('nowhere' in at) return { rows: [], held: 0, keep: KEEP, nowhere: true, trouble: null }
  if ('trouble' in at) return { rows: [], held: 0, keep: KEEP, nowhere: false, trouble: at.trouble }
  const rows = [...read(at).rows].sort((a, b) => b.seq - a.seq)
  return { rows, held: rows.length, keep: KEEP, nowhere: false, trouble: null }
}

/** Everything held in this project, newest first. */
export function list(projectPath: string | null | undefined): Row[] {
  return standing(projectPath).rows
}

export type Done<T> = { ok: true; value: T } | { ok: false; error: string }

/** The place to write, or the sentence saying why there is none. */
function writable(projectPath: string | null | undefined): { ok: true; at: { path: string; root: string } } | { ok: false; error: string } {
  const at = place(projectPath)
  if ('nowhere' in at) return { ok: false, error: NOWHERE }
  if ('trouble' in at) return { ok: false, error: `nothing was written. ${at.trouble}` }
  return { ok: true, at }
}

/**
 * Record one event in this project.
 *
 * Takes the envelope and the payload separately, because that is how they
 * arrive and how they must be kept — see the essay above on what is vouched
 * for. There is no path in this app that lets a caller supply `from`: the door
 * takes it off the event the host delivered, and the host took it off its own
 * registry.
 *
 * Refuses, with a sentence, when there is no project: see `NOWHERE`.
 */
export function record(
  projectPath: string | null | undefined,
  event: {
    from: string
    at: string
    kehikko: Kehikko | null
    payload: unknown
  },
): Done<Row> {
  const where = writable(projectPath)
  if (!where.ok) return where
  const held = read(where.at)
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
  const trouble = write(where.at, held)
  if (trouble) return { ok: false, error: `nothing was written. ${trouble}` }
  return { ok: true, value: row }
}

/**
 * Forget everything in this project, or forget exactly the rows named.
 *
 * Offered because a person has to be able to clear a panel they have read, and
 * a panel that can only be cleared by deleting a file is a panel with a
 * maintenance procedure. It does NOT reset `next` in either case: a `seq` that
 * started again from 1 would collide with ids a page still had on screen, and
 * the page keys its rows by them.
 *
 * ## Why it can be told WHICH, and why the old call still means everything
 *
 * The control lives in the container header, where the host draws it out of
 * `roadmap.clearable` — and the host's rule for that control is that it clears
 * what is SHOWN, under whatever narrowing is in force. This module narrows by
 * kehikko, so "shown" and "everything" are the same list on `all` and different
 * lists on `here`. Only this module can tell those apart, so the page works out
 * what it is showing and says so here.
 *
 * `seqs` omitted still means everything in this project — what any caller has
 * always meant by `/api/forget`.
 *
 * Ids that name nothing are ignored rather than refused: a row trimmed by
 * `KEEP` between the render and the press is already gone, which is what was
 * being asked for.
 */
export function forget(projectPath: string | null | undefined, seqs?: readonly number[]): Done<number> {
  const where = writable(projectPath)
  if (!where.ok) return where
  const held = read(where.at)
  const had = held.rows.length
  if (seqs === undefined) {
    held.rows = []
  } else {
    /* A `Set`, because this is a list from a page against a list from a file
       and the naive version is quadratic in the number of rows on screen. */
    const going = new Set(seqs)
    held.rows = held.rows.filter((row) => !going.has(row.seq))
  }
  /* Nothing to forget in a project with no store is not a reason to create one. */
  if (had === 0 && !existsSync(where.at.path)) return { ok: true, value: 0 }
  const trouble = write(where.at, held)
  if (trouble) return { ok: false, error: `nothing was written. ${trouble}` }
  return { ok: true, value: had - held.rows.length }
}
