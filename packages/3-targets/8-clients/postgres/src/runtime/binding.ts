import type { PostgresBinding } from '@prisma-next/driver-postgres/runtime';
import type { Client, Pool } from 'pg';
import { Client as PgClient, Pool as PgPool } from 'pg';

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

interface PostgresBindingError extends Error {
  readonly code: 'DRIVER.BINDING_INVALID';
  readonly category: 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function bindingError(message: string, details?: Record<string, unknown>): PostgresBindingError {
  const error = new Error(message) as PostgresBindingError;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code: 'DRIVER.BINDING_INVALID' as const,
    category: 'RUNTIME' as const,
    severity: 'error' as const,
    message,
    details,
  });
}

function validatePostgresUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw bindingError('Postgres URL must be a non-empty string', {
      field: 'url',
      reason: 'empty',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw bindingError('Postgres URL must be a valid URL', {
      field: 'url',
      reason: 'invalid-url',
    });
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw bindingError('Postgres URL must use postgres:// or postgresql://', {
      field: 'url',
      reason: 'invalid-protocol',
      protocol: parsed.protocol,
    });
  }

  return trimmed;
}

export function resolvePostgresBinding(options: PostgresBindingInput): PostgresBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount !== 1) {
    throw bindingError('Provide one binding input: binding, url, or pg', {
      providedCount,
    });
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    return { kind: 'url', url: validatePostgresUrl(options.url) };
  }

  const pgBinding = options.pg;
  if (pgBinding === undefined) {
    throw bindingError('Invariant violation: expected pg binding after validation', {
      reason: 'missing-pg-binding',
    });
  }

  if (pgBinding instanceof PgPool) {
    return { kind: 'pgPool', pool: pgBinding };
  }

  if (pgBinding instanceof PgClient) {
    return { kind: 'pgClient', client: pgBinding };
  }

  throw bindingError(
    'Unable to determine pg binding type from pg input; use binding with explicit kind',
    {
      reason: 'unknown-pg-instance',
    },
  );
}
