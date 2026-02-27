import type { Client, Pool } from 'pg';
import { Client as PgClient, Pool as PgPool } from 'pg';

export type PostgresBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'pgPool'; readonly pool: Pool }
  | { readonly kind: 'pgClient'; readonly client: Client };

export type PostgresBindingInput =
  | {
      readonly binding: PostgresBinding;
      readonly url?: never;
      readonly pg?: never;
    }
  | {
      readonly url: string;
      readonly binding?: never;
      readonly pg?: never;
    }
  | {
      readonly pg: Pool | Client;
      readonly binding?: never;
      readonly url?: never;
    };

function validatePostgresUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error('Postgres URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Postgres URL must be a valid URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Postgres URL must use postgres:// or postgresql://');
  }

  return trimmed;
}

export function resolvePostgresBinding(options: PostgresBindingInput): PostgresBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount !== 1) {
    throw new Error('Provide one binding input: binding, url, or pg');
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    return { kind: 'url', url: validatePostgresUrl(options.url) };
  }

  const pgBinding = options.pg;
  if (pgBinding === undefined) {
    throw new Error('Invariant violation: expected pg binding after validation');
  }

  if (pgBinding instanceof PgPool) {
    return { kind: 'pgPool', pool: pgBinding };
  }

  if (pgBinding instanceof PgClient) {
    return { kind: 'pgClient', client: pgBinding };
  }

  throw new Error(
    'Unable to determine pg binding type from pg input; use binding with explicit kind',
  );
}
