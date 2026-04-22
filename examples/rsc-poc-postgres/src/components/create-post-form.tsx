'use client';

import { useActionState } from 'react';
import { type CreatePostState, createPostAction } from '../../app/actions';

/**
 * Client-side form for the `createPostAction` Server Action.
 *
 * This is the one interactive surface in the PoC. It exists to demonstrate
 * (by hand, not under k6) that a Server Action mutation can run alongside
 * the page's five parallel Server Component reads without the shared
 * runtime blowing up.
 *
 * Uses `useActionState` to surface the action's result inline. The action
 * itself calls `revalidatePath('/')` on success, so the updated row shows
 * up in `<PostsWithAuthors />` and `<RecentPostsRaw />` on the next render.
 */

const INITIAL_STATE: CreatePostState = { status: 'idle' };

export function CreatePostForm() {
  const [state, formAction, pending] = useActionState(createPostAction, INITIAL_STATE);

  return (
    <div className="card">
      <h2>Create a post (Server Action)</h2>
      <p className="muted">
        <code>createPostAction(title) → revalidatePath('/')</code>
      </p>
      <form action={formAction}>
        <input
          type="text"
          name="title"
          placeholder="Post title"
          required
          disabled={pending}
          aria-label="Post title"
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create'}
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
