import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth';
import './styles.css';

const el = document.getElementById('root');
if (!el) {
  throw new Error('Missing #root element in index.html');
}

createRoot(el).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
