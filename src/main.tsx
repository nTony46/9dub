import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './styles/index.css'
import { App } from './app/App'
import { useApp } from './store/appStore'

// Dev-only handle for debugging and scripted inspection; stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __9dub: typeof useApp }).__9dub = useApp

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
