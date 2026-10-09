import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig } from 'vite'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

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
 * ## No alias for `kehikot-module-protocol`
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
   * `serves()` first, because it decides the port in `config` and the whole
   * server has to be built around whatever it claimed. It takes a free 7910 in
   * silence, ends the start cleanly if this module is already answering there
   * rather than making a second copy, and otherwise moves loudly to the next
   * free port and rewrites the registration to the port the server ACTUALLY
   * bound. `--strictPort` in `run.sh` used to mean the alternative: this app
   * dying with `Error: Port 7910 is already in use` because of a program that
   * has nothing to do with notifications. `PREFERRED_PORT` in `manifest.ts` is
   * where the number is said, once.
   *
   * `doors()` next — the protocol's — which is every door this app answers on,
   * served by the one process that serves the page: the manifest, `/app` with
   * the write ticket and the build printed into it, and `/healthz` and `/api/*`
   * through `answer` in doors.ts. A module is ONE ORIGIN — the page fetches
   * `/api/notifications` as a relative path, and a store on a second port would
   * make that cross-origin — and `/app` has to be claimed before Vite's own
   * resolver can serve `src/app.tsx` in its place. See the protocol's
   * docs/module-plumbing.md.
   *
   * `maxBodyBytes` is this module's own bound, 256 kB rather than the default
   * megabyte: a notification's message is capped at 2000 characters by its own
   * format, nothing this app accepts is anywhere near this size, and the caller
   * is whatever on this machine found the port.
   */
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    doors({
      manifest: MANIFEST,
      answer,
      build: BUILD,
      page: { title: 'Notifications', ticket: TICKET },
      maxBodyBytes: 256_000,
    }),
    react(),
    tailwindcss(),
  ],
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
