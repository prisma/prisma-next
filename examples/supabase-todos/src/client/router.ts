/**
 * Tiny in-app page state machine. The SPA has three "pages":
 *
 *   - `login`  — unauthenticated landing.
 *   - `todos`  — authenticated, RLS-scoped CRUD against /api/todos,
 *                with realtime updates layered on top.
 *   - `public` — public board, no auth required.
 *
 * react-router would be overkill for three states without deep links
 * or browser-history requirements; a simple `usePage()` hook backed
 * by `useState` is enough for the PoC. If the SPA later grows tabs /
 * deep links / param routing we can swap this out.
 */
export type Page = 'login' | 'todos' | 'public';
