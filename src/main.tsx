import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './lib/error-reporting.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary fallback={<div className="p-6 text-sm text-foreground">Vox hit an unexpected error. Restart the app to continue.</div>}>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
