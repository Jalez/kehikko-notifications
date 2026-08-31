import { Button } from '@/components/ui/button.tsx'

/**
 * The bar: what is held, and one destructive press.
 *
 * ## The filter used to be here, and the whole point is that it is not
 *
 * Two `Button`s carrying `aria-pressed` — All and This kehikko — used to sit at
 * the left of this row. They were a fixed strip of chrome at the top of a
 * container that is routinely 220 pixels wide and under 300 tall, competing
 * with the lines somebody opened this module to read; and five other modules in
 * this family had each built their own version of the same control, spelled
 * their own way, paying the same cost in the same kind of column.
 *
 * They are now one button in the container HEADER, drawn by the host out of
 * what `sift.ts` offers over `roadmap.filters`. This module still decides what
 * the options are, what they are called and what they mean — the host draws a
 * menu and reports a press, and has no idea what `here` is. What changed is
 * where the control is, and that this row is thirty-one pixels shorter for it.
 *
 * What stayed is the sentence under this bar when the filter cannot be honoured
 * and the count of lines that are neither here nor elsewhere. Those are things
 * this module KNOWS and the host cannot: it sees rows it does not render, in a
 * document it cannot read, in a frame on another origin. The control moved; the
 * reporting did not, and must not.
 *
 * ## Forget takes two presses, and it is not a `confirm()`
 *
 * The host frames modules with no `allow-modals`, so `confirm()` does not throw
 * and does not warn — it returns `false`, which is exactly what a person
 * pressing Cancel produces. A button guarded behind one simply never works,
 * silently, forever, with nothing in any console. That cost the checklist
 * module an afternoon.
 *
 * A two-press arm is better anyway, because it can say what is about to happen
 * in this app's own words rather than in browser chrome.
 */
export function Bar({
  held,
  keep,
  armed,
  onForget,
}: {
  held: number
  keep: number
  armed: boolean
  onForget(): void
}) {
  /*
   * Nothing held, nothing to say, and therefore no bar.
   *
   * It could not be absent before: the filter lived here, and a filter is a
   * thing you may want to press before there is anything to filter. With the
   * filter in the container header this row is only ever a count and a way to
   * discard, and both of those are about lines that exist. An empty container
   * used to spend thirty-one pixels on a bordered strip with nothing in it,
   * above a message saying nothing had happened yet.
   */
  if (held === 0) return null

  return (
    <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-1.5 border-b bg-background px-2.5 py-2 @[340px]/container:px-3">
      {/* Still the first thing to go at the narrowest end, and still for the
          reason it always was: it is the least load-bearing text on this row.
          What it used to be competing with was the filter, which has gone to
          the container header — so at 220 pixels this row is now the count and
          the one press, where it used to wrap. */}
      <span
        className="ml-auto hidden shrink-0 text-[0.7rem] whitespace-nowrap text-muted-foreground @[260px]/container:inline"
        title={
          `This container keeps the last ${keep} it has been shown. ` +
          'Events are not history: one sent while this page was still loading was lost, and nothing resends it.'
        }
      >
        {held} held
      </span>

      {held > 0 && (
        <Button
          type="button"
          size="container"
          variant="outline"
          className={armed ? 'ml-auto text-blocked @[260px]/container:ml-0' : 'ml-auto text-muted-foreground @[260px]/container:ml-0'}
          title={
            armed
              ? `Press again to discard all ${held}. Nothing resends them.`
              : 'Discard everything this container holds. Takes two presses.'
          }
          onClick={onForget}
        >
          {armed ? 'Sure?' : 'Forget'}
        </Button>
      )}
    </div>
  )
}
