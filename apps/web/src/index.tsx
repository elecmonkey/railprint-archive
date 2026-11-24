import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Bundled so text looks the same everywhere; Windows would fall back to
// Microsoft YaHei.
import '@fontsource-variable/noto-sans-sc';
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
