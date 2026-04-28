import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { LoginForm } from './components/LoginForm';
import { TopNav } from './components/TopNav';
import type { Page } from './router';

/**
 * Top-level SPA shell. Decides which page to render based on auth
 * state and the user's active tab selection. Only `auth` is wired in
 * this commit — `todos` and `public` lay-down placeholders that the
 * subsequent phase-4c commits replace with real components (T4.10,
 * T4.12, T4.11).
 */
export function App(): React.ReactNode {
  const { state } = useAuth();
  const [page, setPage] = useState<Page>('login');

  useEffect(() => {
    if (state.status === 'authenticated' && page === 'login') {
      setPage('todos');
    }
    if (state.status === 'anonymous' && page === 'todos') {
      setPage('login');
    }
  }, [state.status, page]);

  if (state.status === 'loading') {
    return <div className="loading">Loading session…</div>;
  }

  return (
    <div className="app-shell">
      <TopNav page={page} onNavigate={setPage} />
      <main className="app-main">
        {page === 'login' ? <LoginForm /> : null}
        {page === 'todos' && state.status === 'authenticated' ? (
          <div className="placeholder">Todos page lands in T4.10.</div>
        ) : null}
        {page === 'public' ? <div className="placeholder">Public board lands in T4.12.</div> : null}
      </main>
    </div>
  );
}
