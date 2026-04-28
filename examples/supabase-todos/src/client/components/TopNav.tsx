import { useAuth } from '../auth';
import type { Page } from '../router';

interface Props {
  readonly page: Page;
  readonly onNavigate: (page: Page) => void;
}

export function TopNav({ page, onNavigate }: Props): React.ReactNode {
  const { state, signOut } = useAuth();
  // supabase-js v2 clears the local session before attempting the
  // server-side revoke, so even on a network failure the SPA's auth
  // state flips to anonymous via `onAuthStateChange(null)`. Logging the
  // failure (rather than displaying it) is the right shape: the user's
  // observable outcome is "I am signed out" either way; a logged
  // failure surfaces in DevTools for any contributor debugging the
  // auth path.
  const onSignOut = (): void => {
    void signOut().catch((err: unknown) => {
      console.error('[supabase-todos] signOut failed', err);
    });
  };
  return (
    <nav className="top-nav">
      <div className="top-nav-brand">supabase-todos</div>
      <div className="top-nav-tabs">
        {state.status === 'authenticated' ? (
          <button
            type="button"
            className={page === 'todos' ? 'is-active' : ''}
            onClick={() => onNavigate('todos')}
          >
            My todos
          </button>
        ) : null}
        <button
          type="button"
          className={page === 'public' ? 'is-active' : ''}
          onClick={() => onNavigate('public')}
        >
          Public board
        </button>
      </div>
      <div className="top-nav-account">
        {state.status === 'authenticated' ? (
          <>
            <span className="top-nav-email">{state.session?.user.email}</span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </nav>
  );
}
