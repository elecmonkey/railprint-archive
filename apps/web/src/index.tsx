import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Latin letters, digits and punctuation in Geist everywhere; Chinese falls
// through to the system's font.
import '@fontsource-variable/geist';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
