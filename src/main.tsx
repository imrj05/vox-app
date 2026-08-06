import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './lib/error-reporting.ts'
import { ErrorFallback } from './components/error-page.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary
        fallback={({ error, componentStack, resetError }) => (
          <ErrorFallback error={error as Error | undefined} componentStack={componentStack} onReset={resetError} />
        )}
        onError={(error, info) => {
          console.error("Vox UI error:", error, info);
        }}
      >        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
