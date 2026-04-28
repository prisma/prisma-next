/**
 * Todos page.
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
 *     replace it with the server's persisted row (which has the
 *     server-generated id and `created_at`).
 *   - **Toggle complete**: flip `completed` locally; PATCH; on
 *     success swap in the server row, on failure revert.
 *   - **Delete**: mark the row `pending` (greyed-out style); DELETE;
 *     remove on success or on a 404 (the row is already gone — e.g.
 *     deleted from another tab); clear `pending` and surface the
 *     error on any other failure. The "remove only after the server
 *     confirms" shape is more conservative than a true optimistic
 *     delete (which would remove immediately and reinstate on
 *     failure) and is the right trade for the PoC: the row stays
 *     visible until isolation has been observed end-to-end, so a
 *     reviewer running the demo can see the round-trip happen.
 *
 * The render path keeps a `TodoView` shape that distinguishes
 * `optimistic: true` placeholders (greyed out) from server-confirmed
 * rows. Realtime updates layer on top — `postgres_changes` inserts
 * append (or replace any matching optimistic placeholder), updates
 * patch in place, deletes remove. The placeholder lifecycle here is
 * the foundation realtime builds on.
 */
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, apiJson } from '../api-fetch';
import { useAuth } from '../auth';
import { supabase } from '../supabase';

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

  // Realtime subscription. Pushes INSERT / UPDATE /
  // DELETE events for `public.todos` rows where `user_id = <uid>`
  // into the local list so:
  //   1. an INSERT done in another tab (or via psql) appears
  //      without a refresh.
  //   2. UPDATE / DELETE from another tab reconcile in place.
  //   3. an INSERT we just made via POST is reconciled with its
  //      corresponding optimistic placeholder if the placeholder
  //      hasn't been swapped yet.
  //
  // Two layers enforce isolation:
  //   - **Filter** (`user_id=eq.<uid>`): tells the realtime
  //     broker not to push events the client wouldn't have
  //     access to anyway. Display optimization, not a security
  //     boundary.
  //   - **RLS** (per-table policies + the role on the realtime
  //     connection): even without the filter the broker would
  //     run the same RLS check it runs for SELECT — alice's
  //     subscription cannot receive bob's rows. Cf. FL-20:
  //     the publication has to include `public.todos`, set up
  //     in `scripts/seed.ts` via `ensureRealtimePublication()`.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`todos:user:${userId}`)
      .on<ServerTodo>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'todos',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => applyRealtime(payload, setTodos),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
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
      // the user's intent as fulfilled.
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

/**
 * Reconcile a realtime postgres_changes payload against the local
 * list. The list state is owned by the React component; this helper
 * is an extracted pure-ish function (the setter is the only side
 * effect) so the channel callback stays slim.
 *
 * INSERT: append, but de-dupe against the row id AND against any
 * matching optimistic placeholder by title (a POST round-trip can
 * race with the realtime push — whichever wins, the local id is
 * resolved to the server id). Without the title-keyed de-dupe, a
 * just-created todo would briefly appear twice (once as the
 * placeholder, once as the realtime row) before the POST response
 * arrives and replaces the placeholder.
 *
 * **Known limitation — two-tab same-title creation.** The title-keyed
 * de-dupe is a heuristic, not an invariant. If the same user opens
 * two tabs and creates a todo with the same title in both, the
 * realtime push for Tab B's row can match Tab A's still-pending
 * placeholder by title and replace it; Tab A's POST then resolves
 * its placeholder-id (no longer in the list) into a no-op map, so
 * Tab A's row drops out of the local view (still in the database;
 * a refresh repairs it). Acceptable for the PoC: the workaround is
 * "use different titles or accept the visual artifact." The
 * fully-correct fix would be a client-id round-trip protocol — POST
 * sends a placeholder id, the server stores it on the row, the
 * broker echoes it back so the realtime push carries the original
 * client id and the de-dupe becomes id-keyed instead of title-keyed.
 * Out of scope for the PoC.
 *
 * UPDATE: patch in place. Skip if we don't have the row (we may
 * have filtered it out, or the SPA was opened mid-stream).
 *
 * DELETE: remove if present. The payload's `old` carries the id
 * of the deleted row.
 *
 * **Safety note on DELETE id collisions.** The local list mixes
 * server-generated UUIDs with optimistic placeholder ids of the
 * form `optimistic-<uuid>` (see `clientId()`). The two namespaces
 * cannot collide — `payload.old.id` is always a server UUID, and a
 * placeholder id always has the literal `optimistic-` prefix — so
 * a DELETE event for a server row can never accidentally remove an
 * in-flight placeholder. If `clientId()` is ever changed to drop
 * the prefix, re-evaluate this helper: the id-keyed filter at the
 * end of the DELETE branch would no longer have that namespace
 * separation.
 */
function applyRealtime(
  payload: RealtimePostgresChangesPayload<ServerTodo>,
  setTodos: React.Dispatch<React.SetStateAction<readonly TodoView[]>>,
): void {
  if (payload.eventType === 'INSERT') {
    const incoming = fromServer(payload.new);
    setTodos((prev) => {
      if (prev.some((t) => t.id === incoming.id)) return prev;
      const optimisticMatch = prev.find((t) => t.optimistic && t.title === incoming.title);
      const next = optimisticMatch
        ? prev.map((t) => (t === optimisticMatch ? incoming : t))
        : [incoming, ...prev];
      return [...next].sort(byCreatedAtDesc);
    });
    return;
  }
  if (payload.eventType === 'UPDATE') {
    const updated = fromServer(payload.new);
    setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    return;
  }
  if (payload.eventType === 'DELETE') {
    const oldId = (payload.old as Partial<ServerTodo>).id;
    if (!oldId) return;
    setTodos((prev) => prev.filter((t) => t.id !== oldId));
  }
}
