/**
 * Browser-side `apiFetch` helper.
 *
 * Wraps `fetch` with the current Supabase session's access token as a
 * `Authorization: Bearer <jwt>` header. Use this for every `/api/*`
 * call from the SPA. If no session is active, the header is omitted
 * and the request lands on a public-route or fails with 401 on a
 * gated route — the SPA decides which routes it expects to be public
 * (`/api/public/*`).
 *
 * Vite's dev server proxies `/api/*` to the Hono server (see
 * `vite.config.ts`), so callers pass the path as-is — no host /
 * origin handling needed in the SPA.
 *
 * # JSON convenience
 *
 * Most callers want `.json()`. Use `apiJson<T>(...)` for the typical
 * "GET / parse / unwrap errors" shape. It throws an `ApiError` on
 * non-2xx responses so callers can catch and render the server's
 * stable error code (`auth/missing-bearer`, `todos/not-found`, etc.).
 */
import { supabase } from './supabase';

export interface ApiErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, code: string | undefined, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(path, { ...init, headers });
}

/**
 * Convenience wrapper around `apiFetch` that JSON-encodes the body
 * (when present), parses the JSON response, and throws `ApiError` on
 * non-2xx. Returns `undefined` on 204 No Content.
 */
export async function apiJson<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers: rawHeaders, body: rawBody, ...rest } = init;
  const headers = new Headers(rawHeaders);
  const fetchInit: RequestInit = { ...rest, headers };
  if (json !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    fetchInit.body = JSON.stringify(json);
  } else if (rawBody !== undefined && rawBody !== null) {
    fetchInit.body = rawBody;
  }
  const res = await apiFetch(path, fetchInit);

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!res.ok) {
    const errBody = parsed as ApiErrorBody | undefined;
    const nestedCode = errBody?.error?.code;
    const code = errBody?.code ?? nestedCode;
    const nestedMessage = errBody?.error?.message;
    const message =
      errBody?.message ?? nestedMessage ?? `${res.status} ${res.statusText || 'request failed'}`;
    throw new ApiError(res.status, code, message, errBody);
  }

  return parsed as T;
}
