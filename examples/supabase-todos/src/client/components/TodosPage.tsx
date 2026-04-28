/**
 * Todos page (T4.10).
 *
 * Authenticated route — alice / bob CRUD their own todos via the
 * Hono `/api/todos` API. All reads / writes go through `apiFetch`;
 * the SPA never calls `supabase.from('todos')` (see
 * `client/supabase.ts` docblock for the bright-line rule).
 *
 * # Optimistic UI
 *
 * Writes update the local list immediately and reconcile on the
 * server response:
 *
 *   - **Create**: insert a placeholder row with a UUIDv4 client id;
 *     replace it with the server'\''s persisted row (which has the
 *     server-generated id and `created_at`).
 *   - **Toggle complete**: flip `completed` locally; PATCH; on
 *     success swap in the server row, on failure revert.
 *   - **Delete**: remove the row locally; DELETE; on failure
 *     reinstate it.
 *
 * The render path keeps a `TodoView` shape that distinguishes
 * `optimistic: true` placeholders (greyed out) from server-confirmed
 * rows. T4.11 layers realtime updates on top — `postgres_changes`
 * inserts append (or replace any matching optimistic placeholder),
 * updates patch in place, deletes remove. The placeholder lifecycle
 * here is the foundation realtime builds on.
 */
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, apiJson } from '../api-fetch';
import { useAuth } from '../auth';

interface ServerTodo {
  readonly id: string;
  readonly user_id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly created_at: string;
}

interface TodoView {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly created_at: string;
  /** True while the row exists only client-side (POST not yet acked). */
  readonly optimistic: boolean;
  /** True while a PATCH/DELETE is in flight; greys out the row. */
  readonly pending: boolean;
}

function fromServer(row: ServerTodo): TodoView {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    created_at: row.created_at,
    optimistic: false,
    pending: false,
  };
}

function clientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `optimistic-${crypto.randomUUID()}`;
  }
  return `optimistic-${Math.random().toString(36).slice(2)}`;
}

export function TodosPage(): React.ReactNode {
  const { state } = useAuth();
  const [todos, setTodos] = useState<readonly TodoView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const userId = state.session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiJson<readonly ServerTodo[]>('/api/todos')
      .then((rows) => {
        if (cancelled) return;
        setTodos(rows.map(fromServer).sort(byCreatedAtDesc));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load todos');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const create = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const placeholderId = clientId();
    const placeholder: TodoView = {
      id: placeholderId,
      title: trimmed,
      completed: false,
      created_at: new Date().toISOString(),
      optimistic: true,
      pending: false,
    };
    setTodos((prev) => [placeholder, ...prev]);
    setDraft('');
    try {
      const row = await apiJson<ServerTodo>('/api/todos', {
        method: 'POST',
        json: { title: trimmed },
      });
      setTodos((prev) =>
        prev.map((t) => (t.id === placeholderId ? fromServer(row) : t)).sort(byCreatedAtDesc),
      );
    } catch (err) {
      setTodos((prev) => prev.filter((t) => t.id !== placeholderId));
      setError(err instanceof Error ? err.message : 'Failed to create todo');
    }
  }, []);

  const toggle = useCallback(async (target: TodoView) => {
    if (target.optimistic || target.pending) return;
    const next = !target.completed;
    setTodos((prev) =>
      prev.map((t) => (t.id === target.id ? { ...t, completed: next, pending: true } : t)),
    );
    try {
      const row = await apiJson<ServerTodo>(`/api/todos/${target.id}`, {
        method: 'PATCH',
        json: { completed: next },
      });
      setTodos((prev) => prev.map((t) => (t.id === row.id ? fromServer(row) : t)));
    } catch (err) {
      setTodos((prev) =>
        prev.map((t) =>
          t.id === target.id ? { ...t, completed: target.completed, pending: false } : t,
        ),
      );
      setError(err instanceof Error ? err.message : 'Failed to update todo');
    }
  }, []);

  const remove = useCallback(async (target: TodoView) => {
    if (target.optimistic || target.pending) return;
    setTodos((prev) => prev.map((t) => (t.id === target.id ? { ...t, pending: true } : t)));
    try {
      await apiJson<undefined>(`/api/todos/${target.id}`, { method: 'DELETE' });
      setTodos((prev) => prev.filter((t) => t.id !== target.id));
    } catch (err) {
      setTodos((prev) => prev.map((t) => (t.id === target.id ? { ...t, pending: false } : t)));
      // 404 means the row is already gone (e.g. another tab deleted
      // it, or RLS hid it after a session change). Swallow it; treat
      // the user'\''s intent as fulfilled.
      if (err instanceof ApiError && err.status === 404) {
        setTodos((prev) => prev.filter((t) => t.id !== target.id));
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete todo');
    }
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void create(draft);
  }

  return (
    <div className="todos-page">
      <h1>My todos</h1>
      <form className="todo-create" onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="New todo…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </form>
      {error ? (
        <div className="todo-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {loading ? <div className="todo-loading">Loading todos…</div> : null}
      <ul className="todo-list">
        {todos.length === 0 && !loading ? (
          <li className="todo-empty">No todos yet — add one above.</li>
        ) : null}
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={`todo-row ${todo.completed ? 'is-completed' : ''} ${
              todo.optimistic || todo.pending ? 'is-pending' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={todo.completed}
              disabled={todo.optimistic || todo.pending}
              onChange={() => void toggle(todo)}
            />
            <span className="todo-title">{todo.title}</span>
            <button
              type="button"
              className="todo-delete"
              disabled={todo.optimistic || todo.pending}
              onClick={() => void remove(todo)}
              aria-label={`Delete ${todo.title}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function byCreatedAtDesc(a: TodoView, b: TodoView): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}
