/**
 * The document, assembled per request.
 *
 * ## Why this is a string and not an `index.html`
 *
 * A module that holds nothing ships a static `index.html` and lets Vite serve
 * it. This one cannot, for one reason: the ticket. It is minted once per
 * process and has to reach the page WITHOUT being fetchable on a door of its
 * own — a `GET /api/ticket` would be a route that hands the write credential to
 * anything that asks, which is the ticket abolished with extra steps. So the
 * document is generated, the ticket goes into it, and `vite.config.ts` runs the
 * result through `transformIndexHtml` so that Vite's own client and module
 * graph are injected exactly as they would be for a file on disk.
 *
 * It also sidesteps the collision Atlas lost half a day to. `entry` is `/app`,
 * and under Vite dev an extensionless path is not free: a request for `/app`
 * next to an `app.tsx` resolves to that module and answers `200
 * text/javascript` with compiled source. A browser loads such a document
 * happily and runs nothing in it — the frame's `load` fires, the host greets
 * it, and nothing answers. Here `/app` is claimed before Vite's resolver sees
 * it, so no file sitting next to this one can take it.
 *
 * ## Nothing is drawn here
 *
 * A root element and one inert JSON island. Every row is built by React from
 * what this program's own store answers, because all of it depends on what is
 * in that store — and because the page has to be able to redraw after an event
 * lands without this file and the client holding two versions of the same
 * sentence.
 *
 * ## The ticket rides in a JSON island
 *
 * `type="application/json"` rather than a generated JavaScript literal, because
 * a JSON island is inert: the browser neither parses nor executes it, and the
 * page reads it with `JSON.parse` off `textContent`. A value written into
 * executable source is the one place `textContent` cannot help.
 *
 * ## The one script, and why its type matters
 *
 * `<script type="module">`, which is what Vite serves and what a browser needs
 * in order to `import`. It is also the exact thing an opaque origin cannot
 * fetch without a permissive CORS header — see the essay on `server.cors` in
 * `vite.config.ts`. If this page ever loads in a frame and does nothing at all,
 * that header, or the `storage: true` that makes it unnecessary, is the first
 * thing to check, and the browser console is the only place it is visible.
 */
const PAGE_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!--
  The viewport, which matters even framed: without it a mobile browser assumes a
  980px layout viewport and scales, which turns a 220px pane into something
  drawn at a third of its size.
-->
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notifications</title>
</head>
<body>
<div id="root"></div>
<script id="ticket" type="application/json">__TICKET__</script>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
`

/**
 * The page, with the substitution made.
 *
 * The replacement is given as a FUNCTION. `String.replace` reads `$&`, `$1` and
 * friends out of a replacement string, and a ticket is random text that will
 * eventually contain a dollar sign — at which point the page would be served
 * with a mangled ticket and every write refused, intermittently, for a reason
 * nobody would find. A function replacement is taken literally.
 */
export function page(ticket: string): string {
  return PAGE_SHELL.replace('__TICKET__', () => JSON.stringify(ticket))
}
