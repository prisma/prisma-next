import type { Client, Pool } from 'pg';
import { Client as PgClient, Pool as PgPool } from 'pg';
import type { PostgresBinding, PostgresTargetId } from './types';

interface BindingInput {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPool(binding: Pool | Client): binding is Pool {
  return binding instanceof PgPool;
}

function isClient(binding: Pool | Client): binding is Client {
  return binding instanceof PgClient;
}

function isPoolLike(binding: unknown): binding is Pool {
  if (!isRecord(binding)) {
    return false;
  }
  return (
    typeof binding['connect'] === 'function' &&
    typeof binding['query'] === 'function' &&
    typeof binding['end'] === 'function' &&
    typeof binding['totalCount'] === 'number' &&
    typeof binding['idleCount'] === 'number' &&
    typeof binding['waitingCount'] === 'number'
  );
}

function isClientLike(binding: unknown): binding is Client {
  if (!isRecord(binding)) {
    return false;
  }
  return (
    typeof binding['connect'] === 'function' &&
    typeof binding['query'] === 'function' &&
    typeof binding['end'] === 'function' &&
    isRecord(binding['connectionParameters'])
  );
}

function hasRuntimeBinding(options: BindingInput): boolean {
  return options.binding !== undefined || options.url !== undefined || options.pg !== undefined;
}

export function resolvePostgresBinding(options: BindingInput): PostgresBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount > 1) {
    throw new Error('Provide only one binding input: binding, url, or pg');
  }

  if (!hasRuntimeBinding(options)) {
    throw new Error('Provide one binding input: binding, url, or pg');
  }

  if (options.binding) {
    return options.binding;
  }

  if (options.url) {
    return { kind: 'url', url: options.url };
  }

  if (!options.pg) {
    throw new Error('Provide one binding input: binding, url, or pg');
  }

  if (isPool(options.pg)) {
    return { kind: 'pgPool', pool: options.pg };
  }

  if (isClient(options.pg)) {
    return { kind: 'pgClient', client: options.pg };
  }

  if (isPoolLike(options.pg)) {
    return { kind: 'pgPool', pool: options.pg };
  }

  if (isClientLike(options.pg)) {
    return { kind: 'pgClient', client: options.pg };
  }

  throw new Error('Unable to determine pg binding type; use explicit binding.kind');
}

export type { PostgresTargetId };
