import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'

export const ID = 'kehikot.notifications'
/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

/** The one format this app speaks. Named once, so nothing can misspell it twice. */
export const FORMAT = 'kehikot.notifications@1'

/**
 * The port this app would rather have. Named once, for the same reason as the
 * line above, and against the same failure.
 *
 * 7910 used to be written twice — `--port "${PORT:-7910}"` at the bottom of
 * `run.sh` and `Number(process.env.PORT ?? 7910)` in `register.ts` — with
 * nothing keeping the two in step and a third copy sitting in
 * `~/Library/Application Support/Kehikot/modules` from whenever somebody last ran the second. Two literals
 * that must agree and nothing making them agree is exactly what `FORMAT` exists
 * to prevent for the format string; the port had no such constant and drifted
 * the same way.
 *
 * It lives in this file rather than in `vite.config.ts` because `register.ts`
 * needs it too, and importing a Vite config to read one number would build the
 * whole plugin list and mint this process's write ticket on the way to finding
 * out what to write down.
 *
 * It is a PREFERENCE and not a promise. 7820 through 7960 belong to the other
 * modules on this machine, and if something else holds 7910 when this starts
 * then `serves()` moves to the next free port and rewrites the registration to
 * match — see `kehikot-module-protocol/serve`. A host reads the registry, so the
 * registry is what has to be true; this number is only where to start looking.
 */
export const PREFERRED_PORT = 7910

/**
 * What this app says about itself when a host asks.
 *
 * ## `consumes`, and this time it does something
 *
 * There was a version of this program in the host app's old `modules/` directory
 * that declared `extensions.consumes: ['kehikot.notifications@1']` knowing full
 * well that no host could route an event to it. The essay in that manifest
 * argued the declaration was still right — that it was the difference between a
 * program which would work the day routing existed and one which would need an
 * edit and a re-agreement first — and it was right. This is that day. The
 * protocol grew `kehikot.event`, the host grew a bus that reads this exact
 * field out of this exact manifest, and the line that was a promise is now the
 * subscription.
 *
 * `emits` is empty and must stay empty. This app shows what other modules say;
 * a shower that also sent would be a thing announcing its own arrival on the
 * screen it draws — and the host would refuse to echo it back anyway, because a
 * sender is not an audience.
 *
 * ## Two scopes: the project, or this kehikko
 *
 * The store is one file per project (`.kehikot/notifications/`), so the
 * default scope is `project` (protocol 2.29.0): everything logged in the
 * project, whatever epic or kehikko it came from. A notification also carries
 * the KEHIKKO it happened on, and at the second scope, `kehikko`, the list is
 * only what happened on the one this container stands on — a comparison
 * between that and `context.kehikko`. The person picks it per container in
 * the host; it was a "which kehikko" filter of this module's own, and is now
 * the scope, so there is one setting. Until 2.29.0 the mode said `global`,
 * which meant "not one piece of work"; the scope now says what it is.
 *
 * ## What it asks for: one thing, to move the reader
 *
 * `uses: ['view:navigate']`, since 1.4.0 and for one reason: a notice may carry a `place`
 * (epic, parts, kehikko), and pressing it asks the host to go there with `view.goto`. Before
 * that this was `[]` and it stayed `[]` for a long time on purpose: everything it draws either
 * arrives unbidden as a `kehikot.event` or comes out of its own store, and a panel that
 * declared `epics:read` so it could pretty up a slug would be asking for permission to read
 * the whole project in exchange for a nicer heading. `view:navigate` reads nothing; it moves
 * the person's own view, and only when they press a line that said where it happened.
 *
 * Notably absent: `events:emit`. It is the capability behind the only method
 * that could put a line on this page, and this app does not have it, cannot
 * call it, and would be refused if it tried. A notification panel that could
 * write to itself is a panel whose contents are not evidence of anything.
 *
 * ## Storage, and the hole it closes
 *
 * `storage: true`, which makes the host frame this page WITH `allow-same-origin`
 * so it keeps its real origin. Modules that hold nothing declare `false` and are
 * right to. This one holds data — every notification it has ever been shown —
 * and serves it from its own `/api`, and that combination has a hole in it when
 * the page is opaque:
 *
 *   - An opaque page has origin `null`, which matches nothing, so its fetches
 *     to its OWN `/api` are cross-origin and the server must answer with a
 *     permissive `Access-Control-Allow-Origin` or the app cannot read its own
 *     store.
 *   - Permissive CORS means any page in any tab can read this origin —
 *     including `/app`, including the write ticket printed into it. Something
 *     somebody happened to visit could take that ticket off loopback and write
 *     notifications here.
 *
 * That was not theorised. It was measured in `kehikko-journeys`, with
 * `curl -H 'Origin: https://evil.example' http://127.0.0.1:7840/app` answering
 * `Access-Control-Allow-Origin: *` and the ticket in the body. The stakes are
 * arguably higher here than there: a journey somebody forged is wrong, and a
 * notification somebody forged is a sentence on a panel whose entire purpose is
 * to tell a person what happened.
 *
 * So: a real origin, no `server.cors` in `vite.config.ts`, and same-origin
 * `/api` calls that involve no CORS at all. The sandbox is weakened by exactly
 * what that costs, which is little: the origin regained is `127.0.0.1:7910`
 * and the host is on `127.0.0.1:4181`. Different ports are different origins,
 * so this page still cannot reach into the host. It can only reach itself,
 * which is all it asked for.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  /* Parsed rather than shipped as a bare object, for the reason every module
     here does it: the protocol's schemas are a convenience and never the host's
     check, and running one HERE is the cheapest way to learn this app has
     written a manifest no host will accept — on import, rather than from
     somebody else's log. */
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Notifications',
  /* The icon a host draws beside the name: a key of the protocol's module icons, never a path
     or URL; the same key Kehikot's official list gives it. */
  icon: 'lucide:bell',
  version: VERSION,
  /* Where a host files this module in its list, most fitting first. */
  tags: ['agents'],
  summary: 'What every module on this machine has said happened, newest first, with who said it.',
  /**
   * What an agent should do about this module being here.
   *
   * Not the summary. The summary says what this IS, for a person deciding
   * whether to place it; this says what its PRESENCE OBLIGES, and a host
   * composes it into the prompt every agent on the canvas is handed —
   * attributed to this module, because it is this module's claim.
   */
  guidance:
    'Every line on this panel is one module’s word for what it did, relayed by the host and not ' +
    'checked by it. Read it as testimony: a line saying tests passed is the sender saying so. Do not ' +
    'treat it as a record of what happened on this machine — delivery is best-effort, a module that ' +
    'was still loading missed what was sent to it, and what is here is what this container happened to be ' +
    'shown. If something matters, go and ask the module that claimed it.',
  entry: '/app',
  /* What its content belongs to (protocol 2.29.0): one mode per scope, the default first. */
  modes: [
    { id: 'notifications', label: 'Notifications', scope: 'project', scopeSays: 'everything logged in this project, whatever epic or kehikko it came from' },
    { id: 'here', label: 'This kehikko', scope: 'kehikko', scopeSays: 'only what was logged on this kehikko' },
  ],
  extensions: { emits: [], consumes: [FORMAT] },
  /* Why this module has nothing to narrow by the parts of an epic: it is not about one epic. It
     is a log of what was said on every canvas, whichever project and epic it was said in. (An
     event may well carry an epic and refs; that is not the reason.) */
  partless: 'A log of the project across its epics and kehikot; it sits above any one epic’s parts.',
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['view:navigate'],
    storage: true,
  },
  health: '/healthz',
})
