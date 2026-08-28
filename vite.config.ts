import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, TICKET, answer } from './doors.ts'
import { page } from './page/document.ts'

/**
 * Every door this app answers on, served by the one process that serves the
 * page.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else.
 *
 * That argument usually gets made about the manifest and the health check. Here
 * it reaches further, because this module holds its own material: the page
 * fetches `/api/notifications` as a relative path, which is how it works with
 * nothing else running at all. A store on a second port would make every one of
 * those fetches cross-origin, and this app could not read its own notifications
 * inside the frame it exists to live in. So the store is middleware in front of
 * the same server that serves the page, and `doors.ts` holds the deciding
 * without holding a socket.
 */
function doors(): Plugin {
  return {
    name: 'notifications-doors',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          if (body === null) {
            response.statusCode = status
            response.end()
            return
          }
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this app and every host
           cannot disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        if (path === '/app' || path === '/app/' || path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(TICKET), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              /*
               * Framed by a host and by nothing else — and by nothing at all is
               * fine too, which is what opening this page directly is.
               *
               * `frame-ancestors` is the module's own half of the arrangement: a
               * host says which origins IT will frame, and this says who may
               * frame this. Deliberately not a list of one — whoever is running
               * this decides, through `ROADMAP_ORIGIN`, and the default is the
               * address the host in this workspace actually serves on.
               */
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path.startsWith('/api/')
        if (!ours) return next()

        /* Only the paths above read a body, and only those wait for one. Vite's
           own middleware stack has to keep seeing an unconsumed request for
           everything else. */
        void body(request)
          .then((parsed) => {
            const reply = answer(method, path, parsed, readTicket(request.headers['x-notifications-ticket']))
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

/** One header, which node hands over as a string, an array, or nothing. */
function readTicket(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

/**
 * The request body, as JSON, or null.
 *
 * Bounded, because the caller is whatever on this machine found the port —
 * loopback is a fence around the machine and not around the programs on it —
 * and a handler that reads until the socket closes is a handler that can be
 * asked to read forever. A notification's message is capped at 2000 characters
 * by its own format; nothing this app accepts is anywhere near this size, and
 * the bound is a bound rather than a budget.
 */
const MAX_BODY_BYTES = 256_000

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(piece)
  }
  if (!chunks.length) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The dev server, and the one line that is deliberately absent from it.
 *
 * ## No `server.cors`
 *
 * Several modules here set `cors: true` and have to. A host frames a module
 * WITHOUT `allow-same-origin` unless its manifest declares storage, which puts
 * the page on an opaque origin — and `<script type="module">` is ALWAYS fetched
 * in CORS mode, so with no permissive header not one script in the page runs.
 * The document loads, `load` fires, the host greets it, and nothing answers.
 * `curl` cannot see it, being unsubject to CORS; only the browser console can.
 * That has cost this codebase days.
 *
 * This module must not go that way, for the reason `kehikko-journeys` learned
 * the hard way and measured rather than theorised:
 *
 *     $ curl -H 'Origin: https://evil.example' http://127.0.0.1:7840/app
 *     Access-Control-Allow-Origin: *
 *     ...ticket" type="application/json">"e75d4d01-…
 *
 * A permissive `Access-Control-Allow-Origin` means any page in any tab can read
 * this origin — including `/app`, including the write ticket printed into it —
 * and then write here. For journeys that was somebody's prose. Here it would be
 * arbitrary sentences appearing on a panel whose entire purpose is telling a
 * person what happened on their machine, attributed to whichever module the
 * forger named. A notification panel that can be written to by anything is
 * worse than no notification panel.
 *
 * So the manifest declares `storage: true`, the host frames this with
 * `allow-same-origin`, and this line is gone. With a real origin, this page's
 * scripts and its `/api` calls are ordinary same-origin requests: no CORS is
 * involved at all, nothing is offered to strangers, and the ticket is
 * unreadable from anywhere but inside. The essay in `manifest.ts` says why this
 * module asks for an origin and why a module that holds nothing should not.
 *
 * ## Tailwind v4, and no `tailwind.config.js`
 *
 * v4 is CSS-first: the theme lives in `src/index.css` behind `@theme inline`
 * and the plugin is `@tailwindcss/vite`. A `tailwind.config.js` here would be a
 * v3 file that v4 silently ignores — a config somebody edits, that has no
 * effect, with nothing anywhere saying so.
 *
 * ## No alias for `roadmap-module-protocol`
 *
 * There used to be one in every app here, pointing at the protocol's source in
 * the repository they all used to live in. It is gone and must not come back:
 * the package's `exports` are correct, reaching past them is what made a whole
 * class of bug possible, and a module that resolved its contract differently
 * from the host it talks to is a module testing something nobody ships.
 */
export default defineConfig({
  /**
   * `base: './'`, because this page is served at `/app` here and framed by a
   * host at whatever address that host wrote down. Absolute asset paths are
   * correct in the first case and a guess in the second; relative ones are a
   * fact in both, because the browser resolves them against the document it
   * just fetched.
   */
  base: './',
  /*
   * `doors()` first, so `/app` is claimed before Vite's own resolver can serve
   * `src/app.tsx` in its place — see the essay in `page/document.ts`.
   */
  plugins: [doors(), react(), tailwindcss()],
  /*
   * The `@` alias, which points inside this repository and is a different thing
   * entirely from aliasing a dependency. It is what the shadcn components in
   * `src/components/ui` import through, and it matches `paths` in
   * `tsconfig.json` — two copies of one fact, unavoidable because one is read
   * by the bundler and the other by the type checker.
   */
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
