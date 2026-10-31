import './styles/tokens.css'
import './styles/app.css'
import './styles/output.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { OutputView } from './OutputView'
import { PrepareView } from './PrepareView'
import { applyAppearance, loadAccent, loadThemePref } from './theme'

// `#/output` is the HDMI Program window (see main/display-output.ts);
// `#/output?role=omt` is the offscreen OMT window (see main/omt-output.ts).
const [hashPath, hashQuery = ''] = window.location.hash.split('?')
const isOutput = hashPath === '#/output'
const query = new URLSearchParams(hashQuery)
const role = query.get('role') === 'omt' ? 'omt' : 'hdmi'
// `#/prepare?deck=<id>` is a web deck's Prepare window (see main/web/prepare-window.ts).
const prepareDeck = hashPath === '#/prepare' ? query.get('deck') : null

// Apply the saved appearance before the first paint (the OS theme is the default).
if (!isOutput) applyAppearance(loadThemePref(), loadAccent())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOutput ? (
      <OutputView role={role} />
    ) : prepareDeck ? (
      <PrepareView deckId={prepareDeck} />
    ) : (
      <App />
    )}
  </StrictMode>
)
