import './styles/tokens.css'
import './styles/app.css'
import './styles/output.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { OutputView } from './OutputView'
import { PrepareView } from './PrepareView'
import {
  applyAppearance,
  applyReduceMotion,
  loadAccent,
  loadReduceMotion,
  loadThemePref
} from './theme'

// `#/output` is the HDMI Program window (see main/display-output.ts);
// `#/output?role=omt` is the offscreen OMT window (see main/omt-output.ts).
const [hashPath, hashQuery = ''] = window.location.hash.split('?')
const isOutput = hashPath === '#/output'
const query = new URLSearchParams(hashQuery)
const role = query.get('role') === 'omt' ? 'omt' : 'hdmi'
// `#/prepare?deck=<id>` is a web deck's Prepare window (see main/web/prepare-window.ts).
const prepareDeck = hashPath === '#/prepare' ? query.get('deck') : null
// `#/?skipHome=1` (PPT_SKIP_HOME=1, e2e only): the operator window opens on the console, not Home.
const skipHome = hashPath === '#/' && query.get('skipHome') === '1'

// Apply the saved appearance before the first paint (the OS theme is the default).
if (!isOutput) {
  applyAppearance(loadThemePref(), loadAccent())
  applyReduceMotion(loadReduceMotion())
}

// Operator only: after a mouse press the focus ring stays off buttons, Tab brings it back.
// Focus itself never moves (dialogs and the gear depend on it).
if (!isOutput && !prepareDeck) {
  const root = document.documentElement
  window.addEventListener(
    'pointerdown',
    () => {
      root.dataset.input = 'mouse'
    },
    true
  )
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab') delete root.dataset.input
      // Arrow navigation inside a tablist, radiogroup or menu needs a visible position. Arrows
      // elsewhere (a clicker during a show) leave the ring off.
      else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) &&
        e.target instanceof Element &&
        e.target.closest('[role=tablist], [role=radiogroup], [role=menu]')
      )
        delete root.dataset.input
    },
    true
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOutput ? (
      <OutputView role={role} />
    ) : prepareDeck ? (
      <PrepareView deckId={prepareDeck} />
    ) : (
      <App skipHome={skipHome} />
    )}
  </StrictMode>
)
