import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth';

type Mode = 'sign-in' | 'sign-up';

/**
 * Login / signup form. The seed script creates `alice@example.test`
 * and `bob@example.test` with passwords `password-alice` /
 * `password-bob`; those are the credentials documented in the
 * README two-tab demo procedure. The signup tab is here for ad-hoc
 * testing — it works against the local Supabase Auth and lets the
 * reviewer verify the signup → todos flow end-to-end without
 * running the seed first.
 */
export function LoginForm(): React.ReactNode {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('alice@example.test');
  const [password, setPassword] = useState('password-alice');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === 'sign-in') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>{mode === 'sign-in' ? 'Sign in' : 'Sign up'}</h1>
      <p className="auth-hint">
        Seed users: <code>alice@example.test</code> / <code>password-alice</code>;{' '}
        <code>bob@example.test</code> / <code>password-bob</code>.
      </p>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        </button>
      </form>
      <button
        type="button"
        className="auth-toggle"
        onClick={() => setMode((m) => (m === 'sign-in' ? 'sign-up' : 'sign-in'))}
      >
        {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </div>
  );
}
