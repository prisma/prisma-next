/**
 * Browser supabase-js client.
 *
 * # The PoC bright line — read this before importing
 *
 * **The browser-side `supabase` client is for `auth` and `channel`
 * only.** Do **not** call `supabase.from('todos').select(...)` (or any
 * other PostgREST table query) from the SPA. App-data CRUD goes
 * through the Hono server at `/api/...`, where the per-request
 * scoped-runtime middleware attaches an RLS-scoped PN session and
 * enforces user-vs-user isolation centrally.
 *
 * Why: PostgREST queries from the browser bypass the PN scoped runtime
 * entirely and rely solely on RLS at the database layer. That's
 * defensible (RLS is correctly enforced for all callers, including
 * PostgREST), but it splits the read/write story across two
 * independent code paths — the server's PN handlers and the
 * browser's PostgREST queries — and any future authorisation rule
 * that lives at the application layer (rate limits, audit logs,
 * cross-table consistency checks) would have to be implemented
 * twice. Keeping all app-data traffic on the `/api/*` path keeps the
 * server as the single point of authorisation.
 *
 * The two legitimate browser-side uses are:
 *
 *   - `supabase.auth.*` — sign-in / sign-up / sign-out / session
 *     management. The JWT in the resulting session is what the
 *     server's JWT middleware verifies on `/api/*` requests.
 *   - `supabase.channel(...)` — Supabase Realtime postgres_changes
 *     subscriptions. The realtime broker enforces RLS the same way
 *     PostgREST does, so subscribers see only events for rows they
 *     would have seen on a SELECT. The channel filter
 *     (`user_id=eq.<uid>`) is a display optimisation — it limits
 *     which events the broker pushes — but the security boundary is
 *     RLS at the database, not the filter string.
 *
 * If you find yourself reaching for `supabase.from('todos')` in this
 * SPA, that's a sign you should be calling `apiFetch('/api/todos',
 * ...)` instead. The server is wired to translate the call into a
 * scoped PN plan; the browser shouldn't need to know about
 * PostgREST at all.
 *
 * @see projects/supabase-poc/spec.md § Client architecture
 * @see ./api-fetch.ts — the helper that wraps `fetch` with the
 *   user's bearer token.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'];
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in the SPA build env. ' +
      'Copy `.env.example` to `.env` (in `examples/supabase-todos/`) and re-run the dev server.',
  );
}

/**
 * Singleton browser client. The constructor is called once at module
 * load — Vite's HMR re-uses the same instance — so subscribers and
 * auth listeners are stable across the SPA lifetime.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Dev-only: expose the client on `window.supabase` so the README's
// two-tab demo step 3 (cross-user 404 via DevTools) can read the
// active session's access token without scraping localStorage. The
// localStorage shape (`sb-<project-ref>-auth-token`) is supabase-js
// version-dependent, so a `window` handle is the more durable seam
// for a documented manual test. Gated on `import.meta.env.DEV` so a
// production build never assigns to `window.supabase` — Vite
// statically replaces the boolean and tree-shakes the branch out.
//
// **This does NOT relax the bright-line rule.** A contributor who
// types `window.supabase.from('todos').select(...)` in DevTools is
// breaking the rule the same way a contributor who imports the
// module directly would. The `window` handle is for inspection
// during development, not for production-shaped data access. The
// docblock above remains the load-bearing prose.
if (import.meta.env.DEV) {
  // biome-ignore lint/suspicious/noExplicitAny: dev-only window augmentation
  (globalThis as any).supabase = supabase;
}
