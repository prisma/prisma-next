'use client';

import { useActionState } from 'react';
import { type CreateEventState, createEventAction } from '../../app/actions';

/**
 * Client-side form for the `createEventAction` Server Action.
 *
 * Mongo analogue of the Postgres app's `<CreatePostForm />`. It exists
 * to demonstrate (by hand, not under k6) that a Server Action mutation
 * can run alongside the page's five parallel Server Component reads
 * without the shared Mongo runtime blowing up.
 *
 * Uses `useActionState` to surface the action's result inline. The
 * action itself calls `revalidatePath('/')` on success, so the new
 * event shows up in `<SearchEvents />` and `<EventTypeStats />` on
 * the next render.
 */

const INITIAL_STATE: CreateEventState = { status: 'idle' };

export function CreateEventForm() {
  const [state, formAction, pending] = useActionState(createEventAction, INITIAL_STATE);

  return (
    <div className="card">
      <h2>Record a search (Server Action)</h2>
      <p className="muted">
        <code>createEventAction(query) → revalidatePath('/')</code>
      </p>
      <form action={formAction}>
        <input
          type="text"
          name="query"
          placeholder="Search query"
          required
          disabled={pending}
          aria-label="Search query"
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record'}
        </button>
      </form>
      {state.status === 'ok' && (
        <p>
          <span className="badge ok">ok</span>
          <span className="muted">{state.message}</span>
        </p>
      )}
      {state.status === 'error' && (
        <p>
          <span className="badge err">error</span>
          <span className="muted">{state.message}</span>
        </p>
      )}
    </div>
  );
}
