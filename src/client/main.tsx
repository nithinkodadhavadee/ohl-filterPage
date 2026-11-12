import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StatusPage } from './StatusPage';
import { TermsPage } from './TermsPage';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const path = window.location.pathname.replace(/\/+$/, '') || '/';

createRoot(rootElement).render(
  <StrictMode>
    {path === '/status' ? (
      <StatusPage />
    ) : path === '/terms' ? (
      <TermsPage />
    ) : (
      <App />
    )}
  </StrictMode>,
);
