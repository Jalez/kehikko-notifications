import { Badge } from '@/components/ui/badge.tsx'
import { cn } from '@/lib/utils.ts'
import type { EpicPart } from 'kehikot-module-protocol'
import type { Kehikko, Row } from '../../store.ts'
import { ago } from './ago.ts'

/**
 * One notification, drawn as testimony rather than as a fact.
 *
 * ## The attribution comes FIRST, and it has a verb in it
 *
 * "kehikot.checklist says", above the message, and not "kehikot.checklist:"
 * underneath it. Both halves of that are deliberate.
 *
 * `from` is the host's word: taken from its own registry rather than from
 * anything the sender put in the payload, so no module can post under another
 * module's name. It is the one field a receiver may safely attribute by. The
 * CONTENTS are the sender's claim and nothing more — the protocol's essay on
 * `eventSchema` puts it plainly, that a host relaying "the tests passed" has
 * not checked that any test ran.
 *
 * So a panel that printed the sentence alone would be a panel asserting things
 * nobody asserted, in the host's voice, on the strength of the host's frame
 * around it. The verb is what stops that. And it goes ABOVE, because a by-line
 * underneath is a footnote and a by-line above is a speaker: a reader should
 * know whose claim it is before they read the claim.
 *
 * ## The level is a colour and also a word
 *
 * The dot carries the colour and its `title` carries the word. Colour alone is
 * a claim a person with any kind of colour blindness cannot read, and there is
 * no room in this column for a fifth badge saying "attention".
 */

const LEVEL_COLOUR: Record<string, string> = {
  info: 'bg-info',
  attention: 'bg-attention',
  done: 'bg-done',
  blocked: 'bg-blocked',
}

/**
 * Where a notice's `place` is, in a person's words: the parts it names (by name when they are
 * parts of the epic that is open, else counted) and the kehikko it names (when it is the one the
 * notice happened on, whose name this row holds). Epic is left out: its badge is already there.
 */
export function placeWords(row: Row, parts: readonly EpicPart[]): string[] {
  const place = row.payload.place
  if (!place) return []
  const words: string[] = []
  if (place.parts?.length) {
    const named = place.parts.map((id) => parts.find((one) => one.id === id)?.heading).filter((n): n is string => Boolean(n))
    words.push(named.length === place.parts.length ? named.join(', ') : `${place.parts.length} ${place.parts.length === 1 ? 'part' : 'parts'}`)
  }
  if (place.kehikko && row.kehikko?.key === place.kehikko && row.kehikko.name) words.push(row.kehikko.name)
  return words
}

export function Line({
  row,
  here,
  parts = [],
  onGo,
}: {
  row: Row
  here: Kehikko | null
  parts?: readonly EpicPart[]
  onGo?: (row: Row) => void
}) {
  const level = String(row.payload.level ?? 'info')
  const message = String(row.payload.message ?? '')
  const epic = String(row.payload.epic ?? '')
  const refs = row.payload.refs ?? []

  /*
   * Which of the three things this row can say about WHERE it happened.
   *
   * A row with no kehikko happened while no canvas was open: it is neither here
   * nor elsewhere, and hiding that would leave a count that never adds up. A
   * row from another canvas is marked. A row from this one is not marked at
   * all — see the essay in `badge.tsx` on why only the far ones are.
   */
  const where =
    row.kehikko === null
      ? 'no kehikko'
      : !here || row.kehikko.id !== here.id
        ? `on ${row.kehikko.name || `kehikko ${row.kehikko.id}`}`
        : null

  const placed = placeWords(row, parts)
  /* A press goes somewhere only when the notice said where AND there is an epic to go to. */
  const goes = Boolean(onGo && row.payload.place && (row.payload.place.epic || epic))

  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 border-b px-2.5 py-2 @[340px]/container:px-3 @[340px]/container:py-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[0.7rem] text-muted-foreground">
        <span
          className={cn('size-[7px] shrink-0 self-center rounded-full', LEVEL_COLOUR[level] ?? 'bg-info')}
          title={`level: ${level}`}
        />
        <span className="min-w-0 font-semibold text-foreground [overflow-wrap:anywhere]">{row.from}</span>
        <span>says</span>
        {/* `whitespace-nowrap` on the age and nowhere else: it is three
            characters and breaking "2h ago" across a line reads as two facts. */}
        <span className="whitespace-nowrap" title={row.at}>
          {ago(row.at)}
        </span>
      </div>

      {goes ? (
        <button
          type="button"
          onClick={() => onGo?.(row)}
          className="m-0 min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left text-inherit [overflow-wrap:anywhere] hover:underline focus-visible:underline"
        >
          {message}
        </button>
      ) : (
        <p className="m-0 min-w-0 [overflow-wrap:anywhere]">{message}</p>
      )}

      {(epic || refs.length > 0 || where) && (
        <div className="flex min-w-0 flex-wrap gap-1">
          {epic && <Badge>{epic}</Badge>}
          {refs.map((ref) => (
            <Badge key={ref} variant="outline">
              {ref}
            </Badge>
          ))}
          {placed.map((word) => (
            <Badge key={`place-${word}`} variant="outline">
              {word}
            </Badge>
          ))}
          {where && <Badge variant="elsewhere">{where}</Badge>}
        </div>
      )}
    </li>
  )
}
