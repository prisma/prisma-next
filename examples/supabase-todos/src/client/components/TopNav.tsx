import { useAuth } from '../auth';
import type { Page } from '../router';

interface Props {
  readonly page: Page;
  readonly onNavigate: (page: Page) => void;
}

export function TopNav({ page, onNavigate }: Props): React.ReactNode {
  const { state, signOut } = useAuth();
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
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </nav>
  );
}
