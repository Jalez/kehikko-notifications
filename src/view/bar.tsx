import { Button } from '@/components/ui/button.tsx'
import type { Kehikko } from '../../store.ts'
import type { Scope } from '../sift.ts'

/**
 * The bar: the filter, what is held, and one destructive press.
 *
 * ## The filter is two shadcn Buttons, not a segmented widget of my own
 *
 * Two `Button`s carrying `aria-pressed`, sharing a bordered group. `default`
 * for the chosen one and `ghost` for the other, so the state is a real variant
 * rather than a class this file invented — which is what keeps it looking like
 * every other press in this workspace when somebody changes the theme tokens.
 *
 * Two states and not three. There is no "everywhere except here": nobody asked
 * for it, and a third option on a control in a 220-pixel container is a third option
 * nobody reads. The user's words were "all, or this kehikko", and that is the
 * whole of it.
 *
 * The "this kehikko" button is never DISABLED, even when the container does not know
 * where it is standing. A disabled control is a dead end — it says no and says
 * nothing about why, and the reason here is worth reading. Pressing it puts a
 * sentence on the page instead, and the sentence is the point: this container has
 * not been told which kehikko it is on. See `sift.ts`.
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
  scope,
  here,
  held,
  keep,
  armed,
  onScope,
  onForget,
}: {
  scope: Scope
  here: Kehikko | null
  held: number
  keep: number
  armed: boolean
  onScope(next: Scope): void
  onForget(): void
}) {
  return (
    <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-1.5 border-b bg-background px-2.5 py-2 @[340px]/container:px-3">
      <div className="flex shrink-0 overflow-hidden rounded-md border" role="group" aria-label="which notifications to show">
        <Button
          type="button"
          size="container"
          variant={scope === 'all' ? 'default' : 'ghost'}
          aria-pressed={scope === 'all'}
          className="rounded-none border-0"
          title="Everything this container has been shown, from every kehikko."
          onClick={() => onScope('all')}
        >
          All
        </Button>
        <Button
          type="button"
          size="container"
          variant={scope === 'here' ? 'default' : 'ghost'}
          aria-pressed={scope === 'here'}
          className="rounded-none border-0"
          title={
            here
              ? `Only what happened on ${here.name || `kehikko ${here.id}`}.`
              : 'This container has not been told which kehikko it is on, so this cannot be answered honestly.'
          }
          onClick={() => onScope('here')}
        >
          This kehikko
        </Button>
      </div>

      {/* The count is the first thing to go at the narrowest end: it is the
          least load-bearing text on the bar and it is what pushes the filter
          onto a second line. The same fact is in the note below when it
          matters. */}
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
