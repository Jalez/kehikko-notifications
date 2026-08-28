# kehikko-notifications

Every line the modules on this machine have said happened, newest first,
attributed to whoever said it.

```
./run.sh                # serves on 127.0.0.1:7910
bun run register        # tells a host on this machine where to find it
bun test && bun run typecheck
```

## What it is

A module that **consumes** `roadmap.notifications@1`. Another module calls
`events.emit`; the host checks the format, validates the payload, stamps the
sender out of its own registry, and posts a `roadmap.event` into this frame.
This page writes it down and draws it.

It emits nothing. It asks the host for nothing — `declares.uses` is empty. The
only capability it would need to write to its own panel is `events:emit`, and a
notification panel that could write to itself is a panel whose contents are not
evidence of anything.

## The three decisions worth knowing before reading the code

**Events are not history.** Delivery is best-effort by design: there is no
acknowledgement, and an event sent to a module that is still loading is lost.
So this module keeps its own store (`store.ts`), capped at 2000 rows with the
oldest falling off, and what it shows survives a reload. What it cannot show is
what arrived before its page existed, and the page says so rather than implying
the machine was quiet.

**The filter is a comparison, not a subscription.** Each event carries the
kehikko it happened on; `context.kehikko` says the one this pane is standing on.
`src/sift.ts` compares them. Two states — all, or this kehikko — and when the
host has told this pane no kehikko, the filter cannot be honest: it shows
everything and says why, because an empty list would be a claim, and a false one.

**`from` is the host's word; the contents are the sender's.** The host took the
sender's id from its own registry, so no module can post under another's name.
Nobody checked whether the sentence is true. Every row is therefore drawn as
"*roadmap.checklist* **says** …", with the by-line above the message rather than
below it: a reader should know whose claim it is before they read the claim.

## Why `declares.storage: true` and no `server.cors`

This module owns data and takes writes, gated on a ticket printed into `/app`.
Framed opaque, its own `/api` calls would be cross-origin, the server would have
to answer permissive CORS, and any page in any tab could then read `/app` — and
the ticket in it — off loopback. That was measured in `kehikko-journeys`:

```
$ curl -H 'Origin: https://evil.example' http://127.0.0.1:7840/app
Access-Control-Allow-Origin: *
...ticket" type="application/json">"e75d4d01-…
```

Declaring storage gets a real origin back, which makes those calls same-origin
and involves no CORS at all. The essays in `manifest.ts` and `vite.config.ts`
say it at length.
