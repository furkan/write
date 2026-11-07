import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import '@fontsource/carlito/400.css'
import '@fontsource/carlito/400-italic.css'
import '@fontsource/carlito/700.css'
import '@fontsource/carlito/700-italic.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
