import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicApp from './routes/public/app';
import { getAppMode } from './lib/subdomain';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

const mode = getAppMode();

createRoot(rootElement).render(
  <StrictMode>
    {mode.kind === 'public' ? <PublicApp slug={mode.slug} /> : <App />}
  </StrictMode>,
);
