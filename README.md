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
kehikko it happened on; `context.kehikko` says the one this container is standing on.
`src/sift.ts` compares them. Two states — all, or this kehikko — and when the
host has told this container no kehikko, the filter cannot be honest: it shows
everything and says why, because an empty list would be a claim, and a false one.

**The filter is offered, not drawn.** The two presses used to be a strip at the
top of this page, in a container that is routinely 220 pixels wide. They are now
one button in the container header: this module sends `roadmap.filters` with its
options and their words, the host draws a menu out of them and never learns what
`here` means, and a press comes back in `context.filters`. What did not move is
the reporting — the sentence when the filter cannot be honoured, and the count
of lines that are neither here nor elsewhere, are things this module knows and
the host cannot see.

The choice is remembered by the host, against the CONTAINER. That is a fix as
well as a move: it used to be a `localStorage` key, which is per browser, so two
containers of this module on two kehikot shared one value and overwrote each
other. The old key is deleted on load and deliberately not migrated — migrating
one browser-wide answer into every container on every canvas is the bug, written
down permanently.

**And so is the way to discard them.** `Forget` and the `N held` count beside it
were the last two things in this page's own strip, and the strip is gone with
them — thirty-one pixels of chrome given back, in a container that is routinely
220 wide and under 300 tall. This module sends `roadmap.clearable` with a label
in its own words (`forget 12 shown`), the host draws one button beside the
filter, and the second press comes back as `roadmap.clear`. The host learns
nothing: that message carries no ids, no count and no answer, because the host
sees rows it does not render in a document it cannot read.

What goes is **what is on screen**, which is what makes the two header controls
compose — narrow to this kehikko, press clear, and this kehikko's lines go. That
is a real change from the old button, which always meant everything whatever the
filter said; a position that was never argued for so much as inherited from a bar
that could not see the filter. On `all` the two behave identically. On `this
kehikko` the new one is narrower, and somebody who wants the lot presses *Show
everything* in the filter first. The reverse — a button that quietly deletes more
than it says it will — has no such recovery.

`held` and `keep` survive, on the empty-state line, and that is not sentiment:
`held` counts the STORE while the new label counts the SCREEN, so "nothing has
happened" and "nothing has happened *here*, and eleven things happened
elsewhere" go on reading differently.

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
