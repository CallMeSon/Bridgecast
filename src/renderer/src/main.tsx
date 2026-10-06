import './styles/tokens.css'
import './styles/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, loadTheme } from './theme'

// Apply the saved theme before the first paint (dark is the default).
applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
