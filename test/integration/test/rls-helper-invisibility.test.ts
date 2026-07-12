/**
 * The RLS authoring helpers are Postgres-only surface: they are exported from
 * `@prisma-next/postgres/contract-builder` and reachable from no other
 * target's contract-builder. SQLite and Mongo authors never see them.
 */
import * as mongoContractBuilder from '@prisma-next/mongo/contract-builder';
import * as postgresContractBuilder from '@prisma-next/postgres/contract-builder';
import * as sqliteContractBuilder from '@prisma-next/sqlite/contract-builder';
import { describe, expect, it } from 'vitest';

const RLS_HELPER_NAMES = [
  'policySelect',
  'policyInsert',
  'policyUpdate',
  'policyDelete',
  'policyAll',
  'rlsEnabled',
  'role',
] as const;

describe('RLS helper invisibility off Postgres', () => {
  it('the postgres contract-builder exports every RLS helper', () => {
    const exported: Record<string, unknown> = { ...postgresContractBuilder };
    for (const name of RLS_HELPER_NAMES) {
      expect(typeof exported[name], `postgres should export ${name}`).toBe('function');
    }
  });

  it('the sqlite contract-builder exports none of them', () => {
    const exported = Object.keys(sqliteContractBuilder);
    for (const name of RLS_HELPER_NAMES) {
      expect(exported, `sqlite must not export ${name}`).not.toContain(name);
    }
  });

  it('the mongo contract-builder exports none of them', () => {
    const exported = Object.keys(mongoContractBuilder);
    for (const name of RLS_HELPER_NAMES) {
      expect(exported, `mongo must not export ${name}`).not.toContain(name);
    }
  });
});
