/**
 * Public board page.
 *
 * Renders `/api/public/messages` — the public-route Hono endpoint
 * that the scoped-runtime middleware attaches an **anon-scoped**
 * PN session to. The endpoint works with or without
 * a bearer token; the SPA hits it via `apiFetch`, which attaches
 * the bearer when a session is active and omits it otherwise. Both
 * branches return the same data because the underlying RLS policy
 * (`public_messages_select_public`) grants SELECT to both `anon`
 * and `authenticated` roles.
 *
 * The page is a read-only list — no create / edit / delete. The PoC
 * doesn't exercise INSERT-as-anon (R-FE-5 covers reads only); a
 * future demo could layer write-as-authenticated on top.
 */
import { useEffect, useState } from 'react';
import { apiJson } from '../api-fetch';

interface PublicMessage {
  readonly id: string;
  readonly author_id: string;
  readonly body: string;
  readonly created_at: string;
}

export function PublicBoardPage(): React.ReactNode {
  const [messages, setMessages] = useState<readonly PublicMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiJson<readonly PublicMessage[]>('/api/public/messages')
      .then((rows) => {
        if (cancelled) return;
        setMessages([...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load public messages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="public-board">
      <h1>Public board</h1>
      <p className="public-board-hint">
        Anon and authenticated visitors both see the same messages — RLS lets both roles SELECT from{' '}
        <code>public_messages</code>.
      </p>
      {loading ? <div className="todo-loading">Loading…</div> : null}
      {error ? <div className="todo-error">{error}</div> : null}
      <ul className="public-board-list">
        {messages.length === 0 && !loading && !error ? (
          <li className="todo-empty">
            No public messages — run <code>pnpm seed</code> first.
          </li>
        ) : null}
        {messages.map((msg) => (
          <li key={msg.id} className="public-board-row">
            <div className="public-board-body">{msg.body}</div>
            <div className="public-board-meta">
              <code>{msg.author_id.slice(0, 8)}…</code>
              {' · '}
              {new Date(msg.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
