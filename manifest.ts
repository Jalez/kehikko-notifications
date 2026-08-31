import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.notifications'
export const VERSION = '1.0.0'

/** The one format this app speaks. Named once, so nothing can misspell it twice. */
export const FORMAT = 'roadmap.notifications@1'

/**
 * The port this app would rather have. Named once, for the same reason as the
 * line above, and against the same failure.
 *
 * 7910 used to be written twice — `--port "${PORT:-7910}"` at the bottom of
 * `run.sh` and `Number(process.env.PORT ?? 7910)` in `register.ts` — with
 * nothing keeping the two in step and a third copy sitting in
 * `~/.roadmap/modules` from whenever somebody last ran the second. Two literals
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
 * match — see `roadmap-module-protocol/serve`. A host reads the registry, so the
 * registry is what has to be true; this number is only where to start looking.
 */
export const PREFERRED_PORT = 7910

/**
 * What this app says about itself when a host asks.
 *
 * ## `consumes`, and this time it does something
 *
 * There was a version of this program in the roadmap's own `modules/` directory
 * that declared `extensions.consumes: ['roadmap.notifications@1']` knowing full
 * well that no host could route an event to it. The essay in that manifest
 * argued the declaration was still right — that it was the difference between a
 * program which would work the day routing existed and one which would need an
 * edit and a re-agreement first — and it was right. This is that day. The
 * protocol grew `roadmap.event`, the host grew a bus that reads this exact
 * field out of this exact manifest, and the line that was a promise is now the
 * subscription.
 *
 * `emits` is empty and must stay empty. This app shows what other modules say;
 * a shower that also sent would be a thing announcing its own arrival on the
 * screen it draws — and the host would refuse to echo it back anyway, because a
 * sender is not an audience.
 *
 * ## The mode is global, and the old one was not
 *
 * The version this replaces scoped its mode to a journey, on the reasoning that
 * the interesting question is always "what happened on THIS work". That was the
 * best available answer when the only thing the wire said about location was
 * which epic was open. It is the wrong answer now, and the reason is the new
 * field on the context.
 *
 * A notification carries the KEHIKKO it happened on, and this page's whole
 * filter is a comparison between that and `context.kehikko`. An epic-scoped
 * mode would have the host hide this container whenever the canvas had no epic, on a
 * canvas where things are still happening — a notification panel that
 * disappears when you most want to look at it. Global says the truth: this is a
 * container about the machine, not about one piece of work, and it decides for
 * itself what is near.
 *
 * ## What it asks for, which is nothing
 *
 * `uses: []`. Not modesty — there is genuinely no question this app needs to
 * ask. Everything it draws either arrives unbidden as a `roadmap.event` or
 * comes out of its own store, and the one comparison it makes is against a
 * field of the context every module is handed without asking. A panel that
 * declared `epics:read` so it could pretty up a slug would be asking for
 * permission to read the whole roadmap in exchange for a nicer heading, which
 * is the fastest way to teach somebody to press yes without reading.
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
  version: VERSION,
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
  modes: [{ id: 'notifications', label: 'Notifications', scope: 'global' }],
  extensions: { emits: [], consumes: [FORMAT] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: [],
    storage: true,
  },
  health: '/healthz',
})
