/**
 * How long ago, in as few characters as a 220-pixel container can spare.
 *
 * Relative rather than absolute, for two reasons that point the same way. The
 * question a person asks a notification panel is "is this recent", not "what
 * time was it" — and an absolute timestamp is unwrappable text, so drawing one
 * sets a floor on how narrow a row can be. The exact time goes in the row's
 * `title`, so hovering still answers the other question and costs the layout
 * nothing.
 *
 * A time this cannot parse is drawn as the raw string rather than as "just
 * now". The case should not arise — the host stamps `at` itself, out of its own
 * clock, precisely so that every consumer of one event agrees on when it
 * happened. If it ever does arise, showing the nonsense is how somebody finds
 * out, where a confident "just now" would be this page inventing a fact about
 * somebody else's program.
 *
 * `now` is a parameter so this is testable without freezing a clock. A function
 * whose only untestable part is `Date.now()` is a function that quietly stops
 * being tested.
 */
export function ago(at: string, now: number = Date.now()): string {
  const then = Date.parse(at)
  if (!Number.isFinite(then)) return at
  /* Clamped at zero. A row stamped a second in the future — two machines'
     clocks, or a host and a browser disagreeing — would otherwise render as a
     negative age, which reads as a bug in this page rather than as skew. */
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return `${Math.round(days / 7)}w ago`
}
