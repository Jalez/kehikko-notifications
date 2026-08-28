import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
/**
 * Imported for its side effect, and the ORDER on this page is the whole point.
 *
 * `mailbox.ts` installs the one `message` listener at module scope, so it is
 * listening as part of this bundle being evaluated — before React has rendered
 * anything, let alone run an effect. The host greets on the frame's `load`
 * event and effects run strictly after that, so a listener installed in
 * `useEffect` is installed after the greeting has already been posted and
 * thrown away.
 *
 * For every other module in this family that costs a greeting, which the host
 * re-sends on the next frame load. Here it also costs EVENTS, which nobody
 * re-sends: the protocol is explicit that delivery is best-effort and one sent
 * to a module still loading is lost. So the window this import closes is a
 * window in which somebody else's notification disappears with nothing anywhere
 * recording that it did.
 */
import './wire/mailbox.ts'
import { App } from './app.tsx'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
