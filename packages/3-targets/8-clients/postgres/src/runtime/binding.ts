import { Client as PgClient, Pool as PgPool } from 'pg';
import type { PostgresBinding, PostgresBindingInput } from './types';

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
