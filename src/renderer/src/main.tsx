import './styles/tokens.css'
import './styles/app.css'
import './styles/output.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { OutputView } from './OutputView'
import { applyTheme, loadTheme } from './theme'

// `#/output` is the HDMI Program window (see main/display-output.ts);
// `#/output?role=omt` is the offscreen OMT window (see main/omt-output.ts).
const [hashPath, hashQuery = ''] = window.location.hash.split('?')
const isOutput = hashPath === '#/output'
const role = new URLSearchParams(hashQuery).get('role') === 'omt' ? 'omt' : 'hdmi'

// Apply the saved theme before the first paint (dark is the default).
if (!isOutput) applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOutput ? <OutputView role={role} /> : <App />}</StrictMode>
)
