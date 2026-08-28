import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's badge, used here for the small named things a row is ABOUT: the
 * epic, the references, and — when it is not the reader's own — the kehikko a
 * line came from.
 *
 * They are badges rather than prose because they are NAMES. A name inside a
 * sentence in a 220-pixel column is a name that wraps in the middle, and a
 * half-wrapped `Jalez/kehikko-notifications!12` reads as two different
 * references. A badge is a unit; it wraps as one or not at all.
 *
 * ## The `elsewhere` variant, and why only far ones are marked
 *
 * A badge saying "workbench" on every row while the reader is standing on
 * workbench is a column of noise that says nothing. Marking only the FAR ones
 * makes the badge mean something — this line came from somewhere else — which
 * is the visible half of the near/far filter and the reason a person can trust
 * it without switching modes to check.
 *
 * `whitespace-normal` and `min-w-0`, unlike shadcn's default and unlike
 * `kehikko-checklist`'s copy of this file. There a badge holds one of three
 * fixed words and `whitespace-nowrap` is right. Here it holds a ref another
 * program chose the length of, and a badge that refuses to wrap is a badge that
 * sets a floor on the pane's width — which is the horizontal scrollbar this
 * whole stylesheet is written to avoid.
 */
const badgeVariants = cva(
  'inline-flex min-w-0 max-w-full items-center rounded border px-1.5 py-px text-[0.65rem] leading-4 font-medium [overflow-wrap:anywhere]',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        outline: 'text-muted-foreground',
        /* Far, or unplaceable. Bordered rather than filled, so it reads as a
           qualification on the row rather than as another thing the row is
           about. */
        elsewhere: 'border-dashed text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
